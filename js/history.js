import "./notifications.js";
import { cancelRideRequest, getRide, getRides } from "./supabase-api.js";
import { clearSavedBookingConfirmation, confirmRideCancellation } from "./cancel-ride-dialog.js";

const rideGroups = document.querySelector("#activity-groups");
const loadingElement = document.querySelector("#history-loading");
const emptyElement = document.querySelector("#activity-empty");
const emptyTitle = document.querySelector("#activity-empty-title");
const emptyMessage = document.querySelector("#activity-empty-message");
const errorElement = document.querySelector("#history-error");
const errorMessage = document.querySelector("#history-error-message");
const retryButton = document.querySelector("#history-retry");
const statusElement = document.querySelector("#history-status");
const countElement = document.querySelector("#activity-count");
const loadMoreButton = document.querySelector("#activity-load-more");
const filters = [...document.querySelectorAll("[data-filter]")];
const pageSize = 20;

const dateFormatter = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeStyle: "short",
});
const currencyFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

let rides = [];
let currentFilter = "all";
let visibleLimit = pageSize;
let isLoading = false;

function isUpcomingScheduled(ride, now = Date.now()) {
  const date = new Date(ride.scheduledAt);
  return (
    ride.timing === "scheduled" &&
    ["finding", "accepted", "arriving"].includes(ride.status) &&
    !Number.isNaN(date.getTime()) &&
    date.getTime() > now
  );
}

function getActivityDate(ride) {
  const value =
    ride.timing === "scheduled"
      ? ride.scheduledAt
      : ride.status === "completed"
        ? ride.completedAt ?? ride.startedAt ?? ride.createdAt
        : ride.status === "cancelled"
          ? ride.cancelledAt ?? ride.createdAt
          : ride.createdAt;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : dateFormatter.format(date);
}

function getTotalFare(ride) {
  return ride.fare?.rideTotal ?? ride.fare?.total ?? 0;
}

function getStatusLabel(ride) {
  if (ride.status === "cancelled") return "Cancelled";
  if (ride.status === "completed") return "Completed";
  if (isUpcomingScheduled(ride)) return "Scheduled";

  const labels = {
    finding: "Finding a driver",
    accepted: "Driver accepted",
    arriving: "Driver arriving",
    "on-trip": "On your way",
  };
  return labels[ride.status] ?? "Ride update";
}

function getVehicleLabel(ride) {
  if (ride.serviceType === "delivery") return "Delivery";
  if (ride.vehicleType === "minivan") return "Mini bus";
  if (ride.vehicleType === "bike") return "Motorcycle";
  return "Keke";
}

function makeVehicleIllustration(ride) {
  const tile = document.createElement("span");
  const vehicleClass =
    ride.serviceType === "delivery" || ride.vehicleType === "bike"
      ? "bike"
      : ride.vehicleType === "minivan"
        ? "minivan"
        : "keke";
  tile.className = `activity-vehicle activity-vehicle--${vehicleClass}`;
  tile.setAttribute("aria-hidden", "true");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 64 48");
  svg.setAttribute("focusable", "false");
  svg.innerHTML =
    ride.serviceType === "delivery" || ride.vehicleType === "bike"
      ? '<circle cx="17" cy="35" r="7"/><circle cx="48" cy="35" r="7"/><path d="m17 35 10-17 10 17H17l9-10h13l9 10M26 18h-6"/>'
      : ride.vehicleType === "minivan"
        ? '<path d="M8 13h34l10 11v13H8z"/><path d="M42 14v11h10M14 18h11v9H14zM29 18h9v9h-9z"/><circle cx="19" cy="37" r="4"/><circle cx="45" cy="37" r="4"/>'
        : '<path d="M14 37h34V23L40 15H24l-10 8z"/><path d="M24 16v12h17V16M13 25h-5M20 37a4 4 0 1 0 8 0m11 0a4 4 0 1 0 8 0"/> ';
  tile.append(svg);
  return tile;
}

function makeRideRow(ride) {
  const article = document.createElement("article");
  article.className = "activity-ride";

  const detailsLink = document.createElement("a");
  detailsLink.className = "activity-ride-link";
  detailsLink.href = `tracking.html?id=${encodeURIComponent(ride.id)}`;
  const pickup = ride.pickup?.name ?? "Pickup";
  const destination = ride.destination?.name ?? "Destination";
  detailsLink.setAttribute("aria-label", `View ride details: ${pickup} to ${destination}`);
  detailsLink.append(makeVehicleIllustration(ride));

  const content = document.createElement("span");
  content.className = "activity-ride-content";

  const heading = document.createElement("span");
  heading.className = "activity-ride-heading";
  const route = document.createElement("span");
  route.className = "activity-route";
  route.textContent = `${pickup} to ${destination}`;
  const badge = document.createElement("span");
  badge.className = "activity-status";
  badge.dataset.status = ride.status;
  if (isUpcomingScheduled(ride)) badge.dataset.status = "scheduled";
  badge.textContent = getStatusLabel(ride);
  heading.append(route, badge);

  const time = document.createElement("span");
  time.className = "activity-ride-time";
  time.textContent = isUpcomingScheduled(ride)
    ? `Pickup scheduled · ${formatDate(ride.scheduledAt)}`
    : formatDate(getActivityDate(ride));

  const footer = document.createElement("span");
  footer.className = "activity-ride-footer";
  const vehicle = document.createElement("span");
  vehicle.textContent = getVehicleLabel(ride);
  const fare = document.createElement("span");
  fare.className = "activity-fare";
  fare.textContent = currencyFormatter.format(getTotalFare(ride));
  footer.append(vehicle, fare);

  content.append(heading, time, footer);
  detailsLink.append(content);
  article.append(detailsLink);

  if (["finding", "accepted", "arriving"].includes(ride.status)) {
    const actions = document.createElement("div");
    actions.className = "activity-ride-actions";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "activity-cancel-button";
    cancelButton.dataset.rideId = ride.id;
    cancelButton.textContent = "Cancel request";
    actions.append(cancelButton);
    article.append(actions);
  }

  return article;
}

function getFilteredRides() {
  const now = Date.now();
  const filtered = rides.filter((ride) => {
    if (currentFilter === "completed") return ride.status === "completed";
    if (currentFilter === "cancelled") return ride.status === "cancelled";
    if (currentFilter === "scheduled") return isUpcomingScheduled(ride, now);
    return true;
  });
  return filtered.sort((first, second) => {
    const firstDate = getActivityDate(first)?.getTime() ?? 0;
    const secondDate = getActivityDate(second)?.getTime() ?? 0;
    return secondDate - firstDate;
  });
}

function renderActivity() {
  const filteredRides = getFilteredRides();
  const shownRides = filteredRides.slice(0, visibleLimit);
  const groups = new Map();
  shownRides.forEach((ride) => {
    const date = getActivityDate(ride);
    const key = date
      ? new Intl.DateTimeFormat("en-NG", { month: "long", year: "numeric" }).format(date)
      : "Date unavailable";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ride);
  });

  rideGroups.replaceChildren();
  for (const [month, monthRides] of groups) {
    const section = document.createElement("section");
    section.className = "activity-month";
    const heading = document.createElement("h2");
    heading.className = "activity-month-heading";
    heading.textContent = month;
    const list = document.createElement("div");
    list.className = "activity-ride-list";
    monthRides.forEach((ride) => list.append(makeRideRow(ride)));
    section.append(heading, list);
    rideGroups.append(section);
  }

  countElement.textContent = `${filteredRides.length} ${filteredRides.length === 1 ? "ride" : "rides"}`;
  loadMoreButton.hidden = filteredRides.length <= visibleLimit;
  rideGroups.hidden = shownRides.length === 0;
  emptyElement.hidden = filteredRides.length > 0;
  if (!filteredRides.length) {
    const isFiltered = currentFilter !== "all";
    emptyTitle.textContent = isFiltered ? `No ${currentFilter} rides` : "No rides yet";
    emptyMessage.textContent = isFiltered
      ? "Try another filter to see your rides."
      : "Your trips will show up here after you book a ride.";
    emptyElement.querySelector("a").hidden = isFiltered;
  }
}

function showError(message) {
  errorMessage.textContent = message;
  errorElement.hidden = false;
  rideGroups.hidden = true;
  emptyElement.hidden = true;
  loadMoreButton.hidden = true;
}

function clearMessages() {
  errorElement.hidden = true;
  statusElement.hidden = true;
}

async function loadRides({ showSkeleton = true } = {}) {
  if (isLoading) return false;
  isLoading = true;
  errorElement.hidden = true;
  emptyElement.hidden = true;
  rideGroups.hidden = true;
  loadMoreButton.hidden = true;
  if (showSkeleton) loadingElement.hidden = false;
  retryButton.disabled = true;
  retryButton.textContent = "Loading…";
  try {
    rides = await getRides({ includeDriver: false });
    loadingElement.hidden = true;
    renderActivity();
    return true;
  } catch (error) {
    loadingElement.hidden = true;
    showError(`Activity could not be loaded: ${error.message}`);
    return false;
  } finally {
    retryButton.disabled = false;
    retryButton.textContent = "Retry";
    isLoading = false;
  }
}

async function handleCancel(event) {
  const button = event.target.closest("[data-ride-id]");
  if (!button || !rideGroups.contains(button)) return;

  const rideId = button.dataset.rideId;
  let ride;
  try {
    ride = await getRide(rideId, { includeDriver: false });
  } catch (error) {
    showError(`Ride details could not be refreshed: ${error.message}`);
    return;
  }
  if (!ride) {
    showError("This ride could not be found. Refresh the page and check its current status.");
    return;
  }
  if (!["finding", "accepted", "arriving"].includes(ride.status)) {
    await loadRides({ showSkeleton: false });
    showError("This ride can no longer be cancelled. Its status has changed.");
    return;
  }

  const confirmation = await confirmRideCancellation(ride);
  if (!confirmation?.confirmed) return;

  button.disabled = true;
  button.textContent = "Cancelling…";
  try {
    const cancelledRide = await cancelRideRequest(rideId, confirmation.reason);
    if (cancelledRide.status !== "cancelled") {
      throw new Error("The ride was not cancelled. Refresh and check its current status.");
    }
    clearSavedBookingConfirmation(rideId);
    clearMessages();
    statusElement.textContent = "Your ride has been cancelled.";
    statusElement.hidden = false;
    await loadRides({ showSkeleton: false });
  } catch (error) {
    showError(error.message);
    button.disabled = false;
    button.textContent = "Cancel request";
  }
}

filters.forEach((button) => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    visibleLimit = pageSize;
    filters.forEach((filterButton) => {
      filterButton.setAttribute("aria-pressed", String(filterButton === button));
    });
    if (!loadingElement.hidden || !errorElement.hidden) return;
    errorElement.hidden = true;
    renderActivity();
  });
});

loadMoreButton.addEventListener("click", () => {
  visibleLimit += pageSize;
  renderActivity();
});
retryButton.addEventListener("click", () => loadRides());
rideGroups.addEventListener("click", handleCancel);

await loadRides();
