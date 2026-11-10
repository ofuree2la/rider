# Rider

Rider is a mobile-first campus ride and delivery web app for Veritas University, Abuja. Its current rider, driver, and Admin workflows use Supabase Authentication, Postgres, and private Supabase Storage; the older local mock API remains in the repository but is no longer used by these pages.

## Run locally

Serve the repository over HTTP (ES modules do not work reliably from `file://`) and open `index.html`. The booking screen is available from **Book a Ride**. Configure Supabase Auth Site URL and redirect URLs for the local or deployed origin.

## Site address

Internal links, assets, imports, and splash redirects use paths relative to the current page, so they work from both GitHub Pages at `/rider/` and a custom-domain root. No site-root path needs to be changed for the switch.

The canonical site URL used by the Vercel payment callback is configured in the Vercel `RIDER_APP_URL` environment variable. It is currently `https://ofuree2la.github.io/rider/`; after the custom domain is connected, change that one value to `https://getrider.ng/`. The Vercel API CORS allowlist accepts both the current GitHub Pages origin and `getrider.ng` (including `www`) during transition. Supabase Auth Site URL and redirect allowlist are separate dashboard settings and must also be updated by hand when the domain is ready.

## Prototype status

The Supabase publishable browser key is configured in `js/supabase-config.js`. It is safe for browser use only with the database Row Level Security (RLS) policies enabled. Never put a Supabase `service_role` key or database password in website files.

Keep server-only credentials in local environment files or your hosting provider's secret manager. `.env` files are ignored by Git; only non-secret `.env.example` templates may be committed.

## Supabase backend foundation

The Supabase project URL and publishable browser key are configured in `js/supabase-config.js`; the publishable key is safe for browser use when Row Level Security (RLS) is enabled. Never put a Supabase `service_role` key or database password in website files.

The initial schema and RLS policies are in `supabase/migrations/20261104230300_rider_initial_schema.sql`. To initialize the project:
1. Open the Supabase project SQL Editor and run the migration file.
2. Run `supabase/migrations/20261104234900_rider_workflow_functions.sql` in the SQL Editor.
3. Run `supabase/migrations/20261106140000_enforce_cash_only_ride_payments.sql` in the SQL Editor.
4. To enable the secure Paystack flow, also run `supabase/migrations/20261107000000_secure_online_ride_payments.sql`.
5. Run `supabase/migrations/20261108000000_vehicles_deliveries_photos_chat.sql` after the preceding migrations. It adds vehicle-specific fares, package deliveries, profile photos, and ride chat with database access policies.
6. Run `supabase/migrations/20261108010000_enable_ride_realtime.sql` to add ride requests to the `supabase_realtime` publication. It is safe to rerun and does not change RLS policies.
7. Set the Supabase Auth Site URL to the deployed Rider URL and allow the Rider login URLs as redirects.
8. Create the first Admin user through the Rider sign-up page as a rider account, then confirm the email.
9. In the SQL Editor, promote that account by running:
   `update public.profiles set role = 'admin' where id = (select id from auth.users where email = lower('YOUR_ADMIN_EMAIL'));`
10. Verify the profile role is `admin`, then sign in at `admin/login.html`.

Rider and driver authentication, profiles, bookings, tracking, history, driver workflows, Admin management, locations, and fare matrix settings use Supabase. Online rides may be accepted by a driver while payment is pending, but the driver cannot start the trip until Paystack confirms payment.

### Secure Paystack deployment

The payment API runs as Vercel functions in `api/`. Deploy this repository to Vercel and configure these server-side environment variables in the Vercel project:

- `SUPABASE_URL`: the Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: the Supabase service-role key. Keep it only in Vercel secrets; never add it to frontend code or Git.
- `PAYSTACK_SECRET_KEY`: the Paystack secret key. Start with Paystack test credentials and use the matching Paystack public/merchant environment before accepting live payments.
- `RIDER_APP_URL`: the Rider app URL, including its path (`https://ofuree2la.github.io/rider/` until the custom domain is connected).
- `PAYMENT_CALLBACK_URL`: the deployed Vercel URL ending in `/api/verify-payment`.

Online payments are disabled while `PAYMENT_API_BASE_URL` in `js/paystack-config.js` is blank. Do not populate it or enable payment until the payment flow is explicitly approved and tested.

The rider requests a ride first. After a driver accepts, Paystack checkout is initialized server-side using the ride fare stored in Supabase and that driver's configured subaccount. Paystack's callback is verified server-side and the ride is marked paid only when the reference, NGN currency, and amount match. A payment with an unexpected ride state is not applied automatically and requires support follow-up. Create each driver's subaccount in Paystack and store its subaccount code in that driver's `drivers.subaccount_code` field in Supabase before accepting online rides; drivers without a configured code cannot accept online requests.

**Do not enable online payments until the payment verification flow explicitly handles rides cancelled while checkout is in progress, including late successful payments and the required refund or support outcome.**

Fares are currently placeholders, and time-based surcharges/shared-fare options are off. Test the complete flow with Paystack test credentials and a non-production ride before configuring live payment credentials. Do not use the app for production rides until deployment, live-payment verification, fare configuration, and operational checks are complete.

### Driver push alerts

The driver dashboard supports opt-in Web Push for new matching ride and delivery requests. Existing in-app alerts remain available if Web Push is unsupported or not configured. Push alerts are sent only to approved, online drivers whose vehicle matches the request; an online-payment request is sent only to drivers with a configured Paystack subaccount. Enabling notifications does not enable or change payments.

To configure Web Push:
1. Deploy the repository to Vercel and set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `RIDER_APP_URL` as described above. Push endpoints do not require or read any Paystack credentials.
2. Generate a VAPID key pair locally after installing dependencies with `npm install`: run `npx web-push generate-vapid-keys`. Keep the private key secret; do not commit it.
3. Add these Vercel environment variables:
   - `PUSH_VAPID_PUBLIC_KEY`: the generated public key.
   - `PUSH_VAPID_PRIVATE_KEY`: the generated private key.
   - `PUSH_VAPID_SUBJECT`: a contact URI such as `mailto:your-contact@example.com`.
4. Set `PUSH_API_BASE_URL` in `js/push-config.js` to the origin of this app's Vercel deployment (for example, `https://your-project.vercel.app`, with no path). This is a public URL, not a secret. The VAPID public key is served by the authenticated subscription endpoint.
5. Apply `supabase/migrations/20261110182000_driver_push_subscriptions.sql` to the Supabase project. This migration has not been run as part of the code change.
6. Deploy the static site and Vercel API, then test on HTTPS with an approved driver account: click **Enable push alerts**, grant browser permission, and leave the site or browser closed. Submit a matching request from a separate rider account while the driver is online, then verify the notification opens Driver Trips. Use **Disable push alerts** to revoke that device's subscription.

Push notification delivery depends on the browser and operating system. On iOS/iPadOS, Web Push requires a supported Safari version and the site added to the Home Screen. The `PUSH_API_BASE_URL` value is intentionally blank until the real Vercel deployment origin is known; the opt-in remains disabled until configured. Do not add a CNAME or change the custom domain as part of this setup.

## Mobile experience and motion

- Pages share `css/mobile.css` for touch-sized controls, mobile spacing, safe-area support, and reduced-motion preferences.
- Anime.js 3.2.2 is loaded from jsDelivr for subtle page entrance motion in `js/motion.js`. If the library is unavailable, the page remains usable without the animation.
- Short vibration feedback is requested on touch for buttons and links where the browser supports the Vibration API. iOS Safari and other unsupported browsers may not provide vibration; no extra permission or hardware is assumed.

## Rider and driver accounts

- Riders use `login.html` and `signup.html`. Drivers use `driver/login.html` and `driver/signup.html`; registration collects a phone number, vehicle type, and registration/plate number. The driver portal separates the overview (`driver/dashboard.html`), trip requests and history (`driver/trips.html`), earnings (`driver/earnings.html`), and editable profile (`driver/profile.html`). Keke drivers can accept passenger bookings (up to 4), mini buses up to 6, and bike drivers can accept package deliveries only. New driver accounts must be approved by an Admin before going online.
- Rider and driver profile pages show account-completion steps. Admins can open rider or driver records from the Users and Drivers pages to review profile details, photo, ride totals, and ratings; driver records also include vehicle, status, bank payout details, and completed-ride fare totals. Bank payout details are only readable by the account owner and Admins. The additive migration `supabase/migrations/20261110130000_admin_account_details_and_driver_payout.sql` must be applied manually before deploying this feature; it is not run by the app.
- The Admin portal is at `admin/login.html`. There is no shared/demo Admin password: use an account whose `profiles.role` has been promoted to `admin` by a trusted project owner.
- To provision the first Admin, sign up and confirm an account, then use the SQL promotion command in the Supabase setup steps above. Never expose database credentials or grant Admin access through public signup.
- Riders can update their name, email, phone, and profile photo at `profile.html`; drivers can also edit their vehicle registration at `driver/profile.html`. Photos accept JPG, PNG, or WebP up to 5 MB. They are stored in a private bucket and served to signed-in users through temporary signed URLs.
- After a driver accepts, riders and the assigned driver can exchange messages in a ride-scoped chat while the ride is active. Only the rider and assigned driver can read or send those messages; chat access ends when the ride completes or is cancelled.
- Admins can view registered account names, phone numbers, roles, and registration dates; view ride/driver metrics; filter drivers by pending approval, approved, or suspended; manage locations; and edit a separate zone fare matrix for each vehicle type. The initial keke, mini bus, and bike matrices intentionally use the existing placeholder figures and must be replaced with cost-based prices before launch. The overview is at `admin/dashboard.html`; users, drivers, locations, pricing, and rides each have their own page linked from the Admin navigation. Database authorization is enforced through Supabase RLS and restricted RPC functions.
- Existing local mock data is not automatically migrated to Supabase. Create accounts again through the Supabase-backed signup pages.
