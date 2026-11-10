create or replace function public.get_assigned_ride_rider_phone(target_ride_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rider_phone text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view the rider contact number.';
  end if;

  select p.phone
    into rider_phone
  from public.rides r
  join public.profiles p on p.id = r.rider_id
  where r.id = target_ride_id
    and r.driver_id = (select auth.uid())
    and r.status in ('accepted', 'arriving', 'on-trip');

  if not found then
    raise exception 'The rider contact number is only available to the assigned driver for an active ride.';
  end if;

  return rider_phone;
end;
$$;

revoke all on function public.get_assigned_ride_rider_phone(uuid) from public, anon;
grant execute on function public.get_assigned_ride_rider_phone(uuid) to authenticated;
