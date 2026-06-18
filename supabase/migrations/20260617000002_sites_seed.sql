-- Named-site reverse lookup: a PostGIS KNN function + a curated manual seed.
--
-- The manual seed is the documented Plan B (ParaglidingEarth bulk redistribution
-- terms are unconfirmed). When a licensed import is cleared, load it via
-- scripts/seed-sites.ts with source='paraglidingearth' + source_url/license set;
-- the lookup is source-agnostic.

create or replace function public.nearest_site(
  in_lat double precision,
  in_lon double precision,
  max_m  double precision,
  in_kind text default null
)
returns table (id uuid, name text, kind text, dist_m double precision)
language sql
stable
as $$
  select s.id, s.name, s.kind,
         st_distance(s.geom, st_setsrid(st_makepoint(in_lon, in_lat), 4326)::geography) as dist_m
  from public.sites s
  where st_dwithin(
          s.geom,
          st_setsrid(st_makepoint(in_lon, in_lat), 4326)::geography,
          max_m
        )
    and (in_kind is null or s.kind = in_kind or s.kind = 'both')
  order by s.geom <-> st_setsrid(st_makepoint(in_lon, in_lat), 4326)::geography
  limit 1;
$$;

-- Curated seed of well-known free-flight sites (manual, hand-entered coordinates).
insert into public.sites (name, kind, geom, country_code, region, source, license)
values
  ('Mussel Rock',          'both', st_setsrid(st_makepoint(-122.4936, 37.6685), 4326)::geography, 'US', 'California',  'manual', 'curated'),
  ('Fort Funston',         'both', st_setsrid(st_makepoint(-122.5022, 37.7172), 4326)::geography, 'US', 'California',  'manual', 'curated'),
  ('Ed Levin',             'both', st_setsrid(st_makepoint(-121.8638, 37.4699), 4326)::geography, 'US', 'California',  'manual', 'curated'),
  ('Torrey Pines',         'both', st_setsrid(st_makepoint(-117.2520, 32.8900), 4326)::geography, 'US', 'California',  'manual', 'curated'),
  ('Point of the Mountain','both', st_setsrid(st_makepoint(-111.9030, 40.4828), 4326)::geography, 'US', 'Utah',        'manual', 'curated'),
  ('Chelan Butte',         'takeoff', st_setsrid(st_makepoint(-120.0290, 47.8190), 4326)::geography, 'US', 'Washington','manual', 'curated'),
  ('Col de la Forclaz',    'takeoff', st_setsrid(st_makepoint(6.2256, 45.8186), 4326)::geography,   'FR', 'Annecy',      'manual', 'curated'),
  ('Interlaken (Beatenberg)','takeoff', st_setsrid(st_makepoint(7.7960, 46.6960), 4326)::geography, 'CH', 'Bern',        'manual', 'curated'),
  ('Oludeniz (Babadag)',   'takeoff', st_setsrid(st_makepoint(29.1200, 36.5560), 4326)::geography,  'TR', 'Mugla',       'manual', 'curated'),
  ('Bir Billing',          'takeoff', st_setsrid(st_makepoint(76.7180, 32.0440), 4326)::geography,  'IN', 'Himachal',    'manual', 'curated'),
  ('Stanwell Park',        'both', st_setsrid(st_makepoint(150.9870, -34.2270), 4326)::geography,    'AU', 'NSW',         'manual', 'curated'),
  ('Sun Valley (Bald Mtn)','takeoff', st_setsrid(st_makepoint(-114.3620, 43.6750), 4326)::geography, 'US', 'Idaho',       'manual', 'curated');
