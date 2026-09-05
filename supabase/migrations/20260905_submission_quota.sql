-- Block evidence submissions until the shared hourly quota resets.
create or replace function public.submit_evidence(p_code text,p_target_id uuid,p_storage_path text,p_captured_at timestamptz) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; me public.players; s public.player_secrets; target public.players; checked_at timestamptz;
begin
  select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
  select * into me from public.players where room_id=r.id and user_id=auth.uid();
  select * into s from public.player_secrets where player_id=me.id;
  if auth.uid() is null or r.id is null or r.host_user_id=auth.uid() or me.id is null or s.is_active_killer is not true or me.health='dead' then raise exception 'killer ability unavailable'; end if;
  if p_target_id is null or p_captured_at is null or nullif(trim(p_storage_path),'') is null then raise exception 'missing evidence parameters'; end if;
  if public.advance_due_accusation(r.id) or r.phase='police-check' then
    return public.get_room_view(r.code) || jsonb_build_object('actionError','accusation_started');
  end if;
  select * into target from public.players where id=p_target_id and room_id=r.id;
  checked_at := clock_timestamp();
  if r.quota_window_start=(date_trunc('hour',checked_at at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok')
    and r.approved_attacks_in_window>=r.attack_limit then
    raise exception 'hourly approved attack quota reached';
  end if;
  if r.phase<>'active' or target.id is null or target.health='dead' or target.id=me.id
    or not exists(select 1 from public.player_secrets where player_id=target.id and not is_active_killer)
    or nullif(trim(p_storage_path),'') is null or p_storage_path not like auth.uid()::text||'/%'
    or not exists(select 1 from storage.objects o where o.bucket_id='evidence' and o.name=p_storage_path
      and coalesce(o.metadata->>'mimetype','') like 'image/%' and coalesce(o.metadata->>'size','') ~ '^[1-9][0-9]*$')
    or p_captured_at is null or p_captured_at>checked_at or p_captured_at<checked_at-interval '2 minutes'
    then raise exception 'evidence is not allowed, missing, or stale'; end if;
  insert into public.evidence(room_id,killer_id,target_id,storage_path,captured_at) values(r.id,me.id,target.id,p_storage_path,p_captured_at);
  return public.get_room_view(r.code);
end $$;

