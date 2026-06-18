-- Leaf Log — Milestone 1 initial schema
-- Private-by-default, RLS-enforced. See docs/sprints/SPRINT-001.md.

-- ---------- Extensions ----------
create extension if not exists postgis;      -- geography + GiST KNN for site lookup
create extension if not exists citext;       -- case-insensitive handle / site name

-- ---------- updated_at helper ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- sites (referenced by profiles + flights; world-readable) ----------
create table public.sites (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  kind         text not null default 'unknown' check (kind in ('takeoff','landing','both','unknown')),
  geom         geography(Point, 4326) not null,
  country_code text,
  region       text,
  source       text not null default 'manual',
  source_id    text,
  source_url   text,
  license      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index sites_geom_gix on public.sites using gist (geom);
create index sites_kind_idx on public.sites (kind);

-- ---------- profiles (1:1 with auth.users; public pilot identity) ----------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  handle       citext not null unique,
  display_name text not null,
  bio          text,
  avatar_url   text,
  home_site_id uuid references public.sites(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------- flights ----------
create table public.flights (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles(id) on delete cascade,
  visibility      text not null default 'private' check (visibility in ('private','public')),
  source          text not null default 'web_upload' check (source in ('web_upload','device_push')),
  status          text not null default 'uploaded' check (status in ('uploaded','processing','ready','failed')),
  igc_sha256      text not null,
  parser_version  text not null default '0',
  parse_warnings  jsonb not null default '[]'::jsonb,
  failure_reason  text,
  -- header facts
  flight_date     date,
  takeoff_at      timestamptz,
  landing_at      timestamptz,
  local_tz        text,
  local_utc_offset_minutes int,
  glider          text,
  recorder        text,
  -- derived scalar metrics
  duration_s      int,
  max_alt_m       int,
  alt_gain_m      int,
  max_climb_ms    numeric,
  max_sink_ms     numeric,
  alt_source      text check (alt_source in ('baro','gps')),
  track_dist_m    int,
  straight_dist_m int,
  -- coordinates + bounds
  takeoff_lat     double precision,
  takeoff_lon     double precision,
  landing_lat     double precision,
  landing_lon     double precision,
  bounds          jsonb,
  -- located sites (denormalized name kept for history)
  takeoff_site_id   uuid references public.sites(id) on delete set null,
  takeoff_site_name text,
  landing_site_id   uuid references public.sites(id) on delete set null,
  landing_site_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index flights_owner_date_idx on public.flights (owner_id, flight_date desc);
create index flights_public_idx on public.flights (visibility) where visibility = 'public';
create unique index flights_owner_hash_uniq on public.flights (owner_id, igc_sha256);
create trigger flights_updated_at before update on public.flights
  for each row execute function public.set_updated_at();

-- ---------- flight_assets (explicit storage metadata) ----------
create table public.flight_assets (
  id           uuid primary key default gen_random_uuid(),
  flight_id    uuid not null references public.flights(id) on delete cascade,
  kind         text not null check (kind in ('raw_igc','derived_track')),
  bucket       text not null,
  object_key   text not null,
  content_type text not null,
  byte_size    int not null,
  created_at   timestamptz not null default now()
);
create index flight_assets_flight_idx on public.flight_assets (flight_id);

-- ====================================================================
-- Row-Level Security — the authoritative privacy floor
-- ====================================================================
alter table public.profiles      enable row level security;
alter table public.flights       enable row level security;
alter table public.flight_assets enable row level security;
alter table public.sites         enable row level security;

-- profiles: public identity is world-readable; you may write only your own row.
create policy profiles_select_all on public.profiles
  for select using (true);
create policy profiles_insert_own on public.profiles
  for insert with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- flights: readable iff you own it OR it is public; writable only by the owner.
create policy flights_select_visible on public.flights
  for select using (owner_id = (select auth.uid()) or visibility = 'public');
create policy flights_insert_own on public.flights
  for insert with check (owner_id = (select auth.uid()));
create policy flights_update_own on public.flights
  for update using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy flights_delete_own on public.flights
  for delete using (owner_id = (select auth.uid()));

-- flight_assets: OWNER-ONLY at the data layer. Public flights expose their
-- derived track only through the authorizing server route (service role), and
-- raw IGC is never publicly accessible.
create policy flight_assets_select_owner on public.flight_assets
  for select using (
    exists (select 1 from public.flights f
            where f.id = flight_id and f.owner_id = (select auth.uid()))
  );

-- sites: world-readable; writes are service-role only (no anon write policy).
create policy sites_select_all on public.sites
  for select using (true);

-- ---------- Storage buckets (private) ----------
insert into storage.buckets (id, name, public)
values ('igc','igc', false), ('tracks','tracks', false)
on conflict (id) do nothing;

-- Owners may read their own objects directly (path prefix = "{uid}/...").
-- All writes + cross-user/public reads go through the service role in the app.
create policy "owner reads own igc" on storage.objects
  for select using (
    bucket_id = 'igc' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "owner reads own tracks" on storage.objects
  for select using (
    bucket_id = 'tracks' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
