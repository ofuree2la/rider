import {
  getAuthenticatedUser,
  serviceRequest,
  setCors,
} from "./payments.js";

export function getPushConfig() {
  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    RIDER_APP_URL,
    PUSH_VAPID_PUBLIC_KEY,
    PUSH_VAPID_PRIVATE_KEY,
    PUSH_VAPID_SUBJECT,
  } = process.env;
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !RIDER_APP_URL ||
    !PUSH_VAPID_PUBLIC_KEY ||
    !PUSH_VAPID_PRIVATE_KEY ||
    !PUSH_VAPID_SUBJECT
  ) {
    throw new Error("Push notification service configuration is incomplete.");
  }

  const appUrl = new URL(RIDER_APP_URL);
  if (appUrl.protocol !== "https:" && appUrl.hostname !== "localhost") {
    throw new Error("RIDER_APP_URL must use HTTPS.");
  }

  return {
    supabaseUrl: SUPABASE_URL.replace(/\/+$/, ""),
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    riderAppUrl: appUrl.href.replace(/\/+$/, "") + "/",
    riderOrigin: appUrl.origin,
    vapidPublicKey: PUSH_VAPID_PUBLIC_KEY,
    vapidPrivateKey: PUSH_VAPID_PRIVATE_KEY,
    vapidSubject: PUSH_VAPID_SUBJECT,
  };
}

export async function requireDriver(req, config) {
  const user = await getAuthenticatedUser(req, config);
  const profileQuery = new URLSearchParams({
    id: `eq.${user.id}`,
    select: "id,role",
    limit: "1",
  });
  const profiles = await serviceRequest(`profiles?${profileQuery}`, config);
  if (profiles[0]?.role !== "driver") {
    const error = new Error("A Driver account is required.");
    error.status = 403;
    throw error;
  }

  const driverQuery = new URLSearchParams({
    profile_id: `eq.${user.id}`,
    select: "status",
    limit: "1",
  });
  const drivers = await serviceRequest(`drivers?${driverQuery}`, config);
  if (drivers[0]?.status !== "approved") {
    const error = new Error("An approved Driver account is required.");
    error.status = 403;
    throw error;
  }
  return user;
}

export async function requireRider(req, config) {
  const user = await getAuthenticatedUser(req, config);
  const profileQuery = new URLSearchParams({
    id: `eq.${user.id}`,
    select: "id,role",
    limit: "1",
  });
  const profiles = await serviceRequest(`profiles?${profileQuery}`, config);
  if (profiles[0]?.role !== "rider") {
    const error = new Error("A Rider account is required.");
    error.status = 403;
    throw error;
  }
  return user;
}

export function setPushCors(req, res, config) {
  return setCors(req, res, config.riderOrigin, "GET, POST, DELETE, OPTIONS");
}

export function getRideTripsUrl(config) {
  return new URL("driver/trips.html", config.riderAppUrl).href;
}

export function sendPushError(res, error) {
  console.error("Rider push notification request failed:", error);
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const message = status >= 500
    ? "Push notifications are temporarily unavailable."
    : error.message;
  return res.status(status).json({ error: message });
}
