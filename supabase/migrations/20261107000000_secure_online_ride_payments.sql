begin;

create table if not exists public.ride_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides (id) on delete cascade,
  driver_id uuid not null references public.drivers (profile_id),
  reference text not null unique,
  amount_kobo integer not null check (amount_kobo > 0),
  subaccount_code text not null,
  authorization_url text,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'paid_unapplied')),
  created_at timestamptz not null default now()
);

create unique index if not exists ride_payment_attempts_one_open_per_ride_idx
  on public.ride_payment_attempts (ride_id)
  where status in ('pending', 'paid_unapplied');

alter table public.ride_payment_attempts enable row level security;
revoke all on public.ride_payment_attempts from public, anon, authenticated;
grant select, insert, update on public.ride_payment_attempts to service_role;

drop trigger if exists enforce_cash_only_ride_payments on public.rides;
drop function if exists public.enforce_cash_only_ride_payments();

create function public.enforce_ride_payment_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.payment_method = 'online' and (
      new.status <> 'finding'
      or new.payment_status <> 'pending'
      or new.payment_reference is not null
    ) then
      raise exception 'Online rides must start as pending payment requests.';
    end if;
    if new.payment_method = 'cash' and new.payment_status <> 'unpaid' then
      raise exception 'Cash rides must use the unpaid cash payment state.';
    end if;
    return new;
  end if;

  if old.payment_method = 'online' or new.payment_method = 'online' then
    if new.payment_method is distinct from old.payment_method then
      raise exception 'Ride payment method cannot be changed.';
    end if;
    if old.payment_status = 'paid' and new.payment_status <> 'paid' then
      raise exception 'A confirmed payment cannot be reversed.';
    end if;
    if new.payment_reference is distinct from old.payment_reference
       and auth.role() <> 'service_role' then
      raise exception 'Payment references can only be set by the payment service.';
    end if;
    if new.payment_status is distinct from old.payment_status then
      if auth.role() <> 'service_role'
         or old.payment_status <> 'pending'
         or new.payment_status <> 'paid'
         or new.payment_reference is null
         or new.status not in ('accepted', 'arriving') then
        raise exception 'Online payment status can only be confirmed by the payment service.';
      end if;
    end if;
    if new.status in ('on-trip', 'completed') and new.payment_status <> 'paid' then
      raise exception 'Online payment must be confirmed before the trip starts.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_ride_payment_rules() from public, anon, authenticated;

create trigger enforce_ride_payment_rules
before insert or update on public.rides
for each row execute function public.enforce_ride_payment_rules();

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

  update public.rides
  set driver_id = assigned_driver.profile_id,
      status = 'accepted',
      matched_at = now()
  where id = target_ride_id
    and status = 'finding'
    and driver_id is null
    and (payment_method <> 'online' or assigned_driver.subaccount_code is not null)
  returning * into accepted_ride;

  if not found then
    raise exception 'This ride request has already been accepted or closed.';
  end if;
  return accepted_ride;
end;
$$;

revoke all on function public.accept_ride_request(uuid) from public, anon;
grant execute on function public.accept_ride_request(uuid) to authenticated;

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
    and status in ('finding', 'accepted', 'arriving')
    and not (
      payment_method = 'online'
      and payment_status = 'pending'
      and payment_reference is not null
    )
  returning * into cancelled_ride;

  if not found then
    raise exception 'This scheduled ride cannot be cancelled while an online payment is in progress.';
  end if;

  return cancelled_ride;
end;
$$;

revoke all on function public.cancel_scheduled_ride(uuid) from public, anon;
grant execute on function public.cancel_scheduled_ride(uuid) to authenticated;

commit;
