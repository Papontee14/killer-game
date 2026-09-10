-- Final-vote revision. Only rooms started after this migration opt in through
-- v24.finalVoteRules, so games already in progress retain their original rules.
begin;

create or replace function public.v24_victory(rid uuid, at_time timestamptz) returns void
language plpgsql security definer set search_path=public as $$
declare successor uuid; r public.rooms;
begin
 select * into r from public.rooms where id=rid;
 if coalesce((r.v24->>'finalVoteRules')::boolean,false) and not exists(
   select 1 from public.players p join public.player_secrets s on s.player_id=p.id
   where p.room_id=rid and p.health<>'dead' and s.initial_role='killer'
 ) then
  perform public.v24_finish(rid,'city','original-killer-eliminated',at_time); return;
 end if;
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
declare r public.rooms; k integer; police_id uuid; ranks uuid[]; fallback uuid[]; ordered uuid[]; nominees uuid[]; killers uuid[]; pos integer;
begin
 select * into r from public.rooms where id=rid for update;
 if r.phase='ended' or r.v24->>'stage'<>'secret-vote' then return; end if;
 k:=case when coalesce((r.v24->>'finalVoteRules')::boolean,false) then 1 else (r.v24->>'nomineeCount')::int end;
 select array_agg(value::uuid order by ord) into fallback from jsonb_array_elements_text(r.v24->'fallback') with ordinality x(value,ord);
 select p.id into police_id from public.players p join public.player_secrets s on s.player_id=p.id where p.room_id=rid and p.health<>'dead' and s.role_current='police';
 select ranking into ranks from public.v24_ballots where room_id=rid and voter_id=police_id;
 if ranks is null then ordered:=fallback;
 else
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
 if coalesce((r.v24->>'finalVoteRules')::boolean,false) then
  select array_agg(p.id) into killers from public.players p join public.player_secrets s on s.player_id=p.id where p.room_id=rid and p.health<>'dead' and s.initial_role='killer';
 else
  select array_agg(p.id) into killers from public.players p join public.player_secrets s on s.player_id=p.id where p.room_id=rid and p.health<>'dead' and s.is_active_killer;
 end if;
 update public.rooms set v24=v24||jsonb_build_object('nominees',nominees,'nomineeCount',k) where id=rid;
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
 if deadline<=cutoff and t>deadline+interval '2 minutes' and r.pending_bomber_id is null then
  if not exists(select 1 from public.v24_actions where room_id=rid and kind='attack' and status='pending' and effective_at<=deadline) then perform public.v24_finish(rid,'city','hunt-clock-expired',deadline); return; end if;
 end if;
 if r.pending_bomber_id is not null then return; end if;
 if t>=cutoff then
  select exists(select 1 from public.v24_actions where room_id=rid and status='pending') into pending;
  if pending then update public.rooms set v24=v24||jsonb_build_object('stage','resolution') where id=rid and v24->>'stage'<>'resolution'; return; end if;
  if t<final_at then
   update public.rooms set v24=v24||jsonb_build_object('stage',case when t>=final_at-interval '10 minutes' then 'final-discussion' else 'resolution' end) where id=rid;
  elsif r.v24->>'stage'<>'secret-vote' then
   if (select count(*) from public.v24_actions where room_id=rid and lethal and status='approved')<2 then perform public.v24_finish(rid,'city','final-low-kills',final_at); return; end if;
   if coalesce((r.v24->>'finalVoteRules')::boolean,false) then k:=1;
   else select count(*) into k from public.players p join public.player_secrets s on s.player_id=p.id where p.room_id=rid and p.health<>'dead' and s.is_active_killer; end if;
   select jsonb_agg(id order by random()) into voters from public.players where room_id=rid and health<>'dead';
   update public.rooms set v24=v24||jsonb_build_object('stage','secret-vote','nomineeCount',k,'fallback',voters,'voters',voters,'voteEndsAt',greatest(t,final_at)+interval '3 minutes') where id=rid;
   perform public.add_event(rid,'system','Communication Lock · เริ่มโหวตลับ 3 นาที');
  elsif t>=(r.v24->>'voteEndsAt')::timestamptz then perform public.v24_resolve_vote(rid);
  end if;
 end if;
end $$;

create or replace function public.start_game(p_code text,p_role_counts jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; p public.players; roles text[]:='{}'; item record; role text; hp int; idx int:=1; t timestamptz:=clock_timestamp(); duration int;
begin
 select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
 t:=clock_timestamp();
 if r.rules_version<>'2.4' then return public.start_game_pre24(p_code,p_role_counts); end if;
 if r.host_user_id is distinct from auth.uid() or r.phase<>'lobby' then raise exception 'not allowed'; end if;
 duration:=coalesce((r.v24->>'durationMinutes')::int,600);
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
 update public.rooms set phase='active',police_check_at=null,v24=v24||jsonb_build_object('finalVoteRules',true,'stage','active','startedAt',t,'finalAt',t+make_interval(mins=>duration),'cutoffAt',t+make_interval(mins=>duration-30),'revealEndsAt',t+make_interval(mins=>duration-120),'huntDeadline',t+interval '120 minutes') where id=r.id;
 perform public.add_event(r.id,'system','เกมเริ่มแล้ว'); return public.get_room_view(p_code);
end $$;

create or replace function public.v24_apply(p_code text,p_action_id uuid,p_approve boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; a public.v24_actions; s public.player_secrets; target public.players; hp int; lethal_hit boolean; t timestamptz:=clock_timestamp();
begin
 select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
 t:=clock_timestamp();
 if r.host_user_id is distinct from auth.uid() or r.rules_version<>'2.4' or r.phase in ('lobby','ended') then raise exception 'not allowed'; end if;
 select * into a from public.v24_actions where id=p_action_id and room_id=r.id;
 if a.id is null then raise exception 'action not found'; end if;
 if a.status<>'pending' then return public.get_room_view(p_code); end if;
 if not p_approve and a.kind='attack' then update public.v24_actions set status='rejected' where id=a.id; update public.evidence set status='rejected',decision_at=t where id=a.evidence_id; perform public.add_event(r.id,'warning','หลักฐานถูกปฏิเสธ',a.actor_id); return public.get_room_view(p_code); end if;
 if r.pending_bomber_id is not null then raise exception 'resolve bomb first'; end if;
 if exists(select 1 from public.v24_actions where room_id=r.id and status='pending' and (effective_at,id)<(a.effective_at,a.id)) then raise exception 'resolve earlier event first'; end if;
 if t<a.effective_at+interval '2 minutes' and t<(r.v24->>'cutoffAt')::timestamptz then raise exception 'waiting for capture upload window'; end if;
 if (r.v24->>'huntDeadline')::timestamptz<a.effective_at and (r.v24->>'huntDeadline')::timestamptz<=(r.v24->>'cutoffAt')::timestamptz then perform public.v24_finish(r.id,'city','hunt-clock-expired',(r.v24->>'huntDeadline')::timestamptz); return public.get_room_view(p_code); end if;
 select * into s from public.player_secrets where player_id=a.target_id; select * into target from public.players where id=a.target_id;
 if a.kind='heal' then
  if target.health<>'dead' and not s.is_active_killer and exists(select 1 from public.players where id=a.actor_id and health<>'dead') then hp:=least(s.max_hearts,s.hearts+1); update public.player_secrets set hearts=hp where player_id=target.id; update public.players set health=case when hp=1 then 'critical'::health_state else 'alive'::health_state end where id=target.id; update public.v24_actions set healed=(hp>s.hearts) where id=a.id; end if;
  perform public.add_event(r.id,'ability','Doctor treated '||target.name);
 else
  if target.health='dead' or s.is_active_killer or not exists(select 1 from public.players where id=a.actor_id and health<>'dead') then raise exception 'attack target or actor unavailable; reject evidence'; end if;
  if s.protection_until>a.effective_at then raise exception 'target protected; reject evidence'; end if;
  if (select count(*) from public.v24_actions where room_id=r.id and kind='attack' and status='approved' and effective_at>a.effective_at-interval '60 minutes' and effective_at<=a.effective_at)>=3 then raise exception 'rolling attack quota reached; reject evidence'; end if;
  lethal_hit:=s.hearts=1 and s.initial_role<>'killer-wife';
  if lethal_hit and exists(select 1 from public.v24_actions where room_id=r.id and status='approved' and lethal and effective_at>a.effective_at-interval '60 minutes' and effective_at<=a.effective_at) then raise exception 'rolling kill quota reached; reject evidence'; end if;
  if s.initial_role='killer-wife' then
   if coalesce((r.v24->>'finalVoteRules')::boolean,false) then
    update public.player_secrets set is_active_killer=true,team='killers',hearts=0,max_hearts=0 where player_id=target.id;
    perform public.add_event(r.id,'ability','Killer''s Wife has awakened. There are now two active Killers.');
    perform public.add_event(r.id,'ability','คุณปลดพลัง Killer’s Wife แล้ว',target.id);
   else
    update public.player_secrets set role_current='killer',is_active_killer=true,team='killers',hearts=0,max_hearts=0 where player_id=target.id;
    perform public.add_event(r.id,'ability','มี Killer คนที่สองเกิดขึ้น'); perform public.add_event(r.id,'ability','คุณกลายเป็น Killer แล้ว',target.id);
   end if;
  else
   hp:=greatest(0,s.hearts-1); update public.player_secrets set hearts=hp,protection_until=a.effective_at+interval '45 minutes' where player_id=target.id; update public.players set health=case when hp=0 then 'dead'::health_state when hp=1 then 'critical'::health_state else 'alive'::health_state end where id=target.id;
   perform public.add_event(r.id,'warning','คุณถูกโจมตีและเสียหัวใจ 1 ดวง',target.id); insert into public.room_events(room_id,type,message,excluded_player_id) values(r.id,'attack','มีคนถูกโจมตีจาก Killer',target.id);
  end if;
  update public.evidence set status='approved',decision_at=t,attack_result=case when lethal_hit then 'elimination confirmed' else 'target is still alive' end where id=a.evidence_id; update public.v24_actions set lethal=lethal_hit where id=a.id;
  if lethal_hit then
   if s.initial_role='detective' then perform public.v24_milestone(r.id,'detective-eliminated',a.effective_at,target.id); end if;
   update public.rooms set v24=v24||jsonb_build_object('huntDeadline',a.effective_at+interval '120 minutes') where id=r.id; perform public.add_event(r.id,'attack',target.name||' เสียชีวิต');
   if s.role_current='bomber' then update public.rooms set phase='bomb-resolution',pending_bomber_id=target.id,v24=v24||jsonb_build_object('bombAt',a.effective_at) where id=r.id; perform public.add_event(r.id,'bomb',target.name||' คือ Bomber · รอ Host ตรวจภาพและเลือกผู้เล่นที่ใกล้ที่สุด'); else perform public.v24_victory(r.id,a.effective_at); end if;
  end if;
 end if;
 update public.v24_actions set status='approved' where id=a.id; update public.rooms set v24=v24||jsonb_build_object('lastResolvedAt',a.effective_at) where id=r.id;
 return public.get_room_view(p_code);
end $$;

create or replace function public.submit_final_ballot(p_code text,p_nominees uuid[],p_ranking uuid[]) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; me uuid; police boolean; eligible uuid[]; expected integer;
begin
 select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
 select p.id,s.role_current='police' into me,police from public.players p join public.player_secrets s on s.player_id=p.id where p.room_id=r.id and p.user_id=auth.uid() and p.health<>'dead';
 if me is null or r.rules_version is distinct from '2.4' or r.phase='ended' or r.v24->>'stage'<>'secret-vote' or clock_timestamp()>=(r.v24->>'voteEndsAt')::timestamptz then raise exception 'vote unavailable'; end if;
 expected:=case when coalesce((r.v24->>'finalVoteRules')::boolean,false) then 1 else (r.v24->>'nomineeCount')::int end;
 select array_agg(value::uuid) into eligible from jsonb_array_elements_text(r.v24->'voters') where value<>me::text;
 if p_nominees is null or cardinality(p_nominees)<>expected or cardinality(p_nominees)<>(select count(distinct x) from unnest(p_nominees) x) or not p_nominees<@eligible then raise exception 'invalid ballot'; end if;
 if police and (p_ranking is null or cardinality(p_ranking)<>cardinality(eligible) or cardinality(p_ranking)<>(select count(distinct x) from unnest(p_ranking) x) or not p_ranking<@eligible) then raise exception 'invalid police ranking'; end if;
 if not police and coalesce(cardinality(p_ranking),0)>0 then raise exception 'ranking is police only'; end if;
 insert into public.v24_ballots(room_id,voter_id,nominees,ranking) values(r.id,me,p_nominees,coalesce(p_ranking,'{}')) on conflict do nothing;
 return public.get_room_view(p_code);
end $$;

create or replace function public.get_room_view(p_code text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb; r public.rooms; me public.players; allowed boolean := false; hidden boolean := false; activity jsonb := '[]'::jsonb; filtered_events jsonb;
begin
 result := public.get_room_view_attack_activity_base(p_code);
 if result is null then return null; end if;
 select * into r from public.rooms where code=upper(trim(p_code));
 if r.id is null or auth.uid() is null then return result; end if;
 if r.host_user_id=auth.uid() then allowed:=true;
 else select * into me from public.players where room_id=r.id and user_id=auth.uid(); allowed:=me.id is not null and me.health='dead'; end if;
 hidden:=coalesce((r.v24->>'finalVoteRules')::boolean,false) and r.rules_version='2.4' and r.phase<>'ended' and not (r.host_user_id=auth.uid()) and me.id is not null and me.health<>'dead' and clock_timestamp()>=(r.v24->>'cutoffAt')::timestamptz;
 if hidden then
  select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into filtered_events
  from jsonb_array_elements(coalesce(result->'events','[]'::jsonb)) with ordinality event(value,ord)
  where not ((value->>'type') in ('attack','bomb') or ((value->>'type')='warning' and ((value->>'message')='คุณถูกโจมตีและเสียหัวใจ 1 ดวง' or (value->>'message') like '% ถูกกำจัด')) or ((value->>'type')='ability' and (value->>'message') in ('Killer''s Wife has awakened. There are now two active Killers.','คุณปลดพลัง Killer’s Wife แล้ว','Killer has eliminated Killer''s Wife. There are now two Killers.','คุณกลายเป็น Killer แล้ว')));
  result:=result||jsonb_build_object('events',filtered_events);
 end if;
 if allowed then
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'killerId',e.killer_id,'targetId',e.target_id,'storagePath',e.storage_path,'capturedAt',e.captured_at,'decisionAt',e.decision_at,'result',e.attack_result) order by e.captured_at desc,e.id desc),'[]'::jsonb) into activity from public.evidence e where e.room_id=r.id and e.status='approved';
 end if;
 return result||jsonb_build_object('canViewAttackActivity',allowed,'attackActivity',activity,'attackActivityHidden',hidden);
end $$;

notify pgrst,'reload schema';
commit;
