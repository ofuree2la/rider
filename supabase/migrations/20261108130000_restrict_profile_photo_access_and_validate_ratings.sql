drop policy if exists profile_photos_read_authenticated on storage.objects;

create policy profile_photos_read_authenticated
on storage.objects
for select
to authenticated
using (
  bucket_id = 'profile-photos'
  and auth.uid() is not null
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.is_admin()
    or exists (
      select 1
      from public.rides r
      where r.status <> 'cancelled'
        and (
        (r.rider_id = (select auth.uid())
          and r.driver_id::text = (storage.foldername(name))[1])
        or
        (r.driver_id = (select auth.uid())
          and r.rider_id::text = (storage.foldername(name))[1])
        )
    )
  )
);

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
  if star_rating is null
     or star_rating < 1
     or star_rating > 5
     or length(coalesce(rating_comment, '')) > 500 then
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

revoke all on function public.rate_ride(uuid, integer, text) from public, anon;
grant execute on function public.rate_ride(uuid, integer, text) to authenticated;
