import { getCurrentDriver, getCurrentUser, getDriverRideRequests } from "./supabase-api.js";
import { supabase } from "./supabase-client.js";

const MODULE_GUARD = Symbol.for("rider.driver-notifications");
const AVAILABILITY_STORAGE_KEY = "rider:driver-availability";
const isFirstModuleInstance = !window[MODULE_GUARD];
if (isFirstModuleInstance) {
  window[MODULE_GUARD] = true;
}

const REFRESH_INTERVAL_MS = 45_000;
const ACTIVE_REQUEST_REFRESH_INTERVAL_MS = 12_000;
const siteHeader = document.querySelector(".site-header");
const pageTitle = document.title;
const notificationBanner = document.createElement("aside");
const notificationMessage = document.createElement("span");
const notificationLink = document.createElement("a");

notificationBanner.className = "driver-request-notification";
notificationBanner.setAttribute("role", "status");
notificationBanner.setAttribute("aria-live", "polite");
notificationBanner.hidden = true;
notificationLink.href = "trips.html";
notificationLink.textContent = "View Trips";
notificationBanner.append(notificationMessage, notificationLink);

if (isFirstModuleInstance && !siteHeader) {
  throw new Error("The driver page is missing its site header.");
}

if (isFirstModuleInstance) {
  siteHeader.insertAdjacentElement("afterend", notificationBanner);
}

let driver = null;
let channel = null;
let refreshTimer = null;
let refreshIntervalMs = 0;
let requestListObserver = null;
let isRefreshRunning = false;
let refreshRequested = false;
let previousRequestIds = null;
let isOnline = false;
let authStateSubscription = null;

function renderRequestCount(requests) {
  const requestCount = requests.length;
  const requestWord = requestCount === 1 ? "request" : "requests";

  if (requestCount > 0) {
    notificationMessage.textContent = `You have ${requestCount} matching ride ${requestWord}.`;
    notificationBanner.hidden = false;
    document.title = `(${requestCount}) ${pageTitle}`;
  } else {
    notificationBanner.hidden = true;
    document.title = pageTitle;
  }

  const pendingCount = document.querySelector("#pending-count");
  if (pendingCount) {
    pendingCount.textContent = String(requestCount);
  }
}

function showNotificationError(message) {
  notificationBanner.classList.add("is-error");
  notificationMessage.textContent = message;
  notificationBanner.hidden = false;
}

async function refreshRequests() {
  if (!isOnline) {
    return;
  }
  if (isRefreshRunning) {
    refreshRequested = true;
    return;
  }
  if (document.visibilityState !== "visible") {
    return;
  }

  isRefreshRunning = true;
  try {
    const requests = await getDriverRideRequests(driver.id);
    if (!isOnline) {
      return;
    }
    const requestIds = requests.map((request) => request.id).sort();
    const requestsChanged =
      previousRequestIds !== null &&
      (requestIds.length !== previousRequestIds.length ||
        requestIds.some((requestId, index) => requestId !== previousRequestIds[index]));

    previousRequestIds = requestIds;
    notificationBanner.classList.remove("is-error");
    renderRequestCount(requests);

    if (requestsChanged) {
      document.dispatchEvent(new CustomEvent("driver-ride-requests-updated", {
        detail: { requestIds },
      }));
    }
  } catch (error) {
    showNotificationError(`Ride requests could not be checked: ${error.message}`);
    console.error("Driver ride notifications could not be refreshed.", error);
  } finally {
    isRefreshRunning = false;
    if (refreshRequested) {
      refreshRequested = false;
      if (isOnline) {
        refreshRequests();
      }
    } else {
      scheduleNextRefresh();
    }
  }
}

function getRefreshInterval() {
  const requestList = document.querySelector("#request-list");
  const hasVisibleRequestCard = requestList &&
    [...requestList.querySelectorAll(".request-card[data-ride-id]")]
      .some((card) => card.isConnected && !card.hidden && card.getClientRects().length > 0);
  return hasVisibleRequestCard
    ? ACTIVE_REQUEST_REFRESH_INTERVAL_MS
    : REFRESH_INTERVAL_MS;
}

function scheduleNextRefresh() {
  if (!isOnline) {
    return;
  }
  const nextInterval = getRefreshInterval();
  if (refreshTimer !== null && refreshIntervalMs === nextInterval) {
    return;
  }
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
  }
  refreshIntervalMs = nextInterval;
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    refreshIntervalMs = 0;
    refreshRequests();
  }, nextInterval);
}

function handleRideChange() {
  refreshRequests();
}

function handleRealtimeStatus(status, error) {
  if (!isOnline) {
    return;
  }
  if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
    showNotificationError("Live ride alerts are unavailable. We’ll keep checking for requests.");
    if (error) {
      console.error("Driver ride notification channel error.", error);
    }
    return;
  }

  if (status === "SUBSCRIBED") {
    refreshRequests();
  }
}

function stopRefreshTimer() {
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  refreshIntervalMs = 0;
}

function stopRealtimeChannel() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
}

function startRealtimeChannel() {
  if (!isOnline || channel) {
    return;
  }

  channel = supabase
    .channel(`driver-ride-requests:${driver.id}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "rides",
        filter: "status=eq.finding",
      },
      handleRideChange,
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "rides",
      },
      handleRideChange,
    )
    .subscribe(handleRealtimeStatus);
}

function setOnlineState(nextOnlineState, forceNotify = false) {
  if (isOnline === nextOnlineState && !forceNotify) {
    return;
  }

  isOnline = nextOnlineState;
  document.dispatchEvent(new CustomEvent("driver-availability-state-changed", {
    detail: { isOnline },
  }));

  if (!isOnline) {
    stopRefreshTimer();
    stopRealtimeChannel();
    previousRequestIds = null;
    renderRequestCount([]);
    return;
  }

  startRealtimeChannel();
  refreshRequests();
}

function handleAvailabilityChange(event) {
  setOnlineState(Boolean(event.detail?.isOnline));
}

function handleAvailabilityStorage(event) {
  if (!event.newValue || !driver) {
    return;
  }
  try {
    const update = JSON.parse(event.newValue);
    if (update.driverId === driver.id && typeof update.isOnline === "boolean") {
      setOnlineState(update.isOnline);
    }
  } catch (error) {
    console.error("Driver availability update from another tab could not be read.", error);
  }
}

async function startNotifications() {
  if (!isFirstModuleInstance) {
    return;
  }
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "driver") {
      return;
    }

    driver = await getCurrentDriver();
    const requestList = document.querySelector("#request-list");
    if (requestList) {
      requestListObserver = new MutationObserver(scheduleNextRefresh);
      requestListObserver.observe(requestList, { childList: true, subtree: true });
    }
    document.addEventListener("driver-availability-change", handleAvailabilityChange);
    window.addEventListener("storage", handleAvailabilityStorage);
    document.addEventListener("visibilitychange", refreshRequests);
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        document.dispatchEvent(new Event("driver-session-ended"));
        stopNotifications();
      }
    });
    authStateSubscription = data.subscription;
    setOnlineState(Boolean(driver.isOnline && driver.status === "approved"), true);
    window.addEventListener("pagehide", stopNotifications, { once: true });
  } catch (error) {
    showNotificationError(`Ride notifications could not be started: ${error.message}`);
    console.error("Driver ride notifications could not be started.", error);
  }
}

function stopNotifications() {
  isOnline = false;
  stopRefreshTimer();
  document.removeEventListener("visibilitychange", refreshRequests);
  document.removeEventListener("driver-availability-change", handleAvailabilityChange);
  window.removeEventListener("storage", handleAvailabilityStorage);
  requestListObserver?.disconnect();
  requestListObserver = null;
  stopRealtimeChannel();
  if (authStateSubscription) {
    authStateSubscription.unsubscribe();
    authStateSubscription = null;
  }
}

if (isFirstModuleInstance) {
  startNotifications();
}
