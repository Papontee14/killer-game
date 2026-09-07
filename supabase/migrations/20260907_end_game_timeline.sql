-- End-game explanations are public only after a room ends.  The source rows
-- remain normalized; this projection deliberately exposes only the milestones
-- needed to explain the result, never evidence images or private warnings.

create or replace function public.get_room_view(p_code text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb; end_result jsonb; r public.rooms; timeline jsonb := '[]'::jsonb; ended_at timestamptz;
begin
  result := public.get_room_view_legacy(p_code);
  if result is null or result->>'phase' <> 'ended' then return result; end if;

  select * into r from public.rooms where code=upper(trim(p_code));
  end_result := r.end_game_result;
  ended_at := nullif(end_result->>'occurredAt', '')::timestamptz;

  if end_result is not null then
    select coalesce(jsonb_agg(entry order by occurred_at, position), '[]'::jsonb) into timeline
    from (
      select jsonb_build_object('kind','detective-eliminated','occurredAt',e.decision_at,
               'actorPlayerId',e.killer_id,'targetPlayerId',e.target_id) entry,
             e.decision_at occurred_at, 1 position
      from public.evidence e
      join public.player_secrets target on target.player_id=e.target_id
      where e.room_id=r.id and e.status='approved' and e.attack_result='elimination confirmed'
        and target.initial_role='detective' and (ended_at is null or e.decision_at <= ended_at)
      union all
      select jsonb_build_object('kind','detective-promoted','occurredAt',ended_at,
               'actorPlayerId',null,'targetPlayerId',s.player_id), ended_at, 2
      from public.player_secrets s join public.players p on p.id=s.player_id
      where p.room_id=r.id and s.initial_role='detective' and s.role_current='police'
      union all
      select jsonb_build_object('kind','police-attacked','occurredAt',ended_at,
               'actorPlayerId',end_result->>'actorPlayerId','targetPlayerId',end_result->>'targetPlayerId'), ended_at, 3
      where end_result->>'reason'='police-attacked'
      union all
      select jsonb_build_object('kind','game-ended','occurredAt',ended_at,
               'actorPlayerId',end_result->>'actorPlayerId','targetPlayerId',end_result->>'targetPlayerId'), ended_at, 4
    ) milestones;
  end if;

  return result || jsonb_build_object('endGameResult',end_result,'endGameTimeline',timeline);
end $$;

create or replace function public.approve_evidence(p_code text,p_evidence_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb; r public.rooms; e public.evidence;
begin
  result := public.approve_evidence_legacy(p_code,p_evidence_id);
  if result->>'phase'='ended' then
    select * into r from public.rooms where code=upper(trim(p_code));
    if r.end_game_result is null then
      select * into e from public.evidence where id=p_evidence_id;
      if e.id is not null then
        update public.rooms set end_game_result=jsonb_build_object(
          'reason',case when r.winner='city' then 'police-attacked' else 'police-eliminated-no-successor' end,
          'occurredAt',clock_timestamp(),'actorPlayerId',e.killer_id,
          'targetPlayerId',e.target_id,'affectedPlayerIds',to_jsonb(array[e.target_id]::uuid[])) where id=r.id;
        -- Replace the legacy generic winner announcement rather than appending
        -- another one, so a retried request cannot produce duplicate results.
        update public.room_events set message=case when r.winner='city'
          then 'City Side ชนะ เพราะ Host อนุมัติการโจมตี Police'
          else 'Killer Side ชนะ เพราะ Police ถูกกำจัดและไม่มี Detective รับตำแหน่งต่อ' end
        where id=(select id from public.room_events where room_id=r.id and type='winner' order by created_at desc,id desc limit 1);
      end if;
    end if;
  end if;
  return public.get_room_view(p_code);
end $$;

grant execute on function public.get_room_view(text),public.approve_evidence(text,uuid) to authenticated;
notify pgrst, 'reload schema';
