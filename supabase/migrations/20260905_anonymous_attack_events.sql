-- One anonymous announcement per approved attack; never project the excluded victim identifier.
begin;
alter table public.room_events add column if not exists excluded_player_id uuid references public.players(id);

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
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'type',e.type,'message',e.message,'createdAt',e.created_at,'playerId',e.visible_to_player_id) order by e.created_at desc),'[]'::jsonb) into events from public.room_events e where e.room_id=r.id and (is_host or ((e.visible_to_player_id is null or e.visible_to_player_id=me.id) and e.excluded_player_id is distinct from me.id));
  return jsonb_build_object('viewerRole',viewer_role,'playerId',case when is_host then null else me.id end,'code',r.code,'hostName',r.host_name,'phase',r.phase,
    'createdAt',r.created_at,'closedAt',r.closed_at,'attackLimit',r.attack_limit,'attacksThisHour',case when r.quota_window_start=(date_trunc('hour',clock_timestamp() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok') then r.approved_attacks_in_window else 0 end,
    'quotaWindowStart',r.quota_window_start,'policeCheckAt',r.police_check_at,'players',roster,'privateStates',states,'evidences',evidences,'killerEvidenceProgress',progress,'events',events,
    'winner',r.winner,'bombTargets','[]'::jsonb,'pendingBomberId',r.pending_bomber_id);
end $$;

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
  -- Everyone except the victim receives this public, anonymous announcement.
  -- The victim gets the private heart-loss event below instead.
  insert into public.room_events(room_id,type,message,excluded_player_id)
  values(r.id,'attack','มีคนถูกโจมตีจาก Killer',target.id);
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
commit;
