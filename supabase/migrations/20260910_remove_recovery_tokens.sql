begin;

drop function if exists public.join_room(text,text,text);
drop function if exists public.join_room(text,text);

create function public.join_room(p_code text,p_name text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.rooms; p public.players;
begin
  if auth.uid() is null or nullif(trim(p_name),'') is null or char_length(trim(p_name))>24 then raise exception 'invalid credentials or player name'; end if;
  select * into r from public.rooms where code=upper(trim(p_code)) and closed_at is null for update;
  if not found or r.host_user_id=auth.uid() then raise exception 'invalid room or host cannot play'; end if;
  select * into p from public.players where room_id=r.id and lower(name)=lower(trim(p_name)) limit 1;
  if found and p.user_id=auth.uid() then
    update public.players set is_online=true,last_seen_at=now() where id=p.id returning * into p;
  elsif found then raise exception 'player name is already in use';
  elsif r.phase <> 'lobby' then raise exception 'game already started';
  elsif (select count(*) from public.players where room_id=r.id) >= 28 then raise exception 'room is full';
  else
    insert into public.players(room_id,user_id,name) values(r.id,auth.uid(),trim(p_name)) returning * into p;
  end if;
  return jsonb_build_object('playerId',p.id) || public.get_room_view(r.code);
end $$;

revoke all on function public.join_room(text,text) from public, anon;
grant execute on function public.join_room(text,text) to authenticated;

alter table public.players drop column if exists reclaim_token_hash;

commit;
