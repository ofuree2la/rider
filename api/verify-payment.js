// Vercel serverless function: confirms a Paystack payment is real.
//
// Setup: deploy this folder to Vercel and add an environment variable named
// PAYSTACK_SECRET_KEY (your sk_live_... key). Never put that key in website code.
//
// Call: GET /api/verify-payment?reference=RIDER-...&amount=50000   (amount in kobo)

const ALLOWED_ORIGIN = "https://ofuree2la.github.io";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ verified: false, error: "Method not allowed" });
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ verified: false, error: "Server is missing PAYSTACK_SECRET_KEY" });
  }

  const reference = String(req.query.reference ?? "");
  const expectedAmount = Number(req.query.amount);
  if (!/^[A-Za-z0-9._=-]{6,100}$/.test(reference) || !Number.isInteger(expectedAmount)) {
    return res.status(400).json({ verified: false, error: "Invalid reference or amount" });
  }

  try {
    const paystackResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    );
    const body = await paystackResponse.json();
    const transaction = body?.data;

    const verified =
      paystackResponse.ok &&
      body.status === true &&
      transaction?.status === "success" &&
      transaction?.currency === "NGN" &&
      transaction?.amount === expectedAmount;

    return res.status(200).json({ verified, reference });
  } catch (error) {
    return res.status(502).json({ verified: false, error: "Could not reach Paystack" });
  }
}
