-- A current-rule Final can give City one final ballot when it finds the Wife.
-- Existing rooms intentionally do not receive wifeRevoteRules.
begin;

alter table public.v24_ballots add column if not exists round integer;
update public.v24_ballots set round=1 where round is null;
alter table public.v24_ballots alter column round set default 1;
alter table public.v24_ballots alter column round set not null;
alter table public.v24_ballots drop constraint if exists v24_ballots_pkey;
alter table public.v24_ballots add primary key(room_id,round,voter_id);

create or replace function public.v24_resolve_vote(rid uuid) returns void
language plpgsql security definer set search_path=public as $$
declare r public.rooms; police_id uuid; ranks uuid[]; fallback uuid[]; ordered uuid[]; k integer;
  nominees uuid[]; killers uuid[]; round_voters uuid[]; round_no integer; pos integer;
  t timestamptz:=clock_timestamp(); wife_name text; outcome text; next_voters jsonb;
begin
 select * into r from public.rooms where id=rid for update;
 if r.phase='ended' or r.v24->>'stage'<>'secret-vote' then return; end if;
 round_no:=case when coalesce((r.v24->>'wifeRevoteRules')::boolean,false) then coalesce((r.v24->>'voteRound')::int,1) else 1 end;
 if round_no not in (1,2) then return; end if;
 select array_agg(value::uuid order by ord) into round_voters
 from jsonb_array_elements_text(r.v24->'voters') with ordinality x(value,ord);
 select array_agg(value::uuid order by ord) into fallback
 from jsonb_array_elements_text(r.v24->'fallback') with ordinality x(value,ord);
 select p.id into police_id from public.players p join public.player_secrets s on s.player_id=p.id
 where p.room_id=rid and p.health<>'dead' and s.role_current='police' and p.id=any(round_voters);
 select ranking into ranks from public.v24_ballots
 where room_id=rid and round=round_no and voter_id=police_id;
 if ranks is null then ordered:=fallback;
 else
  pos:=array_position(fallback,police_id); ordered:='{}';
  for i in 1..cardinality(fallback) loop
   if i=pos then ordered:=array_append(ordered,police_id);
   else ordered:=array_append(ordered,ranks[case when i<pos then i else i-1 end]); end if;
  end loop;
 end if;
 k:=case when coalesce((r.v24->>'finalVoteRules')::boolean,false) then 1 else coalesce((r.v24->>'nomineeCount')::int,1) end;
 select array_agg(id order by score desc,tie) into nominees from (
  select p.id,(select count(*) from public.v24_ballots b where b.room_id=rid and b.round=round_no and p.id=any(b.nominees)) score,array_position(ordered,p.id) tie
  from public.players p where p.id=any(round_voters) order by score desc,tie limit k
 ) x;
 if coalesce((r.v24->>'wifeRevoteRules')::boolean,false) and round_no=1 and exists(
   select 1 from public.player_secrets s where s.player_id=nominees[1] and s.initial_role='killer-wife'
 ) then
  select name into wife_name from public.players where id=nominees[1];
  select coalesce(jsonb_agg(p.id order by random()),'[]'::jsonb) into next_voters
  from public.players p where p.room_id=rid and p.health<>'dead' and p.id<>nominees[1];
  update public.rooms set v24=(r.v24||jsonb_build_object(
   'voteRound',2,'excludedVoterIds',jsonb_build_array(nominees[1]),
   'voters',next_voters,'fallback',next_voters,'voteEndsAt',t+interval '3 minutes',
   'nomineeCount',1,'voteRounds',coalesce(r.v24->'voteRounds','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
     'round',1,'nominees',nominees,'resolvedAt',t,'outcome','wife-revote','wifePlayerId',nominees[1]
   ))) - 'nominees') where id=rid;
  perform public.add_event(rid,'system',wife_name||' คือ Killer''s Wife · จับเมีย Killer ได้ — โหวตหา Killer ตั้งต้นอีกครั้ง');
  return;
 end if;
 if coalesce((r.v24->>'finalVoteRules')::boolean,false) then
  select array_agg(p.id) into killers from public.players p join public.player_secrets s on s.player_id=p.id
  where p.room_id=rid and p.health<>'dead' and s.initial_role='killer';
 else
  select array_agg(p.id) into killers from public.players p join public.player_secrets s on s.player_id=p.id
  where p.room_id=rid and p.health<>'dead' and s.is_active_killer;
 end if;
 outcome:=case when nominees @> killers and killers @> nominees then 'city' else 'killers' end;
 update public.rooms set v24=r.v24||jsonb_build_object(
  'nominees',nominees,'nomineeCount',k,
  'voteRounds',case when coalesce((r.v24->>'wifeRevoteRules')::boolean,false)
    then coalesce(r.v24->'voteRounds','[]'::jsonb)||jsonb_build_array(jsonb_build_object('round',round_no,'nominees',nominees,'resolvedAt',t,'outcome',outcome))
    else coalesce(r.v24->'voteRounds','[]'::jsonb) end
 ) where id=rid;
 perform public.v24_finish(rid,outcome::winning_team,'final-vote',(r.v24->>'voteEndsAt')::timestamptz);
end $$;

create or replace function public.v24_tick(rid uuid) returns void
language plpgsql security definer set search_path=public as $$
declare r public.rooms; deadline timestamptz; cutoff timestamptz; final_at timestamptz;
  t timestamptz:=clock_timestamp(); pending boolean; voters jsonb; k integer;
begin
 select * into r from public.rooms where id=rid for update; t:=clock_timestamp();
 if r.rules_version<>'2.4' or r.phase in ('lobby','ended') or r.closed_at is not null then return; end if;
 deadline:=(r.v24->>'huntDeadline')::timestamptz; cutoff:=(r.v24->>'cutoffAt')::timestamptz; final_at:=(r.v24->>'finalAt')::timestamptz;
 if deadline<=cutoff and t>deadline+interval '2 minutes' and r.pending_bomber_id is null then
  if not exists(select 1 from public.v24_actions where room_id=rid and kind='attack' and status='pending' and effective_at<=deadline) then perform public.v24_finish(rid,'city','hunt-clock-expired',deadline); return; end if;
 end if;
 if r.pending_bomber_id is not null then return; end if;
 if t>=cutoff then
  select exists(select 1 from public.v24_actions where room_id=rid and status='pending') into pending;
  if pending then update public.rooms set v24=v24||jsonb_build_object('stage','resolution') where id=rid and v24->>'stage'<>'resolution'; return; end if;
  if t<final_at then update public.rooms set v24=v24||jsonb_build_object('stage',case when t>=final_at-interval '10 minutes' then 'final-discussion' else 'resolution' end) where id=rid;
  elsif r.v24->>'stage'<>'secret-vote' then
   if (select count(*) from public.v24_actions where room_id=rid and lethal and status='approved')<2 then perform public.v24_finish(rid,'city','final-low-kills',final_at); return; end if;
   if coalesce((r.v24->>'finalVoteRules')::boolean,false) then k:=1; else select count(*) into k from public.players p join public.player_secrets s on s.player_id=p.id where p.room_id=rid and p.health<>'dead' and s.is_active_killer; end if;
   select jsonb_agg(id order by random()) into voters from public.players where room_id=rid and health<>'dead';
   update public.rooms set v24=(v24||jsonb_build_object('stage','secret-vote','nomineeCount',k,'fallback',voters,'voters',voters,'voteEndsAt',greatest(t,final_at)+interval '3 minutes','voteRound',case when coalesce((v24->>'wifeRevoteRules')::boolean,false) then 1 else null end,'excludedVoterIds',case when coalesce((v24->>'wifeRevoteRules')::boolean,false) then '[]'::jsonb else null end,'voteRounds',case when coalesce((v24->>'wifeRevoteRules')::boolean,false) then '[]'::jsonb else null end) - 'nominees') where id=rid;
   perform public.add_event(rid,'system','Communication Lock · เริ่มโหวตลับ 3 นาที');
  elsif t>=(r.v24->>'voteEndsAt')::timestamptz then perform public.v24_resolve_vote(rid);
  end if;
 end if;
end $$;

create or replace function public.start_game(p_code text,p_role_counts jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms; p public.players; roles text[]:='{}'; item record; role text; hp int; idx int:=1; t timestamptz:=clock_timestamp(); duration int;
begin
 select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update; t:=clock_timestamp();
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
 update public.rooms set phase='active',police_check_at=null,v24=v24||jsonb_build_object('finalVoteRules',true,'wifeRevoteRules',true,'stage','active','startedAt',t,'finalAt',t+make_interval(mins=>duration),'cutoffAt',t+make_interval(mins=>duration-30),'revealEndsAt',t+make_interval(mins=>duration-120),'huntDeadline',t+interval '120 minutes') where id=r.id;
 perform public.add_event(r.id,'system','เกมเริ่มแล้ว'); return public.get_room_view(p_code);
end $$;

create or replace function public.submit_final_ballot_round(p_code text,p_round integer,p_nominees uuid[],p_ranking uuid[]) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms; me uuid; police boolean; eligible uuid[]; current_round integer;
begin
 select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
 select p.id,s.role_current='police' into me,police from public.players p join public.player_secrets s on s.player_id=p.id where p.room_id=r.id and p.user_id=auth.uid() and p.health<>'dead';
 current_round:=coalesce((r.v24->>'voteRound')::int,1);
 if me is null or not coalesce((r.v24->>'wifeRevoteRules')::boolean,false) or p_round is distinct from current_round or current_round not in (1,2) or r.rules_version is distinct from '2.4' or r.phase='ended' or r.v24->>'stage'<>'secret-vote' or clock_timestamp()>=(r.v24->>'voteEndsAt')::timestamptz or exists(select 1 from jsonb_array_elements_text(coalesce(r.v24->'excludedVoterIds','[]'::jsonb)) x where x.value=me::text) then raise exception 'vote unavailable'; end if;
 select array_agg(value::uuid) into eligible from jsonb_array_elements_text(r.v24->'voters') where value<>me::text;
 if p_nominees is null or cardinality(p_nominees)<>1 or cardinality(p_nominees)<>(select count(distinct x) from unnest(p_nominees) x) or not p_nominees<@eligible then raise exception 'invalid ballot'; end if;
 if police and (p_ranking is null or cardinality(p_ranking)<>cardinality(eligible) or cardinality(p_ranking)<>(select count(distinct x) from unnest(p_ranking) x) or not p_ranking<@eligible) then raise exception 'invalid police ranking'; end if;
 if not police and coalesce(cardinality(p_ranking),0)>0 then raise exception 'ranking is police only'; end if;
 insert into public.v24_ballots(room_id,round,voter_id,nominees,ranking) values(r.id,current_round,me,p_nominees,coalesce(p_ranking,'{}')) on conflict do nothing;
 return public.get_room_view(p_code);
end $$;

-- Keep the pre-revote function callable for rooms already in progress. A retry
-- finds the already-renamed implementation and leaves it intact.
do $$ begin
 if to_regprocedure('public.submit_final_ballot_legacy(text,uuid[],uuid[])') is null then
  alter function public.submit_final_ballot(text,uuid[],uuid[]) rename to submit_final_ballot_legacy;
 end if;
end $$;
create or replace function public.submit_final_ballot(p_code text,p_nominees uuid[],p_ranking uuid[]) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms;
begin
 select * into r from public.rooms where code=upper(trim(p_code));
 if coalesce((r.v24->>'wifeRevoteRules')::boolean,false) then raise exception 'refresh required: use round ballot'; end if;
 return public.submit_final_ballot_legacy(p_code,p_nominees,p_ranking);
end $$;

create or replace function public.get_room_view(p_code text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb; r public.rooms; me public.players; allowed boolean:=false; hidden boolean:=false; activity jsonb:='[]'::jsonb; filtered_events jsonb; meta jsonb; own jsonb; current_round integer; target_protection jsonb:='{}'::jsonb; show_target_protection boolean:=false;
begin
 -- The base projection owns endGameTimeline; this wrapper only adds vote-round metadata.
 result:=public.get_room_view_attack_activity_base(p_code); if result is null then return null; end if;
 select * into r from public.rooms where code=upper(trim(p_code)); if r.id is null or auth.uid() is null then return result; end if;
 if r.host_user_id=auth.uid() then allowed:=true; else select * into me from public.players where room_id=r.id and user_id=auth.uid(); allowed:=me.id is not null and me.health='dead'; end if;
 if r.rules_version='2.4' and coalesce((r.v24->>'wifeRevoteRules')::boolean,false) then
  current_round:=coalesce((r.v24->>'voteRound')::int,1); meta:=case when jsonb_typeof(result->'v24')='object' then result->'v24' else '{}'::jsonb end;
  select jsonb_build_object('round',round,'nominees',nominees,'ranking',ranking,'submittedAt',submitted_at) into own from public.v24_ballots where room_id=r.id and round=current_round and voter_id=me.id;
  meta:=(meta-'myBallot'-'ballots')||jsonb_build_object('finalVoteRules',true,'wifeRevoteRules',true,'voteRound',current_round,'excludedVoterIds',coalesce(r.v24->'excludedVoterIds','[]'::jsonb),'voteRounds',coalesce(r.v24->'voteRounds','[]'::jsonb),'myBallot',own);
  if r.host_user_id=auth.uid() then meta:=meta||jsonb_build_object('ballots',(select coalesce(jsonb_agg(jsonb_build_object('round',b.round,'voter_id',b.voter_id,'nominees',b.nominees,'ranking',b.ranking) order by b.round,b.submitted_at),'[]'::jsonb) from public.v24_ballots b where b.room_id=r.id)); end if;
  result:=result||jsonb_build_object('v24',meta);
 end if;
 if r.rules_version='2.4' then
  result:=result||jsonb_build_object('v24',(case when jsonb_typeof(result->'v24')='object' then result->'v24' else '{}'::jsonb end)||jsonb_build_object('finalVoteRules',coalesce((r.v24->>'finalVoteRules')::boolean,false),'wifeRevoteRules',coalesce((r.v24->>'wifeRevoteRules')::boolean,false)));
 end if;
 hidden:=coalesce((r.v24->>'finalVoteRules')::boolean,false) and r.rules_version='2.4' and r.phase<>'ended' and not (r.host_user_id=auth.uid()) and me.id is not null and me.health<>'dead' and clock_timestamp()>=(r.v24->>'cutoffAt')::timestamptz;
 if hidden then select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into filtered_events from jsonb_array_elements(coalesce(result->'events','[]'::jsonb)) with ordinality event(value,ord) where not ((value->>'type') in ('attack','bomb') or ((value->>'type')='warning' and ((value->>'message')='คุณถูกโจมตีและเสียหัวใจ 1 ดวง' or (value->>'message') like '% ถูกกำจัด')) or ((value->>'type')='ability' and (value->>'message') in ('Killer''s Wife has awakened. There are now two active Killers.','คุณปลดพลัง Killer’s Wife แล้ว','Killer has eliminated Killer''s Wife. There are now two Killers.','คุณกลายเป็น Killer แล้ว'))); result:=result||jsonb_build_object('events',filtered_events); end if;
 if allowed then select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'killerId',e.killer_id,'targetId',e.target_id,'storagePath',e.storage_path,'capturedAt',e.captured_at,'decisionAt',e.decision_at,'result',e.attack_result) order by e.captured_at desc,e.id desc),'[]'::jsonb) into activity from public.evidence e where e.room_id=r.id and e.status='approved'; end if;
 show_target_protection:=r.rules_version='2.4' and (r.host_user_id=auth.uid() or exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.room_id=r.id and p.user_id=auth.uid() and p.health<>'dead' and s.is_active_killer));
 if show_target_protection then
  select coalesce(jsonb_object_agg(s.player_id::text,to_jsonb(s.protection_until)),'{}'::jsonb) into target_protection from public.players p join public.player_secrets s on s.player_id=p.id where p.room_id=r.id and p.health<>'dead' and not s.is_active_killer and s.protection_until>clock_timestamp();
  result:=result||jsonb_build_object('v24',(case when jsonb_typeof(result->'v24')='object' then result->'v24' else '{}'::jsonb end)||jsonb_build_object('targetProtectionUntil',target_protection));
 end if;
 if coalesce(jsonb_typeof(result->'privateStates'),'null')<>'object' then result:=result||jsonb_build_object('privateStates','{}'::jsonb); end if;
 return result||jsonb_build_object('canViewAttackActivity',allowed,'attackActivity',activity,'attackActivityHidden',hidden);
end $$;

revoke all on function public.submit_final_ballot_round(text,integer,uuid[],uuid[]) from public,anon;
grant execute on function public.submit_final_ballot_round(text,integer,uuid[],uuid[]) to authenticated;
revoke all on function public.submit_final_ballot(text,uuid[],uuid[]) from public,anon;
grant execute on function public.submit_final_ballot(text,uuid[],uuid[]) to authenticated;
revoke all on function public.get_room_view(text) from public,anon;
grant execute on function public.get_room_view(text) to authenticated;
notify pgrst,'reload schema';
commit;
