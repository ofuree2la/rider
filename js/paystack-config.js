// Payment API origin. Secret keys remain server-side in Vercel environment variables.
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
