// Set this to the deployed Vercel project origin, without a trailing slash.
// The API remains disabled until its URL and server-side secrets are configured.
export const PAYMENT_API_BASE_URL = "";

export function isOnlinePaymentConfigured() {
  try {
    const url = new URL(PAYMENT_API_BASE_URL);
    return (
      url.protocol === "https:" &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.hostname.includes("your-vercel-project")
    );
  } catch {
    return false;
  }
}
