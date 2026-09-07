-- Durable, server-owned Web Push queue.  Enable only after the dispatch route
-- is deployed: alter database postgres set app.notification_queue_enabled = 'on';
create table if not exists public.room_notifications (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  kind text not null default 'generic' check (kind in ('generic','evidence','police-reminder')),
  due_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '1 hour'),
  state text not null default 'pending' check (state in ('pending','sending','sent','failed','cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  lease_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz,
  last_error text,
  unique(room_id, event_key, recipient_user_id)
);
create index if not exists room_notifications_dispatch_idx
  on public.room_notifications(state, due_at, created_at);

create table if not exists public.push_notification_deliveries (
  notification_id uuid not null references public.room_notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  attempts integer not null default 0 check (attempts >= 0),
  state text not null default 'pending' check (state in ('pending','sent','failed')),
  sent_at timestamptz,
  last_error text,
  primary key(notification_id, subscription_id)
);

alter table public.room_notifications enable row level security;
alter table public.push_notification_deliveries enable row level security;
revoke all on public.room_notifications, public.push_notification_deliveries from anon, authenticated;
drop policy if exists "recipients read room notifications" on public.room_notifications;
create policy "recipients read room notifications" on public.room_notifications for select to authenticated
  using (recipient_user_id = auth.uid());
grant select on public.room_notifications to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='room_notifications') then
    alter publication supabase_realtime add table public.room_notifications;
  end if;
end $$;

create or replace function public.request_notification_dispatch() returns void
language plpgsql security definer set search_path=public as $$
declare dispatch_url text := current_setting('app.push_dispatch_url', true); dispatch_secret text := current_setting('app.push_dispatch_secret', true);
begin
  if coalesce(current_setting('app.notification_queue_enabled', true), 'off') <> 'on' or coalesce(dispatch_url,'')='' or coalesce(dispatch_secret,'')='' then return; end if;
  execute format('select net.http_post(url := %L, headers := jsonb_build_object(''x-notification-dispatch-secret'', %L), body := ''{}''::jsonb)', dispatch_url, dispatch_secret);
exception when undefined_function then return;
end $$;
revoke execute on function public.request_notification_dispatch() from public,anon,authenticated;

create or replace function public.queue_room_notification(
  p_room_id uuid, p_event_key text, p_kind text default 'generic',
  p_recipient_user_ids uuid[] default null, p_due_at timestamptz default clock_timestamp(),
  p_expires_at timestamptz default (clock_timestamp() + interval '1 hour')
) returns void language plpgsql security definer set search_path=public as $$
begin
  -- This makes rollout and rollback safe: game writes never depend on Push.
  if coalesce(current_setting('app.notification_queue_enabled', true), 'off') <> 'on' then return; end if;
  if p_kind not in ('generic','evidence','police-reminder') or p_event_key = '' or p_expires_at <= p_due_at then
    raise exception 'invalid notification';
  end if;
  insert into public.room_notifications(room_id,recipient_user_id,event_key,kind,due_at,expires_at)
  select p_room_id, recipient_user_id, p_event_key, p_kind, p_due_at, p_expires_at
  from (
    select host_user_id as recipient_user_id from public.rooms where id=p_room_id
    union
    select user_id from public.players where room_id=p_room_id
  ) recipients
  where p_recipient_user_ids is null or recipient_user_id = any(p_recipient_user_ids)
  on conflict (room_id,event_key,recipient_user_id) do nothing;
  if found then perform public.request_notification_dispatch(); end if;
end $$;
revoke execute on function public.queue_room_notification(uuid,text,text,uuid[],timestamptz,timestamptz) from public,anon,authenticated;

create or replace function public.queue_notification_from_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare recipient uuid; host_id uuid;
begin
  select host_user_id into host_id from public.rooms where id=new.room_id;
  if new.type='system' and new.message in ('เกมเริ่มแล้ว บทบาทถูกแจกเรียบร้อย','Host สั่งจบเกม') then
    perform public.queue_room_notification(new.room_id,'event:'||new.id::text,'generic');
  elsif (new.type in ('winner','attack','bomb') and new.visible_to_player_id is null)
    or (new.type='warning' and new.message='ถึงเวลาตำรวจชี้ตัวแล้ว')
    or (new.type='ability' and new.message='Reporter has used an ability.') then
    perform public.queue_room_notification(new.room_id,'event:'||new.id::text,'generic');
  elsif new.type='warning' and new.message='หลักฐานถูกปฏิเสธ' then
    select user_id into recipient from public.players where id=new.visible_to_player_id;
    perform public.queue_room_notification(new.room_id,'event:'||new.id::text,'generic',array_remove(array[host_id,recipient],null));
  elsif new.type='ability' and new.message like 'บทบาทเริ่มต้นของ %' then
    select user_id into recipient from public.players where id=new.visible_to_player_id;
    perform public.queue_room_notification(new.room_id,'event:'||new.id::text,'generic',array_remove(array[host_id,recipient],null));
  elsif new.type='ability' and new.message='คุณถูกตรวจบทบาท' then
    select user_id into recipient from public.players where id=new.visible_to_player_id;
    perform public.queue_room_notification(new.room_id,'event:'||new.id::text,'generic',array_remove(array[recipient],null));
  end if;
  return new;
end $$;
drop trigger if exists room_events_notification_queue on public.room_events;
create trigger room_events_notification_queue after insert on public.room_events
  for each row execute function public.queue_notification_from_event();

create or replace function public.queue_notification_from_evidence() returns trigger
language plpgsql security definer set search_path=public as $$
declare host_id uuid;
begin
  select host_user_id into host_id from public.rooms where id=new.room_id;
  perform public.queue_room_notification(new.room_id,'evidence:'||new.id::text,'evidence',array[host_id]);
  return new;
end $$;
drop trigger if exists evidence_notification_queue on public.evidence;
create trigger evidence_notification_queue after insert on public.evidence
  for each row execute function public.queue_notification_from_evidence();

-- Called by the scheduler and by dispatch. SKIP LOCKED gives overlapping workers
-- independent batches. A leased row is automatically eligible again after 60s.
create or replace function public.claim_room_notifications(p_limit integer default 20)
returns table(id uuid, room_id uuid, room_code text, recipient_user_id uuid, kind text, attempts integer)
language plpgsql security definer set search_path=public as $$
begin
  update public.room_notifications
  set state='failed', last_error='expired', lease_expires_at=null
  where state in ('pending','sending') and expires_at <= clock_timestamp();
  return query
  with candidates as (
    select n.id from public.room_notifications n
    where n.due_at <= clock_timestamp() and n.expires_at > clock_timestamp()
      and (n.state='pending' or (n.state='sending' and n.lease_expires_at < clock_timestamp()))
      and n.attempts < 8
    order by n.due_at, n.created_at for update skip locked limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update public.room_notifications n set state='sending', attempts=n.attempts+1,
      lease_expires_at=clock_timestamp()+interval '60 seconds'
    from candidates c where n.id=c.id
    returning n.*
  ) select c.id,c.room_id,r.code,c.recipient_user_id,c.kind,c.attempts from claimed c join public.rooms r on r.id=c.room_id;
end $$;
revoke execute on function public.claim_room_notifications(integer) from public,anon,authenticated;

create or replace function public.advance_notification_schedule() returns integer
language plpgsql security definer set search_path=public as $$
declare r record; changed integer := 0; reminder_key text;
begin
  -- Keep old reminder rows from firing after a room closes, ends, or is rescheduled.
  update public.room_notifications n set state='cancelled', lease_expires_at=null
  from public.rooms r where r.id=n.room_id and n.state in ('pending','sending')
    and (r.closed_at is not null or r.phase='ended' or (n.event_key like 'police-reminder:%' and n.event_key <> 'police-reminder:'||r.id::text||':'||coalesce(r.police_check_at::text,'')));
  for r in select id,police_check_at from public.rooms
    where closed_at is null and phase='active' and police_check_at is not null
  loop
    reminder_key := 'police-reminder:'||r.id::text||':'||r.police_check_at::text;
    if r.police_check_at - interval '3 minutes' <= clock_timestamp()
      and r.police_check_at - interval '3 minutes' + interval '30 seconds' > clock_timestamp() then
      perform public.queue_room_notification(r.id,reminder_key,'police-reminder',null,
        greatest(r.police_check_at - interval '3 minutes', clock_timestamp()),
        r.police_check_at - interval '3 minutes' + interval '30 seconds');
    end if;
    if r.police_check_at <= clock_timestamp() and public.advance_due_accusation(r.id) then changed := changed+1; end if;
  end loop;
  return changed;
end $$;
revoke execute on function public.advance_notification_schedule() from public,anon,authenticated;

-- Install this optional job after setting app.push_dispatch_url and
-- app.push_dispatch_secret. It is intentionally not auto-installed so a schema
-- migration cannot send traffic before the deployment is ready.
create or replace function public.install_notification_cron() returns void
language plpgsql security definer set search_path=public as $$
begin
  if coalesce(current_setting('app.notification_queue_enabled', true), 'off') <> 'on' then raise exception 'notification queue is disabled'; end if;
  perform public.advance_notification_schedule();
  execute $sql$select cron.schedule('killer-notification-worker','1 second',
    format($job$select public.advance_notification_schedule(); select net.http_post(url := %L, headers := jsonb_build_object('x-notification-dispatch-secret', %L), body := '{}'::jsonb);$job$,
      current_setting('app.push_dispatch_url'), current_setting('app.push_dispatch_secret')))$sql$;
end $$;
revoke execute on function public.install_notification_cron() from public,anon,authenticated;
