-- Killer's Wife belongs to Killer Side from the moment roles are assigned.
begin;

update public.player_secrets
set team='killers'
where initial_role='killer-wife' and team is distinct from 'killers';

create or replace function public.start_game(p_code text,p_role_counts jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms; p public.players; roles text[] := '{}'; item record; idx integer := 1; role text; mh integer;
begin
  select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
  if not found or r.host_user_id is distinct from auth.uid() or r.phase<>'lobby' then raise exception 'not allowed'; end if;
  if p_role_counts is null or jsonb_typeof(p_role_counts)<>'object' then raise exception 'invalid roles'; end if;
  for item in select key,value::int amount from jsonb_each_text(p_role_counts) loop
    if item.key not in ('killer','killer-wife','police','reporter','bomber','detective','athlete','sumo','villager') or item.amount is null or item.amount<0 or (item.key in ('killer','killer-wife','police','reporter','bomber','detective','athlete','sumo') and item.amount>1) or (item.key='villager' and item.amount>20) then raise exception 'invalid roles'; end if;
    for idx in 1..item.amount loop roles := array_append(roles,item.key); end loop;
  end loop;
  if array_length(roles,1) <> (select count(*) from public.players where room_id=r.id) or exists(select 1 from public.players where room_id=r.id and avatar_id is null) or (select count(*) from unnest(roles) x where x='killer')<>1 or (select count(*) from unnest(roles) x where x='police')<1 then raise exception 'invalid player count, avatar selection, or required roles'; end if;
  idx := 1;
  for p in select * from public.players where room_id=r.id order by random() loop
    role := roles[idx]; idx := idx+1; mh := case role when 'athlete' then 3 when 'sumo' then 4 when 'killer' then 0 else 2 end;
    insert into public.player_secrets(player_id,initial_role,role_current,team,is_active_killer,hearts,max_hearts)
      values(p.id,role,role,case when role in ('killer','killer-wife') then 'killers' else 'city' end,role='killer',mh,mh)
      on conflict(player_id) do update set initial_role=excluded.initial_role,role_current=excluded.role_current,team=excluded.team,is_active_killer=excluded.is_active_killer,hearts=excluded.hearts,max_hearts=excluded.max_hearts,has_used_ability=false;
    update public.players set health='alive' where id=p.id;
  end loop;
  update public.rooms set phase='active',quota_window_start=(date_trunc('hour',clock_timestamp() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'),approved_attacks_in_window=0 where id=r.id;
  perform public.add_event(r.id,'system','เกมเริ่มแล้ว บทบาทถูกแจกเรียบร้อย');
  return public.get_room_view(r.code);
end $$;

revoke execute on function public.start_game(text,jsonb) from public,anon;
grant execute on function public.start_game(text,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
