-- New games use a single one-minute runoff per main Final round.
begin;

do $$ begin
 if to_regprocedure('public.v24_resolve_vote_pre_runoff(uuid)') is null then
  alter function public.v24_resolve_vote(uuid) rename to v24_resolve_vote_pre_runoff;
  alter function public.submit_final_ballot_round(text,integer,uuid[],uuid[]) rename to submit_final_ballot_round_pre_runoff;
  alter function public.start_game(text,jsonb) rename to start_game_pre_runoff;
  alter function public.get_room_view(text) rename to get_room_view_pre_runoff;
 end if;
end $$;

create or replace function public.v24_resolve_vote(rid uuid) returns void
language plpgsql security definer set search_path=public as $$
declare r public.rooms; round_no int; main_round int; voters uuid[]; candidates uuid[];
 tied uuid[]; police_id uuid; ranks uuid[]; nominee uuid; outcome text; next_voters jsonb;
 t timestamptz; history jsonb;
begin
 select * into r from public.rooms where id=rid for update;
 if not coalesce((r.v24->>'tieRunoffRules')::boolean,false) then
  perform public.v24_resolve_vote_pre_runoff(rid); return;
 end if;
 t:=clock_timestamp();
 if r.phase='ended' or r.v24->>'stage'<>'secret-vote' or t<(r.v24->>'voteEndsAt')::timestamptz then return; end if;
 round_no:=(r.v24->>'voteRound')::int;
 if round_no not in (1,2,3,4) then return; end if;
 main_round:=case when round_no>2 then round_no-2 else round_no end;
 select array_agg(value::uuid) into voters from jsonb_array_elements_text(r.v24->'voters');
 select array_agg(value::uuid) into candidates from jsonb_array_elements_text(
  case when round_no>2 then r.v24->'runoffCandidates' else r.v24->'voters' end);
 select array_agg(id order by id) into tied from (
  select id,rank() over(order by score desc) place from (
   select c.id,(select count(*) from public.v24_ballots b where b.room_id=rid and b.round=round_no and c.id=any(b.nominees)) score
   from unnest(candidates) c(id)
  ) scores
 ) ranked where place=1;
 history:=coalesce(r.v24->'voteRounds','[]'::jsonb);
 if cardinality(tied)>1 then
  if round_no<=2 then
   select p.id into police_id from public.players p join public.player_secrets s on s.player_id=p.id
    where p.id=any(voters) and p.health<>'dead' and s.role_current='police';
   select ranking into ranks from public.v24_ballots where room_id=rid and round=round_no and voter_id=police_id;
   if ranks is not null and not coalesce(police_id=any(tied),false) then
    select id into nominee from unnest(tied) c(id) order by array_position(ranks,id) limit 1;
   else
    update public.rooms set v24=(r.v24||jsonb_build_object(
     'voteRound',main_round+2,'runoffCandidates',tied,'voteEndsAt',t+interval '1 minute',
     'voteRounds',history||jsonb_build_array(jsonb_build_object('round',main_round,'nominees',tied,'resolvedAt',t,'outcome','tie-runoff'))
    ))-'nominees' where id=rid;
    perform public.add_event(rid,'system','คะแนนเสมอ · โหวตเฉพาะผู้ที่เสมออีก 1 นาที · หากยังเสมอ Killer Side ชนะ');
    return;
   end if;
  end if;
 else nominee:=tied[1];
 end if;
 if nominee is not null and main_round=1 and exists(select 1 from public.player_secrets where player_id=nominee and initial_role='killer-wife') then
  select jsonb_agg(id order by id) into next_voters from unnest(voters) c(id) where id<>nominee;
  update public.rooms set v24=(r.v24||jsonb_build_object(
   'voteRound',2,'voters',next_voters,'excludedVoterIds',jsonb_build_array(nominee),'voteEndsAt',t+interval '3 minutes',
   'voteRounds',history||jsonb_build_array(jsonb_build_object('round',main_round,'runoff',round_no>2,'nominees',jsonb_build_array(nominee),'resolvedAt',t,'outcome','wife-revote','wifePlayerId',nominee))
  ))-'nominees'-'runoffCandidates' where id=rid;
  perform public.add_event(rid,'system',(select name from public.players where id=nominee)||' คือ Killer''s Wife · เปิดโหวตหา Killer ตั้งต้นอีก 3 นาที');
  return;
 end if;
 outcome:=case when nominee is not null and exists(select 1 from public.player_secrets where player_id=nominee and initial_role='killer') then 'city' else 'killers' end;
 update public.rooms set v24=r.v24||jsonb_build_object(
  'nominees',case when nominee is null then '[]'::jsonb else jsonb_build_array(nominee) end,
  'voteRounds',history||jsonb_build_array(jsonb_build_object('round',main_round,'runoff',round_no>2,'nominees',case when nominee is null then '[]'::jsonb else jsonb_build_array(nominee) end,'resolvedAt',t,'outcome',outcome,'tied',nominee is null))
 ) where id=rid;
 if nominee is null then perform public.add_event(rid,'system','โหวตแก้เสมอยังเสมอ · Killer Side ชนะ'); end if;
 perform public.v24_finish(rid,outcome::winning_team,'final-vote',(r.v24->>'voteEndsAt')::timestamptz);
end $$;

create or replace function public.submit_final_ballot_round(p_code text,p_round integer,p_nominees uuid[],p_ranking uuid[]) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms; me uuid; police boolean; eligible uuid[]; candidates uuid[]; current_round int;
begin
 select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
 if not coalesce((r.v24->>'tieRunoffRules')::boolean,false) then
  return public.submit_final_ballot_round_pre_runoff(p_code,p_round,p_nominees,p_ranking);
 end if;
 current_round:=(r.v24->>'voteRound')::int;
 select p.id,s.role_current='police' into me,police from public.players p join public.player_secrets s on s.player_id=p.id
 where p.room_id=r.id and p.user_id=auth.uid() and p.health<>'dead';
 if me is null or r.phase='ended' or r.v24->>'stage'<>'secret-vote' or current_round not in (1,2,3,4) or p_round is distinct from current_round
  or clock_timestamp()>=(r.v24->>'voteEndsAt')::timestamptz or not coalesce(r.v24->'voters' @> jsonb_build_array(me),false) then raise exception 'vote unavailable'; end if;
 select array_agg(value::uuid) into eligible from jsonb_array_elements_text(r.v24->'voters') where value<>me::text;
 select array_agg(value::uuid) into candidates from jsonb_array_elements_text(case when current_round>2 then r.v24->'runoffCandidates' else r.v24->'voters' end) where value<>me::text;
 if p_nominees is null or cardinality(p_nominees)<>1 or not coalesce(p_nominees<@candidates,false) then raise exception 'invalid ballot'; end if;
 if police and current_round<=2 and (p_ranking is null or cardinality(p_ranking)<>cardinality(eligible) or cardinality(p_ranking)<>(select count(distinct x) from unnest(p_ranking) x) or not coalesce(p_ranking<@eligible,false)) then raise exception 'invalid police ranking'; end if;
 if (not police or current_round>2) and coalesce(cardinality(p_ranking),0)>0 then raise exception 'ranking is police only'; end if;
 insert into public.v24_ballots(room_id,round,voter_id,nominees,ranking) values(r.id,current_round,me,p_nominees,coalesce(p_ranking,'{}')) on conflict do nothing;
 return public.get_room_view(p_code);
end $$;

create or replace function public.start_game(p_code text,p_role_counts jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 perform public.start_game_pre_runoff(p_code,p_role_counts);
 update public.rooms set v24=v24||jsonb_build_object('tieRunoffRules',true) where code=upper(trim(p_code)) and rules_version='2.4';
 return public.get_room_view(p_code);
end $$;

create or replace function public.get_room_view(p_code text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb; r public.rooms;
begin
 result:=public.get_room_view_pre_runoff(p_code);
 if result is null or result->'v24' is null or result->'v24'='null'::jsonb then return result; end if;
 select * into r from public.rooms where code=upper(trim(p_code));
 return jsonb_set(result,'{v24}',(result->'v24')||jsonb_build_object('tieRunoffRules',coalesce((r.v24->>'tieRunoffRules')::boolean,false),'runoffCandidates',coalesce(r.v24->'runoffCandidates','[]'::jsonb)));
end $$;

revoke all on function public.v24_resolve_vote_pre_runoff(uuid),public.submit_final_ballot_round_pre_runoff(text,integer,uuid[],uuid[]),public.start_game_pre_runoff(text,jsonb),public.get_room_view_pre_runoff(text),public.v24_resolve_vote(uuid) from public,anon,authenticated;
revoke all on function public.submit_final_ballot_round(text,integer,uuid[],uuid[]),public.start_game(text,jsonb),public.get_room_view(text) from public,anon;
grant execute on function public.submit_final_ballot_round(text,integer,uuid[],uuid[]),public.start_game(text,jsonb),public.get_room_view(text) to authenticated;
notify pgrst,'reload schema';
commit;
