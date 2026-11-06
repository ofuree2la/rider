import {
  getPaymentConfig,
  paymentRedirect,
  serviceRequest,
  verifyPaystackTransaction,
} from "../lib/payments.js";

function redirect(res, config, rideId, result) {
  return res.redirect(303, paymentRedirect(config, rideId, result));
}

export default async function handler(req, res) {
  let config;
  try {
    config = getPaymentConfig();
    if (req.method !== "GET") return res.status(405).send("Method not allowed.");

    const reference = String(req.query.reference ?? "");
    if (!/^[A-Za-z0-9._=-]{6,100}$/.test(reference)) {
      return res.redirect(303, `${config.riderAppUrl}/book.html?payment=invalid`);
    }

    const attemptQuery = new URLSearchParams({
      reference: `eq.${reference}`,
      select: "ride_id,driver_id,amount_kobo,subaccount_code,status",
      limit: "1",
    });
    const attempts = await serviceRequest(`ride_payment_attempts?${attemptQuery}`, config);
    const attempt = attempts[0];
    if (!attempt) return res.redirect(303, `${config.riderAppUrl}/book.html?payment=invalid`);

    const transaction = await verifyPaystackTransaction(reference, config);
    const validPayment =
      transaction?.status === "success" &&
      transaction.reference === reference &&
      transaction.currency === "NGN" &&
      transaction.amount === attempt.amount_kobo;

    const rideQuery = new URLSearchParams({
      id: `eq.${attempt.ride_id}`,
      select: "id,status,payment_status,payment_reference",
      limit: "1",
    });
    const rides = await serviceRequest(`rides?${rideQuery}`, config);
    const ride = rides[0];
    if (!ride) return res.status(404).send("The associated ride could not be found.");

    if (!validPayment) {
      if (transaction?.status === "success") {
        await serviceRequest(
          `ride_payment_attempts?reference=eq.${encodeURIComponent(reference)}&status=eq.pending`,
          config,
          { method: "PATCH", body: { status: "paid_unapplied" } },
        );
        return redirect(res, config, attempt.ride_id, "review");
      }
      if (["failed", "abandoned"].includes(transaction?.status)) {
        await serviceRequest(`ride_payment_attempts?reference=eq.${encodeURIComponent(reference)}&status=eq.pending`, config, {
          method: "PATCH",
          body: { status: "failed" },
        });
        await serviceRequest(
          `rides?id=eq.${attempt.ride_id}&payment_reference=eq.${encodeURIComponent(reference)}&payment_status=eq.pending`,
          config,
          { method: "PATCH", body: { payment_reference: null } },
        );
      }
      return redirect(res, config, attempt.ride_id, "failed");
    }

    const driverQuery = new URLSearchParams({
      profile_id: `eq.${attempt.driver_id}`,
      select: "subaccount_code",
      limit: "1",
    });
    const drivers = await serviceRequest(`drivers?${driverQuery}`, config);
    if (drivers[0]?.subaccount_code !== attempt.subaccount_code) {
      await serviceRequest(
        `ride_payment_attempts?reference=eq.${encodeURIComponent(reference)}&status=in.(pending,paid_unapplied)`,
        config,
        { method: "PATCH", body: { status: "paid_unapplied" } },
      );
      return redirect(res, config, attempt.ride_id, "review");
    }

    if (ride.payment_status === "paid" && ride.payment_reference === reference) {
      await serviceRequest(`ride_payment_attempts?reference=eq.${encodeURIComponent(reference)}&status=in.(pending,paid_unapplied)`, config, {
        method: "PATCH",
        body: { status: "paid" },
      });
      return redirect(res, config, attempt.ride_id, "confirmed");
    }

    if (
      ride.payment_status !== "pending" ||
      ride.payment_reference !== reference ||
      !["accepted", "arriving"].includes(ride.status)
    ) {
      await serviceRequest(`ride_payment_attempts?reference=eq.${encodeURIComponent(reference)}&status=eq.pending`, config, {
        method: "PATCH",
        body: { status: "paid_unapplied" },
      });
      return redirect(res, config, attempt.ride_id, "review");
    }

    const updateQuery = new URLSearchParams({
      id: `eq.${attempt.ride_id}`,
      driver_id: `eq.${attempt.driver_id}`,
      status: "in.(accepted,arriving)",
      payment_method: "eq.online",
      payment_status: "eq.pending",
      payment_reference: `eq.${reference}`,
    });
    const updatedRide = await serviceRequest(`rides?${updateQuery}`, config, {
      method: "PATCH",
      prefer: "return=representation",
      body: { payment_status: "paid" },
    });

    if (!updatedRide?.length) {
      await serviceRequest(`ride_payment_attempts?reference=eq.${encodeURIComponent(reference)}&status=in.(pending,paid_unapplied)`, config, {
        method: "PATCH",
        body: { status: "paid_unapplied" },
      });
      return redirect(res, config, attempt.ride_id, "review");
    }

    await serviceRequest(`ride_payment_attempts?reference=eq.${encodeURIComponent(reference)}&status=in.(pending,paid_unapplied)`, config, {
      method: "PATCH",
      body: { status: "paid" },
    });
    return redirect(res, config, attempt.ride_id, "confirmed");
  } catch (error) {
    console.error("Rider Paystack callback failed:", error);
    if (config) {
      const fallbackUrl = new URL(`${config.riderAppUrl}/book.html`);
      fallbackUrl.searchParams.set("payment", "error");
      return res.redirect(303, fallbackUrl.href);
    }
    return res.status(500).send("Payment verification is temporarily unavailable.");
  }
}
