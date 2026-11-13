begin;

alter table public.drivers
  add column if not exists vehicle_photo_path text
  check (
    vehicle_photo_path is null
    or vehicle_photo_path ~ ('^' || profile_id::text || '/[^/]+$')
  );

grant update (vehicle_photo_path) on public.drivers to authenticated;

commit;
