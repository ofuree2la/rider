begin;

alter table public.drivers
  add column if not exists bank_name text not null default ''
    check (length(bank_name) <= 120),
  add column if not exists bank_account_number text not null default ''
    check (bank_account_number = '' or bank_account_number ~ '^[0-9]{10}$');

grant update (bank_name, bank_account_number) on public.drivers to authenticated;

create or replace function public.admin_get_account_details(target_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required.';
  end if;

  select jsonb_build_object(
    'id', p.id,
    'name', p.full_name,
    'phone', p.phone,
    'role', p.role,
    'avatarPath', p.avatar_path,
    'registeredAt', p.created_at,
    'email', u.email,
    'plateNumber', d.plate_number,
    'vehicleType', d.vehicle_type,
    'bankName', d.bank_name,
    'bankAccountNumber', d.bank_account_number,
    'driverStatus', d.status,
    'isOnline', d.is_online,
    'averageRating', case when d.profile_id is null then null else ride_stats.average_rating end,
    'ratedRides', coalesce(ride_stats.rated_rides, 0),
    'totalRides', coalesce(ride_stats.total_rides, 0),
    'completedRides', coalesce(ride_stats.completed_rides, 0),
    'driverRevenue', coalesce(ride_stats.driver_revenue, 0)
  )
  into result
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.drivers d on d.profile_id = p.id
  left join lateral (
    select
      count(*) as total_rides,
      count(*) filter (where r.status = 'completed') as completed_rides,
      count(*) filter (where r.rating is not null) as rated_rides,
      avg((r.rating ->> 'stars')::numeric) filter (where r.rating is not null) as average_rating,
      coalesce(sum(
        case
          when r.status = 'completed' then
            coalesce(
              nullif(r.fare ->> 'rideTotal', '')::numeric,
              nullif(r.fare ->> 'total', '')::numeric,
              0
            )
          else 0
        end
      ), 0) as driver_revenue
    from public.rides r
    where r.rider_id = p.id or r.driver_id = p.id
  ) ride_stats on true
  where p.id = target_profile_id
    and p.role in ('rider', 'driver');

  if result is null then
    raise exception 'Rider or driver account not found.';
  end if;
  return result;
end;
$$;

create or replace function public.admin_update_account_details(
  target_profile_id uuid,
  updated_name text,
  updated_phone text,
  updated_plate_number text,
  updated_bank_name text,
  updated_bank_account_number text,
  updated_avatar_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role text;
  normalized_name text := trim(coalesce(updated_name, ''));
  normalized_phone text := trim(coalesce(updated_phone, ''));
  normalized_plate text := upper(trim(coalesce(updated_plate_number, '')));
  normalized_bank_name text := trim(coalesce(updated_bank_name, ''));
  normalized_bank_account text := trim(coalesce(updated_bank_account_number, ''));
begin
  if not public.is_admin() then
    raise exception 'Admin access is required.';
  end if;
  if length(normalized_name) not between 1 and 120 then
    raise exception 'Enter a name between 1 and 120 characters.';
  end if;
  if length(regexp_replace(normalized_phone, '[^0-9]', '', 'g')) < 10 then
    raise exception 'Enter a valid phone number.';
  end if;

  select role
    into target_role
  from public.profiles
  where id = target_profile_id
  for update;

  if target_role is null or target_role not in ('rider', 'driver') then
    raise exception 'Rider or driver account not found.';
  end if;

  if target_role = 'driver' then
    if length(normalized_plate) not between 1 and 30 then
      raise exception 'Enter a valid vehicle registration or plate number.';
    end if;
    if length(normalized_bank_name) > 120
       or (normalized_bank_name = '' and normalized_bank_account <> '')
       or (normalized_bank_name <> '' and normalized_bank_account !~ '^[0-9]{10}$') then
      raise exception 'Enter a bank name and valid 10-digit account number, or leave both bank fields blank.';
    end if;
  elsif updated_plate_number is not null
     or updated_bank_name is not null
     or updated_bank_account_number is not null then
    raise exception 'Vehicle and bank details are only valid for driver accounts.';
  end if;

  if updated_avatar_path is not null and updated_avatar_path <> ''
     and updated_avatar_path !~ ('^' || target_profile_id::text || '/[^/]+$') then
    raise exception 'The profile photo path is invalid.';
  end if;

  update public.profiles
  set full_name = normalized_name,
      phone = normalized_phone,
      avatar_path = case
        when updated_avatar_path is null then avatar_path
        when updated_avatar_path = '' then null
        else updated_avatar_path
      end,
      updated_at = now()
  where id = target_profile_id;

  if target_role = 'driver' then
    update public.drivers
    set plate_number = normalized_plate,
        bank_name = normalized_bank_name,
        bank_account_number = normalized_bank_account,
        updated_at = now()
    where profile_id = target_profile_id;

    if not found then
      raise exception 'Driver details could not be found.';
    end if;
  end if;
end;
$$;

drop policy if exists "profile_photos_admin_insert" on storage.objects;
create policy "profile_photos_admin_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-photos'
  and (select public.is_admin())
);

drop policy if exists "profile_photos_admin_update" on storage.objects;
create policy "profile_photos_admin_update"
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-photos'
  and (select public.is_admin())
)
with check (
  bucket_id = 'profile-photos'
  and (select public.is_admin())
);

drop policy if exists "profile_photos_admin_delete" on storage.objects;
create policy "profile_photos_admin_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-photos'
  and (select public.is_admin())
);

revoke all on function public.admin_get_account_details(uuid) from public, anon;
grant execute on function public.admin_get_account_details(uuid) to authenticated;
revoke all on function public.admin_update_account_details(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_update_account_details(uuid, text, text, text, text, text, text) to authenticated;

commit;
