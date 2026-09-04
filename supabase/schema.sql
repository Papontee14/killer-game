-- Killer mobile: run this migration in a Supabase project.
-- The browser demo uses localStorage when these variables are absent; this schema
-- is the production boundary for private roles, hearts and evidence.
create extension if not exists pgcrypto;

create type public.room_phase as enum ('lobby','active','police-check','bomb-resolution','ended');
create type public.health_state as enum ('alive','critical','dead');
create type public.evidence_status as enum ('pending','approved','rejected');
create type public.winning_team as enum ('city','killers');
create table public.rooms (
  id uuid primary key default gen_random_uuid(), code text unique not null check (code ~ '^[A-Z0-9]{6}$'),
  host_user_id uuid not null references auth.users(id), host_name text not null,
  host_pin_hash text not null, player_pin_hash text not null, phase public.room_phase not null default 'lobby',
  attack_limit int not null default 2, attacks_this_hour int not null default 0,
  attack_hour int not null default extract(hour from now()), police_check_at timestamptz,
  winner public.winning_team, created_at timestamptz not null default now()
);
create table public.players (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id), name text not null, is_online boolean not null default true,
  health public.health_state not null default 'alive', joined_at timestamptz not null default now(), unique(room_id, name)
);
create table public.player_secrets (
  player_id uuid primary key references public.players(id) on delete cascade,
  role text not null, hearts int not null, max_hearts int not null, has_used_ability boolean not null default false,
  is_killer_side boolean not null default false
);
create table public.evidence (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade,
  killer_id uuid not null references public.players(id), target_id uuid not null references public.players(id),
  storage_path text not null, status public.evidence_status not null default 'pending',
  created_at timestamptz not null default now(), decision_at timestamptz
);
create table public.room_events (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade,
  type text not null, message text not null, visible_to_player_id uuid references public.players(id), created_at timestamptz not null default now()
);

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.player_secrets enable row level security;
alter table public.evidence enable row level security;
alter table public.room_events enable row level security;

-- A player can discover the public roster, but never the private state.
create policy "room members can read public room" on public.rooms for select using (
  host_user_id = auth.uid() or exists (select 1 from public.players p where p.room_id = rooms.id and p.user_id = auth.uid())
);
create policy "room members can read roster" on public.players for select using (
  exists (select 1 from public.rooms r where r.id = players.room_id and r.host_user_id = auth.uid()) or user_id = auth.uid()
);
create policy "only owner reads private state" on public.player_secrets for select using (
  exists (select 1 from public.players p where p.id = player_secrets.player_id and p.user_id = auth.uid())
);
create policy "host reads evidence metadata" on public.evidence for select using (
  exists (select 1 from public.rooms r where r.id = evidence.room_id and r.host_user_id = auth.uid()) or
  exists (select 1 from public.players p where p.id = evidence.killer_id and p.user_id = auth.uid())
);
create policy "killer submits evidence" on public.evidence for insert with check (
  exists (select 1 from public.player_secrets s join public.players p on p.id = s.player_id where p.id = killer_id and p.user_id = auth.uid() and s.is_killer_side)
);
create policy "members read safe events" on public.room_events for select using (
  exists (select 1 from public.rooms r where r.id = room_events.room_id and r.host_user_id = auth.uid()) or
  visible_to_player_id is null or exists (select 1 from public.players p where p.id = visible_to_player_id and p.user_id = auth.uid())
);

-- All host decisions happen inside one transaction. The function is the only
-- write path for damage and quota accounting in production.
create or replace function public.approve_evidence(p_evidence_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e public.evidence%rowtype; target public.player_secrets%rowtype; r public.rooms%rowtype; h int;
begin
  select * into e from evidence where id = p_evidence_id for update;
  select * into r from rooms where id = e.room_id for update;
  if r.host_user_id <> auth.uid() or e.status <> 'pending' then raise exception 'not allowed'; end if;
  h := extract(hour from now());
  if r.attack_hour <> h then r.attacks_this_hour := 0; r.attack_hour := h; end if;
  if r.attacks_this_hour >= r.attack_limit then raise exception 'hourly quota reached'; end if;
  select * into target from player_secrets where player_id = e.target_id for update;
  if target.hearts <= 0 then raise exception 'target is dead'; end if;
  update player_secrets set hearts = hearts - 1 where player_id = e.target_id;
  update players set health = case when target.hearts - 1 <= 0 then 'dead'::health_state when target.hearts - 1 = 1 then 'critical'::health_state else 'alive'::health_state end where id = e.target_id;
  update evidence set status = 'approved', decision_at = now() where id = e.id;
  update rooms set attacks_this_hour = r.attacks_this_hour + 1, attack_hour = r.attack_hour where id = r.id;
end; $$;
