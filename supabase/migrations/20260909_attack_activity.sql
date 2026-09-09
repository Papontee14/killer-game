-- Approved attack history is visible to the Host and members eliminated from the room.
begin;

alter function public.get_room_view(text) rename to get_room_view_attack_activity_base;

create or replace function public.can_read_attack_activity_evidence(p_path text) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(
    select 1
    from public.evidence e
    join public.rooms r on r.id=e.room_id
    left join public.players p on p.room_id=r.id and p.user_id=auth.uid()
    where e.storage_path=p_path
      and (r.host_user_id=auth.uid() or (e.status='approved' and p.health='dead'))
  )
$$;
revoke all on function public.can_read_attack_activity_evidence(text) from public,anon;
grant execute on function public.can_read_attack_activity_evidence(text) to authenticated;

drop policy if exists "host or owner reads evidence" on storage.objects;
create policy "host, owner, or eliminated member reads evidence" on storage.objects
  for select to authenticated using (
    bucket_id='evidence' and public.can_read_attack_activity_evidence(name)
  );

create or replace function public.get_room_view(p_code text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb; r public.rooms; me public.players; allowed boolean := false; activity jsonb := '[]'::jsonb;
begin
  result := public.get_room_view_attack_activity_base(p_code);
  if result is null then return null; end if;
  select * into r from public.rooms where code=upper(trim(p_code));
  if r.id is null or auth.uid() is null then return result; end if;
  if r.host_user_id=auth.uid() then
    allowed := true;
  else
    select * into me from public.players where room_id=r.id and user_id=auth.uid();
    allowed := me.id is not null and me.health='dead';
  end if;
  if allowed then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',e.id,'killerId',e.killer_id,'targetId',e.target_id,
      'storagePath',e.storage_path,'capturedAt',e.captured_at,
      'decisionAt',e.decision_at,'result',e.attack_result
    ) order by e.captured_at desc,e.id desc),'[]'::jsonb)
    into activity from public.evidence e
    where e.room_id=r.id and e.status='approved';
  end if;
  return result || jsonb_build_object(
    'canViewAttackActivity',allowed,
    'attackActivity',activity
  );
end $$;
revoke all on function public.get_room_view_attack_activity_base(text) from public,anon,authenticated;
revoke all on function public.get_room_view(text) from public,anon;
grant execute on function public.get_room_view(text) to authenticated;

notify pgrst,'reload schema';
commit;
