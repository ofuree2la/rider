const TRANSITION_ALLOWED_ORIGINS = new Set([
  "https://ofuree2la.github.io",
  "https://getrider.ng",
  "https://www.getrider.ng",
]);

export function getPaymentConfig() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PAYSTACK_SECRET_KEY, RIDER_APP_URL, PAYMENT_CALLBACK_URL } =
    process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !PAYSTACK_SECRET_KEY || !RIDER_APP_URL || !PAYMENT_CALLBACK_URL) {
    throw new Error("Payment service configuration is incomplete.");
  }

  const appUrl = new URL(RIDER_APP_URL);
  if (appUrl.protocol !== "https:" && appUrl.hostname !== "localhost") {
    throw new Error("RIDER_APP_URL must use HTTPS.");
  }
  const callbackUrl = new URL(PAYMENT_CALLBACK_URL);
  if (
    callbackUrl.protocol !== "https:" ||
    !callbackUrl.pathname.endsWith("/api/verify-payment")
  ) {
    throw new Error("PAYMENT_CALLBACK_URL must be an HTTPS payment verification endpoint.");
  }

  return {
    supabaseUrl: SUPABASE_URL.replace(/\/+$/, ""),
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    paystackSecretKey: PAYSTACK_SECRET_KEY,
    riderAppUrl: appUrl.href.replace(/\/+$/, ""),
    riderOrigin: appUrl.origin,
    paymentCallbackUrl: PAYMENT_CALLBACK_URL,
  };
}

export function setCors(req, res, riderOrigin, allowedMethods = "POST, OPTIONS") {
  const origin = req.headers.origin;
  if (origin && origin !== riderOrigin && !TRANSITION_ALLOWED_ORIGINS.has(origin)) {
    res.status(403).json({ error: "This origin is not allowed." });
    return false;
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", allowedMethods);
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  return true;
}

export async function getAuthenticatedUser(req, config) {
  const authorization = req.headers.authorization ?? "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    const error = new Error("Sign in to continue.");
    error.status = 401;
    throw error;
  }

  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    const error = new Error("Your session has expired. Sign in again.");
    error.status = 401;
    throw error;
  }
  return response.json();
}

export async function serviceRequest(path, config, options = {}) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    method: options.method ?? "GET",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(options.prefer ? { Prefer: options.prefer } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const responseText = response.status === 204 ? "" : await response.text();
  let responseBody = null;
  if (responseText) {
    try {
      responseBody = JSON.parse(responseText);
    } catch (cause) {
      const error = new Error(
        `Supabase request to ${path} returned invalid JSON (HTTP ${response.status}).`,
        { cause },
      );
      error.status = 502;
      throw error;
    }
  } else if (
    response.status !== 204 &&
    (options.method ?? "GET") === "GET"
  ) {
    const error = new Error(
      `Supabase request to ${path} returned an empty response (HTTP ${response.status}).`,
    );
    error.status = response.ok ? 502 : response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(responseBody?.message ?? "The payment service could not update the ride.");
    error.status = response.status;
    throw error;
  }
  return responseBody;
}

export async function verifyPaystackTransaction(reference, config) {
  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${config.paystackSecretKey}` } },
  );
  const body = await response.json();
  if (!response.ok || body?.status !== true) {
    throw new Error("Paystack could not verify this transaction.");
  }
  return body.data;
}

export function paymentRedirect(config, rideId, result) {
  const url = new URL(`${config.riderAppUrl}/tracking.html`);
  url.searchParams.set("id", rideId);
  url.searchParams.set("payment", result);
  return url.href;
}

export function sendError(res, error) {
  console.error("Rider payment request failed:", error);
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const clientMessage = status >= 500 ? "The payment service is temporarily unavailable. Please try again." : error.message;
  return res.status(status).json({ error: clientMessage });
}
