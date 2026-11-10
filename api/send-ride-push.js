import webpush from "web-push";
import {
  getPushConfig,
  getRideTripsUrl,
  requireRider,
  sendPushError,
  setPushCors,
} from "../lib/push-notifications.js";
import { serviceRequest } from "../lib/payments.js";

function invalidRideId() {
  const error = new Error("A valid ride ID is required.");
  error.status = 400;
  return error;
}

async function removeExpiredSubscription(id, config) {
  await serviceRequest(`driver_push_subscriptions?id=eq.${encodeURIComponent(id)}`, config, {
    method: "DELETE",
  });
}

export default async function handler(req, res) {
  let config;
  try {
    config = getPushConfig();
    if (!setPushCors(req, res, config)) return;
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

    const rider = await requireRider(req, config);
    const rideId = String(req.body?.rideId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(rideId)) {
      throw invalidRideId();
    }

    const rideQuery = new URLSearchParams({
      id: `eq.${rideId}`,
      rider_id: `eq.${rider.id}`,
      status: "eq.finding",
      select: "id,vehicle_type,service_type,payment_method,declined_by",
      limit: "1",
    });
    const rides = await serviceRequest(`rides?${rideQuery}`, config);
    const ride = rides[0];
    if (!ride) {
      return res.status(202).json({ sent: 0 });
    }

    const driverQuery = new URLSearchParams({
      vehicle_type: `eq.${ride.vehicle_type}`,
      status: "eq.approved",
      is_online: "eq.true",
      select: "profile_id,subaccount_code",
    });
    const drivers = await serviceRequest(`drivers?${driverQuery}`, config);
    const declinedDrivers = new Set(ride.declined_by ?? []);
    const matchingDriverIds = drivers
      .filter((driver) =>
        !declinedDrivers.has(driver.profile_id) &&
        (ride.payment_method !== "online" || driver.subaccount_code),
      )
      .map((driver) => driver.profile_id);
    if (matchingDriverIds.length === 0) {
      return res.status(202).json({ sent: 0 });
    }

    const subscriptionsQuery = new URLSearchParams({
      driver_id: `in.(${matchingDriverIds.join(",")})`,
      select: "id,driver_id,endpoint,p256dh,auth",
    });
    const subscriptions = await serviceRequest(
      `driver_push_subscriptions?${subscriptionsQuery}`,
      config,
    );
    if (subscriptions.length === 0) {
      return res.status(202).json({ sent: 0 });
    }

    webpush.setVapidDetails(
      config.vapidSubject,
      config.vapidPublicKey,
      config.vapidPrivateKey,
    );
    const payload = JSON.stringify({
      title: ride.service_type === "delivery" ? "New delivery request" : "New ride request",
      body: ride.service_type === "delivery"
        ? "A matching package delivery is available. Open Rider to review it."
        : "A matching ride is available. Open Rider to review it.",
      tag: `rider-ride-${ride.id}`,
      url: getRideTripsUrl(config),
    });
    const results = await Promise.allSettled(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            payload,
            { TTL: 60, urgency: "high" },
          );
          return true;
        } catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            await removeExpiredSubscription(subscription.id, config);
            return false;
          }
          throw error;
        }
      }),
    );
    const failedCount = results.filter((result) => result.status === "rejected").length;
    if (failedCount > 0) {
      console.error("Some Rider push notifications could not be delivered.", {
        rideId,
        failedCount,
      });
    }
    return res.status(202).json({
      sent: results.filter((result) => result.status === "fulfilled" && result.value).length,
    });
  } catch (error) {
    return sendPushError(res, error);
  }
}
