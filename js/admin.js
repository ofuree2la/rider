import {
  createLocation,
  deleteLocation,
  getCurrentUser,
  getDrivers,
  getLocations,
  getPricingConfig,
  getRides,
  isDriverOnline,
  logout,
  setDriverStatus,
  updateLocation,
  updatePricingConfig,
} from "./api.js?v=admin";
import { FARE_CONFIG } from "./pricing.js?v=admin";

const adminStatus = document.querySelector("#admin-status");
const adminError = document.querySelector("#admin-error");
const driverList = document.querySelector("#driver-list");
const locationList = document.querySelector("#location-list");
const fareMatrix = document.querySelector("#fare-matrix");
const rideList = document.querySelector("#ride-list");
const rideEmpty = document.querySelector("#ride-empty");
const statusNames = {
  finding: "Finding driver",
  accepted: "Accepted",
  arriving: "Arriving",
  "on-trip": "On trip",
  completed: "Completed",
  cancelled: "Cancelled",
};
const zoneNames = {
  standard: "Standard",
  campus: "Campus",
  "premium-hostel": "Premium hostel",
};
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
  adminStatus.textContent = message;
  adminStatus.hidden = false;
  adminError.hidden = true;
}

function showError(message) {
  adminError.textContent = message;
  adminError.hidden = false;
  adminStatus.hidden = true;
}

function formatCash(amount) {
  return currencyFormatter.format(Number(amount ?? 0));
}

function localDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rideDate(ride) {
  return ride.timing === "scheduled" ? ride.scheduledAt : ride.createdAt;
}

function setText(selector, text) {
  const element = document.querySelector(selector);
  element.textContent = text;
}

function renderMetrics(drivers, rides) {
  const onlineDrivers = drivers.filter(
    (driver) => driver.status === "approved" && isDriverOnline(driver.id),
  ).length;
  const completedRides = rides.filter((ride) => ride.status === "completed");
  const revenue = completedRides.reduce(
    (total, ride) => total + Number(ride.fare?.rideTotal ?? ride.fare?.total ?? 0),
    0,
  );
  const ratedDrivers = drivers.filter((driver) => Number.isFinite(Number(driver.rating)));
  const averageRating = ratedDrivers.length
    ? ratedDrivers.reduce((total, driver) => total + Number(driver.rating), 0) / ratedDrivers.length
    : null;

  setText("#metric-rides", String(rides.length));
  setText("#metric-drivers", String(onlineDrivers));
  setText("#metric-revenue", formatCash(revenue));
  setText("#metric-rating", averageRating === null ? "—" : `${averageRating.toFixed(1)} / 5`);
}

function makeButton(label, action, id, status, className = "btn btn-secondary") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.id = id;
  if (status) {
    button.dataset.status = status;
  }
  return button;
}

function renderDrivers(drivers) {
  driverList.replaceChildren();
  if (drivers.length === 0) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "No driver accounts have been registered.";
    driverList.append(empty);
    return;
  }

  for (const driver of drivers) {
    const card = document.createElement("article");
    card.className = "admin-record";
    const main = document.createElement("div");
    main.className = "admin-record-main";
    const name = document.createElement("h3");
    name.textContent = driver.name;
    const detail = document.createElement("p");
    detail.textContent = `${driver.plateNumber} · ${driver.phone} · ★ ${Number(driver.rating).toFixed(1)}`;
    const badge = document.createElement("span");
    badge.className = `admin-status-badge ${driver.status}`;
    badge.textContent = driver.status;
    main.append(name, detail, badge);

    const actions = document.createElement("div");
    actions.className = "admin-record-actions";
    if (driver.status !== "approved") {
      actions.append(makeButton("Approve", "driver-status", driver.id, "approved", "btn btn-primary"));
    }
    if (driver.status !== "suspended") {
      actions.append(makeButton("Suspend", "driver-status", driver.id, "suspended", "btn btn-ghost"));
    }
    card.append(main, actions);
    driverList.append(card);
  }
}

function makeZoneSelect(name, selected) {
  const select = document.createElement("select");
  select.name = name;
  select.required = true;
  for (const [zone, label] of Object.entries(zoneNames)) {
    const option = document.createElement("option");
    option.value = zone;
    option.textContent = label;
    option.selected = zone === selected;
    select.append(option);
  }
  return select;
}

function makeField(labelText, control, className = "admin-field") {
  const wrapper = document.createElement("div");
  wrapper.className = className;
  const label = document.createElement("label");
  label.textContent = labelText;
  label.htmlFor = control.id;
  wrapper.append(label, control);
  return wrapper;
}

function renderLocations(locations) {
  locationList.replaceChildren();
  for (const location of locations) {
    const card = document.createElement("article");
    card.className = "admin-record";
    const form = document.createElement("form");
    form.className = "admin-location-form";
    form.dataset.locationId = location.id;

    const nameInput = document.createElement("input");
    nameInput.id = `location-name-${location.id}`;
    nameInput.name = "name";
    nameInput.value = location.name;
    nameInput.maxLength = 80;
    nameInput.required = true;
    form.append(makeField("Name", nameInput));

    const zoneSelect = makeZoneSelect("zone", location.zone);
    zoneSelect.id = `location-zone-${location.id}`;
    form.append(makeField("Fare zone", zoneSelect));

    const typeInput = document.createElement("input");
    typeInput.id = `location-type-${location.id}`;
    typeInput.name = "type";
    typeInput.value = location.type;
    typeInput.maxLength = 40;
    form.append(makeField("Type", typeInput));

    const actions = document.createElement("div");
    actions.className = "admin-record-actions";
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "btn btn-primary";
    save.textContent = "Save";
    const remove = makeButton("Delete", "delete-location", location.id, null, "btn btn-ghost");
    actions.append(save, remove);
    form.append(actions);
    card.append(form);
    locationList.append(card);
  }
}

function renderFareMatrix(config) {
  fareMatrix.replaceChildren();
  const zones = Object.keys(zoneNames);
  const blank = document.createElement("span");
  fareMatrix.append(blank);
  for (const zone of zones) {
    const heading = document.createElement("span");
    heading.className = "fare-matrix-heading";
    heading.textContent = zoneNames[zone];
    fareMatrix.append(heading);
  }

  for (const pickupZone of zones) {
    const rowLabel = document.createElement("span");
    rowLabel.className = "fare-matrix-row-label";
    rowLabel.textContent = zoneNames[pickupZone];
    fareMatrix.append(rowLabel);
    for (const destinationZone of zones) {
      const input = document.createElement("input");
      input.id = `fare-${pickupZone}-${destinationZone}`;
      input.name = `${pickupZone}:${destinationZone}`;
      input.type = "number";
      input.min = "0";
      input.max = "100000";
      input.step = "50";
      input.required = true;
      input.value = String(config.fareMatrix[pickupZone][destinationZone]);
      fareMatrix.append(
        makeField(
          `${zoneNames[pickupZone]} to ${zoneNames[destinationZone]} fare in naira`,
          input,
        ),
      );
    }
  }
}

function renderRides(rides) {
  const filters = new FormData(document.querySelector("#ride-filters"));
  const statusFilter = String(filters.get("status") ?? "");
  const dateFilter = String(filters.get("date") ?? "");
  const filteredRides = rides
    .filter((ride) => !statusFilter || ride.status === statusFilter)
    .filter((ride) => !dateFilter || localDate(rideDate(ride)) === dateFilter)
    .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));

  rideList.replaceChildren();
  for (const ride of filteredRides) {
    const row = document.createElement("tr");
    const route = document.createElement("td");
    route.textContent = `${ride.pickup?.name ?? "Pickup"} → ${ride.destination?.name ?? "Destination"}`;
    const rider = document.createElement("td");
    rider.textContent = ride.rider?.name ?? ride.user?.name ?? (ride.userId ? "Rider account" : "Guest");
    const status = document.createElement("td");
    status.textContent = statusNames[ride.status] ?? ride.status;
    const pickup = document.createElement("td");
    const timestamp = rideDate(ride);
    const parsedDate = timestamp ? new Date(timestamp) : null;
    pickup.textContent = parsedDate && !Number.isNaN(parsedDate.getTime())
      ? dateFormatter.format(parsedDate)
      : "Not scheduled";
    const fare = document.createElement("td");
    fare.textContent = formatCash(ride.fare?.rideTotal ?? ride.fare?.total ?? 0);
    row.append(route, rider, status, pickup, fare);
    rideList.append(row);
  }
  rideEmpty.hidden = filteredRides.length > 0;
}

function refreshDashboard() {
  const drivers = getDrivers();
  const locations = getLocations();
  const rides = getRides();
  const pricing = getPricingConfig(FARE_CONFIG);
  renderMetrics(drivers, rides);
  renderDrivers(drivers);
  renderLocations(locations);
  renderFareMatrix(pricing);
  renderRides(rides);
}

function handleDriverAction(event) {
  const button = event.target.closest("button[data-action='driver-status']");
  if (!button) {
    return;
  }
  try {
    setDriverStatus(button.dataset.id, button.dataset.status);
    showStatus(`Driver account ${button.dataset.status}.`);
    refreshDashboard();
  } catch (error) {
    showError(error.message);
  }
}

function handleLocationSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches(".admin-location-form")) {
    return;
  }
  event.preventDefault();
  const data = new FormData(form);
  try {
    updateLocation(form.dataset.locationId, {
      name: data.get("name"),
      zone: data.get("zone"),
      type: data.get("type"),
    });
    showStatus("Location updated.");
    refreshDashboard();
  } catch (error) {
    showError(error.message);
  }
}

function handleLocationDelete(event) {
  const button = event.target.closest("button[data-action='delete-location']");
  if (!button) {
    return;
  }
  try {
    deleteLocation(button.dataset.id);
    showStatus("Location deleted.");
    refreshDashboard();
  } catch (error) {
    showError(error.message);
  }
}

function handleLocationCreate(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    createLocation({
      name: data.get("name"),
      zone: data.get("zone"),
      type: data.get("type"),
    });
    event.currentTarget.reset();
    showStatus("Location added.");
    refreshDashboard();
  } catch (error) {
    showError(error.message);
  }
}

function handlePricingSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const config = getPricingConfig(FARE_CONFIG);
  for (const pickupZone of Object.keys(zoneNames)) {
    for (const destinationZone of Object.keys(zoneNames)) {
      config.fareMatrix[pickupZone][destinationZone] = Number(
        data.get(`${pickupZone}:${destinationZone}`),
      );
    }
  }
  try {
    updatePricingConfig(config);
    showStatus("Fare settings saved. New estimates and bookings will use these prices.");
    refreshDashboard();
  } catch (error) {
    showError(error.message);
  }
}

function handleLogout() {
  try {
    logout();
    window.location.assign("login.html");
  } catch (error) {
    showError(`Logout failed: ${error.message}`);
  }
}

function startAdminDashboard() {
  try {
    const user = getCurrentUser();
    if (!user || user.role !== "admin") {
      const destination = user?.role === "driver" ? "../driver/login.html" : "../login.html";
      window.location.replace(destination);
      return;
    }

    refreshDashboard();
    document.querySelector("#admin-logout").addEventListener("click", handleLogout);
    driverList.addEventListener("click", handleDriverAction);
    locationList.addEventListener("click", handleLocationDelete);
    locationList.addEventListener("submit", handleLocationSubmit);
    document.querySelector("#location-create-form").addEventListener("submit", handleLocationCreate);
    document.querySelector("#pricing-form").addEventListener("submit", handlePricingSubmit);
    document.querySelector("#ride-filters").addEventListener("input", () => renderRides(getRides()));
  } catch (error) {
    showError(`The admin dashboard could not be loaded: ${error.message}`);
  }
}

startAdminDashboard();
