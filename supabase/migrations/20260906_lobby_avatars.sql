-- Public lobby character selection. Apply after the 20260905 migrations.
begin;

create table if not exists public.avatar_catalog (
  id text primary key,
  display_name text not null,
  gender text not null check (gender in ('male','female'))
);
insert into public.avatar_catalog(id,display_name,gender) values
('m-sea-01','อรุณ','male'),('f-sea-01','มะลิ','female'),('m-sea-02','วิน','male'),('f-sea-02','ฝน','female'),('m-sea-03','ภพ','male'),('f-sea-03','ลิน','female'),('m-sea-04','ก้อง','male'),('f-sea-04','ดาว','female'),('m-sea-05','ชัย','male'),('f-sea-05','พิม','female'),('m-sea-06','ปกรณ์','male'),('f-sea-06','ริน','female'),('m-ea-01','ฮารุ','male'),('f-ea-01','ยูนะ','female'),('m-ea-02','เรน','male'),('f-ea-02','มีนา','female'),('m-ea-03','เคน','male'),('f-ea-03','ซูบิน','female'),('m-ea-04','จุน','male'),('f-ea-04','อาโออิ','female'),('m-sa-01','อาร์ยัน','male'),('f-sa-01','อันยา','female'),('m-sa-02','วิกรม','male'),('f-sa-02','คิรัน','female'),('m-world-01','เอไล','male'),('f-world-01','อามารา','female'),('m-world-02','โอลิเวอร์','male'),('f-world-02','โซเฟีย','female'),('m-world-03','ซามีร์','male'),('f-world-03','เลย์ลา','female'),('m-world-04','มาเตโอ','male'),('f-world-04','คามิลา','female')
on conflict (id) do update set display_name=excluded.display_name,gender=excluded.gender;
alter table public.players add column if not exists avatar_id text;
do $$ begin if not exists(select 1 from pg_constraint where conname='players_avatar_id_fkey') then alter table public.players add constraint players_avatar_id_fkey foreign key (avatar_id) references public.avatar_catalog(id); end if; end $$;
create unique index if not exists players_room_avatar_unique on public.players(room_id,avatar_id) where avatar_id is not null;

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
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'avatarId',p.avatar_id,'joinedAt',p.joined_at,'isOnline',p.is_online and p.last_seen_at > now()-interval '90 seconds','health',case when is_host or p.id=me.id then p.health when p.health='dead' then 'dead'::health_state else 'alive'::health_state end,'heartsVisibleToHost',case when is_host then coalesce(s.hearts,0) else 0 end,'maxHearts',case when is_host then coalesce(s.max_hearts,0) else 0 end) order by p.joined_at), '[]'::jsonb) into roster from public.players p left join public.player_secrets s on s.player_id=p.id where p.room_id=r.id;
  if is_host then
    select coalesce(jsonb_object_agg(s.player_id::text,jsonb_build_object('playerId',s.player_id,'initialRole',s.initial_role,'currentRole',s.role_current,'team',s.team,'isActiveKiller',s.is_active_killer,'hearts',s.hearts,'maxHearts',s.max_hearts,'hasUsedAbility',s.has_used_ability)),'{}'::jsonb) into states from public.player_secrets s join public.players p on p.id=s.player_id where p.room_id=r.id;
    select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'killerId',e.killer_id,'targetId',e.target_id,'storagePath',e.storage_path,'capturedAt',e.captured_at,'createdAt',e.created_at,'status',e.status,'decisionAt',e.decision_at) order by e.created_at desc),'[]'::jsonb) into evidences from public.evidence e where e.room_id=r.id;
  else
    select jsonb_build_object(me.id::text,jsonb_build_object('playerId',s.player_id,'initialRole',s.initial_role,'currentRole',s.role_current,'team',s.team,'isActiveKiller',s.is_active_killer,'hearts',s.hearts,'maxHearts',s.max_hearts,'hasUsedAbility',s.has_used_ability)) into states from public.player_secrets s where s.player_id=me.id;
    if exists(select 1 from public.player_secrets where player_id=me.id and is_active_killer) then states := states || coalesce((select jsonb_object_agg(s.player_id::text,jsonb_build_object('playerId',s.player_id,'initialRole',s.initial_role,'currentRole',s.role_current,'team',s.team,'isActiveKiller',s.is_active_killer,'hearts',0,'maxHearts',0,'hasUsedAbility',s.has_used_ability)) from public.player_secrets s join public.players p on p.id=s.player_id where p.room_id=r.id and s.is_active_killer),'{}'::jsonb); end if;
    evidences := '[]'::jsonb;
    if exists(select 1 from public.player_secrets where player_id=me.id and is_active_killer) then select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'killerId',e.killer_id,'targetId',e.target_id,'capturedAt',e.captured_at,'createdAt',e.created_at,'status',e.status,'decisionAt',e.decision_at,'result',e.attack_result) order by e.created_at desc,e.id),'[]'::jsonb) into progress from public.evidence e where e.room_id=r.id; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'type',e.type,'message',e.message,'createdAt',e.created_at,'playerId',e.visible_to_player_id) order by e.created_at desc),'[]'::jsonb) into events from public.room_events e where e.room_id=r.id and (is_host or ((e.visible_to_player_id is null or e.visible_to_player_id=me.id) and e.excluded_player_id is distinct from me.id));
  if r.phase='ended' then select coalesce(jsonb_agg(jsonb_build_object('playerId',p.id,'initialRole',s.initial_role,'currentRole',s.role_current,'team',s.team) order by p.joined_at,p.id),'[]'::jsonb) into summary from public.players p left join public.player_secrets s on s.player_id=p.id where p.room_id=r.id; end if;
  return jsonb_build_object('viewerRole',viewer_role,'playerId',case when is_host then null else me.id end,'code',r.code,'hostName',r.host_name,'phase',r.phase,'createdAt',r.created_at,'closedAt',r.closed_at,'attackLimit',r.attack_limit,'attacksThisHour',case when r.quota_window_start=(date_trunc('hour',clock_timestamp() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok') then r.approved_attacks_in_window else 0 end,'quotaWindowStart',r.quota_window_start,'policeCheckAt',r.police_check_at,'players',roster,'privateStates',states,'evidences',evidences,'killerEvidenceProgress',progress,'events',events,'endGameSummary',summary,'winner',r.winner,'bombTargets','[]'::jsonb,'pendingBomberId',r.pending_bomber_id);
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
  if array_length(roles,1) <> (select count(*) from public.players where room_id=r.id) or exists(select 1 from public.players where room_id=r.id and avatar_id is null) or (select count(*) from unnest(roles) x where x='killer')<>1 or (select count(*) from unnest(roles) x where x='police')<1 then raise exception 'invalid player count, avatar selection, or required roles'; end if;
  idx := 1;
  for p in select * from public.players where room_id=r.id order by random() loop
    role := roles[idx]; idx := idx+1; mh := case role when 'athlete' then 3 when 'sumo' then 4 when 'killer' then 0 else 2 end;
    insert into public.player_secrets(player_id,initial_role,role_current,team,is_active_killer,hearts,max_hearts) values(p.id,role,role,case when role='killer' then 'killers' else 'city' end,role='killer',mh,mh) on conflict(player_id) do update set initial_role=excluded.initial_role,role_current=excluded.role_current,team=excluded.team,is_active_killer=excluded.is_active_killer,hearts=excluded.hearts,max_hearts=excluded.max_hearts,has_used_ability=false;
    update public.players set health='alive' where id=p.id;
  end loop;
  update public.rooms set phase='active',quota_window_start=(date_trunc('hour',clock_timestamp() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'),approved_attacks_in_window=0 where id=r.id;
  perform public.add_event(r.id,'system','เกมเริ่มแล้ว บทบาทถูกแจกเรียบร้อย'); return public.get_room_view(r.code);
end $$;

create or replace function public.join_room(p_code text,p_name text,p_reclaim_token text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; p public.players; issued_token text;
begin
  if auth.uid() is null or nullif(trim(p_name),'') is null or char_length(trim(p_name))>24 then raise exception 'invalid credentials or player name'; end if;
  select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
  if not found or r.host_user_id=auth.uid() then raise exception 'invalid room or host cannot play'; end if;
  select * into p from public.players where room_id=r.id and lower(name)=lower(trim(p_name)) limit 1;
  if found and p.user_id=auth.uid() then
    if p.reclaim_token_hash is null then issued_token := md5(random()::text||clock_timestamp()::text||auth.uid()::text); update public.players set reclaim_token_hash=md5(issued_token),is_online=true,last_seen_at=now() where id=p.id returning * into p;
    else update public.players set is_online=true,last_seen_at=now() where id=p.id returning * into p; end if;
  elsif found and p.reclaim_token_hash is not null and p.reclaim_token_hash=md5(trim(coalesce(p_reclaim_token,''))) then update public.players set user_id=auth.uid(),is_online=true,last_seen_at=now() where id=p.id returning * into p;
  elsif found then raise exception 'player name is already in use; enter reclaim token';
  elsif r.phase <> 'lobby' then raise exception 'game already started';
  elsif (select count(*) from public.players where room_id=r.id) >= 28 then raise exception 'room is full';
  else issued_token := md5(random()::text||clock_timestamp()::text||auth.uid()::text); insert into public.players(room_id,user_id,name,reclaim_token_hash) values(r.id,auth.uid(),trim(p_name),md5(issued_token)) returning * into p;
  end if;
  return jsonb_build_object('playerId',p.id,'reclaimToken',issued_token) || public.get_room_view(r.code);
end $$;

-- The existing view is replaced below in the app's full schema installation.
-- These RPCs remain safe on upgraded databases; the following grant exposes them.
revoke execute on function public.select_avatar(text,text),public.remove_lobby_player(text,uuid) from public,anon;
grant execute on function public.select_avatar(text,text),public.remove_lobby_player(text,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
