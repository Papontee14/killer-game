-- get_room_view_pre24 returns JSON null for a lobby player's private state.
-- JSONB concatenation then turns it into [null, {}] in the v2.4 projection.
-- Keep every existing field and normalize the public RPC boundary to an object.
begin;

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
  if coalesce(jsonb_typeof(result->'privateStates'), 'null') <> 'object' then
    result := result || jsonb_build_object('privateStates', '{}'::jsonb);
  end if;
  return result||jsonb_build_object('canViewAttackActivity',allowed,'attackActivity',activity,'attackActivityHidden',hidden);
end $$;

revoke all on function public.get_room_view(text) from public,anon;
grant execute on function public.get_room_view(text) to authenticated;

notify pgrst,'reload schema';
commit;
