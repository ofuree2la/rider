import {
  getPushConfig,
  requireDriver,
  sendPushError,
  setPushCors,
} from "../lib/push-notifications.js";
import { serviceRequest } from "../lib/payments.js";

const PUSH_ENDPOINT_HOSTS = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];

function isAllowedPushEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    return false;
  }
  return endpoint.protocol === "https:" &&
    !endpoint.username &&
    !endpoint.password &&
    (!endpoint.port || endpoint.port === "443") &&
    PUSH_ENDPOINT_HOSTS.some((host) =>
      endpoint.hostname === host || endpoint.hostname.endsWith(`.${host}`),
    );
}

function isBase64Url(value, minLength, maxLength) {
  return typeof value === "string" &&
    value.length >= minLength &&
    value.length <= maxLength &&
    /^[A-Za-z0-9_-]+$/.test(value);
}

function validateSubscription(input) {
  const endpoint = input?.endpoint;
  const p256dh = input?.keys?.p256dh;
  const auth = input?.keys?.auth;
  if (
    typeof endpoint !== "string" ||
    endpoint.length > 2048 ||
    !isAllowedPushEndpoint(endpoint) ||
    !isBase64Url(p256dh, 80, 200) ||
    !isBase64Url(auth, 16, 100)
  ) {
    const error = new Error("The browser push subscription is invalid.");
    error.status = 400;
    throw error;
  }
  return { endpoint, p256dh, auth };
}

export default async function handler(req, res) {
  let config;
  try {
    config = getPushConfig();
    if (!setPushCors(req, res, config)) return;
    if (req.method === "OPTIONS") return res.status(204).end();

    const driver = await requireDriver(req, config);
    if (req.method === "GET") {
      res.setHeader("Cache-Control", "no-store");
      const query = new URLSearchParams({
        driver_id: `eq.${driver.id}`,
        select: "id",
        limit: "1",
      });
      const subscriptions = await serviceRequest(`driver_push_subscriptions?${query}`, config);
      return res.status(200).json({
        publicKey: config.vapidPublicKey,
        subscribed: subscriptions.length > 0,
      });
    }

    if (req.method !== "POST" && req.method !== "DELETE") {
      return res.status(405).json({ error: "Method not allowed." });
    }

    const subscription = validateSubscription(req.body?.subscription);
    const endpointQuery = new URLSearchParams({
      endpoint: `eq.${subscription.endpoint}`,
      select: "id,driver_id",
      limit: "1",
    });
    const existingRows = await serviceRequest(
      `driver_push_subscriptions?${endpointQuery}`,
      config,
    );
    const existing = existingRows[0];
    if (existing && existing.driver_id !== driver.id) {
      return res.status(409).json({ error: "This push subscription belongs to another account." });
    }

    if (req.method === "DELETE") {
      if (existing) {
        await serviceRequest(
          `driver_push_subscriptions?id=eq.${encodeURIComponent(existing.id)}&driver_id=eq.${encodeURIComponent(driver.id)}`,
          config,
          { method: "DELETE" },
        );
      }
      return res.status(204).end();
    }

    if (existing) {
      await serviceRequest(
        `driver_push_subscriptions?id=eq.${encodeURIComponent(existing.id)}&driver_id=eq.${encodeURIComponent(driver.id)}`,
        config,
        {
          method: "PATCH",
          body: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
            updated_at: new Date().toISOString(),
          },
        },
      );
    } else {
      await serviceRequest("driver_push_subscriptions", config, {
        method: "POST",
        body: [{
          driver_id: driver.id,
          ...subscription,
        }],
      });
    }
    return res.status(204).end();
  } catch (error) {
    return sendPushError(res, error);
  }
}
