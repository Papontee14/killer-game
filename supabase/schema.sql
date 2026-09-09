-- Killer production schema. Apply to a fresh Supabase project.
-- Existing current-schema rooms: use migrations/20260905_role_rules.sql instead.
-- All game-state writes happen in the security-definer functions below.
-- Supabase installs pgcrypto in its dedicated `extensions` schema.  Keep the
-- extension calls explicitly qualified because the security-definer RPCs use
-- a restricted `search_path` containing only `public`.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$ begin create type public.room_phase as enum ('lobby','active','police-check','bomb-resolution','ended'); exception when duplicate_object then null; end $$;
do $$ begin create type public.health_state as enum ('alive','critical','dead'); exception when duplicate_object then null; end $$;
do $$ begin create type public.evidence_status as enum ('pending','approved','rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type public.winning_team as enum ('city','killers'); exception when duplicate_object then null; end $$;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(), code text unique not null check (code ~ '^[A-Z0-9]{6}$'),
  host_user_id uuid not null references auth.users(id), host_name text not null,
  phase public.room_phase not null default 'lobby',
  -- Legacy column names retained for deployed-room compatibility. They now count
  -- kills, not approved evidence items.
  attack_limit integer not null default 2 check (attack_limit in (2,3)),
  approved_attacks_in_window integer not null default 0 check (approved_attacks_in_window >= 0),
  quota_window_start timestamptz not null default (date_trunc('hour', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'),
  police_check_at timestamptz, pending_bomber_id uuid, winner public.winning_team,
  end_game_result jsonb,
  created_at timestamptz not null default now(), closed_at timestamptz
);
-- Existing installations may still have the retired player PIN hash.
alter table public.rooms drop column if exists host_pin_hash;
alter table public.rooms drop column if exists player_pin_hash;
alter table public.rooms add column if not exists end_game_result jsonb;
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id), name text not null, reclaim_token_hash text, is_online boolean not null default true, last_seen_at timestamptz not null default now(),
  health public.health_state not null default 'alive', avatar_id text, joined_at timestamptz not null default now(), unique(room_id, user_id)
);
create table if not exists public.avatar_catalog (
  id text primary key,
  display_name text not null,
  gender text not null check (gender in ('male','female'))
);
insert into public.avatar_catalog(id,display_name,gender) values
  ('m-sea-01','อรุณ','male'),('f-sea-01','มะลิ','female'),('m-sea-02','วิน','male'),('f-sea-02','ฝน','female'),
  ('m-sea-03','ภพ','male'),('f-sea-03','ลิน','female'),('m-sea-04','ก้อง','male'),('f-sea-04','ดาว','female'),
  ('m-sea-05','ชัย','male'),('f-sea-05','พิม','female'),('m-sea-06','ปกรณ์','male'),('f-sea-06','ริน','female'),
  ('m-ea-01','ฮารุ','male'),('f-ea-01','ยูนะ','female'),('m-ea-02','เรน','male'),('f-ea-02','มีนา','female'),
  ('m-ea-03','เคน','male'),('f-ea-03','ซูบิน','female'),('m-ea-04','จุน','male'),('f-ea-04','อาโออิ','female'),
  ('m-sa-01','อาร์ยัน','male'),('f-sa-01','อันยา','female'),('m-sa-02','วิกรม','male'),('f-sa-02','คิรัน','female'),
  ('m-world-01','เอไล','male'),('f-world-01','อามารา','female'),('m-world-02','โอลิเวอร์','male'),('f-world-02','โซเฟีย','female'),
  ('m-world-03','ซามีร์','male'),('f-world-03','เลย์ลา','female'),('m-world-04','มาเตโอ','male'),('f-world-04','คามิลา','female'),
  ('m-jp-01','โซตะ','male'),('f-jp-01','ฮินะ','female'),('m-jp-02','ริคุ','male'),('f-jp-02','เมอิ','female'),
  ('m-jp-03','ไคโตะ','male'),('f-jp-03','อากิระ','female'),('m-jp-04','ทาคุมิ','male'),('f-jp-04','นานะ','female'),
  ('m-jp-05','ยูโตะ','male'),('f-jp-05','ซากุระ','female'),('m-jp-06','ไดจิ','male'),('f-jp-06','มิซากิ','female')
on conflict (id) do update set display_name=excluded.display_name,gender=excluded.gender;
alter table public.players add column if not exists avatar_id text;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='players_avatar_id_fkey') then
    alter table public.players add constraint players_avatar_id_fkey foreign key (avatar_id) references public.avatar_catalog(id);
  end if;
end $$;
create unique index if not exists players_room_avatar_unique on public.players(room_id,avatar_id) where avatar_id is not null;
create unique index if not exists players_room_name_lower on public.players(room_id, lower(name));
create table if not exists public.player_secrets (
  player_id uuid primary key references public.players(id) on delete cascade,
  initial_role text not null, role_current text not null, team text not null check (team in ('city','killers')),
  is_active_killer boolean not null default false, hearts integer not null default 0 check (hearts >= 0),
  max_hearts integer not null default 0 check (max_hearts >= 0), has_used_ability boolean not null default false
);
create table if not exists public.evidence (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade,
  killer_id uuid not null references public.players(id), target_id uuid not null references public.players(id),
  storage_path text not null unique, captured_at timestamptz not null, status public.evidence_status not null default 'pending',
  created_at timestamptz not null default now(), decision_at timestamptz
);
-- Web Push registrations are kept server-only; this is repeated here so a
-- fresh schema does not require the historical push migration.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, endpoint text not null,
  p256dh text not null, auth text not null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique(user_id, endpoint)
);
alter table public.evidence add column if not exists attack_result text
  check (attack_result in ('target is still alive','elimination confirmed'));

create table if not exists public.room_events (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade,
  type text not null, message text not null, visible_to_player_id uuid references public.players(id), created_at timestamptz not null default now()
);
alter table public.room_events add column if not exists excluded_player_id uuid references public.players(id);
create table if not exists public.room_signals (
  room_id uuid primary key references public.rooms(id) on delete cascade, changed_at timestamptz not null default now()
);
create table if not exists public.room_notifications (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade, event_key text not null,
  kind text not null default 'generic' check (kind in ('generic','evidence','police-reminder')),
  due_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default (clock_timestamp()+interval '1 hour'),
  state text not null default 'pending' check (state in ('pending','sending','sent','failed','cancelled')),
  attempts integer not null default 0, lease_expires_at timestamptz, created_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz, last_error text, unique(room_id,event_key,recipient_user_id)
);
create index if not exists room_notifications_dispatch_idx on public.room_notifications(state,due_at,created_at);
create table if not exists public.push_notification_deliveries (
  notification_id uuid not null references public.room_notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  attempts integer not null default 0, state text not null default 'pending' check (state in ('pending','sent','failed')),
  sent_at timestamptz, last_error text, primary key(notification_id,subscription_id)
);

-- Upgrade only the physical shape of a project that previously ran the old
-- schema. Legacy game state is not migrated; create a new room after applying
-- this schema. `create table if not exists` alone does not add these columns.
alter table public.rooms
  add column if not exists approved_attacks_in_window integer not null default 0,
  add column if not exists quota_window_start timestamptz not null default (date_trunc('hour', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'),
  add column if not exists pending_bomber_id uuid,
  add column if not exists closed_at timestamptz;
alter table public.players
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists reclaim_token_hash text,
  add column if not exists avatar_id text;
alter table public.player_secrets
  add column if not exists initial_role text not null default 'villager',
  add column if not exists role_current text not null default 'villager',
  add column if not exists team text not null default 'city' check (team in ('city','killers')),
  add column if not exists is_active_killer boolean not null default false;
-- Older deployments had a required `role` column. The game now stores the
-- initial and transformed roles separately; leaving the retired column in
-- place makes start_game fail because its insert quite correctly omits it.
alter table public.player_secrets drop column if exists role;
alter table public.evidence
  add column if not exists captured_at timestamptz not null default now();

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.player_secrets enable row level security;
alter table public.evidence enable row level security;
alter table public.room_events enable row level security;
alter table public.room_signals enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.room_notifications enable row level security;
alter table public.push_notification_deliveries enable row level security;

-- No table policy exposes roles, hearts or evidence. Clients use get_room_view.
revoke all on public.rooms, public.players, public.player_secrets, public.evidence, public.room_events, public.push_subscriptions, public.room_notifications, public.push_notification_deliveries from anon, authenticated;
drop policy if exists "room members can read public room" on public.rooms;
drop policy if exists "room members can read roster" on public.players;
drop policy if exists "only owner reads private state" on public.player_secrets;
drop policy if exists "host reads evidence metadata" on public.evidence;
drop policy if exists "killer submits evidence" on public.evidence;
drop policy if exists "members read safe events" on public.room_events;
drop policy if exists "members can receive a harmless room signal" on public.room_signals;
create policy "members can receive a harmless room signal" on public.room_signals for select using (
  exists (select 1 from public.rooms r where r.id = room_signals.room_id and r.host_user_id = auth.uid()) or
  exists (select 1 from public.players p where p.room_id = room_signals.room_id and p.user_id = auth.uid())
);
grant select on public.room_signals to authenticated;
drop policy if exists "recipients read room notifications" on public.room_notifications;
create policy "recipients read room notifications" on public.room_notifications for select to authenticated using (recipient_user_id=auth.uid());
grant select on public.room_notifications to authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='room_signals') then
    alter publication supabase_realtime add table public.room_signals;
  end if;
  if exists (select 1 from pg_publication where pubname='supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='room_notifications') then
    alter publication supabase_realtime add table public.room_notifications;
  end if;
end $$;
create or replace function public.touch_room_signal_room() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.room_signals(room_id, changed_at) values (new.id, now()) on conflict (room_id) do update set changed_at=excluded.changed_at; return new; end $$;
create or replace function public.touch_room_signal_child() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.room_signals(room_id, changed_at) values (new.room_id, now()) on conflict (room_id) do update set changed_at=excluded.changed_at; return new; end $$;
create or replace function public.touch_room_signal_secret() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.room_signals(room_id, changed_at) select room_id, now() from public.players where id=new.player_id on conflict (room_id) do update set changed_at=excluded.changed_at; return new; end $$;
drop trigger if exists rooms_signal on public.rooms;
create trigger rooms_signal after insert or update on public.rooms for each row execute function public.touch_room_signal_room();
drop trigger if exists players_signal on public.players;
create trigger players_signal after insert or update on public.players for each row execute function public.touch_room_signal_child();
drop trigger if exists secrets_signal on public.player_secrets;
create trigger secrets_signal after insert or update on public.player_secrets for each row execute function public.touch_room_signal_secret();
drop trigger if exists evidence_signal on public.evidence;
create trigger evidence_signal after insert or update on public.evidence for each row execute function public.touch_room_signal_child();
drop trigger if exists events_signal on public.room_events;
create trigger events_signal after insert on public.room_events for each row execute function public.touch_room_signal_child();

insert into storage.buckets (id, name, public) values ('evidence','evidence',false) on conflict (id) do update set public=false;
create or replace function public.can_host_evidence(p_path text) returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.evidence e join public.rooms r on r.id=e.room_id where e.storage_path=p_path and r.host_user_id=auth.uid())
$$;
grant execute on function public.can_host_evidence(text) to authenticated;
drop policy if exists "killer uploads only to own evidence prefix" on storage.objects;
create policy "killer uploads only to own evidence prefix" on storage.objects for insert to authenticated with check (
  bucket_id='evidence' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists "host or owner reads evidence" on storage.objects;
create policy "host or owner reads evidence" on storage.objects for select to authenticated using (
  bucket_id='evidence' and public.can_host_evidence(name)
);
drop policy if exists "host deletes room evidence" on storage.objects;
create policy "host deletes room evidence" on storage.objects for delete to authenticated using (
  bucket_id='evidence' and public.can_host_evidence(name)
);

create or replace function public.can_read_room_signal(p_room_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.rooms where id=p_room_id and host_user_id=auth.uid())
    or exists(select 1 from public.players where room_id=p_room_id and user_id=auth.uid())
$$;
revoke execute on function public.can_read_room_signal(uuid) from public,anon;
grant execute on function public.can_read_room_signal(uuid) to authenticated;
drop policy if exists "members can receive a harmless room signal" on public.room_signals;
create policy "members can receive a harmless room signal" on public.room_signals for select to authenticated using (public.can_read_room_signal(room_id));

create or replace function public.can_delete_evidence(p_path text) returns boolean language sql stable security definer set search_path=public as $$
  select public.can_host_evidence(p_path) or (
    split_part(p_path,'/',1)=auth.uid()::text
    and not exists(select 1 from public.evidence where storage_path=p_path))
$$;
revoke execute on function public.can_delete_evidence(text),public.can_host_evidence(text) from public,anon;
grant execute on function public.can_delete_evidence(text) to authenticated;
drop policy if exists "host deletes room evidence" on storage.objects;
create policy "host deletes room evidence" on storage.objects for delete to authenticated using (
  bucket_id='evidence' and public.can_delete_evidence(name)
);

create or replace function public.room_for_code(p_code text) returns public.rooms language sql stable security definer set search_path=public as $$
  select * from public.rooms where code=upper(trim(p_code)) and closed_at is null limit 1
$$;
create or replace function public.add_event(p_room_id uuid, p_type text, p_message text, p_player_id uuid default null) returns void
language sql security definer set search_path=public as $$ insert into public.room_events(room_id,type,message,visible_to_player_id) values (p_room_id,p_type,p_message,p_player_id) $$;
revoke execute on function public.add_event(uuid,text,text,uuid), public.room_for_code(text) from public, anon, authenticated;

create or replace function public.request_notification_dispatch() returns void language plpgsql security definer set search_path=public as $$
declare dispatch_url text:=current_setting('app.push_dispatch_url',true); dispatch_secret text:=current_setting('app.push_dispatch_secret',true);
begin
  if coalesce(current_setting('app.notification_queue_enabled',true),'off')<>'on' or coalesce(dispatch_url,'')='' or coalesce(dispatch_secret,'')='' then return; end if;
  execute format('select net.http_post(url := %L, headers := jsonb_build_object(''x-notification-dispatch-secret'', %L), body := ''{}''::jsonb)',dispatch_url,dispatch_secret);
exception when undefined_function then return;
end $$;
revoke execute on function public.request_notification_dispatch() from public,anon,authenticated;

create or replace function public.queue_room_notification(p_room_id uuid,p_event_key text,p_kind text default 'generic',p_recipient_user_ids uuid[] default null,p_due_at timestamptz default clock_timestamp(),p_expires_at timestamptz default (clock_timestamp()+interval '1 hour')) returns void
language plpgsql security definer set search_path=public as $$
begin
  if coalesce(current_setting('app.notification_queue_enabled',true),'off') <> 'on' then return; end if;
  if p_kind not in ('generic','evidence','police-reminder') or p_event_key='' or p_expires_at<=p_due_at then raise exception 'invalid notification'; end if;
  insert into public.room_notifications(room_id,recipient_user_id,event_key,kind,due_at,expires_at)
  select p_room_id,recipient_user_id,p_event_key,p_kind,p_due_at,p_expires_at from (
    select host_user_id recipient_user_id from public.rooms where id=p_room_id union
    select user_id from public.players where room_id=p_room_id
  ) recipients where p_recipient_user_ids is null or recipient_user_id=any(p_recipient_user_ids)
  on conflict(room_id,event_key,recipient_user_id) do nothing;
  if found then perform public.request_notification_dispatch(); end if;
end $$;
revoke execute on function public.queue_room_notification(uuid,text,text,uuid[],timestamptz,timestamptz) from public,anon,authenticated;

create or replace function public.register_push_subscription(p_code text,p_endpoint text,p_p256dh text,p_auth text) returns boolean language plpgsql security definer set search_path=public as $$
declare r public.rooms;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null;
  if not found or (r.host_user_id<>auth.uid() and not exists(select 1 from public.players where room_id=r.id and user_id=auth.uid())) then raise exception 'not a room member'; end if;
  if nullif(trim(p_endpoint),'') is null or nullif(trim(p_p256dh),'') is null or nullif(trim(p_auth),'') is null then raise exception 'invalid subscription'; end if;
  insert into public.push_subscriptions(room_id,user_id,endpoint,p256dh,auth,updated_at) values(r.id,auth.uid(),trim(p_endpoint),trim(p_p256dh),trim(p_auth),clock_timestamp())
  on conflict(user_id,endpoint) do update set room_id=excluded.room_id,p256dh=excluded.p256dh,auth=excluded.auth,updated_at=excluded.updated_at;
  return true;
end $$;
revoke execute on function public.register_push_subscription(text,text,text,text) from public,anon;
grant execute on function public.register_push_subscription(text,text,text,text) to authenticated;

create or replace function public.queue_notification_from_event() returns trigger language plpgsql security definer set search_path=public as $$
declare recipient uuid; host_id uuid;
begin
  select host_user_id into host_id from public.rooms where id=new.room_id;
  if new.type='system' and new.message in ('เกมเริ่มแล้ว บทบาทถูกแจกเรียบร้อย','Host สั่งจบเกม') then
    perform public.queue_room_notification(new.room_id,'event:'||new.id::text);
  elsif (new.type in ('winner','attack','bomb') and new.visible_to_player_id is null) or (new.type='warning' and new.message='ถึงเวลาตำรวจชี้ตัวแล้ว') or (new.type='ability' and new.message='Reporter has used an ability.') then
    perform public.queue_room_notification(new.room_id,'event:'||new.id::text);
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
create trigger room_events_notification_queue after insert on public.room_events for each row execute function public.queue_notification_from_event();
create or replace function public.queue_notification_from_evidence() returns trigger language plpgsql security definer set search_path=public as $$
declare host_id uuid; begin select host_user_id into host_id from public.rooms where id=new.room_id; perform public.queue_room_notification(new.room_id,'evidence:'||new.id::text,'evidence',array[host_id]); return new; end $$;
drop trigger if exists evidence_notification_queue on public.evidence;
create trigger evidence_notification_queue after insert on public.evidence for each row execute function public.queue_notification_from_evidence();

-- Capture the immutable public explanation at the same time as the winning state.
create or replace function public.finalize_game(
  p_room_id uuid, p_winner public.winning_team, p_reason text,
  p_actor_player_id uuid default null, p_target_player_id uuid default null,
  p_affected_player_ids uuid[] default '{}'
) returns void language plpgsql security definer set search_path=public as $$
begin
  update public.rooms
  set phase='ended', winner=p_winner,
      end_game_result=jsonb_build_object(
        'reason', p_reason, 'occurredAt', clock_timestamp(),
        'actorPlayerId', p_actor_player_id, 'targetPlayerId', p_target_player_id,
        'affectedPlayerIds', to_jsonb(coalesce(p_affected_player_ids, '{}'::uuid[]))
      )
  where id=p_room_id;
end $$;
revoke execute on function public.finalize_game(uuid,public.winning_team,text,uuid,uuid,uuid[]) from public,anon,authenticated;

-- Call only after authorizing the caller. Use wall time AFTER obtaining the room lock.
create or replace function public.advance_due_accusation(p_room_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id=p_room_id for update;
  if r.closed_at is null and r.phase='active' and r.police_check_at<=clock_timestamp() then
    update public.rooms set phase='police-check' where id=r.id;
    perform public.add_event(r.id,'warning','ถึงเวลาตำรวจชี้ตัวแล้ว');
    return true;
  end if;
  return false;
end $$;
revoke execute on function public.advance_due_accusation(uuid) from public,anon,authenticated;

create or replace function public.end_game_timeline(p_room_id uuid,p_result jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare ended_at timestamptz := nullif(p_result->>'occurredAt','')::timestamptz;
begin
  if p_result is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(entry order by occurred_at,position) from (
    select jsonb_build_object('kind','detective-eliminated','occurredAt',e.decision_at,'actorPlayerId',e.killer_id,'targetPlayerId',e.target_id) entry,e.decision_at occurred_at,1 position from public.evidence e join public.player_secrets target on target.player_id=e.target_id where e.room_id=p_room_id and e.status='approved' and e.attack_result='elimination confirmed' and target.initial_role='detective' and (ended_at is null or e.decision_at<=ended_at)
    union all select jsonb_build_object('kind','detective-promoted','occurredAt',ended_at,'actorPlayerId',null,'targetPlayerId',s.player_id),ended_at,2 from public.player_secrets s join public.players p on p.id=s.player_id where p.room_id=p_room_id and s.initial_role='detective' and s.role_current='police'
    union all select jsonb_build_object('kind','police-attacked','occurredAt',ended_at,'actorPlayerId',p_result->>'actorPlayerId','targetPlayerId',p_result->>'targetPlayerId'),ended_at,3 where p_result->>'reason'='police-attacked'
    union all select jsonb_build_object('kind','game-ended','occurredAt',ended_at,'actorPlayerId',p_result->>'actorPlayerId','targetPlayerId',p_result->>'targetPlayerId'),ended_at,4
  ) milestones),'[]'::jsonb);
end $$;
revoke execute on function public.end_game_timeline(uuid,jsonb) from public,anon,authenticated;

create or replace function public.get_room_view(p_code text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; me public.players; is_host boolean; viewer_role text; states jsonb; roster jsonb; events jsonb; evidences jsonb; progress jsonb := '[]'::jsonb; summary jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then return null; end if;
  select * into r from public.rooms where code=upper(trim(p_code)) limit 1;
  if not found then return null; end if;
  is_host := r.host_user_id=auth.uid();
  if not is_host then select * into me from public.players p where p.room_id=r.id and p.user_id=auth.uid() limit 1; if not found then return null; end if; end if;
  perform public.advance_due_accusation(r.id);
  select * into r from public.rooms where id=r.id;
  viewer_role := case when is_host then 'host' else 'player' end;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'avatarId',p.avatar_id,'joinedAt',p.joined_at,'isOnline',p.is_online and p.last_seen_at > now()-interval '90 seconds','health',case when is_host or p.id=me.id then p.health when p.health='dead' then 'dead'::health_state else 'alive'::health_state end,
    'heartsVisibleToHost',case when is_host then coalesce(s.hearts,0) else 0 end,'maxHearts',case when is_host then coalesce(s.max_hearts,0) else 0 end) order by p.joined_at), '[]'::jsonb)
    into roster from public.players p left join public.player_secrets s on s.player_id=p.id where p.room_id=r.id;
  if is_host then
    select coalesce(jsonb_object_agg(s.player_id::text,jsonb_build_object('playerId',s.player_id,'initialRole',s.initial_role,'currentRole',s.role_current,'team',s.team,'isActiveKiller',s.is_active_killer,'hearts',s.hearts,'maxHearts',s.max_hearts,'hasUsedAbility',s.has_used_ability)),'{}'::jsonb) into states from public.player_secrets s join public.players p on p.id=s.player_id where p.room_id=r.id;
    select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'killerId',e.killer_id,'targetId',e.target_id,'storagePath',e.storage_path,'capturedAt',e.captured_at,'createdAt',e.created_at,'status',e.status,'decisionAt',e.decision_at) order by e.created_at desc),'[]'::jsonb) into evidences from public.evidence e where e.room_id=r.id;
  else
    select jsonb_build_object(me.id::text,jsonb_build_object('playerId',s.player_id,'initialRole',s.initial_role,'currentRole',s.role_current,'team',s.team,'isActiveKiller',s.is_active_killer,'hearts',s.hearts,'maxHearts',s.max_hearts,'hasUsedAbility',s.has_used_ability)) into states from public.player_secrets s where s.player_id=me.id;
    if exists(select 1 from public.player_secrets s where s.player_id=me.id and s.is_active_killer) then
      states := states || coalesce((select jsonb_object_agg(s.player_id::text,jsonb_build_object('playerId',s.player_id,'initialRole',s.initial_role,'currentRole',s.role_current,'team',s.team,'isActiveKiller',s.is_active_killer,'hearts',0,'maxHearts',0,'hasUsedAbility',s.has_used_ability)) from public.player_secrets s join public.players p on p.id=s.player_id where p.room_id=r.id and s.is_active_killer),'{}'::jsonb);
    end if;
    evidences := '[]'::jsonb;
    if exists(select 1 from public.player_secrets where player_id=me.id and is_active_killer) then
      select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'killerId',e.killer_id,'targetId',e.target_id,
        'capturedAt',e.captured_at,'createdAt',e.created_at,'status',e.status,'decisionAt',e.decision_at,
        'result',e.attack_result) order by e.created_at desc,e.id),'[]'::jsonb)
        into progress from public.evidence e where e.room_id=r.id;
    end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'type',e.type,'message',e.message,'createdAt',e.created_at,'playerId',e.visible_to_player_id) order by e.created_at desc),'[]'::jsonb) into events from public.room_events e where e.room_id=r.id and (is_host or ((e.visible_to_player_id is null or e.visible_to_player_id=me.id) and e.excluded_player_id is distinct from me.id));
  if r.phase='ended' then
    select coalesce(jsonb_agg(jsonb_build_object('playerId',p.id,'initialRole',s.initial_role,'currentRole',s.role_current,'team',s.team) order by p.joined_at,p.id),'[]'::jsonb)
      into summary from public.players p left join public.player_secrets s on s.player_id=p.id where p.room_id=r.id;
  end if;
  return jsonb_build_object('viewerRole',viewer_role,'playerId',case when is_host then null else me.id end,'code',r.code,'hostName',r.host_name,'phase',r.phase,
    'createdAt',r.created_at,'closedAt',r.closed_at,'killLimit',r.attack_limit,'killsThisHour',case when r.quota_window_start=(date_trunc('hour',clock_timestamp() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok') then r.approved_attacks_in_window else 0 end,
    'quotaWindowStart',r.quota_window_start,'policeCheckAt',r.police_check_at,'players',roster,'privateStates',states,'evidences',evidences,'killerEvidenceProgress',progress,'events',events,
    'endGameSummary',summary,'winner',r.winner,'bombTargets','[]'::jsonb,'pendingBomberId',r.pending_bomber_id)
    || case when r.phase='ended' then jsonb_build_object('endGameResult',r.end_game_result,'endGameTimeline',public.end_game_timeline(r.id,r.end_game_result)) else '{}'::jsonb end;
end $$;

drop function if exists public.create_room(text,text,text,text);
drop function if exists public.create_room(text,text,text);
create or replace function public.create_room(p_code text,p_host_name text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;
begin
  if auth.uid() is null or nullif(trim(p_host_name),'') is null or char_length(trim(p_host_name))>24 then raise exception 'invalid credentials or host name'; end if;
  insert into public.rooms(code,host_user_id,host_name) values(upper(trim(p_code)),auth.uid(),trim(p_host_name)) returning * into r;
  perform public.add_event(r.id,'system','ห้องถูกสร้างแล้ว รอผู้เล่นเข้าร่วม'); return public.get_room_view(r.code);
end $$;

drop function if exists public.join_room(text,text);
drop function if exists public.join_room(text,text,text);
create or replace function public.join_room(p_code text,p_name text,p_reclaim_token text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; p public.players; issued_token text;
begin
  if auth.uid() is null or nullif(trim(p_name),'') is null or char_length(trim(p_name))>24 then raise exception 'invalid credentials or player name'; end if;
  select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
  if not found or r.host_user_id=auth.uid() then raise exception 'invalid room or host cannot play'; end if;
  select * into p from public.players where room_id=r.id and lower(name)=lower(trim(p_name)) limit 1;
  if found and p.user_id=auth.uid() then
    if p.reclaim_token_hash is null then
      issued_token := md5(random()::text||clock_timestamp()::text||auth.uid()::text);
      update public.players set reclaim_token_hash=md5(issued_token),is_online=true,last_seen_at=now() where id=p.id returning * into p;
    else update public.players set is_online=true,last_seen_at=now() where id=p.id returning * into p; end if;
  elsif found and p.reclaim_token_hash is not null and p.reclaim_token_hash=md5(trim(coalesce(p_reclaim_token,''))) then
    update public.players set user_id=auth.uid(),is_online=true,last_seen_at=now() where id=p.id returning * into p;
  elsif found then raise exception 'player name is already in use; enter reclaim token';
  elsif r.phase <> 'lobby' then raise exception 'game already started';
  elsif (select count(*) from public.players where room_id=r.id) >= 28 then raise exception 'room is full';
  else
    issued_token := md5(random()::text||clock_timestamp()::text||auth.uid()::text);
    insert into public.players(room_id,user_id,name,reclaim_token_hash) values(r.id,auth.uid(),trim(p_name),md5(issued_token)) returning * into p;
  end if;
  return jsonb_build_object('playerId',p.id,'reclaimToken',issued_token) || public.get_room_view(r.code);
end $$;

create or replace function public.start_game(p_code text,p_role_counts jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; p public.players; roles text[] := '{}'; item record; idx integer := 1; role text; mh integer;
begin
  select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
  if not found or r.host_user_id is distinct from auth.uid() or r.phase<>'lobby' then raise exception 'not allowed'; end if;
  if p_role_counts is null or jsonb_typeof(p_role_counts)<>'object' then raise exception 'invalid roles'; end if;
  for item in select key,value::int amount from jsonb_each_text(p_role_counts) loop
    if item.key not in ('killer','killer-wife','police','reporter','bomber','detective','athlete','sumo','villager') or item.amount is null or item.amount<0 or (item.key in ('killer','killer-wife','police','reporter','bomber','detective','athlete','sumo') and item.amount>1) or (item.key='villager' and item.amount>20) then raise exception 'invalid roles'; end if;
    for idx in 1..item.amount loop roles := array_append(roles,item.key); end loop;
  end loop;
  if array_length(roles,1) <> (select count(*) from public.players where room_id=r.id) or (select count(*) from public.players where room_id=r.id and avatar_id is null)>0 or (select count(*) from unnest(roles) x where x='killer')<>1 or (select count(*) from unnest(roles) x where x='police')<1 then raise exception 'invalid player count, avatar selection, or required roles'; end if;
  idx := 1;
  for p in select * from public.players where room_id=r.id order by random() loop
    role := roles[idx]; idx := idx+1; mh := case role when 'athlete' then 3 when 'sumo' then 4 when 'killer' then 0 else 2 end;
    insert into public.player_secrets(player_id,initial_role,role_current,team,is_active_killer,hearts,max_hearts) values(p.id,role,role,case when role in ('killer','killer-wife') then 'killers' else 'city' end,role='killer',mh,mh)
      on conflict(player_id) do update set initial_role=excluded.initial_role,role_current=excluded.role_current,team=excluded.team,is_active_killer=excluded.is_active_killer,hearts=excluded.hearts,max_hearts=excluded.max_hearts,has_used_ability=false;
    update public.players set health=case when mh=0 then 'alive'::health_state else 'alive'::health_state end where id=p.id;
  end loop;
  update public.rooms set phase='active',quota_window_start=(date_trunc('hour',clock_timestamp() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'),approved_attacks_in_window=0 where id=r.id;
  perform public.add_event(r.id,'system','เกมเริ่มแล้ว บทบาทถูกแจกเรียบร้อย'); return public.get_room_view(r.code);
end $$;

create or replace function public.select_avatar(p_code text,p_avatar_id text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; me public.players;
begin
  select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
  if not found or r.phase<>'lobby' then raise exception 'game already started'; end if;
  select * into me from public.players where room_id=r.id and user_id=auth.uid() for update;
  if not found then raise exception 'not allowed'; end if;
  if not exists(select 1 from public.avatar_catalog where id=trim(coalesce(p_avatar_id,''))) then raise exception 'invalid avatar'; end if;
  if exists(select 1 from public.players where room_id=r.id and avatar_id=trim(p_avatar_id) and id<>me.id) then raise exception 'avatar already selected'; end if;
  update public.players set avatar_id=trim(p_avatar_id) where id=me.id;
  return public.get_room_view(r.code);
end $$;

create or replace function public.remove_lobby_player(p_code text,p_player_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;
begin
  select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
  if not found or r.host_user_id is distinct from auth.uid() or r.phase<>'lobby' then raise exception 'not allowed'; end if;
  delete from public.players where room_id=r.id and id=p_player_id;
  if not found then raise exception 'player not found'; end if;
  return public.get_room_view(r.code);
end $$;

create or replace function public.submit_evidence(p_code text,p_target_id uuid,p_storage_path text,p_captured_at timestamptz) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; me public.players; s public.player_secrets; target public.players; checked_at timestamptz;
begin
  select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
  select * into me from public.players where room_id=r.id and user_id=auth.uid();
  select * into s from public.player_secrets where player_id=me.id;
  if auth.uid() is null or r.id is null or r.host_user_id=auth.uid() or me.id is null or s.is_active_killer is not true or me.health='dead' then raise exception 'killer ability unavailable'; end if;
  if p_target_id is null or p_captured_at is null or nullif(trim(p_storage_path),'') is null then raise exception 'missing evidence parameters'; end if;
  if public.advance_due_accusation(r.id) or r.phase='police-check' then
    return public.get_room_view(r.code) || jsonb_build_object('actionError','accusation_started');
  end if;
  select * into target from public.players where id=p_target_id and room_id=r.id;
  checked_at := clock_timestamp();
  if r.phase<>'active' or target.id is null or target.health='dead' or target.id=me.id
    or not exists(select 1 from public.player_secrets where player_id=target.id and not is_active_killer)
    or nullif(trim(p_storage_path),'') is null or p_storage_path not like auth.uid()::text||'/%'
    or not exists(select 1 from storage.objects o where o.bucket_id='evidence' and o.name=p_storage_path
      and coalesce(o.metadata->>'mimetype','') like 'image/%' and coalesce(o.metadata->>'size','') ~ '^[1-9][0-9]*$')
    or p_captured_at is null or p_captured_at>checked_at or p_captured_at<checked_at-interval '2 minutes'
    then raise exception 'evidence is not allowed, missing, or stale'; end if;
  insert into public.evidence(room_id,killer_id,target_id,storage_path,captured_at) values(r.id,me.id,target.id,p_storage_path,p_captured_at);
  return public.get_room_view(r.code);
end $$;

create or replace function public.reject_evidence(p_code text,p_evidence_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; e public.evidence;
begin select * into r from public.rooms where code=upper(trim(p_code)) and host_user_id=auth.uid() and closed_at is null for update; select * into e from public.evidence where id=p_evidence_id and room_id=r.id for update; if not found or r.id is null or r.phase not in ('active','bomb-resolution','police-check') or e.status<>'pending' then raise exception 'not allowed'; end if; update public.evidence set status='rejected',decision_at=clock_timestamp() where id=e.id; perform public.add_event(r.id,'warning','หลักฐานถูกปฏิเสธ',e.killer_id); return public.get_room_view(r.code); end $$;

create or replace function public.approve_evidence(p_code text,p_evidence_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; e public.evidence; k public.player_secrets; t public.player_secrets; target public.players; new_hearts integer; window_start timestamptz; detective public.player_secrets; is_kill boolean;
begin
  select * into r from public.rooms where code=upper(trim(p_code)) and host_user_id=auth.uid() and closed_at is null for update; if not found then raise exception 'not allowed'; end if;
  if p_evidence_id is null then raise exception 'missing evidence id'; end if;
  if public.advance_due_accusation(r.id) or r.phase='police-check' then
    return public.get_room_view(r.code) || jsonb_build_object('actionError','accusation_started');
  end if;
  select * into e from public.evidence where id=p_evidence_id and room_id=r.id for update; if not found or e.status<>'pending' or r.phase<>'active' then raise exception 'evidence is no longer pending'; end if;
  select s.* into k from public.player_secrets s where s.player_id=e.killer_id and s.is_active_killer and exists(select 1 from public.players p where p.id=s.player_id and p.room_id=r.id and p.health<>'dead') for update; if k.player_id is null then raise exception 'killer is not active'; end if; select * into t from public.player_secrets where player_id=e.target_id for update; select * into target from public.players where id=e.target_id and room_id=r.id for update;
  if not found or t.player_id is null or target.health='dead' then raise exception 'target is dead'; end if;
  if t.is_active_killer then raise exception 'Killer can only be eliminated by a Bomber explosion'; end if;
  window_start := date_trunc('hour',clock_timestamp() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
  new_hearts := greatest(0,t.hearts-1); update public.evidence set status='approved',decision_at=clock_timestamp() where id=e.id;
  -- An approved attack on the current Police immediately ends the game for City.
  -- It neither changes the Police's hearts nor consumes the hourly kill quota.
  if t.role_current='police' then
    perform public.finalize_game(r.id,'city','police-attacked',e.killer_id,t.player_id,array[t.player_id]);
    update public.rooms set quota_window_start=window_start where id=r.id;
    perform public.add_event(r.id,'winner','City Side ชนะ เพราะ Host อนุมัติการโจมตี Police');
    return public.get_room_view(r.code);
  end if;
  if r.quota_window_start<>window_start then r.approved_attacks_in_window:=0; r.quota_window_start:=window_start; end if;
  is_kill := new_hearts=0;
  if is_kill and r.approved_attacks_in_window>=r.attack_limit then
    raise exception 'hourly kill quota reached';
  end if;
  update public.rooms
    set approved_attacks_in_window=r.approved_attacks_in_window+case when is_kill then 1 else 0 end,
        quota_window_start=r.quota_window_start
    where id=r.id;
  -- Everyone except the victim receives this public, anonymous announcement.
  -- The victim gets the private heart-loss event below instead.
  insert into public.room_events(room_id,type,message,excluded_player_id)
  values(r.id,'attack','มีคนถูกโจมตีจาก Killer',target.id);
  perform public.add_event(r.id,'warning','คุณถูกโจมตีและเสียหัวใจ 1 ดวง',target.id);
  if t.initial_role='killer-wife' and new_hearts=0 then
    update public.player_secrets set role_current='killer',team='killers',is_active_killer=true,hearts=0,max_hearts=0 where player_id=t.player_id; update public.players set health='alive' where id=target.id; update public.rooms set attack_limit=3 where id=r.id;
    perform public.add_event(r.id,'ability','Killer has eliminated Killer''s Wife. There are now two Killers.');
    update public.evidence set attack_result='target is still alive' where id=e.id;
    perform public.add_event(r.id,'ability','คุณกลายเป็น Killer แล้ว',target.id);
    perform public.add_event(r.id,'attack','target is still alive',e.killer_id);
  else
    update public.player_secrets set hearts=new_hearts where player_id=t.player_id; update public.players set health=case when new_hearts=0 then 'dead'::health_state when new_hearts=1 then 'critical'::health_state else 'alive'::health_state end where id=target.id;
    if new_hearts=0 then perform public.add_event(r.id,'warning',target.name||' ถูกกำจัด'); end if;
    update public.evidence set attack_result=case when new_hearts=0 then 'elimination confirmed' else 'target is still alive' end where id=e.id;
    perform public.add_event(r.id,'attack',case when new_hearts=0 then 'elimination confirmed' else 'target is still alive' end,e.killer_id);
    if new_hearts=0 and t.initial_role='bomber' then update public.rooms set phase='bomb-resolution',pending_bomber_id=t.player_id where id=r.id; perform public.add_event(r.id,'bomb',target.name||' ถูกกำจัด — Bomber'); end if;
    if new_hearts=0 and t.role_current='police' then select s.* into detective from public.player_secrets s join public.players p on p.id=s.player_id where p.room_id=r.id and s.role_current='detective' and p.health<>'dead' limit 1 for update; if found then update public.player_secrets set role_current='police' where player_id=detective.player_id; perform public.add_event(r.id,'ability','ตำรวจคนใหม่ได้รับตำแหน่งแบบส่วนตัว',detective.player_id); else perform public.finalize_game(r.id,'killers','police-eliminated-no-successor',e.killer_id,t.player_id,array[t.player_id]); perform public.add_event(r.id,'winner','Killer Side ชนะ'); end if; end if;
  end if;
  return public.get_room_view(r.code);
end $$;

create or replace function public.resolve_bomb(p_code text,p_target_ids uuid[]) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; victim public.players; successor uuid; winning public.winning_team;
begin
  select * into r from public.rooms where code=upper(trim(p_code)) and host_user_id=auth.uid() and closed_at is null for update;
  if not found or r.phase<>'bomb-resolution' or p_target_ids is null or cardinality(p_target_ids)>2
    or cardinality(p_target_ids)<>(select count(distinct x) from unnest(p_target_ids) x)
    or cardinality(p_target_ids)<>(select count(*) from public.players where room_id=r.id and id=any(p_target_ids) and health<>'dead') then raise exception 'invalid bomb targets'; end if;
  -- All victims die before succession is evaluated; there are no chain reactions.
  for victim in select * from public.players where room_id=r.id and id=any(p_target_ids) order by id for update loop
    update public.player_secrets set hearts=0 where player_id=victim.id;
    update public.players set health='dead' where id=victim.id;
    perform public.add_event(r.id,'bomb',victim.name||' ถูกกำจัดจากระเบิด');
  end loop;
  if not exists(select 1 from public.player_secrets s join public.players p on p.id=s.player_id where p.room_id=r.id and s.is_active_killer and p.health<>'dead') then
    winning := 'city';
  elsif not exists(select 1 from public.player_secrets s join public.players p on p.id=s.player_id where p.room_id=r.id and s.role_current='police' and p.health<>'dead') then
    select s.player_id into successor from public.player_secrets s join public.players p on p.id=s.player_id where p.room_id=r.id and s.role_current='detective' and p.health<>'dead' order by p.id limit 1;
    if successor is null then winning := 'killers';
    else
      update public.player_secrets set role_current='police' where player_id=successor;
      perform public.add_event(r.id,'ability','ตำรวจคนใหม่ได้รับตำแหน่งแบบส่วนตัว',successor);
    end if;
  end if;
  update public.rooms set pending_bomber_id=null,phase=case when winning is null then 'active'::room_phase else 'ended'::room_phase end,winner=winning where id=r.id;
  if winning is not null then
    perform public.finalize_game(r.id,winning,case when winning='city' then 'bomb-eliminated-all-killers' else 'bomb-eliminated-police-no-successor' end,r.pending_bomber_id,null,p_target_ids);
    perform public.add_event(r.id,'winner',case when winning='city' then 'City Side ชนะ' else 'Killer Side ชนะ' end);
  end if;
  return public.get_room_view(r.code);
end $$;

create or replace function public.use_reporter(p_code text,p_target_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; me public.players; target public.players; reporter public.player_secrets; inspected public.player_secrets;
begin select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update; select * into me from public.players where room_id=r.id and user_id=auth.uid(); select * into reporter from public.player_secrets where player_id=me.id for update; select * into target from public.players where id=p_target_id and room_id=r.id; select * into inspected from public.player_secrets where player_id=target.id;
  if not found or auth.uid() is null or r.id is null or r.host_user_id=auth.uid() or me.id is null or reporter.player_id is null or target.id is null or r.phase not in ('active','bomb-resolution','police-check') or me.health='dead' or reporter.role_current is distinct from 'reporter' or reporter.has_used_ability or target.id=me.id or target.health='dead' then raise exception 'reporter ability unavailable'; end if;
  update public.player_secrets set has_used_ability=true where player_id=me.id; perform public.add_event(r.id,'ability','Reporter has used an ability.'); perform public.add_event(r.id,'ability','บทบาทเริ่มต้นของ '||target.name||' คือ '||inspected.initial_role,me.id); perform public.add_event(r.id,'ability','คุณถูกตรวจบทบาท',target.id); return public.get_room_view(r.code);
end $$;

create or replace function public.heartbeat(p_code text) returns void language plpgsql security definer set search_path=public as $$
declare r public.rooms; me public.players;
begin
  select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
  select * into me from public.players where room_id=r.id and user_id=auth.uid();
  if auth.uid() is null or r.id is null or me.id is null or r.host_user_id=auth.uid() then raise exception 'not a room player'; end if;
  update public.players set is_online=true,last_seen_at=clock_timestamp() where id=me.id;
end $$;
create or replace function public.set_accusation_at(p_code text,p_at timestamptz) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; begin select * into r from public.rooms where code=upper(trim(p_code)) and host_user_id=auth.uid() and closed_at is null for update; if not found or p_at is null or not isfinite(p_at) or r.phase not in ('lobby','active') then raise exception 'not allowed'; end if; update public.rooms set police_check_at=p_at where id=r.id; return public.get_room_view(r.code); end $$;
drop function if exists public.start_due_accusations();
create or replace function public.resolve_police_check(p_code text,p_target_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; me public.players; police public.player_secrets; target public.player_secrets; target_player public.players; begin select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update; select * into me from public.players where room_id=r.id and user_id=auth.uid(); select * into police from public.player_secrets where player_id=me.id; select * into target from public.player_secrets where player_id=p_target_id; select * into target_player from public.players where id=p_target_id and room_id=r.id;
  if not found or auth.uid() is null or r.id is null or r.host_user_id=auth.uid() or me.id is null or police.player_id is null or target.player_id is null or r.phase not in ('active','police-check') or me.health='dead' or police.role_current is distinct from 'police' or target_player.health='dead' or target_player.id=me.id then raise exception 'police accusation unavailable'; end if; perform public.finalize_game(r.id,case when target.is_active_killer then 'city'::winning_team else 'killers'::winning_team end,case when target.is_active_killer then 'police-accusation-correct' else 'police-accusation-wrong' end,me.id,target_player.id,array[target_player.id]); perform public.add_event(r.id,'winner',case when target.is_active_killer then 'City Side ชนะ' else 'Killer Side ชนะ' end); return public.get_room_view(r.code); end $$;

create or replace function public.end_game(p_code text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; begin select * into r from public.rooms where code=upper(trim(p_code)) and host_user_id=auth.uid() and closed_at is null for update; if not found or r.phase not in ('lobby','active','police-check','bomb-resolution') then raise exception 'not allowed'; end if; perform public.finalize_game(r.id,null,'host-ended'); perform public.add_event(r.id,'system','Host สั่งจบเกม'); return public.get_room_view(r.code); end $$;

create or replace function public.close_room(p_code text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; begin select * into r from public.rooms where code=upper(trim(p_code)) and host_user_id=auth.uid() and closed_at is null for update; if not found or r.phase not in ('lobby','ended') then raise exception 'room cannot close yet'; end if; delete from public.evidence where room_id=r.id; update public.rooms set closed_at=now() where id=r.id; return public.get_room_view(r.code); end $$;

revoke execute on function public.create_room(text,text),public.join_room(text,text,text),public.get_room_view(text),public.start_game(text,jsonb),public.select_avatar(text,text),public.remove_lobby_player(text,uuid),public.submit_evidence(text,uuid,text,timestamptz),public.reject_evidence(text,uuid),public.approve_evidence(text,uuid),public.resolve_bomb(text,uuid[]),public.use_reporter(text,uuid),public.heartbeat(text),public.set_accusation_at(text,timestamptz),public.resolve_police_check(text,uuid),public.end_game(text),public.close_room(text) from public, anon;
grant execute on function public.create_room(text,text),public.join_room(text,text,text),public.get_room_view(text),public.start_game(text,jsonb),public.select_avatar(text,text),public.remove_lobby_player(text,uuid),public.submit_evidence(text,uuid,text,timestamptz),public.reject_evidence(text,uuid),public.approve_evidence(text,uuid),public.resolve_bomb(text,uuid[]),public.use_reporter(text,uuid),public.heartbeat(text),public.set_accusation_at(text,timestamptz),public.resolve_police_check(text,uuid),public.end_game(text),public.close_room(text) to authenticated;

create or replace function public.claim_room_notifications(p_limit integer default 20)
returns table(id uuid,room_id uuid,room_code text,recipient_user_id uuid,kind text,attempts integer)
language plpgsql security definer set search_path=public as $$
begin
  update public.room_notifications set state='failed',last_error='expired',lease_expires_at=null where state in ('pending','sending') and expires_at<=clock_timestamp();
  return query with candidates as (
    select n.id from public.room_notifications n where n.due_at<=clock_timestamp() and n.expires_at>clock_timestamp()
      and (n.state='pending' or (n.state='sending' and n.lease_expires_at<clock_timestamp())) and n.attempts<8
    order by n.due_at,n.created_at for update skip locked limit greatest(1,least(p_limit,100))
  ), claimed as (
    update public.room_notifications n set state='sending',attempts=n.attempts+1,lease_expires_at=clock_timestamp()+interval '60 seconds'
    from candidates c where n.id=c.id returning n.*
  ) select c.id,c.room_id,r.code,c.recipient_user_id,c.kind,c.attempts from claimed c join public.rooms r on r.id=c.room_id;
end $$;
revoke execute on function public.claim_room_notifications(integer) from public,anon,authenticated;

create or replace function public.advance_notification_schedule() returns integer language plpgsql security definer set search_path=public as $$
declare r record; changed integer:=0; reminder_key text;
begin
  update public.room_notifications n set state='cancelled',lease_expires_at=null from public.rooms r where r.id=n.room_id and n.state in ('pending','sending') and (r.closed_at is not null or r.phase='ended' or (n.event_key like 'police-reminder:%' and n.event_key<>'police-reminder:'||r.id::text||':'||coalesce(r.police_check_at::text,'')));
  for r in select id,police_check_at from public.rooms where closed_at is null and phase='active' and police_check_at is not null loop
    reminder_key:='police-reminder:'||r.id::text||':'||r.police_check_at::text;
    if r.police_check_at-interval '3 minutes'<=clock_timestamp() and r.police_check_at-interval '3 minutes'+interval '30 seconds'>clock_timestamp() then
      perform public.queue_room_notification(r.id,reminder_key,'police-reminder',null,clock_timestamp(),r.police_check_at-interval '3 minutes'+interval '30 seconds');
    end if;
    if r.police_check_at<=clock_timestamp() and public.advance_due_accusation(r.id) then changed:=changed+1; end if;
  end loop;
  return changed;
end $$;
revoke execute on function public.advance_notification_schedule() from public,anon,authenticated;

-- Make newly created RPC functions available to the REST API immediately.
notify pgrst, 'reload schema';

-- BEGIN GENERATED V24 UPGRADE
-- v2.4: additive upgrade; existing rooms keep their legacy engine.
begin;
alter table public.rooms add column if not exists rules_version text not null default 'legacy';
alter table public.rooms alter column rules_version set default '2.4';
alter table public.rooms add column if not exists v24 jsonb not null default '{}';
alter table public.player_secrets add column if not exists protection_until timestamptz;
alter table public.player_secrets add column if not exists doctor_uses integer not null default 0;
alter table public.player_secrets add column if not exists doctor_ready_at timestamptz;
alter table public.player_secrets add column if not exists badge_revealed boolean not null default false;
create table if not exists public.v24_actions (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade,
 actor_id uuid not null references public.players(id), target_id uuid not null references public.players(id),
 kind text not null check(kind in ('attack','heal')), effective_at timestamptz not null,
 evidence_id uuid unique references public.evidence(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 lethal boolean not null default false, healed boolean not null default false
);
create index if not exists v24_actions_order on public.v24_actions(room_id,effective_at,id);
create table if not exists public.v24_ballots (
 room_id uuid not null references public.rooms(id) on delete cascade,
 voter_id uuid not null references public.players(id), nominees uuid[] not null, ranking uuid[] not null,
 submitted_at timestamptz not null default clock_timestamp(), primary key(room_id,voter_id)
);
alter table public.v24_actions enable row level security;
alter table public.v24_ballots enable row level security;
revoke all on public.v24_actions,public.v24_ballots from public,anon,authenticated;

-- Preserve the complete deployed implementation, including its existing wrappers.
do $$ declare n text; sig text; begin
 foreach n in array array['get_room_view','start_game','submit_evidence','approve_evidence','reject_evidence','resolve_bomb','use_reporter','resolve_police_check','set_accusation_at','end_game'] loop
  sig := case n when 'start_game' then 'text,jsonb' when 'submit_evidence' then 'text,uuid,text,timestamptz' when 'resolve_bomb' then 'text,uuid[]' when 'set_accusation_at' then 'text,timestamptz' when 'get_room_view' then 'text' when 'end_game' then 'text' else 'text,uuid' end;
  if to_regprocedure('public.'||n||'_pre24('||sig||')') is null then
   execute format('alter function public.%I(%s) rename to %I',n,sig,n||'_pre24');
  end if;
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated',n||'_pre24',sig);
 end loop;
end $$;

create or replace function public.v24_milestone(rid uuid,kind text,at_time timestamptz,target uuid default null) returns void
language plpgsql security definer set search_path=public as $$ begin
 update public.rooms set v24=jsonb_set(v24,'{milestones}',coalesce(v24->'milestones','[]')||jsonb_build_array(jsonb_build_object('kind',kind,'occurredAt',at_time,'targetPlayerId',target))) where id=rid;
end $$;

create or replace function public.v24_finish(rid uuid, side public.winning_team, reason text, at_time timestamptz) returns void
language plpgsql security definer set search_path=public as $$ begin
 update public.rooms set phase='ended',winner=side,end_game_result=jsonb_build_object('reason',reason,'occurredAt',at_time,'affectedPlayerIds','[]'::jsonb),
 v24=v24||jsonb_build_object('stage','ended') where id=rid and phase<>'ended';
 if found then
  perform public.v24_milestone(rid,'game-ended',at_time);
  perform public.add_event(rid,'winner',case side when 'city' then 'City Side ชนะ · ' else 'Killer Side ชนะ · ' end||reason);
 end if;
end $$;

create or replace function public.v24_victory(rid uuid, at_time timestamptz) returns void
language plpgsql security definer set search_path=public as $$ declare successor uuid; begin
 if not exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.room_id=rid and p.health<>'dead' and s.is_active_killer) then
  perform public.v24_finish(rid,'city','all-killers-eliminated',at_time); return;
 end if;
 if not exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.room_id=rid and p.health<>'dead' and s.role_current='police') then
  select p.id into successor from public.players p join public.player_secrets s on s.player_id=p.id where p.room_id=rid and p.health<>'dead' and s.role_current='detective' limit 1;
  if successor is null then perform public.v24_finish(rid,'killers','police-lineage-eliminated',at_time);
  else
   update public.player_secrets set role_current='police',hearts=2,max_hearts=2,badge_revealed=false where player_id=successor;
   update public.players set health='alive' where id=successor;
   perform public.v24_milestone(rid,'detective-promoted',at_time,successor);
   perform public.add_event(rid,'ability','คุณได้รับตำแหน่ง Police · 2 หัวใจ และ Reveal Badge',successor);
  end if;
 end if;
end $$;

create or replace function public.v24_resolve_vote(rid uuid) returns void
language plpgsql security definer set search_path=public as $$
declare r public.rooms; k integer; police_id uuid; ranks uuid[]; fallback uuid[]; ordered uuid[]; nominees uuid[]; killers uuid[]; pid uuid; pos integer;
begin
 select * into r from public.rooms where id=rid for update;
 if r.phase='ended' or r.v24->>'stage'<>'secret-vote' then return; end if;
 k:=(r.v24->>'nomineeCount')::int;
 select array_agg(value::uuid order by ord) into fallback from jsonb_array_elements_text(r.v24->'fallback') with ordinality x(value,ord);
 select p.id into police_id from public.players p join public.player_secrets s on s.player_id=p.id where p.room_id=rid and p.health<>'dead' and s.role_current='police';
 select ranking into ranks from public.v24_ballots where room_id=rid and voter_id=police_id;
 if ranks is null then ordered:=fallback;
 else
  -- Insert Police at their precommitted fallback position; preserve their ranking of everyone else.
  pos:=array_position(fallback,police_id); ordered:='{}';
  for i in 1..cardinality(fallback) loop
   if i=pos then ordered:=array_append(ordered,police_id);
   else ordered:=array_append(ordered,ranks[case when i<pos then i else i-1 end]); end if;
  end loop;
 end if;
 select array_agg(id order by score desc,tie) into nominees from (
  select p.id,(select count(*) from public.v24_ballots b where b.room_id=rid and p.id=any(b.nominees)) score,array_position(ordered,p.id) tie
  from public.players p where p.room_id=rid and p.health<>'dead' order by score desc,tie limit k
 ) x;
 select array_agg(p.id) into killers from public.players p join public.player_secrets s on s.player_id=p.id where p.room_id=rid and p.health<>'dead' and s.is_active_killer;
 update public.rooms set v24=v24||jsonb_build_object('nominees',nominees) where id=rid;
 perform public.v24_finish(rid,case when nominees @> killers and killers @> nominees then 'city'::winning_team else 'killers'::winning_team end,'final-vote',(r.v24->>'voteEndsAt')::timestamptz);
end $$;

create or replace function public.v24_tick(rid uuid) returns void
language plpgsql security definer set search_path=public as $$
declare r public.rooms; deadline timestamptz; cutoff timestamptz; final_at timestamptz; t timestamptz:=clock_timestamp(); pending boolean; voters jsonb; k integer;
begin
 select * into r from public.rooms where id=rid for update;
 t:=clock_timestamp();
 if r.rules_version<>'2.4' or r.phase in ('lobby','ended') or r.closed_at is not null then return; end if;
 deadline:=(r.v24->>'huntDeadline')::timestamptz; cutoff:=(r.v24->>'cutoffAt')::timestamptz; final_at:=(r.v24->>'finalAt')::timestamptz;
 -- Wait out the permitted upload window as well as already submitted evidence.
 if deadline<=cutoff and t>deadline+interval '2 minutes' and r.pending_bomber_id is null then
  if not exists(select 1 from public.v24_actions where room_id=rid and kind='attack' and status='pending' and effective_at<=deadline) then
   perform public.v24_finish(rid,'city','hunt-clock-expired',deadline); return;
  end if;
 end if;
 if r.pending_bomber_id is not null then return; end if;
 if t>=cutoff then
  select exists(select 1 from public.v24_actions where room_id=rid and status='pending') into pending;
  if pending then update public.rooms set v24=v24||jsonb_build_object('stage','resolution') where id=rid and v24->>'stage'<>'resolution'; return; end if;
  if t<final_at then
   update public.rooms set v24=v24||jsonb_build_object('stage',case when t>=final_at-interval '10 minutes' then 'final-discussion' else 'resolution' end) where id=rid;
  elsif r.v24->>'stage'<>'secret-vote' then
   if (select count(*) from public.v24_actions where room_id=rid and lethal and status='approved')<2 then perform public.v24_finish(rid,'city','final-low-kills',final_at); return; end if;
   select count(*) into k from public.players p join public.player_secrets s on s.player_id=p.id where p.room_id=rid and p.health<>'dead' and s.is_active_killer;
   select jsonb_agg(id order by random()) into voters from public.players where room_id=rid and health<>'dead';
   -- A delayed Host resolution must not silently consume the secret voting window.
   update public.rooms set v24=v24||jsonb_build_object('stage','secret-vote','nomineeCount',k,'fallback',voters,'voters',voters,'voteEndsAt',greatest(t,final_at)+interval '3 minutes') where id=rid;
   perform public.add_event(rid,'system','Communication Lock · เริ่มโหวตลับ 3 นาที');
  elsif t>=(r.v24->>'voteEndsAt')::timestamptz then perform public.v24_resolve_vote(rid);
  end if;
 end if;
end $$;

create or replace function public.get_room_view(p_code text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; result jsonb; me uuid; host boolean; killer boolean; meta jsonb; extra jsonb; own jsonb;
begin
 select * into r from public.rooms where code=upper(trim(p_code));
 if r.id is null or auth.uid() is null then return null; end if;
 host:=r.host_user_id=auth.uid(); select id into me from public.players where room_id=r.id and user_id=auth.uid();
 if not host and me is null then return null; end if;
 if r.rules_version='2.4' then perform public.v24_tick(r.id); end if;
 result:=public.get_room_view_pre24(p_code);
 if r.rules_version<>'2.4' then return result||jsonb_build_object('rulesVersion','legacy'); end if;
 select * into r from public.rooms where id=r.id;
 select is_active_killer into killer from public.player_secrets where player_id=me;
 meta:=r.v24-'fallback'-'voters'-'lastResolvedAt'-'huntDeadline'-'milestones';
 if r.phase='ended' then result:=result||jsonb_build_object('endGameTimeline',coalesce((select jsonb_agg(value order by (value->>'occurredAt')::timestamptz) from jsonb_array_elements(coalesce(r.v24->'milestones','[]'))),'[]')); end if;
 if host or coalesce(killer,false) then
  meta:=meta||jsonb_build_object('huntDeadline',r.v24->'huntDeadline','huntPending',exists(select 1 from public.v24_actions where room_id=r.id and kind='attack' and status='pending' and effective_at<=(r.v24->>'huntDeadline')::timestamptz),
   'attacksUsed',(select count(*) from public.v24_actions where room_id=r.id and status='approved' and kind='attack' and effective_at>clock_timestamp()-interval '60 minutes'),
   'killsUsed',(select count(*) from public.v24_actions where room_id=r.id and status='approved' and lethal and effective_at>clock_timestamp()-interval '60 minutes'),
   'pendingAttacks',(select count(*) from public.v24_actions where room_id=r.id and status='pending' and kind='attack'));
 end if;
 select coalesce(jsonb_object_agg(s.player_id::text,(result->'privateStates'->s.player_id::text)||jsonb_build_object('protectionUntil',s.protection_until,'doctorUses',s.doctor_uses,'doctorReadyAt',s.doctor_ready_at,'badgeRevealed',s.badge_revealed)),'{}') into extra
 from public.player_secrets s join public.players p on p.id=s.player_id where p.room_id=r.id and (host or s.player_id=me);
 select jsonb_build_object('nominees',nominees,'ranking',ranking,'submittedAt',submitted_at) into own from public.v24_ballots where room_id=r.id and voter_id=me;
 meta:=meta||jsonb_build_object('myBallot',own,'serverNow',clock_timestamp());
 if host then
  meta:=meta||jsonb_build_object('actions',(select coalesce(jsonb_agg(to_jsonb(a) order by effective_at,id),'[]') from public.v24_actions a where room_id=r.id),
   'ballots',(select coalesce(jsonb_agg(to_jsonb(b)),'[]') from public.v24_ballots b where room_id=r.id));
 end if;
 return result||jsonb_build_object('rulesVersion','2.4','phase',case when r.phase in ('lobby','ended','bomb-resolution') then r.phase::text else coalesce(r.v24->>'stage','active') end,'v24',meta,'privateStates',coalesce(result->'privateStates','{}')||extra,'policeCheckAt',null);
end $$;

create or replace function public.configure_v24(p_code text,p_duration_minutes integer,p_proximity_rule text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; begin
 select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
 if r.host_user_id is distinct from auth.uid() or r.rules_version<>'2.4' or r.phase<>'lobby' then raise exception 'not allowed'; end if;
 if p_duration_minutes is null or p_duration_minutes<=120 or p_duration_minutes>2880 or length(trim(coalesce(p_proximity_rule,''))) not between 10 and 1000 then raise exception 'invalid v24 settings'; end if;
 update public.rooms set v24=jsonb_build_object('durationMinutes',p_duration_minutes,'proximityRule',trim(p_proximity_rule)) where id=r.id;
 return public.get_room_view(p_code);
end $$;

create or replace function public.start_game(p_code text,p_role_counts jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; p public.players; roles text[]:='{}'; item record; role text; hp int; idx int:=1; t timestamptz:=clock_timestamp(); duration int;
begin
 select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
 t:=clock_timestamp();
 if r.rules_version<>'2.4' then return public.start_game_pre24(p_code,p_role_counts); end if;
 if r.host_user_id is distinct from auth.uid() or r.phase<>'lobby' then raise exception 'not allowed'; end if;
 duration:=coalesce((r.v24->>'durationMinutes')::int,600);
 if length(trim(coalesce(r.v24->>'proximityRule','')))<10 then raise exception 'configure proximity rule before start'; end if;
 if p_role_counts is null or jsonb_typeof(p_role_counts)<>'object' then raise exception 'invalid roles'; end if;
 for item in select key,value::int amount from jsonb_each_text(p_role_counts) loop
  if item.key not in ('killer','killer-wife','police','detective','reporter','bomber','athlete','doctor','villager') or item.amount is null or item.amount<0 or item.amount>(case when item.key='villager' then 20 else 1 end) then raise exception 'invalid roles'; end if;
  roles:=roles||array_fill(item.key,array[item.amount]);
 end loop;
 if cardinality(roles)<3 or cardinality(roles)<>(select count(*) from public.players where room_id=r.id) or coalesce((p_role_counts->>'killer')::int,0)<>1 or coalesce((p_role_counts->>'police')::int,0)<>1 or exists(select 1 from public.players where room_id=r.id and avatar_id is null) then raise exception 'invalid player count, avatar selection, or required roles'; end if;
 for p in select * from public.players where room_id=r.id order by random() loop
  role:=roles[idx]; idx:=idx+1; hp:=case role when 'killer' then 0 when 'killer-wife' then 1 when 'athlete' then 3 else 2 end;
  insert into public.player_secrets(player_id,initial_role,role_current,team,is_active_killer,hearts,max_hearts) values(p.id,role,role,case when role in ('killer','killer-wife') then 'killers' else 'city' end,role='killer',hp,hp);
 end loop;
 update public.rooms set phase='active',police_check_at=null,v24=v24||jsonb_build_object('stage','active','startedAt',t,'finalAt',t+make_interval(mins=>duration),'cutoffAt',t+make_interval(mins=>duration-30),'revealEndsAt',t+make_interval(mins=>duration-120),'huntDeadline',t+interval '120 minutes') where id=r.id;
 perform public.add_event(r.id,'system','เกมเริ่มแล้ว · กติกา v2.4'); return public.get_room_view(p_code);
end $$;
-- All mutations serialize on the room row. The two-minute watermark prevents
-- a later upload from inserting an attack ahead of an already resolved heal.
create or replace function public.v24_apply(p_code text,p_action_id uuid,p_approve boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; a public.v24_actions; s public.player_secrets; target public.players; hp int; lethal_hit boolean; t timestamptz:=clock_timestamp();
begin
 select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
 t:=clock_timestamp();
 if r.host_user_id is distinct from auth.uid() or r.rules_version<>'2.4' or r.phase in ('lobby','ended') then raise exception 'not allowed'; end if;
 select * into a from public.v24_actions where id=p_action_id and room_id=r.id;
 if a.id is null then raise exception 'action not found'; end if;
 if a.status<>'pending' then return public.get_room_view(p_code); end if;
 if not p_approve and a.kind='attack' then
  update public.v24_actions set status='rejected' where id=a.id;
  update public.evidence set status='rejected',decision_at=t where id=a.evidence_id;
  perform public.add_event(r.id,'warning','หลักฐานถูกปฏิเสธ',a.actor_id);
  return public.get_room_view(p_code);
 end if;
 if r.pending_bomber_id is not null then raise exception 'resolve bomb first'; end if;
 if exists(select 1 from public.v24_actions where room_id=r.id and status='pending' and (effective_at,id)<(a.effective_at,a.id)) then raise exception 'resolve earlier event first'; end if;
 if t<a.effective_at+interval '2 minutes' and t<(r.v24->>'cutoffAt')::timestamptz then raise exception 'waiting for capture upload window'; end if;
 if (r.v24->>'huntDeadline')::timestamptz<a.effective_at and (r.v24->>'huntDeadline')::timestamptz<=(r.v24->>'cutoffAt')::timestamptz then
  perform public.v24_finish(r.id,'city','hunt-clock-expired',(r.v24->>'huntDeadline')::timestamptz); return public.get_room_view(p_code);
 end if;
 select * into s from public.player_secrets where player_id=a.target_id;
 select * into target from public.players where id=a.target_id;
 if a.kind='heal' then
  -- A previously accepted heal becomes a no-op if its actor or target died earlier.
  if target.health<>'dead' and not s.is_active_killer and exists(select 1 from public.players where id=a.actor_id and health<>'dead') then
   hp:=least(s.max_hearts,s.hearts+1);
   update public.player_secrets set hearts=hp where player_id=target.id;
   update public.players set health=case when hp=1 then 'critical'::health_state else 'alive'::health_state end where id=target.id;
   update public.v24_actions set healed=(hp>s.hearts) where id=a.id;
  end if;
  perform public.add_event(r.id,'ability','Doctor treated '||target.name);
 else
  if target.health='dead' or s.is_active_killer or not exists(select 1 from public.players where id=a.actor_id and health<>'dead') then raise exception 'attack target or actor unavailable; reject evidence'; end if;
  if s.protection_until>a.effective_at then raise exception 'target protected; reject evidence'; end if;
  if (select count(*) from public.v24_actions where room_id=r.id and kind='attack' and status='approved' and effective_at>a.effective_at-interval '60 minutes' and effective_at<=a.effective_at)>=3 then raise exception 'rolling attack quota reached; reject evidence'; end if;
  lethal_hit:=s.hearts=1 and s.initial_role<>'killer-wife';
  if lethal_hit and exists(select 1 from public.v24_actions where room_id=r.id and status='approved' and lethal and effective_at>a.effective_at-interval '60 minutes' and effective_at<=a.effective_at) then raise exception 'rolling kill quota reached; reject evidence'; end if;
  if s.initial_role='killer-wife' then
   update public.player_secrets set role_current='killer',is_active_killer=true,team='killers',hearts=0,max_hearts=0 where player_id=target.id;
   perform public.add_event(r.id,'ability','มี Killer คนที่สองเกิดขึ้น');
   perform public.add_event(r.id,'ability','คุณกลายเป็น Killer แล้ว',target.id);
  else
   hp:=greatest(0,s.hearts-1);
   update public.player_secrets set hearts=hp,protection_until=a.effective_at+interval '45 minutes' where player_id=target.id;
   update public.players set health=case when hp=0 then 'dead'::health_state when hp=1 then 'critical'::health_state else 'alive'::health_state end where id=target.id;
   perform public.add_event(r.id,'warning','คุณถูกโจมตีและเสียหัวใจ 1 ดวง',target.id);
   insert into public.room_events(room_id,type,message,excluded_player_id) values(r.id,'attack','มีคนถูกโจมตีจาก Killer',target.id);
  end if;
  update public.evidence set status='approved',decision_at=t,attack_result=case when lethal_hit then 'elimination confirmed' else 'target is still alive' end where id=a.evidence_id;
  update public.v24_actions set lethal=lethal_hit where id=a.id;
  if lethal_hit then
   if s.initial_role='detective' then perform public.v24_milestone(r.id,'detective-eliminated',a.effective_at,target.id); end if;
   update public.rooms set v24=v24||jsonb_build_object('huntDeadline',a.effective_at+interval '120 minutes') where id=r.id;
   perform public.add_event(r.id,'attack',target.name||' เสียชีวิต');
   if s.role_current='bomber' then
    update public.rooms set phase='bomb-resolution',pending_bomber_id=target.id,v24=v24||jsonb_build_object('bombAt',a.effective_at) where id=r.id;
    perform public.add_event(r.id,'bomb',target.name||' คือ Bomber · รอ Host ตรวจ proximity rule');
   else perform public.v24_victory(r.id,a.effective_at); end if;
  end if;
 end if;
 update public.v24_actions set status='approved' where id=a.id;
 update public.rooms set v24=v24||jsonb_build_object('lastResolvedAt',a.effective_at) where id=r.id;
 return public.get_room_view(p_code);
end $$;

create or replace function public.submit_evidence(p_code text,p_target_id uuid,p_storage_path text,p_captured_at timestamptz) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; me uuid; eid uuid; t timestamptz:=clock_timestamp();
begin
 select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
 if r.rules_version='2.4' and exists(select 1 from public.players where room_id=r.id and user_id=auth.uid()) then
  perform public.v24_tick(r.id); select * into r from public.rooms where id=r.id;
  if r.phase='ended' then return public.get_room_view(p_code)||jsonb_build_object('actionError','game_ended'); end if;
 end if;
 t:=clock_timestamp();
 if r.rules_version<>'2.4' then return public.submit_evidence_pre24(p_code,p_target_id,p_storage_path,p_captured_at); end if;
 select p.id into me from public.players p join public.player_secrets s on s.player_id=p.id where p.room_id=r.id and p.user_id=auth.uid() and p.health<>'dead' and s.is_active_killer;
 if me is null or r.phase not in ('active','bomb-resolution') or t>=(r.v24->>'cutoffAt')::timestamptz or p_captured_at is null or p_captured_at>t or p_captured_at<t-interval '2 minutes' or p_captured_at<(r.v24->>'startedAt')::timestamptz or p_captured_at<=coalesce((r.v24->>'lastResolvedAt')::timestamptz,'-infinity') then raise exception 'evidence is not allowed, missing, or stale'; end if;
 if not exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.id=p_target_id and p.room_id=r.id and p.id<>me and p.health<>'dead' and not s.is_active_killer) then raise exception 'invalid target'; end if;
 if p_storage_path is null or p_storage_path not like auth.uid()::text||'/%' or not exists(select 1 from storage.objects where bucket_id='evidence' and name=p_storage_path and metadata->>'mimetype' like 'image/%' and metadata->>'size' ~ '^[1-9][0-9]*$') then raise exception 'missing evidence image'; end if;
 if (select count(*) from public.v24_actions where room_id=r.id and actor_id=me and kind='attack' and status='pending')>=2 then raise exception 'pending evidence limit reached'; end if;
 if (select count(*) from public.v24_actions where room_id=r.id and kind='attack' and status in ('pending','approved') and effective_at>p_captured_at-interval '60 minutes')>=3 then raise exception 'rolling attack reservations full'; end if;
 insert into public.evidence(room_id,killer_id,target_id,storage_path,captured_at) values(r.id,me,p_target_id,p_storage_path,p_captured_at) returning id into eid;
 insert into public.v24_actions(room_id,actor_id,target_id,kind,effective_at,evidence_id) values(r.id,me,p_target_id,'attack',p_captured_at,eid);
 return public.get_room_view(p_code);
end $$;

create or replace function public.approve_evidence(p_code text,p_evidence_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if (select rules_version from public.rooms where code=upper(trim(p_code)))='2.4' then return public.v24_apply(p_code,(select id from public.v24_actions where evidence_id=p_evidence_id),true); end if;
 return public.approve_evidence_pre24(p_code,p_evidence_id);
end $$;
create or replace function public.reject_evidence(p_code text,p_evidence_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if (select rules_version from public.rooms where code=upper(trim(p_code)))='2.4' then return public.v24_apply(p_code,(select id from public.v24_actions where evidence_id=p_evidence_id),false); end if;
 return public.reject_evidence_pre24(p_code,p_evidence_id);
end $$;

create or replace function public.use_doctor(p_code text,p_target_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; me uuid; s public.player_secrets; t timestamptz:=clock_timestamp(); begin
 select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
 if r.rules_version='2.4' and exists(select 1 from public.players where room_id=r.id and user_id=auth.uid()) then
  perform public.v24_tick(r.id); select * into r from public.rooms where id=r.id;
  if r.phase='ended' then return public.get_room_view(p_code)||jsonb_build_object('actionError','game_ended'); end if;
 end if;
 t:=clock_timestamp();
 select id into me from public.players where room_id=r.id and user_id=auth.uid() and health<>'dead';
 select * into s from public.player_secrets where player_id=me;
 if r.rules_version is distinct from '2.4' or r.phase not in ('active','bomb-resolution') or t>=(r.v24->>'cutoffAt')::timestamptz or s.role_current is distinct from 'doctor' or s.doctor_uses>=4 or s.doctor_ready_at>t or p_target_id=me or not exists(select 1 from public.players where id=p_target_id and room_id=r.id and health<>'dead') then raise exception 'doctor ability unavailable'; end if;
 update public.player_secrets set doctor_uses=doctor_uses+1,doctor_ready_at=t+interval '90 minutes' where player_id=me;
 insert into public.v24_actions(room_id,actor_id,target_id,kind,effective_at) values(r.id,me,p_target_id,'heal',t);
 return public.get_room_view(p_code);
end $$;

create or replace function public.reveal_police(p_code text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; me public.players; begin
 select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
 if r.rules_version='2.4' and exists(select 1 from public.players where room_id=r.id and user_id=auth.uid()) then
  perform public.v24_tick(r.id); select * into r from public.rooms where id=r.id;
  if r.phase='ended' then return public.get_room_view(p_code)||jsonb_build_object('actionError','game_ended'); end if;
 end if;
 select * into me from public.players where room_id=r.id and user_id=auth.uid() and health<>'dead';
 if r.rules_version is distinct from '2.4' or r.phase not in ('active','bomb-resolution') or clock_timestamp()>(r.v24->>'revealEndsAt')::timestamptz or not exists(select 1 from public.player_secrets where player_id=me.id and role_current='police' and not badge_revealed) then raise exception 'reveal unavailable'; end if;
 update public.player_secrets set badge_revealed=true where player_id=me.id;
 perform public.add_event(r.id,'ability',me.name||' เปิด Reveal Badge · ยืนยันว่าเป็น Police'); return public.get_room_view(p_code);
end $$;

create or replace function public.resolve_bomb(p_code text,p_target_ids uuid[]) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; target public.players; begin
 select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
 if r.rules_version<>'2.4' then return public.resolve_bomb_pre24(p_code,p_target_ids); end if;
 if r.host_user_id is distinct from auth.uid() or r.phase<>'bomb-resolution' or p_target_ids is null or cardinality(p_target_ids)>1 then raise exception 'invalid bomb resolution'; end if;
 foreach target.id in array p_target_ids loop
  select * into target from public.players where id=target.id and room_id=r.id and health<>'dead';
  if not found then raise exception 'invalid bomb target'; end if;
  update public.players set health='dead' where id=target.id; update public.player_secrets set hearts=0 where player_id=target.id;
  if exists(select 1 from public.player_secrets where player_id=target.id and initial_role='detective') then perform public.v24_milestone(r.id,'detective-eliminated',(r.v24->>'bombAt')::timestamptz,target.id); end if;
  perform public.add_event(r.id,'bomb',target.name||' เสียชีวิตจากระเบิด');
 end loop;
 update public.rooms set phase='active',pending_bomber_id=null where id=r.id;
 perform public.v24_victory(r.id,(r.v24->>'bombAt')::timestamptz);
 return public.get_room_view(p_code);
end $$;

create or replace function public.use_reporter(p_code text,p_target_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms;
begin
 select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
 if r.rules_version='2.4' then
  if r.phase not in ('active','bomb-resolution') or clock_timestamp()>=(r.v24->>'cutoffAt')::timestamptz then raise exception 'reporter ability unavailable'; end if;
  if exists(select 1 from public.players where room_id=r.id and user_id=auth.uid()) then
   perform public.v24_tick(r.id);
   if exists(select 1 from public.rooms where id=r.id and phase='ended') then return public.get_room_view(p_code)||jsonb_build_object('actionError','game_ended'); end if;
  end if;
 end if;
 return public.use_reporter_pre24(p_code,p_target_id);
end $$;
create or replace function public.resolve_police_check(p_code text,p_target_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$ begin
 if exists(select 1 from public.rooms where code=upper(trim(p_code)) and rules_version='2.4') then raise exception 'v24 uses secret final vote'; end if;
 return public.resolve_police_check_pre24(p_code,p_target_id);
end $$;
create or replace function public.set_accusation_at(p_code text,p_at timestamptz) returns jsonb language plpgsql security definer set search_path=public as $$ begin
 if exists(select 1 from public.rooms where code=upper(trim(p_code)) and rules_version='2.4') then raise exception 'v24 schedule locked at start'; end if;
 return public.set_accusation_at_pre24(p_code,p_at);
end $$;
create or replace function public.end_game(p_code text) returns jsonb language plpgsql security definer set search_path=public as $$ begin
 return public.end_game_pre24(p_code);
end $$;

create or replace function public.submit_final_ballot(p_code text,p_nominees uuid[],p_ranking uuid[]) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; me uuid; police boolean; eligible uuid[]; begin
 select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
 select p.id,s.role_current='police' into me,police from public.players p join public.player_secrets s on s.player_id=p.id where p.room_id=r.id and p.user_id=auth.uid() and p.health<>'dead';
 if me is null or r.rules_version is distinct from '2.4' or r.phase='ended' or r.v24->>'stage'<>'secret-vote' or clock_timestamp()>=(r.v24->>'voteEndsAt')::timestamptz then raise exception 'vote unavailable'; end if;
 select array_agg(value::uuid) into eligible from jsonb_array_elements_text(r.v24->'voters') where value<>me::text;
 if p_nominees is null or cardinality(p_nominees)<>(r.v24->>'nomineeCount')::int or cardinality(p_nominees)<>(select count(distinct x) from unnest(p_nominees) x) or not p_nominees<@eligible then raise exception 'invalid ballot'; end if;
 if police and (p_ranking is null or cardinality(p_ranking)<>cardinality(eligible) or cardinality(p_ranking)<>(select count(distinct x) from unnest(p_ranking) x) or not p_ranking<@eligible) then raise exception 'invalid police ranking'; end if;
 if not police and coalesce(cardinality(p_ranking),0)>0 then raise exception 'ranking is police only'; end if;
 insert into public.v24_ballots(room_id,voter_id,nominees,ranking) values(r.id,me,p_nominees,coalesce(p_ranking,'{}')) on conflict do nothing;
 return public.get_room_view(p_code);
end $$;

create or replace function public.resolve_final(p_code text) returns jsonb language plpgsql security definer set search_path=public as $$ declare rid uuid; begin
 select id into rid from public.rooms where code=upper(trim(p_code)) and host_user_id=auth.uid() and rules_version='2.4';
 if rid is null then raise exception 'not allowed'; end if; perform public.v24_tick(rid); return public.get_room_view(p_code);
end $$;
create or replace function public.record_v24_warning(p_code text,p_message text) returns jsonb language plpgsql security definer set search_path=public as $$ declare rid uuid; begin
 select id into rid from public.rooms where code=upper(trim(p_code)) and host_user_id=auth.uid() and rules_version='2.4' and closed_at is null;
 if rid is null or length(trim(coalesce(p_message,''))) not between 1 and 500 then raise exception 'not allowed'; end if;
 perform public.add_event(rid,'warning','Host warning: '||trim(p_message)); return public.get_room_view(p_code);
end $$;

create or replace function public.advance_v24_schedule() returns void language plpgsql security definer set search_path=public as $$ declare rid uuid; begin
 for rid in select id from public.rooms where rules_version='2.4' and phase not in ('lobby','ended') and closed_at is null loop perform public.v24_tick(rid); end loop;
end $$;
-- Existing notification schedulers also evaluate v2.4, independently of clients.
do $$ begin
 if to_regprocedure('public.advance_notification_schedule_pre24()') is null then
  alter function public.advance_notification_schedule() rename to advance_notification_schedule_pre24;
 end if;
end $$;
create or replace function public.advance_notification_schedule() returns integer language plpgsql security definer set search_path=public as $$ begin
 perform public.advance_v24_schedule();
 return public.advance_notification_schedule_pre24();
end $$;
revoke all on function public.advance_notification_schedule(),public.advance_notification_schedule_pre24() from public,anon,authenticated;
do $$ declare f record; begin
 for f in select oid::regprocedure sig,proname from pg_proc where pronamespace='public'::regnamespace and (proname like 'v24_%' or proname in ('advance_v24_schedule','configure_v24','use_doctor','reveal_police','submit_final_ballot','resolve_final','record_v24_warning','get_room_view','start_game','submit_evidence','approve_evidence','reject_evidence','resolve_bomb','use_reporter','resolve_police_check','set_accusation_at','end_game')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
  if f.proname not like 'v24_%' and f.proname<>'advance_v24_schedule' then execute format('grant execute on function %s to authenticated',f.sig); end if;
 end loop;
 -- Host-authorized queue resolver is also an RPC.
 grant execute on function public.v24_apply(text,uuid,boolean) to authenticated;
 if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.advance_v24_schedule() to service_role; end if;
 if exists(select 1 from pg_namespace where nspname='cron') then
  perform cron.schedule('killer-v24-clock','* * * * *','select public.advance_v24_schedule()');
 end if;
end $$;
notify pgrst,'reload schema';
commit;
