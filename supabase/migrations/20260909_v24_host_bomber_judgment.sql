-- Remove the pre-game Bomber proximity rule. Host judges the closest player
-- from the submitted image during bomb resolution.
begin;

create or replace function public.configure_v24(p_code text,p_duration_minutes integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms;
begin
 select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
 if r.host_user_id is distinct from auth.uid() or r.rules_version<>'2.4' or r.phase<>'lobby' then raise exception 'not allowed'; end if;
 if p_duration_minutes is null or p_duration_minutes<=120 or p_duration_minutes>2880 then raise exception 'invalid v24 settings'; end if;
 update public.rooms set v24=jsonb_build_object('durationMinutes',p_duration_minutes) where id=r.id;
 return public.get_room_view(p_code);
end $$;

-- Backward-compatible for clients that still send the removed third argument.
create or replace function public.configure_v24(p_code text,p_duration_minutes integer,p_proximity_rule text) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 return public.configure_v24(p_code,p_duration_minutes);
end $$;

create or replace function public.start_game(p_code text,p_role_counts jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms; p public.players; roles text[]:='{}'; item record; role text; hp int; idx int:=1; t timestamptz:=clock_timestamp(); duration int;
begin
 select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
 t:=clock_timestamp();
 if r.rules_version<>'2.4' then return public.start_game_pre24(p_code,p_role_counts); end if;
 if r.host_user_id is distinct from auth.uid() or r.phase<>'lobby' then raise exception 'not allowed'; end if;
 duration:=coalesce((r.v24->>'durationMinutes')::int,600);
 if p_role_counts is null or jsonb_typeof(p_role_counts)<>'object' then raise exception 'invalid roles'; end if;
 for item in select key,value::int amount from jsonb_each_text(p_role_counts) loop
  if item.key not in ('killer','killer-wife','police','detective','reporter','bomber','athlete','doctor','villager') or item.amount is null or item.amount<0 or item.amount>(case when item.key='villager' then 20 else 1 end) then raise exception 'invalid roles'; end if;
  roles:=roles||array_fill(item.key,array[item.amount]);
 end loop;
 if cardinality(roles)<3 or cardinality(roles)<>(select count(*) from public.players where room_id=r.id) or coalesce((p_role_counts->>'killer')::int,0)<>1 or coalesce((p_role_counts->>'police')::int,0)<>1 or exists(select 1 from public.players where room_id=r.id and avatar_id is null) then raise exception 'invalid player count, avatar selection, or required roles'; end if;
 for p in select * from public.players where room_id=r.id order by random() loop
  role:=roles[idx]; idx:=idx+1; hp:=case role when 'killer' then 0 when 'killer-wife' then 1 when 'athlete' then 3 else 2 end;
  insert into public.player_secrets(player_id,initial_role,role_current,team,is_active_killer,hearts,max_hearts) values(p.id,role,role,case when role in ('killer','killer-wife') then 'killers' else 'city' end,role='killer',hp,hp);
 end loop;
 update public.rooms set phase='active',police_check_at=null,v24=v24||jsonb_build_object('stage','active','startedAt',t,'finalAt',t+make_interval(mins=>duration),'cutoffAt',t+make_interval(mins=>duration-30),'revealEndsAt',t+make_interval(mins=>duration-120),'huntDeadline',t+interval '120 minutes') where id=r.id;
 perform public.add_event(r.id,'system','เกมเริ่มแล้ว'); return public.get_room_view(p_code);
end $$;

update public.rooms set v24=v24-'proximityRule' where rules_version='2.4' and v24 ? 'proximityRule';

revoke all on function public.configure_v24(text,integer),public.configure_v24(text,integer,text) from public,anon,authenticated;
grant execute on function public.configure_v24(text,integer),public.configure_v24(text,integer,text) to authenticated;
revoke all on function public.start_game(text,jsonb) from public,anon,authenticated;
grant execute on function public.start_game(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
