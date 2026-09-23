-- Deliver harmless room invalidations and recipient-specific notices over
-- private Supabase Broadcast channels. Postgres Changes remains available as
-- the client fallback during rollout.
begin;

create or replace function public.can_receive_room_broadcast(p_topic text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.rooms r
    where p_topic='room:'||r.code
      and (r.host_user_id=auth.uid() or exists (
        select 1 from public.players p where p.room_id=r.id and p.user_id=auth.uid()
      ))
  )
$$;
revoke all on function public.can_receive_room_broadcast(text) from public,anon;
grant execute on function public.can_receive_room_broadcast(text) to authenticated;

create or replace function public.can_receive_user_broadcast(p_topic text)
returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and p_topic='user:'||auth.uid()::text
$$;
revoke all on function public.can_receive_user_broadcast(text) from public,anon;
grant execute on function public.can_receive_user_broadcast(text) to authenticated;

drop policy if exists "room members receive private room broadcasts" on realtime.messages;
create policy "room members receive private room broadcasts"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension='broadcast'
    and public.can_receive_room_broadcast((select realtime.topic()))
  );

drop policy if exists "users receive their private notices" on realtime.messages;
create policy "users receive their private notices"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension='broadcast'
    and public.can_receive_user_broadcast((select realtime.topic()))
  );

create or replace function public.emit_private_broadcast(
  p_topic text, p_event text, p_payload jsonb
) returns void language plpgsql security definer set search_path=public as $$
begin
  -- Keep game mutations healthy if Realtime is unavailable or its SQL helper
  -- is absent in a local/test database. The existing signal row and polling
  -- fallback remain the recovery path.
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then return; end if;
  execute 'select realtime.send($1,$2,$3,$4)'
    using coalesce(p_payload,'{}'::jsonb),p_event,p_topic,true;
exception when others then
  return;
end $$;
revoke all on function public.emit_private_broadcast(text,text,jsonb) from public,anon,authenticated;

create or replace function public.broadcast_room_signal()
returns trigger language plpgsql security definer set search_path=public as $$
declare room_code text;
begin
  if tg_op='UPDATE' and new.changed_at is not distinct from old.changed_at then return new; end if;
  select code into room_code from public.rooms where id=new.room_id;
  if room_code is not null then
    perform public.emit_private_broadcast(
      'room:'||room_code,'room_changed',jsonb_build_object('changedAt',new.changed_at)
    );
  end if;
  return new;
end $$;
revoke all on function public.broadcast_room_signal() from public,anon,authenticated;
drop trigger if exists room_signals_broadcast on public.room_signals;
create trigger room_signals_broadcast after insert or update on public.room_signals
  for each row execute function public.broadcast_room_signal();

-- Do not fan out heartbeat-only writes or no-op updates. `now()` is stable for
-- a transaction, so the room signal row also coalesces repeated changes made
-- by one game RPC into a single Broadcast invalidation.
create or replace function public.touch_room_signal_room()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='UPDATE' and to_jsonb(new)=to_jsonb(old) then return new; end if;
  insert into public.room_signals(room_id,changed_at) values(new.id,now())
  on conflict(room_id) do update set changed_at=excluded.changed_at;
  return new;
end $$;

create or replace function public.touch_room_signal_child()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='UPDATE' then
    if tg_table_name='players' and (to_jsonb(new)-'last_seen_at')=(to_jsonb(old)-'last_seen_at') then return new; end if;
    if to_jsonb(new)=to_jsonb(old) then return new; end if;
  end if;
  insert into public.room_signals(room_id,changed_at) values(new.room_id,now())
  on conflict(room_id) do update set changed_at=excluded.changed_at;
  return new;
end $$;

create or replace function public.touch_room_signal_secret()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='UPDATE' and to_jsonb(new)=to_jsonb(old) then return new; end if;
  insert into public.room_signals(room_id,changed_at)
    select room_id,now() from public.players where id=new.player_id
  on conflict(room_id) do update set changed_at=excluded.changed_at;
  return new;
end $$;

create or replace function public.broadcast_v24_action_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare room_code text;
begin
  if tg_op='UPDATE' and to_jsonb(new)=to_jsonb(old) then return new; end if;
  if exists (select 1 from public.room_signals where room_id=new.room_id and changed_at=transaction_timestamp()) then return new; end if;
  select code into room_code from public.rooms where id=new.room_id;
  if room_code is not null then
    perform public.emit_private_broadcast('room:'||room_code,'room_changed','{}'::jsonb);
  end if;
  return new;
end $$;
revoke all on function public.broadcast_v24_action_change() from public,anon,authenticated;
drop trigger if exists v24_actions_broadcast on public.v24_actions;
create trigger v24_actions_broadcast after insert or update on public.v24_actions
  for each row execute function public.broadcast_v24_action_change();

create or replace function public.broadcast_v24_ballot_to_host()
returns trigger language plpgsql security definer set search_path=public as $$
declare room_code text; host_id uuid;
begin
  select code,host_user_id into room_code,host_id from public.rooms where id=new.room_id;
  if room_code is not null and host_id is not null then
    perform public.emit_private_broadcast(
      'user:'||host_id::text,'host_room_changed',jsonb_build_object('roomCode',room_code)
    );
  end if;
  return new;
end $$;
revoke all on function public.broadcast_v24_ballot_to_host() from public,anon,authenticated;
drop trigger if exists v24_ballots_broadcast on public.v24_ballots;
create trigger v24_ballots_broadcast after insert or update on public.v24_ballots
  for each row execute function public.broadcast_v24_ballot_to_host();

create or replace function public.broadcast_room_notification()
returns trigger language plpgsql security definer set search_path=public as $$
declare room_code text;
begin
  select code into room_code from public.rooms where id=new.room_id;
  if room_code is not null then
    perform public.emit_private_broadcast(
      'user:'||new.recipient_user_id::text,
      'room_notification',
      jsonb_build_object('id',new.id,'kind',new.kind,'created_at',new.created_at,
        'room_code',room_code,'due_at',new.due_at)
    );
  end if;
  return new;
end $$;
revoke all on function public.broadcast_room_notification() from public,anon,authenticated;
drop trigger if exists room_notifications_broadcast on public.room_notifications;
create trigger room_notifications_broadcast after insert on public.room_notifications
  for each row execute function public.broadcast_room_notification();

create or replace function public.get_recent_room_notifications(
  p_code text, p_since timestamptz default (clock_timestamp()-interval '30 seconds')
) returns table(id uuid,kind text,created_at timestamptz,room_code text,due_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare normalized_code text:=upper(trim(coalesce(p_code,'')));
begin
  if auth.uid() is null or normalized_code='' then raise exception 'not allowed'; end if;
  if not exists (
    select 1 from public.rooms r where r.code=normalized_code
      and (r.host_user_id=auth.uid() or exists (
        select 1 from public.players p where p.room_id=r.id and p.user_id=auth.uid()
      ))
  ) then raise exception 'not allowed'; end if;
  return query
    select n.id,n.kind,n.created_at,r.code,n.due_at
    from public.room_notifications n join public.rooms r on r.id=n.room_id
    where r.code=normalized_code and n.recipient_user_id=auth.uid()
      and n.created_at>=greatest(coalesce(p_since,clock_timestamp()-interval '30 seconds'),clock_timestamp()-interval '1 hour')
      and n.created_at<=clock_timestamp() and n.due_at<=clock_timestamp()
      and n.expires_at>clock_timestamp() and n.state<>'cancelled'
    order by n.created_at desc limit 100;
end $$;
revoke all on function public.get_recent_room_notifications(text,timestamptz) from public,anon;
grant execute on function public.get_recent_room_notifications(text,timestamptz) to authenticated;

notify pgrst,'reload schema';
commit;
