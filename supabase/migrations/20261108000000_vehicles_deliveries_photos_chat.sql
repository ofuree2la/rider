begin;

alter table public.profiles
  add column if not exists avatar_path text;

alter table public.drivers
  add column if not exists vehicle_type text not null default 'keke'
  check (vehicle_type in ('bike', 'keke', 'minivan'));

alter table public.rides
  add column if not exists service_type text not null default 'passenger'
    check (service_type in ('passenger', 'delivery')),
  add column if not exists vehicle_type text not null default 'keke'
    check (vehicle_type in ('bike', 'keke', 'minivan')),
  add column if not exists delivery_description text,
  add column if not exists delivery_recipient_name text,
  add column if not exists delivery_recipient_phone text;

alter table public.rides drop constraint if exists rides_passengers_check;
alter table public.rides
  add constraint rides_vehicle_service_check check (
    (
      service_type = 'passenger'
      and vehicle_type in ('keke', 'minivan')
      and (
        (vehicle_type = 'keke' and passengers between 1 and 4)
        or (vehicle_type = 'minivan' and passengers between 1 and 6)
      )
      and delivery_description is null
      and delivery_recipient_name is null
      and delivery_recipient_phone is null
    )
    or (
      service_type = 'delivery'
      and vehicle_type = 'bike'
      and passengers = 0
      and length(trim(coalesce(delivery_description, ''))) between 1 and 300
      and length(trim(coalesce(delivery_recipient_name, ''))) between 1 and 120
      and length(regexp_replace(coalesce(delivery_recipient_phone, ''), '[^0-9]', '', 'g')) >= 10
    )
  );

update public.pricing_settings
set fare_matrix = jsonb_build_object(
  'keke', fare_matrix,
  'minivan', fare_matrix,
  'bike', fare_matrix
)
where not (fare_matrix ? 'keke');

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
  driver_vehicle_type text;
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
    driver_vehicle_type := coalesce(new.raw_user_meta_data ->> 'vehicle_type', 'keke');
    if driver_plate = '' then
      raise exception 'Driver signup requires a vehicle registration or plate number.';
    end if;
    if driver_vehicle_type not in ('bike', 'keke', 'minivan') then
      raise exception 'Choose a supported vehicle type.';
    end if;

    insert into public.drivers (profile_id, plate_number, vehicle_type)
    values (new.id, driver_plate, driver_vehicle_type);
  end if;

  return new;
end;
$$;

create or replace function public.create_ride(
  selected_service_type text,
  selected_vehicle_type text,
  pickup_location_id text,
  destination_location_id text,
  passenger_count smallint,
  ride_timing text,
  pickup_time timestamptz,
  selected_payment_method text,
  package_description text default null,
  recipient_full_name text default null,
  recipient_contact text default null
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
  billed_passengers integer;
  new_ride public.rides;
begin
  select * into rider_profile
  from public.profiles
  where id = (select auth.uid());

  if not found or rider_profile.role <> 'rider' then
    raise exception 'Sign in with a rider account to book.';
  end if;
  if selected_service_type is null or selected_service_type not in ('passenger', 'delivery') then
    raise exception 'Choose a valid service.';
  end if;
  if selected_vehicle_type is null or selected_vehicle_type not in ('bike', 'keke', 'minivan') then
    raise exception 'Choose a supported vehicle type.';
  end if;
  if selected_service_type = 'passenger' then
    if selected_vehicle_type not in ('keke', 'minivan') then
      raise exception 'Bikes are available for delivery only.';
    end if;
    if passenger_count is null
       or (selected_vehicle_type = 'keke' and passenger_count not between 1 and 4)
       or (selected_vehicle_type = 'minivan' and passenger_count not between 1 and 6) then
      raise exception 'Passenger count exceeds this vehicle capacity.';
    end if;
    if package_description is not null or recipient_full_name is not null or recipient_contact is not null then
      raise exception 'Delivery details are not valid for a passenger ride.';
    end if;
    billed_passengers := passenger_count;
  else
    if selected_vehicle_type <> 'bike' or passenger_count is distinct from 0 then
      raise exception 'Choose bike delivery without passenger seats.';
    end if;
    if length(trim(coalesce(package_description, ''))) not between 1 and 300
       or length(trim(coalesce(recipient_full_name, ''))) not between 1 and 120
       or length(regexp_replace(coalesce(recipient_contact, ''), '[^0-9]', '', 'g')) < 10 then
      raise exception 'Enter the package description and a valid recipient name and phone number.';
    end if;
    billed_passengers := 1;
  end if;
  if ride_timing is null or ride_timing not in ('now', 'scheduled') then
    raise exception 'Choose a valid pickup time.';
  end if;
  if selected_payment_method is null or selected_payment_method not in ('cash', 'online') then
    raise exception 'Choose a valid payment method.';
  end if;
  if ride_timing = 'scheduled' and (pickup_time is null or pickup_time <= now()) then
    raise exception 'Choose a future pickup time for a scheduled booking.';
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

  configured_fare := (
    settings.fare_matrix -> selected_vehicle_type
      -> pickup_location.zone ->> destination_location.zone
  )::numeric;
  if configured_fare is null or configured_fare < 0 or configured_fare > 100000 then
    raise exception 'No valid fare is configured for this route and vehicle.';
  end if;
  rounded_fare := round(configured_fare / settings.rounding_increment)::integer
    * settings.rounding_increment;

  insert into public.rides (
    rider_id, pickup, destination, passengers, timing, scheduled_at,
    status, fare, payment_method, payment_status, service_type, vehicle_type,
    delivery_description, delivery_recipient_name, delivery_recipient_phone
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
      'total', rounded_fare * billed_passengers,
      'rideTotal', rounded_fare * billed_passengers,
      'passengers', billed_passengers,
      'shared', false,
      'surcharges', jsonb_build_object('earlyMorning', 0, 'peakHour', 0)
    ),
    selected_payment_method,
    case when selected_payment_method = 'online' then 'pending' else 'unpaid' end,
    selected_service_type,
    selected_vehicle_type,
    case when selected_service_type = 'delivery' then trim(package_description) end,
    case when selected_service_type = 'delivery' then trim(recipient_full_name) end,
    case when selected_service_type = 'delivery' then trim(recipient_contact) end
  )
  returning * into new_ride;

  return new_ride;
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
begin
  return public.create_ride(
    'passenger', 'keke', pickup_location_id, destination_location_id,
    passenger_count, ride_timing, pickup_time, selected_payment_method,
    null, null, null
  );
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

  if assigned_driver.subaccount_code is null and exists (
    select 1 from public.rides
    where id = target_ride_id
      and status = 'finding'
      and payment_method = 'online'
  ) then
    raise exception 'Online rides require a configured Paystack driver subaccount.';
  end if;

  update public.rides r
  set driver_id = assigned_driver.profile_id,
      status = 'accepted',
      matched_at = now()
  where r.id = target_ride_id
    and r.status = 'finding'
    and r.driver_id is null
    and r.vehicle_type = assigned_driver.vehicle_type
    and (r.payment_method <> 'online' or assigned_driver.subaccount_code is not null)
  returning r.* into accepted_ride;

  if not found then
    raise exception 'This request is closed or does not match your vehicle type.';
  end if;
  return accepted_ride;
end;
$$;

create or replace function public.get_ride_driver(target_ride_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'id', d.profile_id,
    'name', p.full_name,
    'phone', p.phone,
    'plateNumber', d.plate_number,
    'vehicleType', d.vehicle_type,
    'avatarPath', p.avatar_path,
    'rating', d.rating,
    'status', d.status,
    'verified', d.status = 'approved',
    'subaccountCode', d.subaccount_code
  )
  into result
  from public.rides r
  join public.drivers d on d.profile_id = r.driver_id
  join public.profiles p on p.id = d.profile_id
  where r.id = target_ride_id
    and (
      r.rider_id = (select auth.uid())
      or r.driver_id = (select auth.uid())
      or (select public.is_admin())
    );

  if result is null then
    raise exception 'Ride or assigned driver not found.';
  end if;
  return result;
end;
$$;

create table if not exists public.ride_messages (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists ride_messages_ride_created_idx
  on public.ride_messages (ride_id, created_at);

alter table public.ride_messages enable row level security;
revoke all on public.ride_messages from public, anon, authenticated;
grant select on public.ride_messages to authenticated;
grant insert (ride_id, sender_id, body) on public.ride_messages to authenticated;

drop policy if exists "ride_messages_read_active_participants" on public.ride_messages;
create policy "ride_messages_read_active_participants"
on public.ride_messages for select to authenticated
using (
  exists (
    select 1 from public.rides r
    where r.id = ride_id
      and r.status in ('accepted', 'arriving', 'on-trip')
      and (r.rider_id = (select auth.uid()) or r.driver_id = (select auth.uid()))
  )
);

drop policy if exists "ride_messages_send_active_participants" on public.ride_messages;
create policy "ride_messages_send_active_participants"
on public.ride_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and length(trim(body)) between 1 and 1000
  and exists (
    select 1 from public.rides r
    where r.id = ride_id
      and r.status in ('accepted', 'arriving', 'on-trip')
      and (r.rider_id = (select auth.uid()) or r.driver_id = (select auth.uid()))
  )
);

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
        and d.vehicle_type = rides.vehicle_type
    )
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos',
  'profile-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile_photos_read_authenticated" on storage.objects;
create policy "profile_photos_read_authenticated"
on storage.objects for select to authenticated
using (bucket_id = 'profile-photos');

drop policy if exists "profile_photos_insert_own" on storage.objects;
create policy "profile_photos_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "profile_photos_update_own" on storage.objects;
create policy "profile_photos_update_own"
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "profile_photos_delete_own" on storage.objects;
create policy "profile_photos_delete_own"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

revoke all on function public.create_ride(text, text, text, text, smallint, text, timestamptz, text, text, text, text) from public, anon;
grant execute on function public.create_ride(text, text, text, text, smallint, text, timestamptz, text, text, text, text) to authenticated;
revoke all on function public.create_ride(text, text, smallint, text, timestamptz, text) from public, anon;
grant execute on function public.create_ride(text, text, smallint, text, timestamptz, text) to authenticated;
revoke all on function public.accept_ride_request(uuid) from public, anon;
grant execute on function public.accept_ride_request(uuid) to authenticated;
revoke all on function public.get_ride_driver(uuid) from public, anon;
grant execute on function public.get_ride_driver(uuid) to authenticated;
grant update (avatar_path) on public.profiles to authenticated;

commit;
