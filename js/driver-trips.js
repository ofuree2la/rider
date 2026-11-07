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
const REFRESH_INTERVAL_MS = 15_000;
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

async function renderRequests() {
  if (driver.status !== "approved") {
    pendingCount.textContent = "0";
    requestList.innerHTML = `<div class="request-card empty-state-box"><p>${
      driver.status === "suspended"
        ? "Your account is suspended. Contact Rider support for help."
        : "Your account must be approved before you can receive matching requests."
    }</p></div>`;
    return;
  }

  const requests = await getDriverRideRequests(driver.id);
  pendingCount.textContent = String(requests.length);
  if (requests.length === 0) {
    requestList.innerHTML = `<div class="request-card empty-state-box"><p>No matching requests right now. Keep your ${driver.vehicleType === "bike" ? "bike" : "vehicle"} online to receive new work.</p></div>`;
    return;
  }

  requestList.innerHTML = requests.map((ride) => `
    <article class="request-card">
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
  `).join("");
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
  activeCount.textContent = String(
    rides.filter((ride) => ["accepted", "arriving", "on-trip"].includes(ride.status)).length,
  );

  if (!activeRide) {
    activeRideCard.className = "active-ride-card empty-state-box";
    activeRideCard.innerHTML = "<p>No active ride yet. Accept a ride request to get started.</p>";
    clearDriverChat();
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
  renderActiveRide(rides);
  renderScheduledRides(rides);
  renderRideHistory(rides);
}

async function handleRideAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }
  button.disabled = true;
  const { action, rideId } = button.dataset;

  try {
    if (action === "accept") {
      const ride = await acceptRideRequest(rideId, driver.id);
      showStatus(
        `${ride.serviceType === "delivery" ? "Delivery" : "Ride"} accepted. The rider can now track your progress.`,
      );
    } else if (action === "decline") {
      await declineRideRequest(rideId, driver.id);
      showStatus("Ride request declined.");
    } else if (action === "advance-status") {
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
    }
    await refreshTrips();
  } catch (error) {
    showError(error.message);
    button.disabled = false;
  }
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
    await refreshTrips();
    window.setInterval(async () => {
      if (document.visibilityState !== "visible" || isRefreshRunning) {
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
    }, REFRESH_INTERVAL_MS);
  } catch (error) {
    showError(`Trips could not be loaded: ${error.message}`);
  }
}

window.addEventListener("pagehide", () => driverChatCleanup?.());

startTripsPage();
