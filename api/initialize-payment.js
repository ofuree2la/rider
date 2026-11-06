import { randomUUID } from "node:crypto";
import {
  getAuthenticatedUser,
  getPaymentConfig,
  sendError,
  serviceRequest,
  setCors,
} from "../lib/payments.js";

function getRideAmountKobo(ride) {
  const amountNaira = Number(ride.fare?.rideTotal ?? ride.fare?.total);
  const amountKobo = Math.round(amountNaira * 100);
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) {
    throw new Error("This ride has an invalid fare and cannot be paid online.");
  }
  return amountKobo;
}

async function getPendingAttempt(rideId, config) {
  const query = new URLSearchParams({
    ride_id: `eq.${rideId}`,
    status: "eq.pending",
    select: "reference,driver_id,subaccount_code,authorization_url,amount_kobo,created_at",
    order: "created_at.desc",
    limit: "1",
  });
  const attempts = await serviceRequest(`ride_payment_attempts?${query}`, config);
  return attempts[0] ?? null;
}

async function hasUnappliedPayment(rideId, config) {
  const query = new URLSearchParams({
    ride_id: `eq.${rideId}`,
    status: "eq.paid_unapplied",
    select: "reference",
    limit: "1",
  });
  const attempts = await serviceRequest(`ride_payment_attempts?${query}`, config);
  return attempts.length > 0;
}

export default async function handler(req, res) {
  let config;
  try {
    config = getPaymentConfig();
    if (!setCors(req, res, config.riderOrigin)) return;
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

    const user = await getAuthenticatedUser(req, config);
    const profilesQuery = new URLSearchParams({
      id: `eq.${user.id}`,
      select: "id,role",
      limit: "1",
    });
    const profiles = await serviceRequest(`profiles?${profilesQuery}`, config);
    if (profiles[0]?.role !== "rider") {
      return res.status(403).json({ error: "A Rider account is required to pay for this ride." });
    }

    const rideId = String(req.body?.rideId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(rideId)) {
      return res.status(400).json({ error: "A valid ride ID is required." });
    }
    const rideQuery = new URLSearchParams({
      id: `eq.${rideId}`,
      rider_id: `eq.${user.id}`,
      select: "id,rider_id,driver_id,status,fare,payment_method,payment_status,payment_reference",
      limit: "1",
    });
    const rides = await serviceRequest(`rides?${rideQuery}`, config);
    const ride = rides[0];
    if (!ride) return res.status(404).json({ error: "This ride could not be found." });
    if (ride.payment_status === "paid") {
      return res.status(200).json({ paid: true });
    }
    if (ride.payment_method !== "online" || ride.payment_status !== "pending") {
      return res.status(409).json({ error: "This ride is not awaiting online payment." });
    }
    if (!ride.driver_id || !["accepted", "arriving"].includes(ride.status)) {
      return res.status(409).json({ error: "Online payment is available after a driver accepts the ride." });
    }

    const amountKobo = getRideAmountKobo(ride);
    const driverQuery = new URLSearchParams({
      profile_id: `eq.${ride.driver_id}`,
      select: "subaccount_code,status",
      limit: "1",
    });
    const drivers = await serviceRequest(`drivers?${driverQuery}`, config);
    const driver = drivers[0];
    if (driver?.status !== "approved" || !driver.subaccount_code) {
      return res.status(409).json({ error: "This driver is not set up to receive online payments." });
    }
    if (await hasUnappliedPayment(ride.id, config)) {
      return res.status(409).json({ error: "A payment needs support review. Do not make another payment for this ride." });
    }

    let existingAttempt = await getPendingAttempt(ride.id, config);
    if (existingAttempt) {
      const isStale =
        !existingAttempt.authorization_url &&
        Date.now() - new Date(existingAttempt.created_at).getTime() > 120_000;
      const assignmentChanged =
        existingAttempt.driver_id !== ride.driver_id ||
        existingAttempt.subaccount_code !== driver.subaccount_code;
      if (isStale || assignmentChanged) {
        await serviceRequest(
          `ride_payment_attempts?reference=eq.${encodeURIComponent(existingAttempt.reference)}&status=eq.pending`,
          config,
          { method: "PATCH", body: { status: "failed" } },
        );
        await serviceRequest(
          `rides?id=eq.${ride.id}&payment_reference=eq.${encodeURIComponent(existingAttempt.reference)}`,
          config,
          { method: "PATCH", body: { payment_reference: null } },
        );
        existingAttempt = null;
      } else if (existingAttempt.amount_kobo !== amountKobo || !existingAttempt.authorization_url) {
        return res.status(409).json({ error: "A payment attempt is already being prepared. Please try again shortly." });
      } else {
        return res.status(200).json({ authorizationUrl: existingAttempt.authorization_url });
      }
    }

    const reference = `rider_${randomUUID().replace(/-/g, "")}`;
    let attempts;
    try {
      attempts = await serviceRequest("ride_payment_attempts", config, {
        method: "POST",
        prefer: "return=representation",
        body: [{
          ride_id: ride.id,
          driver_id: ride.driver_id,
          reference,
          amount_kobo: amountKobo,
          subaccount_code: driver.subaccount_code,
          status: "pending",
        }],
      });
    } catch (error) {
      if (error.status !== 409) throw error;
      const concurrentAttempt = await getPendingAttempt(ride.id, config);
      if (concurrentAttempt?.authorization_url) {
        return res.status(200).json({ authorizationUrl: concurrentAttempt.authorization_url });
      }
      return res.status(409).json({ error: "A payment attempt is already being prepared. Please try again shortly." });
    }
    if (!attempts?.[0]) {
      throw new Error("The payment attempt could not be created.");
    }

    const rideRefQuery = new URLSearchParams({
      id: `eq.${ride.id}`,
      rider_id: `eq.${user.id}`,
      driver_id: `eq.${ride.driver_id}`,
      status: "in.(accepted,arriving)",
      payment_method: "eq.online",
      payment_status: "eq.pending",
    });
    const updatedRide = await serviceRequest(`rides?${rideRefQuery}`, config, {
      method: "PATCH",
      prefer: "return=representation",
      body: { payment_reference: reference },
    });
    if (!updatedRide?.length) {
      await serviceRequest(`ride_payment_attempts?reference=eq.${encodeURIComponent(reference)}`, config, {
        method: "PATCH",
        body: { status: "failed" },
      });
      return res.status(409).json({ error: "This ride changed and can no longer be paid online." });
    }

    let paystackBody;
    try {
      const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.paystackSecretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: user.email,
          amount: amountKobo,
          currency: "NGN",
          reference,
          subaccount: driver.subaccount_code,
          callback_url: config.paymentCallbackUrl,
          metadata: { rideId: ride.id, driverId: ride.driver_id },
        }),
      });
      paystackBody = await paystackResponse.json();
      if (!paystackResponse.ok || paystackBody?.status !== true || !paystackBody?.data?.authorization_url) {
        throw new Error("Paystack could not initialize checkout.");
      }
    } catch (error) {
      await serviceRequest(`ride_payment_attempts?reference=eq.${encodeURIComponent(reference)}`, config, {
        method: "PATCH",
        body: { status: "failed" },
      });
      await serviceRequest(`rides?id=eq.${ride.id}&payment_reference=eq.${encodeURIComponent(reference)}`, config, {
        method: "PATCH",
        body: { payment_reference: null },
      });
      throw error;
    }

    await serviceRequest(`ride_payment_attempts?reference=eq.${encodeURIComponent(reference)}`, config, {
      method: "PATCH",
      body: { authorization_url: paystackBody.data.authorization_url },
    });
    return res.status(200).json({ authorizationUrl: paystackBody.data.authorization_url });
  } catch (error) {
    return sendError(res, error);
  }
}
