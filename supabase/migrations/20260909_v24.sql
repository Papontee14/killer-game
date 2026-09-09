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
