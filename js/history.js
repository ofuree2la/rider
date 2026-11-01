import { cancelScheduledRide, getRides } from "./api.js?v=step4";

const upcomingList = document.querySelector("#upcoming-rides");
const pastList = document.querySelector("#past-rides");
const upcomingEmpty = document.querySelector("#upcoming-empty");
const pastEmpty = document.querySelector("#past-empty");
const upcomingCount = document.querySelector("#upcoming-count");
const pastCount = document.querySelector("#past-count");
const errorElement = document.querySelector("#history-error");
const statusElement = document.querySelector("#history-status");

const dateFormatter = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeStyle: "short",
});
const currencyFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

function showError(message) {
  errorElement.textContent = message;
  errorElement.hidden = false;
  statusElement.hidden = true;
}

function showStatus(message) {
  statusElement.textContent = message;
  statusElement.hidden = false;
  errorElement.hidden = true;
}

function clearMessages() {
  errorElement.hidden = true;
  statusElement.hidden = true;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Pickup time unavailable" : dateFormatter.format(date);
}

function getTotalFare(ride) {
  return ride.fare?.rideTotal ?? ride.fare?.total ?? 0;
}

function getStatusLabel(status) {
  const labels = {
    finding: "Finding a driver",
    accepted: "Driver accepted",
    arriving: "Driver arriving",
    "on-trip": "On your way",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return labels[status] ?? "Ride update";
}

function makeRideCard(ride, canCancel) {
  const card = document.createElement("article");
  card.className = "ride-history-card";

  const heading = document.createElement("div");
  heading.className = "ride-history-heading";
  const route = document.createElement("h3");
  route.textContent = `${ride.pickup?.name ?? "Pickup"} to ${ride.destination?.name ?? "Destination"}`;
  const badge = document.createElement("span");
  badge.className = "status-badge";
  badge.dataset.status = ride.status;
  badge.textContent = getStatusLabel(ride.status);
  heading.append(route, badge);

  const details = document.createElement("p");
  details.className = "ride-history-meta";
  details.textContent = `${ride.timing === "scheduled" ? "Scheduled" : "Requested"} · ${formatDate(ride.scheduledAt)} · ${currencyFormatter.format(getTotalFare(ride))}`;

  const actions = document.createElement("div");
  actions.className = "ride-history-actions";
  if (ride.status !== "cancelled") {
    const trackingLink = document.createElement("a");
    trackingLink.className = "btn btn-secondary";
    trackingLink.href = `tracking.html?id=${encodeURIComponent(ride.id)}`;
    trackingLink.textContent = ride.status === "completed" ? "Ride details" : "Track ride";
    actions.append(trackingLink);
  }
  if (canCancel) {
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "btn btn-ghost cancel-ride-button";
    cancelButton.dataset.rideId = ride.id;
    cancelButton.textContent = "Cancel scheduled ride";
    actions.append(cancelButton);
  }

  card.append(heading, details, actions);
  return card;
}

function renderRides() {
  const rides = getRides().sort(
    (first, second) => new Date(first.scheduledAt) - new Date(second.scheduledAt),
  );
  const upcoming = [];
  const past = [];
  const now = new Date();

  rides.forEach((ride) => {
    if (ride.status === "completed" || ride.status === "cancelled") {
      past.push(ride);
    } else {
      upcoming.push(ride);
    }
  });

  upcomingList.replaceChildren();
  pastList.replaceChildren();
  upcoming.forEach((ride) => {
    const canCancel =
      ride.timing === "scheduled" &&
      new Date(ride.scheduledAt) > now &&
      !["completed", "cancelled", "on-trip"].includes(ride.status);
    upcomingList.append(makeRideCard(ride, canCancel));
  });
  past.forEach((ride) => pastList.append(makeRideCard(ride, false)));

  upcomingCount.textContent = `${upcoming.length} ${upcoming.length === 1 ? "ride" : "rides"}`;
  pastCount.textContent = `${past.length} ${past.length === 1 ? "ride" : "rides"}`;
  upcomingEmpty.hidden = upcoming.length > 0;
  pastEmpty.hidden = past.length > 0;
}

function handleCancel(event) {
  const button = event.target.closest("[data-ride-id]");
  if (!button) {
    return;
  }

  if (!window.confirm("Cancel this scheduled ride?")) {
    return;
  }

  try {
    cancelScheduledRide(button.dataset.rideId);
    clearMessages();
    showStatus("Your scheduled ride has been cancelled.");
    renderRides();
  } catch (error) {
    showError(error.message);
  }
}

try {
  renderRides();
  upcomingList.addEventListener("click", handleCancel);
} catch (error) {
  showError(`Ride history could not be loaded: ${error.message}`);
}
