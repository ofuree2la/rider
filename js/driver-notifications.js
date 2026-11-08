import { getCurrentDriver, getCurrentUser, getDriverRideRequests } from "./supabase-api.js";
import { supabase } from "./supabase-client.js";

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

if (!siteHeader) {
  throw new Error("The driver page is missing its site header.");
}

siteHeader.insertAdjacentElement("afterend", notificationBanner);

let driver = null;
let channel = null;
let refreshTimer = null;
let refreshIntervalMs = 0;
let requestListObserver = null;
let isRefreshRunning = false;
let refreshRequested = false;
let previousRequestIds = null;

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
      refreshRequests();
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

async function startNotifications() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "driver") {
      return;
    }

    driver = await getCurrentDriver();
    await refreshRequests();
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

    const requestList = document.querySelector("#request-list");
    if (requestList) {
      requestListObserver = new MutationObserver(scheduleNextRefresh);
      requestListObserver.observe(requestList, { childList: true, subtree: true });
    }
    await refreshRequests();
    document.addEventListener("visibilitychange", refreshRequests);
    window.addEventListener("pagehide", stopNotifications, { once: true });
  } catch (error) {
    showNotificationError(`Ride notifications could not be started: ${error.message}`);
    console.error("Driver ride notifications could not be started.", error);
  }
}

function stopNotifications() {
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  refreshIntervalMs = 0;
  document.removeEventListener("visibilitychange", refreshRequests);
  requestListObserver?.disconnect();
  requestListObserver = null;
  if (channel) {
    supabase.removeChannel(channel);
  }
}

startNotifications();
