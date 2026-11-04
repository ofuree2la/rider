// Paystack settings for Rider.
//
// PUBLIC key only. It is safe to keep in website code. NEVER put your secret
// key (sk_live_...) in any file on this site. The secret key lives only in the
// server function under /api as an environment variable.
export const PAYSTACK_PUBLIC_KEY = "pk_live_55d13f10e21fd44510006e63850d93dfd9b1bae4";

// Address of the deployed verify-payment function (see api/verify-payment.js),
// for example "https://rider-api.vercel.app/api/verify-payment".
// While this is empty, online payments still work but stay marked "unverified".
export const VERIFY_PAYMENT_URL = "";
