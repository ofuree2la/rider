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

create or replace function public.decline_ride_request(target_ride_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.rides r
  set declined_by = array_append(r.declined_by, (select auth.uid()))
  where r.id = target_ride_id
    and r.status = 'finding'
    and not ((select auth.uid()) = any(r.declined_by))
    and exists (
      select 1
      from public.drivers d
      where d.profile_id = (select auth.uid())
        and d.status = 'approved'
        and d.is_online
    );

  if not found then
    raise exception 'This request is not available to decline.';
  end if;
end;
$$;

create or replace function public.cancel_scheduled_ride(target_ride_id uuid)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  cancelled_ride public.rides;
begin
  update public.rides
  set status = 'cancelled', cancelled_at = now()
  where id = target_ride_id
    and rider_id = (select auth.uid())
    and timing = 'scheduled'
    and scheduled_at > now()
    and status in ('finding', 'accepted', 'arriving');

  if not found then
    raise exception 'This scheduled ride is no longer eligible for cancellation.';
  end if;

  select * into cancelled_ride from public.rides where id = target_ride_id;
  return cancelled_ride;
end;
$$;

create or replace function public.rate_ride(
  target_ride_id uuid,
  star_rating integer,
  rating_comment text
)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  rated_ride public.rides;
begin
  if star_rating < 1 or star_rating > 5 or length(coalesce(rating_comment, '')) > 500 then
    raise exception 'Rating must be 1 to 5 stars and comment must be at most 500 characters.';
  end if;

  update public.rides
  set rating = jsonb_build_object(
    'stars', star_rating,
    'comment', trim(coalesce(rating_comment, '')),
    'submittedAt', now()
  )
  where id = target_ride_id
    and rider_id = (select auth.uid())
    and status = 'completed'
    and rating is null
  returning * into rated_ride;

  if not found then
    raise exception 'This ride cannot be rated.';
  end if;

  update public.drivers d
  set rating = (
    select round(avg((r.rating ->> 'stars')::numeric), 1)
    from public.rides r
    where r.driver_id = d.profile_id and r.rating is not null
  ),
  updated_at = now()
  where d.profile_id = rated_ride.driver_id;

  return rated_ride;
end;
$$;

grant update (plate_number) on public.drivers to authenticated;
drop policy if exists "drivers_update_own_availability" on public.drivers;
create policy "drivers_update_own_profile"
on public.drivers for update to authenticated
using (profile_id = (select auth.uid()))
with check (
  profile_id = (select auth.uid())
  and (status = 'approved' or is_online = false)
);

revoke all on function public.get_ride_driver(uuid) from public, anon;
grant execute on function public.get_ride_driver(uuid) to authenticated;
revoke all on function public.decline_ride_request(uuid) from public, anon;
grant execute on function public.decline_ride_request(uuid) to authenticated;
revoke all on function public.cancel_scheduled_ride(uuid) from public, anon;
grant execute on function public.cancel_scheduled_ride(uuid) to authenticated;
revoke all on function public.rate_ride(uuid, integer, text) from public, anon;
grant execute on function public.rate_ride(uuid, integer, text) to authenticated;
