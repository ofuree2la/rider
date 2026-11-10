import { PUSH_API_BASE_URL } from "./push-config.js";
import { supabase } from "./supabase-client.js";

function getApiUrl(path) {
  if (!PUSH_API_BASE_URL) {
    throw new Error("Push alerts are not configured yet.");
  }
  const baseUrl = new URL(PUSH_API_BASE_URL);
  if (
    (baseUrl.protocol !== "https:" && baseUrl.hostname !== "localhost") ||
    baseUrl.pathname !== "/" ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error("The push API address must be an HTTPS origin.");
  }
  return new URL(`/api/${path}`, baseUrl);
}

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  if (!data.session?.access_token) {
    throw new Error("Sign in again to manage push alerts.");
  }
  return data.session.access_token;
}

async function pushApiRequest(path, method = "GET", body) {
  const accessToken = await getAccessToken();
  const response = await fetch(getApiUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    let message = "Push alerts could not be updated.";
    try {
      message = (await response.json()).error || message;
    } catch (error) {
      console.error("The push API returned an unreadable error response.", error);
    }
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

function decodeVapidKey(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function setPushMessage(element, message, isError = false) {
  element.textContent = message;
  element.dataset.state = isError ? "error" : "info";
}

export async function notifyDriversOfNewRide(rideId) {
  if (!PUSH_API_BASE_URL) {
    return;
  }
  try {
    await pushApiRequest("send-ride-push", "POST", { rideId });
  } catch (error) {
    console.error("Driver push alerts could not be sent; the in-app alert remains available.", error);
  }
}

export async function initializeDriverPushNotifications(driver) {
  const button = document.querySelector("#driver-push-toggle");
  const message = document.querySelector("#driver-push-status");
  if (!button || !message) {
    return;
  }

  if (!PUSH_API_BASE_URL) {
    button.disabled = true;
    setPushMessage(message, "Push alerts are not configured yet. In-app alerts remain available.");
    return;
  }
  if (
    !window.isSecureContext ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    button.disabled = true;
    setPushMessage(message, "This browser does not support secure push alerts.");
    return;
  }
  if (driver.status !== "approved") {
    button.disabled = true;
    setPushMessage(message, "Push alerts are available after your driver account is approved.");
    return;
  }

  const serviceWorkerScope = new URL("../", import.meta.url).pathname;
  let localSubscribed = false;
  try {
    const state = await pushApiRequest("push-subscriptions");
    const serverSubscribed = state.subscribed;
    const registration = await navigator.serviceWorker.getRegistration(serviceWorkerScope);
    const subscription = await registration?.pushManager.getSubscription();
    localSubscribed = Boolean(subscription) && serverSubscribed;
    button.textContent = localSubscribed ? "Disable push alerts" : "Enable push alerts";
    setPushMessage(
      message,
      localSubscribed
        ? "Push alerts are enabled on this device."
        : serverSubscribed
          ? "Push alerts are enabled on another device. Enable them here too."
          : "Get notified about matching ride requests.",
    );
    if (Notification.permission === "denied" && !serverSubscribed) {
      setPushMessage(message, "Notifications are blocked in browser settings. Allow them there to enable push alerts.");
    }
  } catch (error) {
    button.disabled = true;
    setPushMessage(message, error.message, true);
    return;
  }

  button.addEventListener("click", async () => {
    if (button.disabled) {
      return;
    }
    button.disabled = true;
    try {
      if (localSubscribed) {
        const registration = await navigator.serviceWorker.getRegistration(
          serviceWorkerScope,
        );
        const subscription = await registration?.pushManager.getSubscription();
        if (!subscription) {
          localSubscribed = false;
          button.textContent = "Enable push alerts";
          setPushMessage(message, "This device no longer has an active push subscription.");
          return;
        }
        await pushApiRequest("push-subscriptions", "DELETE", {
          subscription: subscription.toJSON(),
        });
        await subscription.unsubscribe();
        localSubscribed = false;
        button.textContent = "Enable push alerts";
        setPushMessage(message, "Push alerts are disabled on this device.");
        return;
      }

      const permission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission !== "granted") {
        setPushMessage(
          message,
          permission === "denied"
            ? "Notifications are blocked in browser settings. Allow them there to enable push alerts."
            : "Notification permission was not granted.",
          true,
        );
        return;
      }

      const state = await pushApiRequest("push-subscriptions");
      const workerUrl = new URL("../service-worker.js", import.meta.url);
      const registration = await navigator.serviceWorker.register(workerUrl, {
        scope: serviceWorkerScope,
      });
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(state.publicKey),
        });
      }
      await pushApiRequest("push-subscriptions", "POST", {
        subscription: subscription.toJSON(),
      });
      localSubscribed = true;
      button.textContent = "Disable push alerts";
      setPushMessage(message, "Push alerts are enabled on this device.");
    } catch (error) {
      setPushMessage(message, error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}
