# Rider

Rider is a front-end prototype for campus keke bookings at Veritas University, Abuja.

## Run locally

Open `index.html` in a browser. The booking screen is available from the **Book a Ride** button on the landing page.

## Prototype status

This version uses static demo content and browser storage rather than a booking database. The map and fare shown on the booking screen are illustrative. Paystack checkout must be configured as described below before online payments can be used.

## Mobile experience and motion

- Pages share `css/mobile.css` for touch-sized controls, mobile spacing, safe-area support, and reduced-motion preferences.
- Anime.js 3.2.2 is loaded from jsDelivr for subtle page entrance motion in `js/motion.js`. If the library is unavailable, the page remains usable without the animation.
- Short vibration feedback is requested on touch for buttons and links where the browser supports the Vibration API. iOS Safari and other unsupported browsers may not provide vibration; no extra permission or hardware is assumed.

## Online payments (Paystack)

Choose **Pay online** on the booking screen. After a driver is matched, **Pay now** opens Paystack checkout with the driver's subaccount, so Paystack splits the fare automatically (the percentages are set on the subaccount in the Paystack dashboard).

Setup:
1. Put your Paystack **public** key in `js/paystack-config.js`.
2. Give each driver a `subaccountCode` in `js/mockData.js`.
3. Deploy `api/verify-payment.js` (for example on Vercel) with the environment variable `PAYSTACK_SECRET_KEY`, then put its URL in `js/paystack-config.js`.

Never put the secret key (`sk_...`) in any website file.

## Rider and driver accounts

- Riders use `login.html` and `signup.html`; rider sign-up creates a rider account and sends the user to booking.
- Drivers use `driver/login.html` and `driver/signup.html`; driver registration also collects a phone number and keke plate number, then opens the driver dashboard.
- The Admin portal is at `admin/login.html`. The demo account is `admin@rider.demo` with password `RiderAdmin123!`.
- Riders can update their name, email, and phone number at `profile.html`. Drivers can also edit their keke plate number at `driver/profile.html`.
- The prototype stores accounts, rides, locations, and fare settings in localStorage. New driver accounts start pending and must be approved in the Admin portal before going online or accepting requests. Approval is only a local demo state and does not verify driver documents or vehicle ownership.
- Admins can view overview metrics and rides, approve or suspend drivers, manage locations, and edit the zone fare matrix. Location and fare changes affect new booking estimates in the same browser.
- Existing local non-driver accounts are migrated to the general `rider` role when the mock API reads them.
- The seeded demo rider can sign in with `rider@rider.demo` and `RiderDemo123!`; the seeded demo driver can sign in with `driver@rider.demo` and `RiderDemo123!`. Use a different email when testing registration.
- Admin authorization and all data are client-side and stored in localStorage. This portal is for demonstrations only; it is not suitable for real access control, authentication, or storing real passwords.
