-- Active Killers need a narrowly scoped view of target protection before they
-- take a photo. The RPC remains the authority for every client.
begin;

create or replace function public.submit_evidence(p_code text,p_target_id uuid,p_storage_path text,p_captured_at timestamptz) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; me uuid; eid uuid; t timestamptz:=clock_timestamp(); protection_until timestamptz;
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
 select s.protection_until into protection_until from public.player_secrets s where s.player_id=p_target_id;
 -- A photo taken before protection expires is invalid even if the upload waits
 -- until after expiry. Equality is allowed: protection has ended at that instant.
 if protection_until>t or protection_until>p_captured_at then raise exception 'target protected; reject evidence'; end if;
 if p_storage_path is null or p_storage_path not like auth.uid()::text||'/%' or not exists(select 1 from storage.objects where bucket_id='evidence' and name=p_storage_path and metadata->>'mimetype' like 'image/%' and metadata->>'size' ~ '^[1-9][0-9]*$') then raise exception 'missing evidence image'; end if;
 if (select count(*) from public.v24_actions where room_id=r.id and actor_id=me and kind='attack' and status='pending')>=2 then raise exception 'pending evidence limit reached'; end if;
 if (select count(*) from public.v24_actions where room_id=r.id and kind='attack' and status in ('pending','approved') and effective_at>p_captured_at-interval '60 minutes')>=3 then raise exception 'rolling attack reservations full'; end if;
 insert into public.evidence(room_id,killer_id,target_id,storage_path,captured_at) values(r.id,me,p_target_id,p_storage_path,p_captured_at) returning id into eid;
 insert into public.v24_actions(room_id,actor_id,target_id,kind,effective_at,evidence_id) values(r.id,me,p_target_id,'attack',p_captured_at,eid);
 return public.get_room_view(p_code);
end $$;

create or replace function public.get_room_view(p_code text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb; r public.rooms; me public.players; allowed boolean := false; hidden boolean := false; activity jsonb := '[]'::jsonb; filtered_events jsonb; target_protection jsonb := '{}'::jsonb; show_target_protection boolean := false;
begin
  -- endGameTimeline remains in the base projection; this wrapper only narrows
  -- live protection and attack-history visibility.
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
  show_target_protection:=r.rules_version='2.4' and (r.host_user_id=auth.uid() or exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.room_id=r.id and p.user_id=auth.uid() and p.health<>'dead' and s.is_active_killer));
  if show_target_protection then
    select coalesce(jsonb_object_agg(s.player_id::text,to_jsonb(s.protection_until)),'{}'::jsonb) into target_protection
    from public.players p join public.player_secrets s on s.player_id=p.id
    where p.room_id=r.id and p.health<>'dead' and not s.is_active_killer and s.protection_until>clock_timestamp();
    result:=result||jsonb_build_object('v24',(case when jsonb_typeof(result->'v24')='object' then result->'v24' else '{}'::jsonb end)||jsonb_build_object('targetProtectionUntil',target_protection));
  end if;
  if coalesce(jsonb_typeof(result->'privateStates'), 'null') <> 'object' then
    result := result || jsonb_build_object('privateStates', '{}'::jsonb);
  end if;
  return result||jsonb_build_object('canViewAttackActivity',allowed,'attackActivity',activity,'attackActivityHidden',hidden);
end $$;

notify pgrst,'reload schema';
commit;
