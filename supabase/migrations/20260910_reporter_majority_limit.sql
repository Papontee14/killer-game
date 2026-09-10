-- Reporter may inspect only while a strict majority of the original room is alive.
-- Players cannot join or leave after a game starts, so the room roster is the
-- immutable starting count without requiring a new persisted field.
begin;

create or replace function public.use_reporter(p_code text,p_target_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms;
begin
 select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
 if r.rules_version='2.4' then
  if r.phase not in ('active','bomb-resolution') or clock_timestamp()>=(r.v24->>'cutoffAt')::timestamptz then raise exception 'reporter ability unavailable'; end if;
  if exists(select 1 from public.players where room_id=r.id and user_id=auth.uid()) then
   perform public.v24_tick(r.id);
   if exists(select 1 from public.rooms where id=r.id and phase='ended') then return public.get_room_view(p_code)||jsonb_build_object('actionError','game_ended'); end if;
  end if;
 end if;
 if r.id is not null and exists(select 1 from public.players p join public.player_secrets s on s.player_id=p.id where p.room_id=r.id and p.user_id=auth.uid() and p.health<>'dead' and s.role_current='reporter' and not s.has_used_ability) and (select count(*) from public.players where room_id=r.id and health<>'dead')*2<=(select count(*) from public.players where room_id=r.id) then
  raise exception 'reporter ability requires more than half of starting players alive';
 end if;
 return public.use_reporter_pre24(p_code,p_target_id);
end $$;

notify pgrst,'reload schema';
commit;
