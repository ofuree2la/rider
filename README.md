# Rider

Rider is a front-end prototype for campus keke bookings at Veritas University, Abuja.

## Run locally

Open `index.html` in a browser. The booking screen is available from the **Book a Ride** button on the landing page.

## Prototype status

This version uses static demo content and browser storage rather than a booking database. The map and fare shown on the booking screen are illustrative. Paystack checkout must be configured as described below before online payments can be used.

## Online payments (Paystack)

Choose **Pay online** on the booking screen. After a driver is matched, **Pay now** opens Paystack checkout with the driver's subaccount, so Paystack splits the fare automatically (the percentages are set on the subaccount in the Paystack dashboard).

Setup:
1. Put your Paystack **public** key in `js/paystack-config.js`.
2. Give each driver a `subaccountCode` in `js/mockData.js`.
3. Deploy `api/verify-payment.js` (for example on Vercel) with the environment variable `PAYSTACK_SECRET_KEY`, then put its URL in `js/paystack-config.js`.

Never put the secret key (`sk_...`) in any website file.

## Separate student and driver accounts

- Students use `login.html` and `signup.html`; student sign-up creates a student account and sends the user to booking.
- Drivers use `driver/login.html` and `driver/signup.html`; driver registration also collects a phone number and keke plate number, then opens the driver dashboard.
- The prototype stores accounts and driver profiles in localStorage. Newly registered drivers receive immediate demo access and are marked verified for the prototype only. This is not a real identity or vehicle verification process.
- The seeded demo driver can sign in with `driver@rider.demo` and `RiderDemo123!`. Use a different email when testing driver registration.
- This client-side account system is for demonstrations only; it is not suitable for real authentication or storing real passwords.
