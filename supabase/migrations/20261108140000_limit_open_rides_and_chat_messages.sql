create unique index if not exists rides_one_open_immediate_per_rider_idx
  on public.rides (rider_id)
  where status = 'finding'
    and timing = 'now'
    and scheduled_at is null;

create index if not exists ride_messages_sender_created_idx
  on public.ride_messages (sender_id, created_at);

create or replace function public.enforce_open_scheduled_ride_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  open_scheduled_count bigint;
begin
  if new.status <> 'finding'
     or new.timing <> 'scheduled'
     or new.scheduled_at is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.rider_id::text, 0)
  );

  select count(*)
  into open_scheduled_count
  from public.rides r
  where r.rider_id = new.rider_id
    and r.status = 'finding'
    and r.timing = 'scheduled'
    and r.scheduled_at is not null
    and r.id <> new.id;

  if open_scheduled_count >= 5 then
    raise exception 'A rider may have no more than 5 open scheduled rides.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_open_scheduled_ride_limit() from public, anon, authenticated;

drop trigger if exists rides_enforce_open_scheduled_limit on public.rides;
create trigger rides_enforce_open_scheduled_limit
before insert or update of rider_id, timing, scheduled_at, status
on public.rides
for each row
execute function public.enforce_open_scheduled_ride_limit();

create or replace function public.enforce_ride_message_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent_message_count bigint;
begin
  if auth.uid() is null or new.sender_id is distinct from auth.uid() then
    raise exception 'Message sender must match the authenticated user.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.sender_id::text, 1)
  );

  new.created_at := clock_timestamp();

  select count(*)
  into recent_message_count
  from public.ride_messages m
  where m.sender_id = new.sender_id
    and m.created_at > new.created_at - interval '60 seconds';

  if recent_message_count >= 15 then
    raise exception 'Message limit reached. Please wait before sending another message.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_ride_message_rate_limit() from public, anon, authenticated;

drop trigger if exists ride_messages_enforce_sender_rate_limit on public.ride_messages;
create trigger ride_messages_enforce_sender_rate_limit
before insert on public.ride_messages
for each row
execute function public.enforce_ride_message_rate_limit();
