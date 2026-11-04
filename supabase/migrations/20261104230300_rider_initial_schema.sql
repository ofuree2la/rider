create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 1 and 120),
  phone text not null default '',
  role text not null default 'rider' check (role in ('rider', 'driver', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.drivers (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  plate_number text not null unique check (length(trim(plate_number)) between 1 and 30),
  rating numeric(2, 1) not null default 5.0 check (rating between 0 and 5),
  status text not null default 'pending' check (status in ('pending', 'approved', 'suspended')),
  is_online boolean not null default false,
  subaccount_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.locations (
  id text primary key check (length(trim(id)) between 1 and 100),
  name text not null unique check (length(trim(name)) between 1 and 120),
  zone text not null check (zone in ('standard', 'campus', 'premium-hostel')),
  type text not null default 'building' check (length(trim(type)) between 1 and 40),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pricing_settings (
  id smallint primary key default 1 check (id = 1),
  currency text not null default 'NGN' check (currency = 'NGN'),
  rounding_increment integer not null default 50 check (rounding_increment > 0),
  fare_matrix jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.profiles (id),
  driver_id uuid references public.drivers (profile_id),
  pickup jsonb not null,
  destination jsonb not null,
  passengers smallint not null check (passengers between 1 and 4),
  timing text not null check (timing in ('now', 'scheduled')),
  scheduled_at timestamptz,
  status text not null default 'finding'
    check (status in ('finding', 'accepted', 'arriving', 'on-trip', 'completed', 'cancelled')),
  fare jsonb not null,
  payment_method text not null check (payment_method in ('cash', 'online')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'pending', 'paid', 'failed', 'paid-unverified')),
  payment_reference text unique,
  rating jsonb,
  declined_by uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  matched_at timestamptz,
  arrived_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  constraint scheduled_ride_has_time check (timing <> 'scheduled' or scheduled_at is not null)
);

create index if not exists rides_rider_created_idx on public.rides (rider_id, created_at desc);
create index if not exists rides_driver_created_idx on public.rides (driver_id, created_at desc);
create index if not exists rides_finding_idx on public.rides (created_at) where status = 'finding';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role text;
  profile_name text;
  profile_phone text;
  driver_plate text;
begin
  requested_role := case
    when new.raw_user_meta_data ->> 'role' in ('rider', 'driver')
      then new.raw_user_meta_data ->> 'role'
    else 'rider'
  end;
  profile_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(new.email, '@', 1)
  );
  profile_phone := coalesce(trim(new.raw_user_meta_data ->> 'phone'), '');

  insert into public.profiles (id, full_name, phone, role)
  values (new.id, profile_name, profile_phone, requested_role);

  if requested_role = 'driver' then
    driver_plate := upper(trim(coalesce(new.raw_user_meta_data ->> 'plate_number', '')));
    if driver_plate = '' then
      raise exception 'Driver signup requires a plate number.';
    end if;

    insert into public.drivers (profile_id, plate_number)
    values (new.id, driver_plate);
  end if;

  return new;
end;
$$;

drop trigger if exists rider_create_profile_after_signup on auth.users;
create trigger rider_create_profile_after_signup
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

create or replace function public.set_driver_online(make_online boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.drivers
  set is_online = make_online, updated_at = now()
  where profile_id = (select auth.uid())
    and status = 'approved';

  if not found then
    raise exception 'An approved driver account is required to change availability.';
  end if;

  return make_online;
end;
$$;

create or replace function public.admin_set_driver_status(
  target_driver_id uuid,
  next_status text
)
returns public.drivers
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_driver public.drivers;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required.';
  end if;
  if next_status not in ('pending', 'approved', 'suspended') then
    raise exception 'Invalid driver status.';
  end if;

  update public.drivers
  set status = next_status,
      is_online = case when next_status = 'approved' then is_online else false end,
      updated_at = now()
  where profile_id = target_driver_id
  returning * into updated_driver;

  if not found then
    raise exception 'Driver account not found.';
  end if;

  return updated_driver;
end;
$$;

create or replace function public.create_ride(
  pickup_location_id text,
  destination_location_id text,
  passenger_count smallint,
  ride_timing text,
  pickup_time timestamptz,
  selected_payment_method text
)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  rider_profile public.profiles;
  pickup_location public.locations;
  destination_location public.locations;
  settings public.pricing_settings;
  configured_fare numeric;
  rounded_fare integer;
  new_ride public.rides;
begin
  select * into rider_profile
  from public.profiles
  where id = (select auth.uid());

  if not found or rider_profile.role <> 'rider' then
    raise exception 'Sign in with a rider account to book a ride.';
  end if;
  if passenger_count < 1 or passenger_count > 4 then
    raise exception 'Passenger count must be between 1 and 4.';
  end if;
  if ride_timing not in ('now', 'scheduled') then
    raise exception 'Choose a valid ride time.';
  end if;
  if selected_payment_method not in ('cash', 'online') then
    raise exception 'Choose a valid payment method.';
  end if;
  if ride_timing = 'scheduled' and (pickup_time is null or pickup_time <= now()) then
    raise exception 'Choose a future pickup time for a scheduled ride.';
  end if;

  select * into pickup_location
  from public.locations
  where id = pickup_location_id and active;
  select * into destination_location
  from public.locations
  where id = destination_location_id and active;
  if pickup_location.id is null or destination_location.id is null then
    raise exception 'Choose active pickup and destination locations.';
  end if;
  if pickup_location.id = destination_location.id then
    raise exception 'Pickup and destination must be different.';
  end if;

  select * into settings from public.pricing_settings where id = 1;
  if not found then
    raise exception 'Fare settings have not been initialized.';
  end if;

  configured_fare := (settings.fare_matrix -> pickup_location.zone ->> destination_location.zone)::numeric;
  if configured_fare is null or configured_fare < 0 then
    raise exception 'No fare is configured for this route.';
  end if;
  rounded_fare := round(configured_fare / settings.rounding_increment)::integer
    * settings.rounding_increment;

  insert into public.rides (
    rider_id, pickup, destination, passengers, timing, scheduled_at,
    status, fare, payment_method, payment_status
  )
  values (
    rider_profile.id,
    jsonb_build_object('id', pickup_location.id, 'name', pickup_location.name,
      'zone', pickup_location.zone, 'type', pickup_location.type),
    jsonb_build_object('id', destination_location.id, 'name', destination_location.name,
      'zone', destination_location.zone, 'type', destination_location.type),
    passenger_count,
    ride_timing,
    case when ride_timing = 'scheduled' then pickup_time else null end,
    'finding',
    jsonb_build_object(
      'currency', settings.currency,
      'base', rounded_fare,
      'surcharge', 0,
      'perPassenger', rounded_fare,
      'total', rounded_fare * passenger_count,
      'rideTotal', rounded_fare * passenger_count,
      'passengers', passenger_count,
      'shared', false,
      'surcharges', jsonb_build_object('earlyMorning', 0, 'peakHour', 0)
    ),
    selected_payment_method,
    case when selected_payment_method = 'online' then 'pending' else 'unpaid' end
  )
  returning * into new_ride;

  return new_ride;
end;
$$;

create or replace function public.accept_ride_request(target_ride_id uuid)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  assigned_driver public.drivers;
  accepted_ride public.rides;
begin
  select * into assigned_driver
  from public.drivers
  where profile_id = (select auth.uid())
    and status = 'approved'
    and is_online;
  if not found then
    raise exception 'An approved, online driver account is required.';
  end if;

  update public.rides
  set driver_id = assigned_driver.profile_id,
      status = 'accepted',
      matched_at = now()
  where id = target_ride_id
    and status = 'finding'
    and driver_id is null
  returning * into accepted_ride;

  if not found then
    raise exception 'This ride request has already been accepted or closed.';
  end if;
  return accepted_ride;
end;
$$;

create or replace function public.advance_driver_ride(
  target_ride_id uuid,
  next_status text
)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_ride public.rides;
begin
  update public.rides
  set status = next_status,
      arrived_at = case when next_status = 'arriving' then now() else arrived_at end,
      started_at = case when next_status = 'on-trip' then now() else started_at end,
      completed_at = case when next_status = 'completed' then now() else completed_at end
  where id = target_ride_id
    and driver_id = (select auth.uid())
    and (
      (status = 'accepted' and next_status = 'arriving')
      or (status = 'arriving' and next_status = 'on-trip')
      or (status = 'on-trip' and next_status = 'completed')
    )
  returning * into updated_ride;

  if not found then
    raise exception 'That ride status update is not allowed.';
  end if;
  return updated_ride;
end;
$$;

alter table public.profiles enable row level security;
alter table public.drivers enable row level security;
alter table public.locations enable row level security;
alter table public.pricing_settings enable row level security;
alter table public.rides enable row level security;

revoke all on public.profiles, public.drivers, public.locations,
  public.pricing_settings, public.rides from anon, authenticated;

grant select on public.locations, public.pricing_settings to anon, authenticated;
grant select on public.profiles, public.drivers, public.rides to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
grant update (is_online) on public.drivers to authenticated;
grant insert, update, delete on public.locations to authenticated;
grant update on public.pricing_settings to authenticated;

drop policy if exists "profiles_read_own_or_admin" on public.profiles;
create policy "profiles_read_own_or_admin"
on public.profiles for select to authenticated
using ((select auth.uid()) = id or (select public.is_admin()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "drivers_read_self_or_admin" on public.drivers;
create policy "drivers_read_self_or_admin"
on public.drivers for select to authenticated
using (profile_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "drivers_update_own_availability" on public.drivers;
create policy "drivers_update_own_availability"
on public.drivers for update to authenticated
using (profile_id = (select auth.uid()) and status = 'approved')
with check (profile_id = (select auth.uid()) and status = 'approved');

drop policy if exists "locations_read_active" on public.locations;
create policy "locations_read_active"
on public.locations for select to anon, authenticated
using (active or (select public.is_admin()));

drop policy if exists "locations_admin_insert" on public.locations;
create policy "locations_admin_insert"
on public.locations for insert to authenticated
with check ((select public.is_admin()));

drop policy if exists "locations_admin_update" on public.locations;
create policy "locations_admin_update"
on public.locations for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "locations_admin_delete" on public.locations;
create policy "locations_admin_delete"
on public.locations for delete to authenticated
using ((select public.is_admin()));

drop policy if exists "pricing_settings_read" on public.pricing_settings;
create policy "pricing_settings_read"
on public.pricing_settings for select to anon, authenticated
using (true);

drop policy if exists "pricing_settings_admin_update" on public.pricing_settings;
create policy "pricing_settings_admin_update"
on public.pricing_settings for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "rides_read_rider_driver_or_admin" on public.rides;
create policy "rides_read_rider_driver_or_admin"
on public.rides for select to authenticated
using (
  rider_id = (select auth.uid())
  or driver_id = (select auth.uid())
  or (select public.is_admin())
  or (
    status = 'finding'
    and exists (
      select 1 from public.drivers d
      where d.profile_id = (select auth.uid())
        and d.status = 'approved'
        and d.is_online
    )
  )
);

insert into public.locations (id, name, zone, type)
values
  ('hostel-a', 'Hostel A', 'standard', 'hostel'),
  ('hostel-b', 'Hostel B', 'standard', 'hostel'),
  ('hostel-c', 'Hostel C', 'standard', 'hostel'),
  ('hostel-d', 'Hostel D', 'standard', 'hostel'),
  ('hostel-e', 'Hostel E', 'standard', 'hostel'),
  ('hostel-f', 'Hostel F', 'standard', 'hostel'),
  ('hostel-g', 'Hostel G', 'standard', 'hostel'),
  ('hostel-h', 'Hostel H', 'standard', 'hostel'),
  ('hostel-i', 'Hostel I', 'standard', 'hostel'),
  ('hostel-j', 'Hostel J', 'standard', 'hostel'),
  ('hostel-k', 'Hostel K', 'standard', 'hostel'),
  ('hostel-l', 'Hostel L', 'standard', 'hostel'),
  ('hostel-m', 'Hostel M', 'standard', 'hostel'),
  ('hostel-n', 'Hostel N', 'standard', 'hostel'),
  ('hostel-o', 'Hostel O', 'standard', 'hostel'),
  ('hostel-p', 'Hostel P', 'standard', 'hostel'),
  ('cicl', 'CICL', 'standard', 'hostel'),
  ('paetos', 'PAETOS', 'standard', 'hostel'),
  ('old-kelson', 'Old Kelson', 'standard', 'hostel'),
  ('new-kelson', 'New Kelson', 'standard', 'hostel'),
  ('stanzel-hostel', 'Stanzel Hostel', 'standard', 'hostel'),
  ('hostel-r', 'Hostel R', 'premium-hostel', 'hostel'),
  ('hostel-s', 'Hostel S', 'premium-hostel', 'hostel'),
  ('hostel-t', 'Hostel T', 'premium-hostel', 'hostel'),
  ('law-faculty', 'Law Faculty', 'campus', 'faculty'),
  ('auditorium', 'Auditorium', 'campus', 'building'),
  ('clinic', 'Clinic', 'campus', 'medical'),
  ('pharmacy-building', 'Pharmacy Building', 'campus', 'building'),
  ('medicine-building', 'Medicine Building', 'campus', 'building'),
  ('software-building', 'Software Building', 'campus', 'building'),
  ('multipurpose-hall', 'Multipurpose Hall', 'campus', 'building'),
  ('new-lecture-theatre', 'New Lecture Theatre', 'campus', 'building'),
  ('senate-building', 'Senate Building', 'campus', 'building'),
  ('chapel', 'Chapel', 'campus', 'chapel'),
  ('boys-hostel-gate', 'Boys Hostel Gate', 'campus', 'gate'),
  ('school-gate', 'School Gate', 'campus', 'gate'),
  ('block-a', 'Block A', 'campus', 'building'),
  ('block-b', 'Block B', 'campus', 'building'),
  ('block-c', 'Block C', 'campus', 'building'),
  ('block-d', 'Block D', 'campus', 'building'),
  ('veritas-cafe', 'Veritas Cafe', 'campus', 'cafeteria')
on conflict (id) do update
set name = excluded.name, zone = excluded.zone, type = excluded.type;

insert into public.pricing_settings (id, fare_matrix)
values (
  1,
  '{
    "standard": {"standard": 200, "campus": 200, "premium-hostel": 300},
    "campus": {"standard": 200, "campus": 200, "premium-hostel": 300},
    "premium-hostel": {"standard": 300, "campus": 300, "premium-hostel": 300}
  }'::jsonb
)
on conflict (id) do nothing;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to anon, authenticated;
revoke all on function public.create_profile_for_new_user() from public, anon, authenticated;
revoke all on function public.set_driver_online(boolean) from public, anon;
grant execute on function public.set_driver_online(boolean) to authenticated;
revoke all on function public.admin_set_driver_status(uuid, text) from public, anon;
grant execute on function public.admin_set_driver_status(uuid, text) to authenticated;
revoke all on function public.create_ride(text, text, smallint, text, timestamptz, text) from public, anon;
grant execute on function public.create_ride(text, text, smallint, text, timestamptz, text) to authenticated;
revoke all on function public.accept_ride_request(uuid) from public, anon;
grant execute on function public.accept_ride_request(uuid) to authenticated;
revoke all on function public.advance_driver_ride(uuid, text) from public, anon;
grant execute on function public.advance_driver_ride(uuid, text) to authenticated;
