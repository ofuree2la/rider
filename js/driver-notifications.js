import "./notifications.js";
import { getCurrentDriver, getCurrentUser, getDriverRideRequests } from "./supabase-api.js";
import { supabase } from "./supabase-client.js";

const MODULE_GUARD = Symbol.for("rider.driver-notifications");
const AVAILABILITY_STORAGE_KEY = "rider:driver-availability";
const ALERT_CLAIM_KEY_PREFIX = "rider:driver-request-alert:";
const isFirstModuleInstance = !window[MODULE_GUARD];
if (isFirstModuleInstance) {
  window[MODULE_GUARD] = true;
}

const REFRESH_INTERVAL_MS = 45_000;
const ACTIVE_REQUEST_REFRESH_INTERVAL_MS = 12_000;
const REQUEST_LIFETIME_MS = 30_000;
const REQUEST_ALERT_BELL = {
  // Raise/lower the bell by changing the base and partial frequencies.
  partials: [
    { frequencyHz: 880, level: 0.5, decaySeconds: 0.62 },
    { frequencyHz: 880 * 2.76, level: 0.16, decaySeconds: 0.38 },
    { frequencyHz: 880 * 5.4, level: 0.07, decaySeconds: 0.2 },
  ],
  // Increase/decrease volume for a louder/softer bell.
  volume: 1,
  attackSeconds: 0.004,
  fadeFloor: 0.0001,
  // Increase repeats or spacing to make the bell ring longer; reduce for shorter.
  repeats: 2,
  repeatSpacingSeconds: 0.38,
  compressor: {
    thresholdDb: -12,
    kneeDb: 10,
    ratio: 12,
    attackSeconds: 0.003,
    releaseSeconds: 0.15,
  },
};
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
let isReconnecting = false;
let authStateSubscription = null;
let audioContext = null;
let alertTabId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

function createAudioContext() {
  const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextConstructor) {
    return null;
  }
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContextConstructor();
  }
  return audioContext;
}

function playBell(startTime) {
  const context = audioContext;
  const sound = REQUEST_ALERT_BELL;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(sound.compressor.thresholdDb, context.currentTime);
  compressor.knee.setValueAtTime(sound.compressor.kneeDb, context.currentTime);
  compressor.ratio.setValueAtTime(sound.compressor.ratio, context.currentTime);
  compressor.attack.setValueAtTime(sound.compressor.attackSeconds, context.currentTime);
  compressor.release.setValueAtTime(sound.compressor.releaseSeconds, context.currentTime);
  compressor.connect(context.destination);

  for (const partial of sound.partials) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const soundEnd = startTime + partial.decaySeconds;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(partial.frequencyHz, startTime);
    gain.gain.setValueAtTime(sound.fadeFloor, startTime);
    gain.gain.linearRampToValueAtTime(
      sound.volume * partial.level,
      startTime + sound.attackSeconds,
    );
    gain.gain.exponentialRampToValueAtTime(sound.fadeFloor, soundEnd);
    oscillator.connect(gain);
    gain.connect(compressor);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(startTime);
    oscillator.stop(soundEnd);
  }

  window.setTimeout(
    () => compressor.disconnect(),
    Math.max(
      0,
      startTime + Math.max(...sound.partials.map((partial) => partial.decaySeconds)) -
        context.currentTime,
    ) * 1000,
  );
}

function scheduleRequestAlertSound(context) {
  for (let repeat = 0; repeat < REQUEST_ALERT_BELL.repeats; repeat += 1) {
    playBell(
      context.currentTime + repeat * REQUEST_ALERT_BELL.repeatSpacingSeconds,
    );
  }
}

function unlockRequestAlertAudio() {
  const context = createAudioContext();
  if (!context || context.state === "running") {
    return;
  }
  context.resume().catch((error) => {
    console.warn("The browser has not unlocked driver alert audio yet.", error);
  });
}

async function playRequestAlertSound() {
  if (!isOnline) {
    return;
  }
  try {
    const context = createAudioContext();
    if (!context) {
      throw new Error("This browser does not support audio alerts.");
    }
    if (!isOnline || context.state !== "running") {
      return;
    }

    scheduleRequestAlertSound(context);
  } catch (error) {
    console.error("Driver request sound could not be played.", error);
  }
}

function vibrateForRequest() {
  if (!isOnline || typeof navigator.vibrate !== "function") {
    return;
  }
  try {
    navigator.vibrate(180);
  } catch {
    // Vibration is optional and unsupported on some devices.
  }
}

async function claimRequestAlert(requestId) {
  const key = `${ALERT_CLAIM_KEY_PREFIX}${driver.id}:${requestId}`;
  const claim = { tabId: alertTabId, claimedAt: Date.now() };
  try {
    if (window.localStorage.getItem(key)) {
      return false;
    }
    window.localStorage.setItem(key, JSON.stringify(claim));
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    return JSON.parse(window.localStorage.getItem(key) ?? "null")?.tabId === alertTabId;
  } catch (error) {
    console.error("Cross-tab request alert deduplication is unavailable.", error);
    return false;
  }
}

async function alertForNewRequest(requestId) {
  if (!isOnline) {
    return;
  }

  try {
    if (navigator.locks?.request) {
      await navigator.locks.request(
        `rider:driver-request-alert:${driver.id}:${requestId}`,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock || !isOnline || !(await claimRequestAlert(requestId))) {
            return;
          }
          vibrateForRequest();
          await playRequestAlertSound();
        },
      );
      return;
    }

    if (!(await claimRequestAlert(requestId)) || !isOnline) {
      return;
    }
    vibrateForRequest();
    await playRequestAlertSound();
  } catch (error) {
    console.error("Driver request alert could not be delivered.", error);
  }
}

function renderRequestCount(requests, announce = false) {
  let visibleRequests = requests;
  try {
    const savedState = JSON.parse(
      window.localStorage.getItem(`rider:driver-request-countdowns:${driver.id}`) ?? "null",
    );
    if (savedState && typeof savedState === "object") {
      const expiredIds = new Set(Array.isArray(savedState.expiredIds) ? savedState.expiredIds : []);
      const firstSeenAt = savedState.firstSeenAt && typeof savedState.firstSeenAt === "object"
        ? savedState.firstSeenAt
        : {};
      const now = Date.now();
      visibleRequests = requests.filter((request) => {
        const seenAt = Number(firstSeenAt[request.id]);
        return !expiredIds.has(request.id) &&
          (!Number.isFinite(seenAt) || now - seenAt < REQUEST_LIFETIME_MS);
      });
    }
  } catch (error) {
    console.error("Expired driver requests could not be filtered from the notification count.", error);
  }

  const requestCount = visibleRequests.length;
  const requestWord = requestCount === 1 ? "request" : "requests";

  if (isReconnecting) {
    const waitingMessage = requestCount > 0
      ? `Reconnecting… ${requestCount} matching ride ${requestCount === 1 ? "request" : "requests"} found.`
      : "Reconnecting… We’ll keep checking for requests.";
    const messageChanged = notificationMessage.textContent !== waitingMessage;
    if (messageChanged) {
      notificationMessage.textContent = waitingMessage;
    }
    if (messageChanged || announce) {
      notificationBanner.hidden = false;
    }
    document.title = requestCount > 0 ? `(${requestCount}) ${pageTitle}` : pageTitle;
  } else if (requestCount > 0) {
    const waitingMessage = `You have ${requestCount} matching ride ${requestWord}.`;
    const messageChanged = notificationMessage.textContent !== waitingMessage;
    if (messageChanged) {
      notificationMessage.textContent = waitingMessage;
    }
    if (messageChanged || announce) {
      notificationBanner.hidden = false;
    }
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
    const newRequestIds = previousRequestIds === null
      ? []
      : requestIds.filter((requestId) => !previousRequestIds.includes(requestId));

    previousRequestIds = requestIds;
    notificationBanner.classList.remove("is-error");
    renderRequestCount(requests, requestsChanged);

    for (const requestId of newRequestIds) {
      alertForNewRequest(requestId);
    }

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

function handleRideChange(payload) {
  const updatedRide = payload?.new;
  if (updatedRide?.id && updatedRide.status) {
    document.dispatchEvent(new CustomEvent("driver-ride-updated", {
      detail: {
        rideId: updatedRide.id,
        status: updatedRide.status,
        driverId: updatedRide.driver_id,
      },
    }));
  }
  refreshRequests();
}

function handleRealtimeStatus(status, error) {
  if (!isOnline) {
    return;
  }
  if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
    isReconnecting = true;
    notificationBanner.classList.remove("is-error");
    notificationBanner.classList.add("is-reconnecting");
    notificationMessage.textContent = "Reconnecting… We’ll keep checking for requests.";
    notificationBanner.hidden = false;
    if (error) {
      console.error("Driver ride notification channel error.", error);
    }
    return;
  }

  if (status === "SUBSCRIBED") {
    isReconnecting = false;
    notificationBanner.classList.remove("is-reconnecting");
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
    isReconnecting = false;
    notificationBanner.classList.remove("is-reconnecting");
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
  if (!driver || event.key !== AVAILABILITY_STORAGE_KEY) {
    return;
  }
  try {
    const update = event.newValue ? JSON.parse(event.newValue) : null;
    if (!update || update.driverId === driver.id) {
      getCurrentDriver()
        .then((currentDriver) => {
          if (currentDriver?.id === driver.id) {
            driver = currentDriver;
            setOnlineState(Boolean(currentDriver.isOnline && currentDriver.status === "approved"));
          } else {
            setOnlineState(false);
          }
        })
        .catch((error) => {
          console.error("Driver availability could not be refreshed from the database.", error);
        });
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

    driver = user;
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
        try {
          window.localStorage.removeItem(AVAILABILITY_STORAGE_KEY);
        } catch (error) {
          console.error("Driver availability signal could not be cleared on logout.", error);
        }
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
  isReconnecting = false;
  notificationBanner.classList.remove("is-reconnecting");
  stopRefreshTimer();
  document.removeEventListener("visibilitychange", refreshRequests);
  document.removeEventListener("driver-availability-change", handleAvailabilityChange);
  window.removeEventListener("storage", handleAvailabilityStorage);
  document.removeEventListener("pointerdown", unlockRequestAlertAudio, true);
  document.removeEventListener("keydown", unlockRequestAlertAudio, true);
  requestListObserver?.disconnect();
  requestListObserver = null;
  stopRealtimeChannel();
  if (authStateSubscription) {
    authStateSubscription.unsubscribe();
    authStateSubscription = null;
  }
}

if (isFirstModuleInstance) {
  document.addEventListener("pointerdown", unlockRequestAlertAudio, true);
  document.addEventListener("keydown", unlockRequestAlertAudio, true);
  startNotifications();
}
