import {
  acceptRideRequest,
  declineRideRequest,
  getCurrentDriver,
  getCurrentUser,
  getDriverRideRequests,
  getDriverRides,
  logout,
  setDriverOnline,
  isDriverOnline,
  updateDriverRideStatus,
} from "./api.js";

let driver = null;
const driverNameHeading = document.querySelector("#driver-name-heading");
const driverOnlineToggle = document.querySelector("#driver-online-toggle");
const pendingCount = document.querySelector("#pending-count");
const activeCount = document.querySelector("#active-count");
const todayCount = document.querySelector("#today-count");
const todayEarnings = document.querySelector("#today-earnings");
const requestList = document.querySelector("#request-list");
const scheduledRides = document.querySelector("#scheduled-rides");
const activeRideCard = document.querySelector("#active-ride-card");
const profileName = document.querySelector("#profile-name");
const profilePlate = document.querySelector("#profile-plate");
const profileRating = document.querySelector("#profile-rating");
const profileVerification = document.querySelector("#profile-verification");
const profilePhone = document.querySelector("#profile-phone");
const driverAvatar = document.querySelector("#driver-avatar");
const weekEarnings = document.querySelector("#week-earnings");
const completedTotal = document.querySelector("#completed-total");
const allTimeEarnings = document.querySelector("#alltime-earnings");
const dashboardStatus = document.querySelector("#dashboard-status");
const dashboardError = document.querySelector("#dashboard-error");
const logoutButton = document.querySelector("#logout-button");

const currencyFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeStyle: "short",
});

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

function formatRideTime(value) {
  if (!value) {
    return "Pickup time unavailable";
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? "Pickup time unavailable" : dateFormatter.format(parsedDate);
}

function getRideTotal(ride) {
  return ride?.fare?.rideTotal ?? ride?.fare?.total ?? 0;
}

function getDriverRideSummary(allRides) {
  const completedRides = allRides.filter((ride) => ride.status === "completed");
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todaysCompleted = completedRides.filter((ride) => {
    if (!ride.completedAt) {
      return false;
    }
    const completedAt = new Date(ride.completedAt);
    return completedAt >= today;
  });

  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - 6);

  const weeklyCompleted = completedRides.filter((ride) => {
    if (!ride.completedAt) {
      return false;
    }
    const completedAt = new Date(ride.completedAt);
    return completedAt >= weekStart;
  });

  const totalEarnings = completedRides.reduce((sum, ride) => sum + Number(getRideTotal(ride)), 0);
  const weekTotal = weeklyCompleted.reduce((sum, ride) => sum + Number(getRideTotal(ride)), 0);
  const todayTotal = todaysCompleted.reduce((sum, ride) => sum + Number(getRideTotal(ride)), 0);

  return {
    completedCount: completedRides.length,
    todayCount: todaysCompleted.length,
    todayEarnings: todayTotal,
    weekTotal,
    allTimeTotal: totalEarnings,
  };
}

function renderProfile() {
  driverNameHeading.textContent = driver.name;
  profileName.textContent = driver.name;
  profilePlate.textContent = driver.plateNumber;
  profileRating.textContent = `★ ${driver.rating.toFixed(1)}`;
  profileVerification.textContent =
    driver.status === "suspended"
      ? "Suspended"
      : driver.status === "pending"
        ? "Awaiting approval"
        : "Approved";
  profilePhone.textContent = driver.phone;
  driverAvatar.textContent = driver.name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const canGoOnline = driver.status === "approved";
  driverOnlineToggle.disabled = !canGoOnline;
  driverOnlineToggle.checked = canGoOnline && isDriverOnline(driver.id);
  if (!canGoOnline) {
    showStatus(
      driver.status === "suspended"
        ? "Your driver account is suspended. Contact Rider support for help."
        : "Your driver account is waiting for admin approval before you can go online.",
    );
  }
}

function renderRequests() {
  if (driver.status !== "approved") {
    pendingCount.textContent = "0";
    requestList.innerHTML = `<div class="request-card empty-state-box"><p>${
      driver.status === "suspended"
        ? "Your account is suspended. Contact Rider support for help."
        : "Your account must be approved before you can receive ride requests."
    }</p></div>`;
    return;
  }

  const requests = getDriverRideRequests(driver.id);
  pendingCount.textContent = String(requests.length);

  if (requests.length === 0) {
    requestList.innerHTML = '<div class="request-card empty-state-box"><p>No ride requests right now. Keep your keke online to receive new trips.</p></div>';
    return;
  }

  requestList.innerHTML = requests
    .map(
      (ride) => `
        <article class="request-card">
          <div class="request-top">
            <h3>${ride.pickup?.name ?? "Pickup"} to ${ride.destination?.name ?? "Destination"}</h3>
            <span class="badge">${ride.timing === "scheduled" ? "Scheduled" : "Now"}</span>
          </div>
          <div class="request-meta">
            <span>${ride.passengers} passenger${ride.passengers > 1 ? "s" : ""}</span>
            <span class="value">${formatCash(getRideTotal(ride))}</span>
          </div>
          <div class="request-meta">
            <span>${formatRideTime(ride.scheduledAt)}</span>
            <span>${ride.paymentMethod ?? "Cash"}</span>
          </div>
          <div class="request-actions">
            <button type="button" class="btn btn-primary" data-action="accept" data-ride-id="${ride.id}">Accept</button>
            <button type="button" class="btn btn-danger" data-action="decline" data-ride-id="${ride.id}">Decline</button>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderActiveRide() {
  const rides = getDriverRides(driver.id)
    .filter((ride) => ride.status && !["finding", "cancelled"].includes(ride.status))
    .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));

  const activeRide = rides.find((ride) => ["accepted", "arriving", "on-trip", "completed"].includes(ride.status)) ?? null;
  activeCount.textContent = String(rides.filter((ride) => ["accepted", "arriving", "on-trip"].includes(ride.status)).length);

  if (!activeRide) {
    activeRideCard.className = "active-ride-card empty-state-box";
    activeRideCard.innerHTML = "<p>No active ride yet. Accept a ride request to get started.</p>";
    return;
  }

  const statusButtonMap = {
    accepted: { label: "Arrived", nextStatus: "arriving" },
    arriving: { label: "Start trip", nextStatus: "on-trip" },
    "on-trip": { label: "Complete trip", nextStatus: "completed" },
    completed: { label: "Ride complete", nextStatus: null },
  };

  const actionInfo = statusButtonMap[activeRide.status] ?? { label: "Ride in progress", nextStatus: null };

  activeRideCard.className = "active-ride-card";
  activeRideCard.innerHTML = `
    <div class="trip-top">
      <div>
        <h3>${activeRide.pickup?.name ?? "Pickup"} to ${activeRide.destination?.name ?? "Destination"}</h3>
      </div>
      <span class="status-pill">${activeRide.status.replace("-", " ")}</span>
    </div>
    <div class="route-summary-row">
      <span>${activeRide.passengers} passenger${activeRide.passengers > 1 ? "s" : ""}</span>
      <span class="value">${formatCash(getRideTotal(activeRide))}</span>
    </div>
    <div class="request-meta">
      <span>${activeRide.timing === "scheduled" ? "Scheduled" : "On demand"}</span>
      <span>${formatRideTime(activeRide.scheduledAt)}</span>
    </div>
    <div class="trip-actions">
      <button type="button" class="btn btn-primary" data-action="advance-status" data-ride-id="${activeRide.id}" ${actionInfo.nextStatus ? "" : "disabled"}>${actionInfo.label}</button>
    </div>
  `;
}

function renderScheduledRides() {
  const rides = getDriverRides(driver.id).filter((ride) => ride.timing === "scheduled" && ride.status !== "cancelled");

  if (rides.length === 0) {
    scheduledRides.innerHTML = '<div class="scheduled-item empty-state-box"><p>No future scheduled rides yet.</p></div>';
    return;
  }

  scheduledRides.innerHTML = rides
    .map(
      (ride) => `
        <article class="scheduled-item">
          <div class="scheduled-meta">
            <h3>${ride.pickup?.name ?? "Pickup"} to ${ride.destination?.name ?? "Destination"}</h3>
            <span class="badge">${ride.status}</span>
          </div>
          <div class="request-meta">
            <span>${formatRideTime(ride.scheduledAt)}</span>
            <span>${ride.passengers} rider${ride.passengers > 1 ? "s" : ""}</span>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderEarnings() {
  const rides = getDriverRides(driver.id);
  const summary = getDriverRideSummary(rides);
  todayCount.textContent = String(summary.todayCount);
  todayEarnings.textContent = formatCash(summary.todayEarnings);
  weekEarnings.textContent = formatCash(summary.weekTotal);
  completedTotal.textContent = `${summary.completedCount} rides`;
  allTimeEarnings.textContent = formatCash(summary.allTimeTotal);
}

function refreshDashboard() {
  hideMessages();
  renderProfile();
  renderRequests();
  renderActiveRide();
  renderScheduledRides();
  renderEarnings();
}

async function handleRideAction(event) {
  const target = event.target.closest("button[data-action]");
  if (!target) {
    return;
  }

  const { action, rideId } = target.dataset;

  try {
    if (action === "accept") {
      acceptRideRequest(rideId, driver.id);
      showStatus("Ride accepted. The rider can now track your progress.");
    } else if (action === "decline") {
      declineRideRequest(rideId, driver.id);
      showStatus("Ride request declined.");
    } else if (action === "advance-status") {
      const ride = getDriverRides(driver.id).find((candidate) => candidate.id === rideId);
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
      updateDriverRideStatus(rideId, driver.id, nextStatus);
      showStatus(`Ride status updated to ${nextStatus.replace("-", " ")}.`);
    }

    refreshDashboard();
  } catch (error) {
    showError(error.message);
  }
}

function handleOnlineToggle(event) {
  const isOnline = event.target.checked;

  try {
    setDriverOnline(driver.id, isOnline);
    showStatus(`${driver.name} is now ${isOnline ? "online" : "offline"}.`);
  } catch (error) {
    showError(error.message);
    driverOnlineToggle.checked = !isOnline;
  }
}

function startDriverDashboard() {
  try {
    const user = getCurrentUser();
    if (!user || user.role !== "driver") {
      window.location.replace(user?.role === "rider" ? "../login.html" : user?.role === "admin" ? "../admin/login.html" : "login.html");
      return;
    }

    driver = getCurrentDriver();
    logoutButton.addEventListener("click", () => {
      try {
        logout();
        window.location.assign("login.html");
      } catch (error) {
        showError(`Logout failed: ${error.message}`);
      }
    });

    requestList.addEventListener("click", handleRideAction);
    activeRideCard.addEventListener("click", handleRideAction);
    driverOnlineToggle.addEventListener("change", handleOnlineToggle);
    refreshDashboard();
  } catch (error) {
    showError(`The driver dashboard could not be loaded: ${error.message}`);
  }
}

startDriverDashboard();
