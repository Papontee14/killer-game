-- Reveal only roles and teams to existing authorized members after the game ends.
-- Apply after 20260905_anonymous_attack_events.sql.
begin;

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
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'avatarId',p.avatar_id,'joinedAt',p.joined_at,'isOnline',p.is_online and p.last_seen_at > now()-interval '90 seconds','health',case when is_host or p.id=me.id then p.health when p.health='dead' then 'dead'::health_state else 'alive'::health_state end,
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
  if r.phase='ended' then
    select coalesce(jsonb_agg(jsonb_build_object('playerId',p.id,'initialRole',s.initial_role,'currentRole',s.role_current,'team',s.team) order by p.joined_at,p.id),'[]'::jsonb)
      into summary from public.players p left join public.player_secrets s on s.player_id=p.id where p.room_id=r.id;
  end if;
  return jsonb_build_object('viewerRole',viewer_role,'playerId',case when is_host then null else me.id end,'code',r.code,'hostName',r.host_name,'phase',r.phase,
    'createdAt',r.created_at,'closedAt',r.closed_at,'attackLimit',r.attack_limit,'attacksThisHour',case when r.quota_window_start=(date_trunc('hour',clock_timestamp() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok') then r.approved_attacks_in_window else 0 end,
    'quotaWindowStart',r.quota_window_start,'policeCheckAt',r.police_check_at,'players',roster,'privateStates',states,'evidences',evidences,'killerEvidenceProgress',progress,'events',events,
    'endGameSummary',summary,'winner',r.winner,'bombTargets','[]'::jsonb,'pendingBomberId',r.pending_bomber_id);
end $$;

commit;
