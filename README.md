# Rider

Rider is a mobile-first campus keke booking web app for Veritas University, Abuja. Its current rider, driver, and Admin workflows use Supabase Authentication and Postgres; the older local mock API remains in the repository but is no longer used by these pages.

## Run locally

Serve the repository over HTTP (ES modules do not work reliably from `file://`) and open `index.html`. The booking screen is available from **Book a Ride**. Configure Supabase Auth Site URL and redirect URLs for the local or deployed origin.

## Prototype status

The Supabase publishable browser key is configured in `js/supabase-config.js`. It is safe for browser use only with the database Row Level Security (RLS) policies enabled. Never put a Supabase `service_role` key or database password in website files.

## Supabase backend foundation

The Supabase project URL and publishable browser key are configured in `js/supabase-config.js`; the publishable key is safe for browser use when Row Level Security (RLS) is enabled. Never put a Supabase `service_role` key or database password in website files.

The initial schema and RLS policies are in `supabase/migrations/20261104230300_rider_initial_schema.sql`. To initialize the project:
1. Open the Supabase project SQL Editor and run the migration file.
2. Run `supabase/migrations/20261104234900_rider_workflow_functions.sql` in the SQL Editor.
3. Set the Supabase Auth Site URL to the deployed Rider URL and allow the Rider login URLs as redirects.
4. Create the first Admin user through the Rider sign-up page as a rider account, then confirm the email.
5. In the SQL Editor, promote that account by running:
   `update public.profiles set role = 'admin' where id = (select id from auth.users where email = lower('YOUR_ADMIN_EMAIL'));`
6. Verify the profile role is `admin`, then sign in at `admin/login.html`.

Rider and driver authentication, profiles, bookings, tracking, history, driver workflows, Admin management, locations, and fare matrix settings use Supabase. Online payment is disabled until a server-side Paystack verification endpoint is deployed and integrated. Fares are currently placeholders, and time-based surcharges/shared-fare options are off. Do not use the app for production rides until payment, deployment, and operational/security checks are complete.

## Mobile experience and motion

- Pages share `css/mobile.css` for touch-sized controls, mobile spacing, safe-area support, and reduced-motion preferences.
- Anime.js 3.2.2 is loaded from jsDelivr for subtle page entrance motion in `js/motion.js`. If the library is unavailable, the page remains usable without the animation.
- Short vibration feedback is requested on touch for buttons and links where the browser supports the Vibration API. iOS Safari and other unsupported browsers may not provide vibration; no extra permission or hardware is assumed.

## Rider and driver accounts

- Riders use `login.html` and `signup.html`. Drivers use `driver/login.html` and `driver/signup.html`; registration collects a phone number and keke plate number, and new driver accounts must be approved by an Admin before going online.
- The Admin portal is at `admin/login.html`. There is no shared/demo Admin password: use an account whose `profiles.role` has been promoted to `admin` by a trusted project owner.
- To provision the first Admin, sign up and confirm an account, then use the SQL promotion command in the Supabase setup steps above. Never expose database credentials or grant Admin access through public signup.
- Riders can update their name, email, and phone at `profile.html`; drivers can also edit their keke plate number at `driver/profile.html`.
- Admins can view ride/driver metrics, approve or suspend drivers, manage locations, and edit the fare matrix. Database authorization is enforced through Supabase RLS and restricted RPC functions.
- Existing local mock data is not automatically migrated to Supabase. Create accounts again through the Supabase-backed signup pages.
