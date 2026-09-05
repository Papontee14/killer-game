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
  attack_limit integer not null default 2 check (attack_limit in (2,3)),
  approved_attacks_in_window integer not null default 0 check (approved_attacks_in_window >= 0),
  quota_window_start timestamptz not null default (date_trunc('hour', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'),
  police_check_at timestamptz, pending_bomber_id uuid, winner public.winning_team,
  created_at timestamptz not null default now(), closed_at timestamptz
);
-- Existing installations may still have the retired player PIN hash.
alter table public.rooms drop column if exists host_pin_hash;
alter table public.rooms drop column if exists player_pin_hash;
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id), name text not null, reclaim_token_hash text, is_online boolean not null default true, last_seen_at timestamptz not null default now(),
  health public.health_state not null default 'alive', joined_at timestamptz not null default now(), unique(room_id, user_id)
);
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
alter table public.evidence add column if not exists attack_result text
  check (attack_result in ('target is still alive','elimination confirmed'));

create table if not exists public.room_events (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade,
  type text not null, message text not null, visible_to_player_id uuid references public.players(id), created_at timestamptz not null default now()
);
create table if not exists public.room_signals (
  room_id uuid primary key references public.rooms(id) on delete cascade, changed_at timestamptz not null default now()
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
  add column if not exists reclaim_token_hash text;
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

-- No table policy exposes roles, hearts or evidence. Clients use get_room_view.
revoke all on public.rooms, public.players, public.player_secrets, public.evidence, public.room_events from anon, authenticated;
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
do $$ begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='room_signals') then
    alter publication supabase_realtime add table public.room_signals;
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

create or replace function public.get_room_view(p_code text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; me public.players; is_host boolean; viewer_role text; states jsonb; roster jsonb; events jsonb; evidences jsonb; progress jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then return null; end if;
  select * into r from public.rooms where code=upper(trim(p_code)) limit 1;
  if not found then return null; end if;
  is_host := r.host_user_id=auth.uid();
  if not is_host then select * into me from public.players p where p.room_id=r.id and p.user_id=auth.uid() limit 1; if not found then return null; end if; end if;
  perform public.advance_due_accusation(r.id);
  select * into r from public.rooms where id=r.id;
  viewer_role := case when is_host then 'host' else 'player' end;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'joinedAt',p.joined_at,'isOnline',p.is_online and p.last_seen_at > now()-interval '90 seconds','health',case when is_host or p.id=me.id then p.health when p.health='dead' then 'dead'::health_state else 'alive'::health_state end,
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
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'type',e.type,'message',e.message,'createdAt',e.created_at,'playerId',e.visible_to_player_id) order by e.created_at desc),'[]'::jsonb) into events from public.room_events e where e.room_id=r.id and (is_host or e.visible_to_player_id is null or e.visible_to_player_id=me.id);
  return jsonb_build_object('viewerRole',viewer_role,'playerId',case when is_host then null else me.id end,'code',r.code,'hostName',r.host_name,'phase',r.phase,
    'createdAt',r.created_at,'closedAt',r.closed_at,'attackLimit',r.attack_limit,'attacksThisHour',case when r.quota_window_start=(date_trunc('hour',clock_timestamp() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok') then r.approved_attacks_in_window else 0 end,
    'quotaWindowStart',r.quota_window_start,'policeCheckAt',r.police_check_at,'players',roster,'privateStates',states,'evidences',evidences,'killerEvidenceProgress',progress,'events',events,
    'winner',r.winner,'bombTargets','[]'::jsonb,'pendingBomberId',r.pending_bomber_id);
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
  if array_length(roles,1) <> (select count(*) from public.players where room_id=r.id) or (select count(*) from unnest(roles) x where x='killer')<>1 or (select count(*) from unnest(roles) x where x='police')<1 then raise exception 'invalid player count or required roles'; end if;
  idx := 1;
  for p in select * from public.players where room_id=r.id order by random() loop
    role := roles[idx]; idx := idx+1; mh := case role when 'athlete' then 3 when 'sumo' then 4 when 'killer' then 0 else 2 end;
    insert into public.player_secrets(player_id,initial_role,role_current,team,is_active_killer,hearts,max_hearts) values(p.id,role,role,case when role='killer' then 'killers' else 'city' end,role='killer',mh,mh)
      on conflict(player_id) do update set initial_role=excluded.initial_role,role_current=excluded.role_current,team=excluded.team,is_active_killer=excluded.is_active_killer,hearts=excluded.hearts,max_hearts=excluded.max_hearts,has_used_ability=false;
    update public.players set health=case when mh=0 then 'alive'::health_state else 'alive'::health_state end where id=p.id;
  end loop;
  update public.rooms set phase='active',quota_window_start=(date_trunc('hour',clock_timestamp() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'),approved_attacks_in_window=0 where id=r.id;
  perform public.add_event(r.id,'system','เกมเริ่มแล้ว บทบาทถูกแจกเรียบร้อย'); return public.get_room_view(r.code);
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
declare r public.rooms; e public.evidence; k public.player_secrets; t public.player_secrets; target public.players; new_hearts integer; window_start timestamptz; detective public.player_secrets;
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
  if r.quota_window_start<>window_start then r.approved_attacks_in_window:=0; r.quota_window_start:=window_start; end if;
  if r.approved_attacks_in_window>=r.attack_limit then raise exception 'hourly approved attack quota reached'; end if;
  new_hearts := greatest(0,t.hearts-1); update public.evidence set status='approved',decision_at=clock_timestamp() where id=e.id;
  update public.rooms set approved_attacks_in_window=r.approved_attacks_in_window+1,quota_window_start=r.quota_window_start where id=r.id;
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
    if new_hearts=0 and t.role_current='police' then select s.* into detective from public.player_secrets s join public.players p on p.id=s.player_id where p.room_id=r.id and s.role_current='detective' and p.health<>'dead' limit 1 for update; if found then update public.player_secrets set role_current='police' where player_id=detective.player_id; perform public.add_event(r.id,'ability','ตำรวจคนใหม่ได้รับตำแหน่งแบบส่วนตัว',detective.player_id); else update public.rooms set phase='ended',winner='killers' where id=r.id; perform public.add_event(r.id,'winner','ฝ่าย Killer ชนะ'); end if; end if;
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
  if winning is not null then perform public.add_event(r.id,'winner',case when winning='city' then 'ฝ่ายเมืองชนะ' else 'ฝ่าย Killer ชนะ' end); end if;
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
  if not found or auth.uid() is null or r.id is null or r.host_user_id=auth.uid() or me.id is null or police.player_id is null or target.player_id is null or r.phase<>'police-check' or me.health='dead' or police.role_current is distinct from 'police' or target_player.health='dead' or target_player.id=me.id then raise exception 'police accusation unavailable'; end if; update public.rooms set phase='ended',winner=case when target.is_active_killer then 'city'::winning_team else 'killers'::winning_team end where id=r.id; perform public.add_event(r.id,'winner',case when target.is_active_killer then 'ฝ่ายเมืองชนะ' else 'ฝ่าย Killer ชนะ' end); return public.get_room_view(r.code); end $$;

create or replace function public.end_game(p_code text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; begin select * into r from public.rooms where code=upper(trim(p_code)) and host_user_id=auth.uid() and closed_at is null for update; if not found or r.phase not in ('lobby','active','police-check','bomb-resolution') then raise exception 'not allowed'; end if; update public.rooms set phase='ended' where id=r.id; perform public.add_event(r.id,'system','Host สั่งจบเกม'); return public.get_room_view(r.code); end $$;

create or replace function public.close_room(p_code text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; begin select * into r from public.rooms where code=upper(trim(p_code)) and host_user_id=auth.uid() and closed_at is null for update; if not found or r.phase not in ('lobby','ended') then raise exception 'room cannot close yet'; end if; delete from public.evidence where room_id=r.id; update public.rooms set closed_at=now() where id=r.id; return public.get_room_view(r.code); end $$;

revoke execute on function public.create_room(text,text),public.join_room(text,text,text),public.get_room_view(text),public.start_game(text,jsonb),public.submit_evidence(text,uuid,text,timestamptz),public.reject_evidence(text,uuid),public.approve_evidence(text,uuid),public.resolve_bomb(text,uuid[]),public.use_reporter(text,uuid),public.heartbeat(text),public.set_accusation_at(text,timestamptz),public.resolve_police_check(text,uuid),public.end_game(text),public.close_room(text) from public, anon;
grant execute on function public.create_room(text,text),public.join_room(text,text,text),public.get_room_view(text),public.start_game(text,jsonb),public.submit_evidence(text,uuid,text,timestamptz),public.reject_evidence(text,uuid),public.approve_evidence(text,uuid),public.resolve_bomb(text,uuid[]),public.use_reporter(text,uuid),public.heartbeat(text),public.set_accusation_at(text,timestamptz),public.resolve_police_check(text,uuid),public.end_game(text),public.close_room(text) to authenticated;

-- Make newly created RPC functions available to the REST API immediately.
notify pgrst, 'reload schema';
