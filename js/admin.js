import "./notifications.js";
import {
  createLocation,
  deleteLocation,
  getCurrentUser,
  getAdminAccountDetails,
  getDrivers,
  getLocations,
  getPricingConfig,
  getRegisteredUsers,
  getRides,
  logout,
  setDriverStatus,
  updateAccountAsAdmin,
  updateLocation,
  updatePricingConfig,
} from "./supabase-api.js?v=account-details";
import { FARE_CONFIG } from "./pricing.js?v=admin";
import { attachPhotoPicker } from "./photo-picker.js";

const adminStatus = document.querySelector("#admin-status");
const adminError = document.querySelector("#admin-error");
const registeredUserList = document.querySelector("#registered-user-list");
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
let driverStatusFilter = "pending";
let pricingConfig = null;
let adminRides = [];

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

function renderMetrics(drivers, rides, users) {
  const onlineDrivers = drivers.filter(
    (driver) => driver.status === "approved" && driver.isOnline,
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
  if (document.querySelector("#metric-users")) {
    setText("#metric-users", String(users.length));
  }
  setText("#metric-drivers", String(onlineDrivers));
  setText("#metric-revenue", formatCash(revenue));
  setText("#metric-rating", averageRating === null ? "—" : `${averageRating.toFixed(1)} / 5`);
}

function renderRegisteredUsers(users) {
  registeredUserList.replaceChildren();
  if (users.length === 0) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "No Rider or driver accounts have been registered.";
    registeredUserList.append(empty);
    return;
  }

  for (const user of users) {
    const card = document.createElement("article");
    card.className = "admin-record";
    if (user.role === "rider" || user.role === "driver") {
      card.dataset.accountId = user.id;
      card.classList.add("admin-account-open");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `View ${user.role} details for ${user.name}`);
    }
    if (user.avatarUrl) {
      const avatar = document.createElement("img");
      avatar.className = "admin-driver-avatar";
      avatar.src = user.avatarUrl;
      avatar.alt = `${user.name}'s profile`;
      card.append(avatar);
    } else {
      card.append(createInitialsAvatar(user.name, "admin-driver-avatar"));
    }
    const main = document.createElement("div");
    main.className = "admin-record-main";

    const name = document.createElement("h3");
    name.textContent = user.name || "Unnamed account";
    const detail = document.createElement("p");
    const registeredDate = user.registeredAt ? new Date(user.registeredAt) : null;
    const registeredLabel =
      registeredDate && !Number.isNaN(registeredDate.getTime())
        ? `Registered ${dateFormatter.format(registeredDate)}`
        : "Registration date unavailable";
    detail.textContent = `${user.phone || "No phone number"} · ${registeredLabel}`;

    const role = document.createElement("span");
    role.className = `admin-status-badge ${user.role}`;
    role.textContent = user.role;

    main.append(name, detail, role);
    card.append(main);
    registeredUserList.append(card);
  }
}

function createInitialsAvatar(name, className) {
  const initials = document.createElement("span");
  initials.className = `${className} admin-avatar-fallback`;
  initials.setAttribute("aria-hidden", "true");
  initials.textContent = String(name || "R")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
  return initials;
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
  for (const status of ["pending", "approved", "suspended"]) {
    const count = document.querySelector(`#driver-count-${status}`);
    if (count) {
      count.textContent = String(drivers.filter((driver) => driver.status === status).length);
    }
  }
  document.querySelectorAll("[data-driver-status-filter]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.driverStatusFilter === driverStatusFilter),
    );
  });

  driverList.replaceChildren();
  const visibleDrivers = drivers.filter((driver) => driver.status === driverStatusFilter);
  if (visibleDrivers.length === 0) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = `No ${driverStatusFilter === "pending" ? "pending" : driverStatusFilter} driver accounts.`;
    driverList.append(empty);
    return;
  }

  for (const driver of visibleDrivers) {
    const card = document.createElement("article");
    card.className = "admin-record";
    card.dataset.accountId = driver.id;
    card.classList.add("admin-account-open");
    card.setAttribute("aria-label", `Driver account: ${driver.name}`);
    if (driver.avatarUrl) {
      const avatar = document.createElement("img");
      avatar.className = "admin-driver-avatar";
      avatar.src = driver.avatarUrl;
      avatar.alt = `${driver.name}'s profile`;
      card.append(avatar);
    } else {
      card.append(createInitialsAvatar(driver.name, "admin-driver-avatar"));
    }
    const main = document.createElement("div");
    main.className = "admin-record-main";
    const name = document.createElement("h3");
    name.textContent = driver.name;
    const detail = document.createElement("p");
    const vehicleNames = { bike: "Bike · delivery", keke: "Keke", minivan: "Mini bus" };
    detail.textContent = `${vehicleNames[driver.vehicleType] ?? "Vehicle"} · ${driver.plateNumber} · ${driver.phone} · ★ ${Number(driver.rating).toFixed(1)}`;
    const badge = document.createElement("span");
    badge.className = `admin-status-badge ${driver.status}`;
    badge.textContent = driver.status;
    main.append(name, detail, badge);

    const actions = document.createElement("div");
    actions.className = "admin-record-actions";
    actions.append(makeButton("View details", "account-details", driver.id));
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

function makeDetailField(labelText, name, value, options = {}) {
  const field = document.createElement("div");
  field.className = "admin-field";
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.name = name;
  input.value = value ?? "";
  input.type = options.type ?? "text";
  input.required = Boolean(options.required);
  if (options.maxLength) input.maxLength = options.maxLength;
  if (options.pattern) input.pattern = options.pattern;
  if (options.inputMode) input.inputMode = options.inputMode;
  label.htmlFor = `account-detail-${name}`;
  input.id = label.htmlFor;
  field.append(label, input);
  return field;
}

function makeDetailRow(label, value) {
  const row = document.createElement("div");
  row.className = "admin-account-detail-row";
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value || "Not provided";
  row.append(term, description);
  return row;
}

async function openAccountDetails(profileId) {
  try {
    const account = await getAdminAccountDetails(profileId);
    const dialog = document.createElement("dialog");
    dialog.className = "admin-account-dialog";
    dialog.setAttribute("aria-labelledby", "account-detail-title");

    const heading = document.createElement("div");
    heading.className = "admin-account-dialog-heading";
    const title = document.createElement("h2");
    title.id = "account-detail-title";
    title.textContent = `${account.role === "driver" ? "Driver" : "Rider"} details`;
    const closeButton = makeButton("Close", "", "");
    closeButton.addEventListener("click", () => dialog.close());
    heading.append(title, closeButton);
    dialog.append(heading);

    const summary = document.createElement("div");
    summary.className = "admin-account-summary";
    if (account.avatarUrl) {
      const avatar = document.createElement("img");
      avatar.className = "admin-account-avatar";
      avatar.src = account.avatarUrl;
      avatar.alt = `${account.name}'s profile`;
      summary.append(avatar);
    } else {
      summary.append(createInitialsAvatar(account.name, "admin-account-avatar"));
    }
    const identity = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = account.name || "Unnamed account";
    const email = document.createElement("p");
    email.textContent = account.email || "Email unavailable";
    identity.append(name, email);
    summary.append(identity);
    dialog.append(summary);

    const metrics = document.createElement("dl");
    metrics.className = "admin-account-metrics";
    metrics.append(
      makeDetailRow("Total rides", String(account.totalRides ?? 0)),
      makeDetailRow("Completed rides", String(account.completedRides ?? 0)),
      makeDetailRow(
        "Average rating",
        account.role === "driver" && account.averageRating !== null
          ? `${Number(account.averageRating).toFixed(1)} / 5`
          : "Not rated",
      ),
    );
    if (account.role === "driver") {
      metrics.append(
        makeDetailRow("Rated rides", String(account.ratedRides ?? 0)),
        makeDetailRow("Completed ride revenue", formatCash(account.driverRevenue)),
        makeDetailRow("Vehicle", account.vehicleType),
        makeDetailRow("Driver status", account.driverStatus),
        makeDetailRow("Availability", account.isOnline ? "Online" : "Offline"),
        makeDetailRow("Registered", account.registeredAt ? dateFormatter.format(new Date(account.registeredAt)) : ""),
      );
    } else {
      metrics.append(
        makeDetailRow("Registered", account.registeredAt ? dateFormatter.format(new Date(account.registeredAt)) : ""),
      );
    }
    dialog.append(metrics);

    const form = document.createElement("form");
    form.className = "admin-form admin-account-form";
    form.append(
      makeDetailField("Full name", "name", account.name, { required: true, maxLength: 120 }),
      makeDetailField("Phone number", "phone", account.phone, { required: true }),
    );
    if (account.role === "driver") {
      form.append(
        makeDetailField("Vehicle registration / plate number", "plateNumber", account.plateNumber, {
          required: true,
          maxLength: 30,
        }),
        makeDetailField("Bank name", "bankName", account.bankName, { maxLength: 120 }),
        makeDetailField("Bank account number", "bankAccountNumber", account.bankAccountNumber, {
          maxLength: 10,
          pattern: "[0-9]{10}",
          inputMode: "numeric",
        }),
      );
    }
    const photoField = document.createElement("div");
    photoField.className = "admin-field";
    const photoLabel = document.createElement("label");
    photoLabel.htmlFor = "account-detail-photo";
    photoLabel.textContent = "Profile photo";
    const photoInput = document.createElement("input");
    photoInput.id = photoLabel.htmlFor;
    photoInput.name = "photo";
    photoInput.type = "file";
    photoInput.accept = "image/jpeg,image/png,image/webp";
    photoField.append(photoLabel, photoInput);
    form.append(photoField);
    const photoPicker = attachPhotoPicker(photoInput, { shape: "profile" });
    const saveButton = document.createElement("button");
    saveButton.className = "btn btn-primary";
    saveButton.type = "submit";
    saveButton.textContent = "Save account details";
    form.append(saveButton);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      saveButton.disabled = true;
      const photoFile = photoPicker.getFile();
      if (photoFile) {
        photoPicker.setStatus("Uploading photo…", "uploading");
      }
      try {
        const values = new FormData(form);
        const warning = await updateAccountAsAdmin(
          account.id,
          {
            name: values.get("name"),
            phone: values.get("phone"),
            ...(account.role === "driver"
              ? {
                  plateNumber: values.get("plateNumber"),
                  bankName: values.get("bankName"),
                  bankAccountNumber: values.get("bankAccountNumber"),
                }
              : {}),
          },
          photoFile ?? null,
        );
        if (photoFile) {
          photoPicker.clear();
          photoPicker.setStatus("Photo updated.", "success");
        }
        dialog.close();
        showStatus(warning || "Account details updated.");
        await refreshDashboard();
      } catch (error) {
        if (photoFile) {
          photoPicker.setStatus(error.message || "The photo could not be uploaded.", "error");
        }
        showError(error.message);
      } finally {
        saveButton.disabled = false;
      }
    });
    dialog.append(form);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      photoPicker.destroy();
      dialog.remove();
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  } catch (error) {
    showError(`Account details could not be loaded: ${error.message}`);
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

function renderFareMatrix(config, vehicleType) {
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
      input.value = String(config.fareMatrices[vehicleType][pickupZone][destinationZone]);
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
    const service = document.createElement("td");
    service.textContent =
      ride.serviceType === "delivery"
        ? `Bike delivery · ${ride.deliveryDescription ?? "Package"}`
        : `${ride.vehicleType === "minivan" ? "Mini bus" : "Keke"} · ${ride.passengers} passenger${ride.passengers === 1 ? "" : "s"}`;
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
    const cancelledBy = document.createElement("td");
    cancelledBy.textContent = ride.status === "cancelled"
      ? ride.cancelledBy ?? "Not recorded"
      : "—";
    const cancellationReason = document.createElement("td");
    cancellationReason.textContent = ride.status === "cancelled"
      ? ride.cancellationReason ?? "Not provided"
      : "—";
    const cancelledAt = document.createElement("td");
    if (ride.status === "cancelled" && ride.cancelledAt) {
      const cancellationDate = new Date(ride.cancelledAt);
      cancelledAt.textContent = Number.isNaN(cancellationDate.getTime())
        ? "Time unavailable"
        : dateFormatter.format(cancellationDate);
    } else {
      cancelledAt.textContent = ride.status === "cancelled" ? "Not recorded" : "—";
    }
    row.append(route, service, rider, status, pickup, fare, cancelledBy, cancellationReason, cancelledAt);
    rideList.append(row);
  }
  rideEmpty.hidden = filteredRides.length > 0;
}

async function refreshDashboard() {
  const requests = [];

  if (document.querySelector("#metric-rides")) {
    requests.push(
      Promise.all([getDrivers(), getRides({ includeDriver: false }), getRegisteredUsers()]).then(
        ([drivers, rides, users]) => renderMetrics(drivers, rides, users),
      ),
    );
  } else if (registeredUserList || document.querySelector("#metric-users")) {
    requests.push(
      getRegisteredUsers().then((users) => {
        if (registeredUserList) {
          renderRegisteredUsers(users);
        }
        if (document.querySelector("#metric-users")) {
          setText("#metric-users", String(users.length));
        }
      }),
    );
  }
  if (driverList) {
    requests.push(getDrivers().then(renderDrivers));
  }
  if (locationList) {
    requests.push(getLocations().then(renderLocations));
  }
  if (fareMatrix) {
    requests.push(
      getPricingConfig(FARE_CONFIG).then((config) => {
        pricingConfig = config;
        renderFareMatrix(config, document.querySelector("#fare-vehicle-type").value);
      }),
    );
  }
  if (rideList) {
    requests.push(
      getRides({ includeDriver: false }).then((rides) => {
        adminRides = rides;
        renderRides(rides);
      }),
    );
  }

  await Promise.all(requests);
}

async function handleDriverAction(event) {
  const detailButton = event.target.closest("button[data-action='account-details']");
  if (detailButton) {
    openAccountDetails(detailButton.dataset.id);
    return;
  }
  const button = event.target.closest("button[data-action='driver-status']");
  if (!button) {
    const card = event.target.closest(".admin-account-open");
    if (card && driverList.contains(card)) {
      openAccountDetails(card.dataset.accountId);
    }
    return;
  }
  try {
    await setDriverStatus(button.dataset.id, button.dataset.status);
    showStatus(`Driver account ${button.dataset.status}.`);
    await refreshDashboard();
  } catch (error) {
    showError(error.message);
  }
}

async function handleLocationSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches(".admin-location-form")) {
    return;
  }
  event.preventDefault();
  const data = new FormData(form);
  try {
    await updateLocation(form.dataset.locationId, {
      name: data.get("name"),
      zone: data.get("zone"),
      type: data.get("type"),
    });
    showStatus("Location updated.");
    await refreshDashboard();
  } catch (error) {
    showError(error.message);
  }
}

async function handleLocationDelete(event) {
  const button = event.target.closest("button[data-action='delete-location']");
  if (!button) {
    return;
  }
  try {
    await deleteLocation(button.dataset.id);
    showStatus("Location deleted.");
    await refreshDashboard();
  } catch (error) {
    showError(error.message);
  }
}

async function handleLocationCreate(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    await createLocation({
      name: data.get("name"),
      zone: data.get("zone"),
      type: data.get("type"),
    });
    event.currentTarget.reset();
    showStatus("Location added.");
    await refreshDashboard();
  } catch (error) {
    showError(error.message);
  }
}

async function handlePricingSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    const config = pricingConfig ?? await getPricingConfig(FARE_CONFIG);
    const vehicleType = String(data.get("vehicleType"));
    for (const pickupZone of Object.keys(zoneNames)) {
      for (const destinationZone of Object.keys(zoneNames)) {
        config.fareMatrices[vehicleType][pickupZone][destinationZone] = Number(
          data.get(`${pickupZone}:${destinationZone}`),
        );
      }
    }
    pricingConfig = await updatePricingConfig(config);
    showStatus(`${vehicleType} fare settings saved. New estimates and bookings will use these prices.`);
    await refreshDashboard();
  } catch (error) {
    showError(error.message);
  }
}

async function handleLogout() {
  try {
    await logout();
    window.location.assign("login.html");
  } catch (error) {
    showError(`Logout failed: ${error.message}`);
  }
}

async function startAdminDashboard() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "admin") {
      const destination = user?.role === "driver" ? "../driver/login.html" : "../login.html";
      window.location.replace(destination);
      return;
    }

    await refreshDashboard();
    document.querySelector("#admin-logout").addEventListener("click", handleLogout);
    driverList?.addEventListener("click", handleDriverAction);
    registeredUserList?.addEventListener("click", (event) => {
      const card = event.target.closest(".admin-account-open");
      if (card) openAccountDetails(card.dataset.accountId);
    });
    registeredUserList?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const card = event.target.closest(".admin-account-open");
      if (!card) return;
      event.preventDefault();
      openAccountDetails(card.dataset.accountId);
    });
    document.querySelector(".driver-status-filters")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-driver-status-filter]");
      if (!button) return;
      driverStatusFilter = button.dataset.driverStatusFilter;
      getDrivers().then(renderDrivers).catch((error) => showError(error.message));
    });
    locationList?.addEventListener("click", handleLocationDelete);
    locationList?.addEventListener("submit", handleLocationSubmit);
    document.querySelector("#location-create-form")?.addEventListener("submit", handleLocationCreate);
    document.querySelector("#pricing-form")?.addEventListener("submit", handlePricingSubmit);
    document.querySelector("#fare-vehicle-type")?.addEventListener("change", (event) => {
      if (pricingConfig) {
        renderFareMatrix(pricingConfig, event.target.value);
      }
    });
    document.querySelector("#ride-filters")?.addEventListener("input", () => {
      renderRides(adminRides);
    });
  } catch (error) {
    showError(`The admin dashboard could not be loaded: ${error.message}`);
  }
}

startAdminDashboard();
