import { supabase } from "./supabase-client.js";
import { isOnlinePaymentConfigured, PAYMENT_API_BASE_URL } from "./paystack-config.js";

export { isOnlinePaymentConfigured };

export async function initializeRidePayment(rideId) {
  if (!isOnlinePaymentConfigured()) {
    throw new Error("Online payments are not configured yet. Please choose cash or contact Rider support.");
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error(error.message || "Your session could not be checked.");
  }
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error("Sign in again before paying for this ride.");
  }

  const response = await fetch(`${PAYMENT_API_BASE_URL}/api/initialize-payment`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ rideId }),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The payment service returned an unreadable response. Please try again.");
  }
  if (!response.ok) {
    throw new Error(result.error || "Paystack checkout could not be started.");
  }
  if (result.paid === true) {
    return { paid: true };
  }
  if (typeof result.authorizationUrl !== "string") {
    throw new Error("The payment service returned an invalid checkout link.");
  }
  return { authorizationUrl: result.authorizationUrl, paid: false };
}
