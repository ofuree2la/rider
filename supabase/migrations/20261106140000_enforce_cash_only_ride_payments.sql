begin;

create or replace function public.enforce_cash_only_ride_payments()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.payment_method <> 'cash' then
    if tg_op = 'INSERT' then
      raise exception 'Online payments are not available yet. Choose cash.';
    end if;

    if new.status is distinct from old.status and new.status <> 'cancelled' then
      raise exception 'Online-payment rides cannot progress while online payments are disabled.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_cash_only_ride_payments() from public, anon, authenticated;

drop trigger if exists enforce_cash_only_ride_payments on public.rides;
create trigger enforce_cash_only_ride_payments
before insert or update on public.rides
for each row execute function public.enforce_cash_only_ride_payments();

commit;
