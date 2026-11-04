import { PAYSTACK_PUBLIC_KEY, VERIFY_PAYMENT_URL } from "./paystack-config.js";

const PAYSTACK_SCRIPT = "https://js.paystack.co/v2/inline.js";
let scriptPromise = null;

function loadPaystack() {
  if (globalThis.PaystackPop) {
    return Promise.resolve();
  }
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = PAYSTACK_SCRIPT;
      script.onload = resolve;
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error("Could not load Paystack. Check your internet connection and try again."));
      };
      document.head.append(script);
    });
  }
  return scriptPromise;
}

export function makePaymentReference(rideId) {
  const safeId = String(rideId).replace(/[^a-zA-Z0-9]/g, "").slice(-12);
  return `RIDER-${safeId}-${Date.now()}`;
}

// Opens Paystack checkout. The driver's subaccount code makes Paystack split the
// payment automatically (the share is set on the subaccount in the dashboard).
export async function payForRide({ email, amountNaira, subaccountCode, reference, metadata }) {
  if (!PAYSTACK_PUBLIC_KEY || PAYSTACK_PUBLIC_KEY.includes("REPLACE")) {
    throw new Error("Online payment is not set up yet: add your Paystack public key in js/paystack-config.js.");
  }
  if (!subaccountCode) {
    throw new Error("This driver cannot receive online payments yet.");
  }

  await loadPaystack();

  return new Promise((resolve, reject) => {
    const popup = new globalThis.PaystackPop();
    popup.newTransaction({
      key: PAYSTACK_PUBLIC_KEY,
      email,
      amount: Math.round(amountNaira * 100), // Paystack counts in kobo
      currency: "NGN",
      ref: reference,
      subaccount: subaccountCode,
      metadata,
      onSuccess: (transaction) => resolve({ reference: transaction.reference ?? reference }),
      onCancel: () => reject(new Error("Payment was cancelled. You can try again.")),
      onError: (error) => reject(new Error(error?.message || "Payment failed. Please try again.")),
    });
  });
}

// Asks your server to confirm with Paystack that the payment really happened
// and that the amount was right. Returns { verified, checked }.
export async function verifyPayment(reference, amountNaira) {
  if (!VERIFY_PAYMENT_URL) {
    return { verified: false, checked: false };
  }

  const url = new URL(VERIFY_PAYMENT_URL);
  url.searchParams.set("reference", reference);
  url.searchParams.set("amount", String(Math.round(amountNaira * 100)));

  const response = await fetch(url);
  if (!response.ok) {
    return { verified: false, checked: true };
  }
  const result = await response.json();
  return { verified: result.verified === true, checked: true };
}
