create table if not exists public.driver_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers (profile_id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists driver_push_subscriptions_driver_id_idx
  on public.driver_push_subscriptions (driver_id);

alter table public.driver_push_subscriptions enable row level security;

revoke all on public.driver_push_subscriptions from anon, authenticated;
grant all on public.driver_push_subscriptions to service_role;
