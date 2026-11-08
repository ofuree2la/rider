import "./notifications.js";
import { getCurrentDriver, getCurrentUser, getDriverRideRequests } from "./supabase-api.js";
import { supabase } from "./supabase-client.js";

const MODULE_GUARD = Symbol.for("rider.driver-notifications");
const AVAILABILITY_STORAGE_KEY = "rider:driver-availability";
const SOUND_ALERT_KEY_PREFIX = "rider:driver-sound-alerts:";
const ALERT_CLAIM_KEY_PREFIX = "rider:driver-request-alert:";
const isFirstModuleInstance = !window[MODULE_GUARD];
if (isFirstModuleInstance) {
  window[MODULE_GUARD] = true;
}

const REFRESH_INTERVAL_MS = 45_000;
const ACTIVE_REQUEST_REFRESH_INTERVAL_MS = 12_000;
const REQUEST_LIFETIME_MS = 30_000;
const REQUEST_ALERT_SOUND = {
  // Raise/lower these together to shift the chime higher/lower.
  startFrequencyHz: 600,
  endFrequencyHz: 1400,
  // Increase/decrease for a longer/shorter rising slide.
  glideSeconds: 0.18,
  // Increase/decrease for a brighter/quieter upper shimmer.
  shimmerLevel: 0.22,
  shimmerFrequencyMultiplier: 2,
  sparkleFrequencyHz: 2800,
  sparkleLevel: 0.12,
  sparkleDurationSeconds: 0.055,
  // Increase/decrease volume for a louder/softer alert.
  volume: 0.5,
  attackSeconds: 0.01,
  totalDurationSeconds: 0.42,
  fadeFloor: 0.0001,
  // Increase repeats or spacing to make the chime longer; reduce for shorter.
  repeats: 2,
  repeatSpacingSeconds: 0.35,
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
const notificationControls = document.createElement("div");
const soundAlertButton = document.createElement("button");
const notificationBanner = document.createElement("aside");
const notificationMessage = document.createElement("span");
const notificationLink = document.createElement("a");

notificationControls.className = "driver-notification-controls";
soundAlertButton.type = "button";
soundAlertButton.className = "btn btn-secondary driver-sound-alert-button";
notificationControls.append(soundAlertButton);
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
  siteHeader.insertAdjacentElement("afterend", notificationControls);
  notificationControls.append(notificationBanner);
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
let soundAlertsEnabled = false;
let audioContext = null;
let alertTabId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

function getSoundAlertKey() {
  return `${SOUND_ALERT_KEY_PREFIX}${driver.id}`;
}

function updateSoundAlertButton() {
  if (soundAlertsEnabled && !audioContext && !(window.AudioContext ?? window.webkitAudioContext)) {
    soundAlertButton.textContent = "Sound alerts unavailable";
    soundAlertButton.disabled = true;
  } else if (soundAlertsEnabled && audioContext?.state !== "running") {
    soundAlertButton.textContent = "Tap to enable sound on this page";
    soundAlertButton.disabled = false;
  } else {
    soundAlertButton.textContent = soundAlertsEnabled
      ? "Sound alerts enabled"
      : "Enable sound alerts";
    soundAlertButton.disabled = soundAlertsEnabled;
  }
  soundAlertButton.setAttribute("aria-pressed", String(soundAlertsEnabled));
}

function createAudioContext() {
  const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextConstructor) {
    return null;
  }
  if (!audioContext) {
    audioContext = new AudioContextConstructor();
  }
  return audioContext;
}

function playSlide(startTime) {
  const context = audioContext;
  const sound = REQUEST_ALERT_SOUND;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(sound.compressor.thresholdDb, context.currentTime);
  compressor.knee.setValueAtTime(sound.compressor.kneeDb, context.currentTime);
  compressor.ratio.setValueAtTime(sound.compressor.ratio, context.currentTime);
  compressor.attack.setValueAtTime(sound.compressor.attackSeconds, context.currentTime);
  compressor.release.setValueAtTime(sound.compressor.releaseSeconds, context.currentTime);
  compressor.connect(context.destination);

  const slideLayers = [
    {
      frequency: sound.startFrequencyHz,
      endFrequency: sound.endFrequencyHz,
      level: sound.volume,
    },
    {
      frequency: sound.startFrequencyHz * sound.shimmerFrequencyMultiplier,
      endFrequency: sound.endFrequencyHz * sound.shimmerFrequencyMultiplier,
      level: sound.volume * sound.shimmerLevel,
    },
  ];

  for (const layer of slideLayers) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const glideEnd = startTime + sound.glideSeconds;
    const soundEnd = startTime + sound.totalDurationSeconds;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(layer.frequency, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(layer.endFrequency, glideEnd);
    gain.gain.setValueAtTime(sound.fadeFloor, startTime);
    gain.gain.linearRampToValueAtTime(layer.level, startTime + sound.attackSeconds);
    gain.gain.setValueAtTime(layer.level, glideEnd);
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

  const sparkle = context.createOscillator();
  const sparkleGain = context.createGain();
  const sparkleStart = startTime + sound.glideSeconds - sound.sparkleDurationSeconds / 2;
  const sparkleEnd = sparkleStart + sound.sparkleDurationSeconds;
  sparkle.type = "sine";
  sparkle.frequency.setValueAtTime(sound.sparkleFrequencyHz, sparkleStart);
  sparkleGain.gain.setValueAtTime(sound.fadeFloor, sparkleStart);
  sparkleGain.gain.linearRampToValueAtTime(
    sound.volume * sound.sparkleLevel,
    sparkleStart + sound.attackSeconds,
  );
  sparkleGain.gain.exponentialRampToValueAtTime(sound.fadeFloor, sparkleEnd);
  sparkle.connect(sparkleGain);
  sparkleGain.connect(compressor);
  sparkle.onended = () => {
    sparkle.disconnect();
    sparkleGain.disconnect();
  };
  sparkle.start(sparkleStart);
  sparkle.stop(sparkleEnd);

  window.setTimeout(
    () => compressor.disconnect(),
    Math.max(0, soundEnd - context.currentTime) * 1000,
  );
}

function scheduleRequestAlertSound(context) {
  for (let repeat = 0; repeat < REQUEST_ALERT_SOUND.repeats; repeat += 1) {
    playSlide(
      context.currentTime + repeat * REQUEST_ALERT_SOUND.repeatSpacingSeconds,
    );
  }
}

async function enableSoundAlerts() {
  try {
    const context = createAudioContext();
    if (!context) {
      throw new Error("This browser does not support audio alerts.");
    }
    if (context.state === "suspended") {
      await context.resume();
    }
    if (context.state !== "running") {
      throw new Error("The browser did not allow audio playback. Please try again.");
    }
    soundAlertsEnabled = true;
    try {
      window.localStorage.setItem(getSoundAlertKey(), "true");
    } catch (error) {
      console.error("Sound-alert preference could not be saved.", error);
    }
    updateSoundAlertButton();
  } catch (error) {
    showNotificationError(`Sound alerts could not be enabled: ${error.message}`);
    console.error("Driver sound alerts could not be enabled.", error);
  }
}

async function playRequestAlertSound() {
  if (!soundAlertsEnabled || !isOnline) {
    return;
  }
  try {
    const context = createAudioContext();
    if (!context) {
      throw new Error("This browser does not support audio alerts.");
    }
    if (context.state === "suspended") {
      await context.resume();
    }
    if (!isOnline || !soundAlertsEnabled) {
      return;
    }
    if (context.state !== "running") {
      throw new Error("Tap Enable sound alerts on this page to allow audio.");
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

function handleSoundPreferenceStorage(event) {
  if (!driver || event.key !== getSoundAlertKey()) {
    return;
  }
  soundAlertsEnabled = event.newValue === "true";
  if (soundAlertsEnabled) {
    createAudioContext();
  }
  updateSoundAlertButton();
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

function handleRideChange() {
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

    driver = await getCurrentDriver();
    try {
      soundAlertsEnabled = window.localStorage.getItem(getSoundAlertKey()) === "true";
      if (soundAlertsEnabled) {
        createAudioContext();
      }
    } catch (error) {
      console.error("Sound-alert preference could not be loaded.", error);
    }
    updateSoundAlertButton();
    soundAlertButton.addEventListener("click", enableSoundAlerts);
    const requestList = document.querySelector("#request-list");
    if (requestList) {
      requestListObserver = new MutationObserver(scheduleNextRefresh);
      requestListObserver.observe(requestList, { childList: true, subtree: true });
    }
    document.addEventListener("driver-availability-change", handleAvailabilityChange);
    window.addEventListener("storage", handleAvailabilityStorage);
    window.addEventListener("storage", handleSoundPreferenceStorage);
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
  window.removeEventListener("storage", handleSoundPreferenceStorage);
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
