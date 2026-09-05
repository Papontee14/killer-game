-- Add push_subscriptions table for Web Push notifications
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

create or replace function public.register_push_subscription(
  p_code text,
  p_endpoint text,
  p_p256dh text,
  p_auth text
) returns boolean language plpgsql security definer set search_path=public as $$
declare
  r public.rooms;
  is_member boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into r from public.rooms where code = upper(trim(p_code)) and closed_at is null;
  if not found or r.id is null then
    raise exception 'room not found or closed';
  end if;

  is_member := (r.host_user_id = auth.uid()) or exists (
    select 1 from public.players where room_id = r.id and user_id = auth.uid()
  );

  if not is_member then
    raise exception 'not a room member';
  end if;

  insert into public.push_subscriptions (room_id, user_id, endpoint, p256dh, auth, updated_at)
  values (r.id, auth.uid(), trim(p_endpoint), trim(p_p256dh), trim(p_auth), now())
  on conflict (user_id, endpoint)
  do update set
    room_id = excluded.room_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    updated_at = now();

  return true;
end $$;

create or replace function public.unregister_push_subscription(
  p_endpoint text
) returns boolean language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  delete from public.push_subscriptions
  where user_id = auth.uid() and endpoint = trim(p_endpoint);

  return true;
end $$;

revoke execute on function public.register_push_subscription(text, text, text, text),
  public.unregister_push_subscription(text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text),
  public.unregister_push_subscription(text) to authenticated;
