-- Repair installations where PostgREST cannot find the Host termination RPC.
-- Safe to apply more than once and does not alter room or player data.
begin;

create or replace function public.end_game(p_code text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.rooms; begin select * into r from public.rooms where code=upper(trim(p_code)) and host_user_id=auth.uid() and closed_at is null for update; if not found or r.phase not in ('lobby','active','police-check','bomb-resolution') then raise exception 'not allowed'; end if; update public.rooms set phase='ended' where id=r.id; perform public.add_event(r.id,'system','Host สั่งจบเกม'); return public.get_room_view(r.code); end $$;

revoke execute on function public.end_game(text) from public, anon;
grant execute on function public.end_game(text) to authenticated;

-- PostgREST caches exposed RPC signatures. Reload it after restoring the function.
notify pgrst, 'reload schema';

commit;
