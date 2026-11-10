import "./notifications.js";
import {
  acceptRideRequest,
  declineRideRequest,
  getCurrentDriver,
  getCurrentUser,
  getDriverRideRequests,
  getDriverRides,
  logout,
  updateDriverRideStatus,
} from "./supabase-api.js";
import { mountRideChat } from "./ride-chat.js";

const driverNameHeading = document.querySelector("#driver-name-heading");
const requestHeading = document.querySelector("#incoming-title");
const activeHeading = document.querySelector("#active-title");
const pendingCount = document.querySelector("#pending-count");
const activeCount = document.querySelector("#active-count");
const requestList = document.querySelector("#request-list");
const scheduledRides = document.querySelector("#scheduled-rides");
const rideHistoryList = document.querySelector("#ride-history-list");
const activeRideCard = document.querySelector("#active-ride-card");
const dashboardStatus = document.querySelector("#dashboard-status");
const dashboardError = document.querySelector("#dashboard-error");
const logoutButton = document.querySelector("#logout-button");
const driverChatCard = document.querySelector("#driver-chat-card");
const driverChatRoot = document.querySelector("#driver-chat");
const REFRESH_INTERVAL_MS = 12_000;
const CANCELLATION_NOTICE_MS = 6_000;
const REQUEST_LIFETIME_MS = 30_000;
const REQUEST_EXPIRY_NOTE_MS = 5_000;
const currencyFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});
const dateFormatter = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeStyle: "short",
});

let driver = null;
let isRefreshRunning = false;
let driverChatRideId = null;
let driverChatCleanup = null;
let tripsRefreshTimer = null;
let cancellationNoticeTimer = null;
let requestCountdownTimer = null;
let requestExpiryNoteTimer = null;
let expiredNoticeUntil = 0;
let requestTimingState = { firstSeenAt: {}, expiredIds: [] };
let activeRideIds = new Set();
let latestRides = [];
const DECLINE_CONFIRMATION_MS = 5000;
const declineConfirmations = new Map();

function showStatus(message) {
  dashboardStatus.textContent = message;
  dashboardStatus.hidden = false;
  dashboardError.hidden = true;
}

function showError(message) {
  dashboardError.textContent = message;
  dashboardError.hidden = false;
  dashboardStatus.hidden = true;
}

function hideMessages() {
  dashboardStatus.hidden = true;
  dashboardError.hidden = true;
}

function formatCash(amount) {
  return currencyFormatter.format(Number(amount ?? 0));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function formatRideTime(value) {
  if (!value) {
    return "Pickup time unavailable";
  }
  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime())
    ? "Pickup time unavailable"
    : dateFormatter.format(parsedDate);
}

function getRideTotal(ride) {
  return ride?.fare?.rideTotal ?? ride?.fare?.total ?? 0;
}

function getRequestTimingStorageKey() {
  return `rider:driver-request-countdowns:${driver.id}`;
}

function loadRequestTimingState() {
  try {
    const savedState = JSON.parse(window.localStorage.getItem(getRequestTimingStorageKey()) ?? "null");
    if (savedState && typeof savedState === "object") {
      requestTimingState = {
        firstSeenAt: {
          ...requestTimingState.firstSeenAt,
          ...(savedState.firstSeenAt && typeof savedState.firstSeenAt === "object"
            ? savedState.firstSeenAt
            : {}),
        },
        expiredIds: [...new Set([
          ...requestTimingState.expiredIds,
          ...(Array.isArray(savedState.expiredIds) ? savedState.expiredIds : []),
        ])],
      };
    }
  } catch (error) {
    console.error("Driver request countdown state could not be loaded.", error);
  }
}

function saveRequestTimingState() {
  try {
    window.localStorage.setItem(getRequestTimingStorageKey(), JSON.stringify(requestTimingState));
  } catch (error) {
    console.error("Driver request countdown state could not be saved.", error);
  }
}

function stopRequestCountdownTimer() {
  if (requestCountdownTimer !== null) {
    window.clearTimeout(requestCountdownTimer);
    requestCountdownTimer = null;
  }
}

function showRequestExpiredNote() {
  expiredNoticeUntil = Date.now() + REQUEST_EXPIRY_NOTE_MS;
  if (requestExpiryNoteTimer !== null) {
    window.clearTimeout(requestExpiryNoteTimer);
  }
  requestExpiryNoteTimer = window.setTimeout(() => {
    requestExpiryNoteTimer = null;
    expiredNoticeUntil = 0;
    requestList.querySelector(".request-expired-note")?.remove();
  }, REQUEST_EXPIRY_NOTE_MS);
  renderRequestExpiredNote();
}

function renderRequestExpiredNote() {
  requestList.querySelector(".request-expired-note")?.remove();
  if (expiredNoticeUntil <= Date.now()) {
    return;
  }
  const note = document.createElement("p");
  note.className = "request-expired-note";
  note.setAttribute("role", "status");
  note.textContent = "Request expired";
  requestList.append(note);
}

function expireRequestCard(card) {
  const rideId = card.dataset.rideId;
  if (!rideId || requestTimingState.expiredIds.includes(rideId)) {
    return false;
  }
  requestTimingState.expiredIds.push(rideId);
  card.remove();
  showRequestExpiredNote();
  return true;
}

function updateRequestCountdowns() {
  requestCountdownTimer = null;
  if (!driver?.isOnline) {
    return;
  }

  const now = Date.now();
  let expiredAny = false;
  let nextExpiryAt = Infinity;
  for (const card of requestList.querySelectorAll(".request-card[data-ride-id]")) {
    const deadline = Number(card.dataset.expiresAt);
    const remaining = deadline - now;
    if (!Number.isFinite(deadline) || remaining <= 0) {
      expiredAny = expireRequestCard(card) || expiredAny;
      continue;
    }
    nextExpiryAt = Math.min(nextExpiryAt, deadline);
    const countdown = card.querySelector(".request-countdown");
    if (countdown) {
      countdown.textContent = `Request expires in ${Math.ceil(remaining / 1000)}s`;
    }
  }

  if (expiredAny) {
    requestTimingState.expiredIds = [...new Set(requestTimingState.expiredIds)];
    saveRequestTimingState();
    pendingCount.textContent = String(
      requestList.querySelectorAll(".request-card[data-ride-id]").length,
    );
    if (requestList.querySelectorAll(".request-card[data-ride-id]").length === 0) {
      const emptyState = document.createElement("div");
      emptyState.className = "request-card empty-state-box";
      const message = document.createElement("p");
      message.textContent = `No matching requests right now. Keep your ${driver.vehicleType === "bike" ? "bike" : "vehicle"} online to receive new work.`;
      emptyState.append(message);
      requestList.prepend(emptyState);
    }
    renderRequestExpiredNote();
  }

  if (Number.isFinite(nextExpiryAt)) {
    requestCountdownTimer = window.setTimeout(
      updateRequestCountdowns,
      Math.min(1000, Math.max(50, nextExpiryAt - now)),
    );
  }
}

async function renderRequests() {
  if (driver.status === "approved" && !driver.isOnline) {
    stopRequestCountdownTimer();
    pendingCount.textContent = "0";
    requestList.innerHTML = '<div class="request-card empty-state-box"><p>You’re offline. Go online from the Dashboard to receive matching requests.</p></div>';
    return;
  }
  if (driver.status !== "approved") {
    stopRequestCountdownTimer();
    pendingCount.textContent = "0";
    requestList.innerHTML = `<div class="request-card empty-state-box"><p>${
      driver.status === "suspended"
        ? "Your account is suspended. Contact Rider support for help."
        : "Your account must be approved before you can receive matching requests."
    }</p></div>`;
    return;
  }

  const requests = await getDriverRideRequests(driver.id);
  loadRequestTimingState();
  const previousRequestIds = new Set(
    [...requestList.querySelectorAll(".request-card[data-ride-id]")]
      .map((card) => card.dataset.rideId),
  );
  const currentRequestIds = new Set(requests.map((request) => request.id));
  const removedRequestCount = [...previousRequestIds]
    .filter((requestId) => !currentRequestIds.has(requestId))
    .length;
  if (removedRequestCount > 0) {
    showStatus(
      removedRequestCount === 1
        ? "A request was taken or cancelled and removed from your list."
        : `${removedRequestCount} requests were taken or cancelled and removed from your list.`,
    );
  }
  const now = Date.now();
  const expiredIds = new Set(requestTimingState.expiredIds);
  const previouslyExpiredIds = new Set(expiredIds);
  const visibleRequests = [];
  for (const ride of requests) {
    const firstSeenAt = Number(requestTimingState.firstSeenAt[ride.id]);
    if (!Number.isFinite(firstSeenAt)) {
      requestTimingState.firstSeenAt[ride.id] = now;
    }
    if (now - Number(requestTimingState.firstSeenAt[ride.id]) >= REQUEST_LIFETIME_MS) {
      expiredIds.add(ride.id);
    } else if (!expiredIds.has(ride.id)) {
      visibleRequests.push(ride);
    }
  }
  requestTimingState.expiredIds = [...expiredIds];
  const currentIds = new Set(requests.map((ride) => ride.id));
  requestTimingState.firstSeenAt = Object.fromEntries(
    Object.entries(requestTimingState.firstSeenAt)
      .filter(([rideId]) => currentIds.has(rideId)),
  );
  saveRequestTimingState();

  const newlyExpiredIds = requests
    .filter((ride) => expiredIds.has(ride.id) && !previouslyExpiredIds.has(ride.id))
    .map((ride) => ride.id);
  if (newlyExpiredIds.length > 0) {
    showRequestExpiredNote();
  }
  pendingCount.textContent = String(visibleRequests.length);
  if (visibleRequests.length === 0) {
    requestList.innerHTML = `<div class="request-card empty-state-box"><p>No matching requests right now. Keep your ${driver.vehicleType === "bike" ? "bike" : "vehicle"} online to receive new work.</p></div>`;
    renderRequestExpiredNote();
    updateRequestCountdowns();
    return;
  }

  requestList.innerHTML = visibleRequests.map((ride) => {
    const expiresAt = Number(requestTimingState.firstSeenAt[ride.id]) + REQUEST_LIFETIME_MS;
    const secondsRemaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    return `
    <article class="request-card" data-ride-id="${escapeHtml(ride.id)}" data-expires-at="${expiresAt}">
      <div class="request-accept-progress" aria-hidden="true"><span></span></div>
      <p class="request-action-feedback" role="status" aria-live="polite" hidden></p>
      <p class="request-countdown" aria-live="off">Request expires in ${secondsRemaining}s</p>
      <div class="request-rider" aria-label="Rider profile details are hidden until acceptance">
        <span class="request-rider-avatar" aria-hidden="true">R</span>
        <span>Rider</span>
      </div>
      <div class="request-top">
        <h3>${escapeHtml(ride.pickup?.name ?? "Pickup")} to ${escapeHtml(ride.destination?.name ?? "Destination")}</h3>
        <span class="badge">${ride.serviceType === "delivery" ? "Delivery" : ride.timing === "scheduled" ? "Scheduled" : "Now"}</span>
      </div>
      <div class="request-meta">
        <span>${ride.serviceType === "delivery" ? "Bike delivery" : `${ride.passengers} passenger${ride.passengers > 1 ? "s" : ""}`}</span>
        <span class="value">${formatCash(getRideTotal(ride))}</span>
      </div>
      ${
        ride.serviceType === "delivery"
          ? `<p class="request-description">${escapeHtml(ride.deliveryDescription)} · Recipient: ${escapeHtml(ride.recipientName)} (${escapeHtml(ride.recipientPhone)})</p>`
          : ""
      }
      <div class="request-meta">
        <span>${ride.timing === "scheduled" ? formatRideTime(ride.scheduledAt) : "Requested now"}</span>
        <span>${ride.paymentMethod === "online" ? "Online · rider pays after acceptance" : "Cash"}</span>
      </div>
      <div class="request-actions">
        <button type="button" class="btn btn-primary" data-action="accept" data-ride-id="${escapeHtml(ride.id)}">Accept</button>
        <button type="button" class="btn btn-danger" data-action="decline" data-ride-id="${escapeHtml(ride.id)}">Decline</button>
      </div>
    </article>
  `;
  }).join("");
  renderRequestExpiredNote();
  updateRequestCountdowns();
}

function clearDriverChat() {
  driverChatCleanup?.();
  driverChatCleanup = null;
  driverChatRideId = null;
  driverChatRoot.replaceChildren();
  driverChatCard.hidden = true;
}

function renderActiveRide(rides) {
  const activeRide = rides.find((ride) => ["accepted", "arriving", "on-trip"].includes(ride.status));
  const cancelledActiveRide = rides.find(
    (ride) => ride.status === "cancelled" && activeRideIds.has(ride.id),
  );
  activeRideIds = new Set(
    rides
      .filter((ride) => ["accepted", "arriving", "on-trip"].includes(ride.status))
      .map((ride) => ride.id),
  );
  latestRides = rides;
  activeCount.textContent = String(
    rides.filter((ride) => ["accepted", "arriving", "on-trip"].includes(ride.status)).length,
  );

  if (activeRide) {
    if (cancellationNoticeTimer !== null) {
      window.clearTimeout(cancellationNoticeTimer);
      cancellationNoticeTimer = null;
    }
  }

  if (!activeRide) {
    clearDriverChat();
    if (cancelledActiveRide) {
      activeRideCard.className = "active-ride-card ride-cancelled-notice";
      const notice = document.createElement("p");
      notice.setAttribute("role", "status");
      notice.setAttribute("aria-live", "polite");
      notice.textContent = "Ride cancelled by rider";
      activeRideCard.replaceChildren(notice);
      if (cancellationNoticeTimer !== null) {
        window.clearTimeout(cancellationNoticeTimer);
      }
      cancellationNoticeTimer = window.setTimeout(() => {
        cancellationNoticeTimer = null;
        renderActiveRide(latestRides);
      }, CANCELLATION_NOTICE_MS);
      return;
    }
    if (cancellationNoticeTimer !== null) {
      return;
    }
    activeRideCard.className = "active-ride-card empty-state-box";
    activeRideCard.innerHTML = "<p>No active ride yet. Accept a ride request to get started.</p>";
    return;
  }

  const isDelivery = activeRide.serviceType === "delivery";
  const statusButtonMap = {
    accepted: { label: isDelivery ? "Arrived at pickup" : "Arrived", nextStatus: "arriving" },
    arriving: { label: isDelivery ? "Start delivery" : "Start trip", nextStatus: "on-trip" },
    "on-trip": { label: isDelivery ? "Complete delivery" : "Complete trip", nextStatus: "completed" },
  };
  const actionInfo = statusButtonMap[activeRide.status];
  const waitingForPayment =
    activeRide.paymentMethod === "online" &&
    activeRide.paymentStatus !== "paid" &&
    actionInfo.nextStatus === "on-trip";
  const riderPhone = String(activeRide.riderPhone ?? "").replace(/[^\d+]/g, "");
  const callRiderAction = riderPhone.replace(/\D/g, "").length >= 10
    ? `<a class="btn btn-secondary" href="tel:${escapeHtml(riderPhone)}">Call rider</a>`
    : "";

  activeRideCard.className = "active-ride-card";
  activeRideCard.innerHTML = `
    <div class="trip-top">
      <h3>${escapeHtml(activeRide.pickup?.name ?? "Pickup")} to ${escapeHtml(activeRide.destination?.name ?? "Destination")}</h3>
      <span class="status-pill">${escapeHtml(activeRide.status.replace("-", " "))}</span>
    </div>
    <div class="route-summary-row">
      <span>${isDelivery ? "Bike delivery" : `${activeRide.passengers} passenger${activeRide.passengers > 1 ? "s" : ""}`}</span>
      <span class="value">${formatCash(getRideTotal(activeRide))}</span>
    </div>
    ${
      isDelivery
        ? `<div class="request-description"><strong>Package:</strong> ${escapeHtml(activeRide.deliveryDescription)}<br><strong>Recipient:</strong> ${escapeHtml(activeRide.recipientName)} · ${escapeHtml(activeRide.recipientPhone)}</div>`
        : ""
    }
    <div class="request-meta">
      <span>${activeRide.timing === "scheduled" ? "Scheduled" : "On demand"}</span>
      <span>${activeRide.timing === "scheduled" ? formatRideTime(activeRide.scheduledAt) : "Requested now"}</span>
    </div>
    <div class="trip-actions">
      ${callRiderAction}
      <button type="button" class="btn btn-primary" data-action="advance-status" data-ride-id="${escapeHtml(activeRide.id)}" ${waitingForPayment ? "disabled" : ""}>${waitingForPayment ? "Waiting for rider payment" : actionInfo.label}</button>
    </div>
  `;

  driverChatCard.hidden = false;
  if (driverChatRideId !== activeRide.id) {
    driverChatCleanup?.();
    driverChatRoot.replaceChildren();
    driverChatRideId = activeRide.id;
    driverChatCleanup = mountRideChat(driverChatRoot, activeRide.id);
  }
}

function renderScheduledRides(rides) {
  const scheduled = rides.filter((ride) => ride.timing === "scheduled" && ride.status !== "cancelled");
  if (scheduled.length === 0) {
    scheduledRides.innerHTML = '<div class="scheduled-item empty-state-box"><p>No future scheduled rides yet.</p></div>';
    return;
  }

  scheduledRides.innerHTML = scheduled.map((ride) => `
    <article class="scheduled-item">
      <div class="scheduled-meta">
        <h3>${escapeHtml(ride.pickup?.name ?? "Pickup")} to ${escapeHtml(ride.destination?.name ?? "Destination")}</h3>
        <span class="badge">${escapeHtml(ride.status)}</span>
      </div>
      <div class="request-meta">
        <span>${formatRideTime(ride.scheduledAt)}</span>
        <span>${ride.serviceType === "delivery" ? "Bike delivery" : `${ride.passengers} rider${ride.passengers > 1 ? "s" : ""}`}</span>
      </div>
    </article>
  `).join("");
}

function renderRideHistory(rides) {
  const history = rides.filter((ride) => ["completed", "cancelled"].includes(ride.status));
  if (history.length === 0) {
    rideHistoryList.innerHTML = '<div class="scheduled-item empty-state-box"><p>Completed and cancelled trips will appear here.</p></div>';
    return;
  }

  rideHistoryList.innerHTML = history.map((ride) => `
    <article class="scheduled-item">
      <div class="scheduled-meta">
        <h3>${escapeHtml(ride.pickup?.name ?? "Pickup")} to ${escapeHtml(ride.destination?.name ?? "Destination")}</h3>
        <span class="badge">${escapeHtml(ride.status)}</span>
      </div>
      <div class="request-meta">
        <span>${ride.serviceType === "delivery" ? "Bike delivery" : `${ride.passengers} rider${ride.passengers > 1 ? "s" : ""}`}</span>
        <span class="value">${formatCash(getRideTotal(ride))}</span>
      </div>
    </article>
  `).join("");
}

async function refreshTrips() {
  hideMessages();
  const [rides] = await Promise.all([
    getDriverRides(driver.id),
    renderRequests(),
  ]);
  if (!driver.isOnline) {
    await renderRequests();
  }
  renderActiveRide(rides);
  renderScheduledRides(rides);
  renderRideHistory(rides);
}

async function handleRideAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }
  const { action, rideId } = button.dataset;

  try {
    if (action === "accept") {
      await handleAcceptRequest(button, rideId);
    } else if (action === "decline") {
      await handleDeclineRequest(button, rideId);
    } else if (action === "advance-status") {
      button.disabled = true;
      const ride = (await getDriverRides(driver.id)).find((candidate) => candidate.id === rideId);
      if (!ride) {
        throw new Error("This ride no longer exists.");
      }
      const statusUpdates = {
        accepted: "arriving",
        arriving: "on-trip",
        "on-trip": "completed",
      };
      const nextStatus = statusUpdates[ride.status];
      if (!nextStatus) {
        throw new Error("This ride is already complete.");
      }
      await updateDriverRideStatus(rideId, driver.id, nextStatus);
      showStatus(`Ride status updated to ${nextStatus.replace("-", " ")}.`);
      await refreshTrips();
    }
  } catch (error) {
    showError(error.message);
    button.disabled = false;
  }
}

function resetDeclineConfirmation(rideId) {
  const confirmation = declineConfirmations.get(rideId);
  if (!confirmation) {
    return;
  }
  window.clearTimeout(confirmation.timer);
  confirmation.button.textContent = "Decline";
  delete confirmation.button.dataset.confirming;
  confirmation.button.closest(".request-card")?.querySelector(".request-action-feedback")?.setAttribute("hidden", "");
  declineConfirmations.delete(rideId);
}

function startDeclineConfirmation(button, rideId) {
  resetDeclineConfirmation(rideId);
  button.dataset.confirming = "true";
  button.textContent = "Tap again to decline";
  const feedback = button.closest(".request-card")?.querySelector(".request-action-feedback");
  if (feedback) {
    feedback.textContent = "Decline this ride? Tap again within 5 seconds to confirm.";
    feedback.hidden = false;
  }
  const timer = window.setTimeout(() => resetDeclineConfirmation(rideId), DECLINE_CONFIRMATION_MS);
  declineConfirmations.set(rideId, { button, timer });
}

async function handleDeclineRequest(button, rideId) {
  if (!button.dataset.confirming) {
    startDeclineConfirmation(button, rideId);
    return;
  }

  resetDeclineConfirmation(rideId);
  button.disabled = true;
  await declineRideRequest(rideId, driver.id);
  showStatus("Ride request declined.");
  await refreshTrips();
}

async function handleAcceptRequest(button, rideId) {
  resetDeclineConfirmation(rideId);
  button.disabled = true;
  const card = button.closest(".request-card");
  startAcceptAnimation(card);

  let ride;
  try {
    ride = await acceptRideRequest(rideId, driver.id);
  } catch (error) {
    if (/already been accepted|closed|no longer available|does not match your vehicle type/i.test(error.message)) {
      await refreshUnavailableRide(button);
      return;
    }
    if (isNetworkError(error)) {
      await resolveUncertainAccept(button, rideId, error);
      return;
    }
    resetAcceptingCard(card);
    throw error;
  }

  try {
    await refreshTrips();
  } catch (error) {
    resetAcceptingCard(card);
    showError(`Ride accepted, but the Trips page could not refresh: ${error.message}`);
    return;
  }
  showStatus(
    `${ride.serviceType === "delivery" ? "Delivery" : "Ride"} accepted. The rider’s tracking page will update automatically.`,
  );
}

function isNetworkError(error) {
  return error instanceof TypeError ||
    /network|fetch|timeout|timed out|connection|offline|load failed|aborted/i.test(error.message);
}

async function resolveUncertainAccept(button, rideId, originalError) {
  try {
    const assignedRides = await getDriverRides(driver.id);
    const assignedRide = assignedRides.find((ride) => ride.id === rideId);
    if (assignedRide) {
      try {
        await refreshTrips();
      } catch (refreshError) {
        resetAcceptingCard(button.closest(".request-card"));
        showError(`Ride accepted, but the Trips page could not refresh: ${refreshError.message}`);
        return;
      }
      showStatus(
        `${assignedRide.serviceType === "delivery" ? "Delivery" : "Ride"} accepted. The rider’s tracking page will update automatically.`,
      );
      return;
    }

    const openRequests = await getDriverRideRequests(driver.id);
    const isStillAvailable = openRequests.some((request) => request.id === rideId);
    try {
      await refreshTrips();
    } catch (refreshError) {
      console.error("Trips could not refresh after an uncertain accept outcome.", refreshError);
    }
    if (!isStillAvailable) {
      showError("This ride was already taken or is no longer available.");
    } else {
      resetAcceptingCard(button.closest(".request-card"));
      showError("Connection problem, check and try again.");
    }
  } catch (checkError) {
    console.error("Could not verify the outcome of the ride acceptance request.", {
      acceptError: originalError,
      checkError,
    });
    resetAcceptingCard(button.closest(".request-card"));
    showError("Connection problem, check and try again.");
  }
}

function resetAcceptingCard(card) {
  if (!card) {
    return;
  }
  card.classList.remove("is-accepting");
  card.querySelector(".request-accept-progress").hidden = true;
  card.querySelector(".request-action-feedback").hidden = true;
  const acceptButton = card.querySelector('[data-action="accept"]');
  const declineButton = card.querySelector('[data-action="decline"]');
  acceptButton.disabled = false;
  acceptButton.textContent = "Accept";
  if (declineButton) {
    declineButton.disabled = false;
  }
}

function startAcceptAnimation(card) {
  const progress = card.querySelector(".request-accept-progress");
  const feedback = card.querySelector(".request-action-feedback");
  const acceptButton = card.querySelector('[data-action="accept"]');
  const declineButton = card.querySelector('[data-action="decline"]');

  card.classList.add("is-accepting");
  progress.hidden = false;
  feedback.textContent = "Accepting request…";
  feedback.hidden = false;
  acceptButton.textContent = "Accepting…";
  if (declineButton) {
    declineButton.disabled = true;
  }
}

async function refreshUnavailableRide(button) {
  try {
    await refreshTrips();
    showError("This ride was already taken or is no longer available. The request list has been refreshed.");
  } catch (error) {
    showError(`This ride was already taken or is no longer available. The request list could not be refreshed: ${error.message}`);
    resetAcceptingCard(button.closest(".request-card"));
    button.disabled = false;
  }
}

async function refreshTripsSafely() {
  if (isRefreshRunning) {
    return;
  }
  isRefreshRunning = true;
  try {
    await refreshTrips();
  } catch (error) {
    showError(`Trips could not be refreshed: ${error.message}`);
  } finally {
    isRefreshRunning = false;
  }
}

function stopTripsRefresh() {
  if (tripsRefreshTimer !== null) {
    window.clearInterval(tripsRefreshTimer);
    tripsRefreshTimer = null;
  }
}

function startTripsRefresh() {
  if ((!driver?.isOnline && activeRideIds.size === 0) || tripsRefreshTimer !== null) {
    return;
  }

  tripsRefreshTimer = window.setInterval(async () => {
    if (
      document.visibilityState !== "visible" ||
      isRefreshRunning ||
      (!driver.isOnline && activeRideIds.size === 0)
    ) {
      return;
    }
    await refreshTripsSafely();
  }, REFRESH_INTERVAL_MS);
}

function handleDriverAvailabilityChange(event) {
  driver.isOnline = Boolean(event.detail?.isOnline);
  if (!driver.isOnline) {
    stopRequestCountdownTimer();
    if (activeRideIds.size > 0) {
      startTripsRefresh();
    } else {
      stopTripsRefresh();
    }
    for (const rideId of declineConfirmations.keys()) {
      resetDeclineConfirmation(rideId);
    }
    pendingCount.textContent = "0";
    requestList.innerHTML = '<div class="request-card empty-state-box"><p>You’re offline. Go online from the Dashboard to receive matching requests.</p></div>';
    return;
  }

  startTripsRefresh();
  refreshTripsSafely();
}

function cleanupTripsPage() {
  stopTripsRefresh();
  stopRequestCountdownTimer();
  if (requestExpiryNoteTimer !== null) {
    window.clearTimeout(requestExpiryNoteTimer);
    requestExpiryNoteTimer = null;
  }
  if (cancellationNoticeTimer !== null) {
    window.clearTimeout(cancellationNoticeTimer);
    cancellationNoticeTimer = null;
  }
  driverChatCleanup?.();
  for (const rideId of declineConfirmations.keys()) {
    resetDeclineConfirmation(rideId);
  }
  document.removeEventListener("driver-availability-state-changed", handleDriverAvailabilityChange);
  document.removeEventListener("driver-session-ended", cleanupTripsPage);
  document.removeEventListener("driver-ride-requests-updated", refreshTripsSafely);
}

async function startTripsPage() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "driver") {
      window.location.replace(
        user?.role === "rider"
          ? "../login.html"
          : user?.role === "admin"
            ? "../admin/login.html"
            : "login.html",
      );
      return;
    }

    driver = await getCurrentDriver();
    driverNameHeading.textContent = driver.name;
    requestHeading.textContent = driver.vehicleType === "bike" ? "Delivery requests" : "Ride requests";
    activeHeading.textContent = driver.vehicleType === "bike" ? "Active delivery" : "Active ride";
    logoutButton.addEventListener("click", async () => {
      try {
        await logout();
        window.location.assign("login.html");
      } catch (error) {
        showError(`Logout failed: ${error.message}`);
      }
    });
    requestList.addEventListener("click", handleRideAction);
    activeRideCard.addEventListener("click", handleRideAction);
    document.addEventListener("driver-availability-state-changed", handleDriverAvailabilityChange);
    document.addEventListener("driver-session-ended", cleanupTripsPage);
    await refreshTrips();
    document.addEventListener("driver-ride-requests-updated", refreshTripsSafely);
    startTripsRefresh();
  } catch (error) {
    showError(`Trips could not be loaded: ${error.message}`);
  }
}

window.addEventListener("pagehide", cleanupTripsPage, { once: true });

startTripsPage();
