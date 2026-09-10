-- The post-game story is a member-only audit projection.  It keeps player ids
-- alongside display data so the client can filter without guessing from text.
begin;

create table if not exists public.end_game_story_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  source_type text not null,
  source_id text not null,
  kind text not null,
  occurred_at timestamptz not null,
  actor_player_id uuid references public.players(id),
  target_player_id uuid references public.players(id),
  affected_player_ids uuid[] not null default '{}'::uuid[],
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  unique(room_id, source_type, source_id)
);
create index if not exists end_game_story_events_room_time_idx
  on public.end_game_story_events(room_id, occurred_at, created_at, id);
alter table public.end_game_story_events enable row level security;
revoke all on public.end_game_story_events from public, anon, authenticated;

create or replace function public.record_end_game_story(
  p_room_id uuid, p_source_type text, p_source_id text, p_kind text,
  p_occurred_at timestamptz, p_actor uuid default null, p_target uuid default null,
  p_affected uuid[] default '{}'::uuid[], p_result jsonb default '{}'::jsonb
) returns void language sql security definer set search_path=public as $$
  insert into public.end_game_story_events(
    room_id,source_type,source_id,kind,occurred_at,actor_player_id,target_player_id,affected_player_ids,result
  ) values(
    p_room_id,p_source_type,p_source_id,p_kind,p_occurred_at,p_actor,p_target,coalesce(p_affected,'{}'::uuid[]),coalesce(p_result,'{}'::jsonb)
  ) on conflict(room_id,source_type,source_id) do nothing
$$;
revoke all on function public.record_end_game_story(uuid,text,text,text,timestamptz,uuid,uuid,uuid[],jsonb) from public, anon, authenticated;

-- These triggers capture future activity in the same transaction as its source.
create or replace function public.capture_story_room_event() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  perform public.record_end_game_story(new.room_id,'room-event',new.id::text,
    case when new.type in ('system','ability','bomb','winner') then new.type else 'event' end,
    new.created_at,new.visible_to_player_id,null,
    case when new.visible_to_player_id is null then '{}'::uuid[] else array[new.visible_to_player_id] end,
    jsonb_build_object('message',new.message));
  return new;
end $$;
drop trigger if exists end_game_story_room_event on public.room_events;
create trigger end_game_story_room_event after insert on public.room_events
  for each row execute function public.capture_story_room_event();

create or replace function public.capture_story_evidence() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.status='approved' and (tg_op='INSERT' or old.status is distinct from 'approved') then
    perform public.record_end_game_story(new.room_id,'evidence',new.id::text,'attack',new.captured_at,
      new.killer_id,new.target_id,array[new.target_id],
      jsonb_build_object('storagePath',new.storage_path,'capturedAt',new.captured_at,
        'decisionAt',new.decision_at,'result',new.attack_result));
  end if;
  return new;
end $$;
drop trigger if exists end_game_story_evidence on public.evidence;
create trigger end_game_story_evidence after insert or update on public.evidence
  for each row execute function public.capture_story_evidence();

create or replace function public.capture_story_v24_action() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.kind='heal' and new.status='approved' and (tg_op='INSERT' or old.status is distinct from 'approved') then
    perform public.record_end_game_story(new.room_id,'v24-action',new.id::text,'heal',new.effective_at,
      new.actor_id,new.target_id,array[new.target_id],jsonb_build_object('healed',new.healed));
  end if;
  return new;
end $$;
drop trigger if exists end_game_story_v24_action on public.v24_actions;
create trigger end_game_story_v24_action after insert or update on public.v24_actions
  for each row execute function public.capture_story_v24_action();

create or replace function public.capture_story_game_end() returns trigger
language plpgsql security definer set search_path=public as $$
declare at_time timestamptz;
begin
  if new.phase='ended' and old.phase is distinct from 'ended' then
    at_time:=coalesce(nullif(new.end_game_result->>'occurredAt','')::timestamptz,clock_timestamp());
    perform public.record_end_game_story(new.id,'game-end',new.id::text,'game-ended',at_time,
      nullif(new.end_game_result->>'actorPlayerId','')::uuid,
      nullif(new.end_game_result->>'targetPlayerId','')::uuid,
      coalesce(array(select jsonb_array_elements_text(new.end_game_result->'affectedPlayerIds')::uuid),'{}'::uuid[]),
      coalesce(new.end_game_result,'{}'::jsonb));
  end if;
  return new;
end $$;
drop trigger if exists end_game_story_game_end on public.rooms;
create trigger end_game_story_game_end after update of phase on public.rooms
  for each row execute function public.capture_story_game_end();

-- The backfill deliberately uses only facts that already exist.  It does not
-- infer private targets from historic display strings.
create or replace function public.sync_end_game_story(p_room_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare r public.rooms; started_at timestamptz; vote_counts jsonb;
begin
  select * into r from public.rooms where id=p_room_id;
  if r.id is null then return; end if;
  started_at:=coalesce(nullif(r.v24->>'startedAt','')::timestamptz,
    (select min(e.created_at) from public.room_events e where e.room_id=r.id and e.message like 'เกมเริ่มแล้ว%'),r.created_at);
  perform public.record_end_game_story(r.id,'room','start','game-start',started_at,null,null,'{}'::uuid[],jsonb_build_object('message','เกมเริ่มแล้ว'));

  insert into public.end_game_story_events(room_id,source_type,source_id,kind,occurred_at,actor_player_id,target_player_id,affected_player_ids,result)
  select e.room_id,'evidence',e.id::text,'attack',e.captured_at,e.killer_id,e.target_id,array[e.target_id],
    jsonb_build_object('storagePath',e.storage_path,'capturedAt',e.captured_at,'decisionAt',e.decision_at,'result',e.attack_result)
  from public.evidence e where e.room_id=r.id and e.status='approved'
  on conflict(room_id,source_type,source_id) do nothing;

  insert into public.end_game_story_events(room_id,source_type,source_id,kind,occurred_at,actor_player_id,target_player_id,affected_player_ids,result)
  select a.room_id,'v24-action',a.id::text,'heal',a.effective_at,a.actor_id,a.target_id,array[a.target_id],jsonb_build_object('healed',a.healed)
  from public.v24_actions a where a.room_id=r.id and a.kind='heal' and a.status='approved'
  on conflict(room_id,source_type,source_id) do nothing;

  insert into public.end_game_story_events(room_id,source_type,source_id,kind,occurred_at,target_player_id,affected_player_ids,result)
  select r.id,'milestone',ord::text,
    case when value->>'kind'='game-ended' then 'game-ended' else 'milestone' end,
    (value->>'occurredAt')::timestamptz,nullif(value->>'targetPlayerId','')::uuid,
    case when nullif(value->>'targetPlayerId','') is null then '{}'::uuid[] else array[(value->>'targetPlayerId')::uuid] end,
    value
  from jsonb_array_elements(coalesce(r.v24->'milestones','[]'::jsonb)) with ordinality item(value,ord)
  on conflict(room_id,source_type,source_id) do nothing;

  insert into public.end_game_story_events(room_id,source_type,source_id,kind,occurred_at,actor_player_id,affected_player_ids,result)
  select e.room_id,'room-event',e.id::text,
    case when e.type in ('system','ability','bomb','winner') then e.type else 'event' end,
    e.created_at,e.visible_to_player_id,
    case when e.visible_to_player_id is null then '{}'::uuid[] else array[e.visible_to_player_id] end,
    jsonb_build_object('message',e.message)
  from public.room_events e where e.room_id=r.id and e.type in ('system','ability','bomb','winner')
  on conflict(room_id,source_type,source_id) do nothing;

  if r.end_game_result is not null then
    perform public.record_end_game_story(r.id,'game-end',r.id::text,'game-ended',
      coalesce(nullif(r.end_game_result->>'occurredAt','')::timestamptz,clock_timestamp()),
      nullif(r.end_game_result->>'actorPlayerId','')::uuid,nullif(r.end_game_result->>'targetPlayerId','')::uuid,
      coalesce(array(select jsonb_array_elements_text(r.end_game_result->'affectedPlayerIds')::uuid),'{}'::uuid[]),r.end_game_result);
  end if;
  if r.rules_version='2.4' and r.v24 ? 'nominees' then
    select coalesce(jsonb_object_agg(p.id::text,coalesce(v.count,0)),'{}'::jsonb) into vote_counts
    from unnest(coalesce(array(select jsonb_array_elements_text(r.v24->'nominees')::uuid),'{}'::uuid[])) p(id)
    left join lateral (select count(*)::int from public.v24_ballots b where b.room_id=r.id and p.id=any(b.nominees)) v on true;
    perform public.record_end_game_story(r.id,'vote',r.id::text,'vote-summary',
      coalesce(nullif(r.v24->>'voteEndsAt','')::timestamptz,nullif(r.end_game_result->>'occurredAt','')::timestamptz,clock_timestamp()),
      null,null,coalesce(array(select jsonb_array_elements_text(r.v24->'nominees')::uuid),'{}'::uuid[]),jsonb_build_object('counts',vote_counts));
  end if;
end $$;

create or replace function public.get_end_game_story(p_code text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms; member boolean; entries jsonb; incomplete boolean;
begin
  select * into r from public.rooms where code=upper(trim(p_code));
  if r.id is null or auth.uid() is null then raise exception 'room not found'; end if;
  member:=r.host_user_id=auth.uid() or exists(select 1 from public.players p where p.room_id=r.id and p.user_id=auth.uid());
  if not member then raise exception 'not allowed'; end if;
  if r.phase<>'ended' then raise exception 'story is available after the game ends'; end if;
  perform public.sync_end_game_story(r.id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'kind',s.kind,'occurredAt',s.occurred_at,'actorPlayerId',s.actor_player_id,
    'targetPlayerId',s.target_player_id,'affectedPlayerIds',to_jsonb(s.affected_player_ids),'result',s.result
  ) order by s.occurred_at,s.created_at,s.id),'[]'::jsonb) into entries
  from public.end_game_story_events s where s.room_id=r.id;
  incomplete:=not exists(
    select 1 from public.room_events e
    where e.room_id=r.id and e.message like 'เกมเริ่มแล้ว%'
  );
  return jsonb_build_object('entries',entries,'incomplete',incomplete);
end $$;

-- Approved evidence becomes public to room members only after the game ends.
create or replace function public.can_read_attack_activity_evidence(p_path text) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.evidence e join public.rooms r on r.id=e.room_id
    left join public.players p on p.room_id=r.id and p.user_id=auth.uid()
    where e.storage_path=p_path and (
      r.host_user_id=auth.uid() or (e.status='approved' and (p.health='dead' or r.phase='ended'))
    )
  )
$$;

revoke all on function public.get_end_game_story(text) from public,anon;
grant execute on function public.get_end_game_story(text) to authenticated;
notify pgrst,'reload schema';
commit;
