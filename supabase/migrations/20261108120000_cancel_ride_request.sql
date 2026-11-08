begin;

alter table public.rides
  add column if not exists cancelled_by text,
  add column if not exists cancellation_reason text;

alter table public.rides
  drop constraint if exists rides_cancelled_by_check,
  add constraint rides_cancelled_by_check
    check (cancelled_by is null or cancelled_by in ('rider', 'driver', 'admin', 'system')),
  drop constraint if exists rides_cancellation_reason_check,
  add constraint rides_cancellation_reason_check
    check (
      cancellation_reason is null
      or cancellation_reason in (
        'found another ride',
        'plans changed',
        'driver too far',
        'booked by mistake',
        'other'
      )
    );

create or replace function public.cancel_ride_request(
  target_ride_id uuid,
  cancellation_reason text default null
)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  cancelled_ride public.rides;
  current_ride public.rides;
  payment_needs_review boolean;
  payment_attempt_in_progress boolean;
begin
  if caller_id is null then
    raise exception 'Sign in as the rider who booked this ride to cancel it.';
  end if;

  if cancellation_reason is not null and cancellation_reason not in (
    'found another ride',
    'plans changed',
    'driver too far',
    'booked by mistake',
    'other'
  ) then
    raise exception 'Choose a valid cancellation reason.';
  end if;

  update public.rides r
  set status = 'cancelled',
      cancelled_by = 'rider',
      cancelled_at = now(),
      cancellation_reason = cancel_ride_request.cancellation_reason
  where r.id = target_ride_id
    and r.rider_id = caller_id
    and exists (
      select 1
      from public.profiles p
      where p.id = caller_id
        and p.role = 'rider'
    )
    and r.status in ('finding', 'accepted', 'arriving')
    and not (
      r.payment_method = 'online'
      and r.payment_status = 'paid'
    )
    and not (
      r.payment_method = 'online'
      and r.payment_status = 'pending'
      and r.payment_reference is not null
      and exists (
        select 1
        from public.ride_payment_attempts a
        where a.reference = r.payment_reference
          and (
            a.status = 'paid_unapplied'
            or (
              a.status = 'pending'
              and a.created_at > now() - interval '5 minutes'
            )
          )
      )
    )
  returning r.* into cancelled_ride;

  if found then
    return cancelled_ride;
  end if;

  select r.* into current_ride
  from public.rides r
  where r.id = target_ride_id
    and r.rider_id = caller_id
    and exists (
      select 1
      from public.profiles p
      where p.id = caller_id
        and p.role = 'rider'
    );

  if not found then
    raise exception 'This ride could not be found for your rider account.';
  end if;

  if current_ride.status = 'cancelled' then
    raise exception 'This ride has already been cancelled.';
  end if;

  if current_ride.status = 'on-trip' then
    raise exception 'This ride cannot be cancelled after the trip has started.';
  end if;

  if current_ride.status = 'completed' then
    raise exception 'A completed ride cannot be cancelled.';
  end if;

  if current_ride.status not in ('finding', 'accepted', 'arriving') then
    raise exception 'This ride is not in a cancellable state.';
  end if;

  if current_ride.payment_method = 'online'
     and current_ride.payment_status = 'paid' then
    raise exception 'Online payment is already confirmed. Contact support to arrange cancellation and any refund.';
  end if;

  select exists (
    select 1
    from public.ride_payment_attempts a
    where a.reference = current_ride.payment_reference
      and a.status = 'paid_unapplied'
  ) into payment_needs_review;

  if payment_needs_review then
    raise exception 'A payment for this ride needs support review. Contact support before cancelling.';
  end if;

  select exists (
    select 1
    from public.ride_payment_attempts a
    where a.reference = current_ride.payment_reference
      and a.status = 'pending'
      and a.created_at > now() - interval '5 minutes'
  ) into payment_attempt_in_progress;

  if current_ride.payment_method = 'online'
     and current_ride.payment_status = 'pending'
     and current_ride.payment_reference is not null
     and payment_attempt_in_progress then
    raise exception 'An online payment is still in progress. Try cancelling again after five minutes. If payment completes later, support may need to review it.';
  end if;

  raise exception 'This ride changed while you were cancelling it. Refresh and check its current status.';
end;
$$;

revoke all on function public.cancel_ride_request(uuid, text) from public, anon;
grant execute on function public.cancel_ride_request(uuid, text) to authenticated;

create or replace function public.cancel_scheduled_ride(target_ride_id uuid)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.cancel_ride_request(target_ride_id, null);
end;
$$;

revoke all on function public.cancel_scheduled_ride(uuid) from public, anon;
grant execute on function public.cancel_scheduled_ride(uuid) to authenticated;

commit;
