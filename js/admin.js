import "./notifications.js";
import {
  createLocation,
  deleteLocation,
  getCurrentUser,
  getAdminAccountDetails,
  getDrivers,
  getLocations,
  getRegisteredUsers,
  getRides,
  logout,
  setDriverStatus,
  updateAccountAsAdmin,
  updateLocation,
  updatePricingConfig,
} from "./supabase-api.js?v=account-details";
import { calculateFare, loadFareConfig } from "./pricing.js?v=admin";
import { attachPhotoPicker } from "./photo-picker.js";
import { createLoadingState } from "./loading.js";

const adminStatus = document.querySelector("#admin-status");
const adminError = document.querySelector("#admin-error");
const registeredUserList = document.querySelector("#registered-user-list");
const driverList = document.querySelector("#driver-list");
const locationList = document.querySelector("#location-list");
const fareMatrix = document.querySelector("#fare-matrix");
const rideList = document.querySelector("#ride-list");
const rideEmpty = document.querySelector("#ride-empty");
const usersContent = document.querySelector("#users-content");
const driversContent = document.querySelector("#drivers-content");
const pricingContent = document.querySelector("#pricing-content");
const usersLoader = usersContent
  ? createLoadingState(document.querySelector("#users-load-container"), usersContent, { label: "Loading accounts…" })
  : null;
const driversLoader = driversContent
  ? createLoadingState(document.querySelector("#drivers-load-container"), driversContent, { label: "Loading drivers…" })
  : null;
const pricingLoader = pricingContent
  ? createLoadingState(document.querySelector("#pricing-load-container"), pricingContent, { label: "Loading fare settings…" })
  : null;
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
const joinDateFormatter = new Intl.DateTimeFormat("en-NG", { dateStyle: "medium" });
let driverStatusFilter = "pending";
let pricingConfig = null;
let savedKekeFareMatrix = null;
let adminRides = [];
let registeredUsers = [];
let registeredDrivers = [];
let selectedUserTab = "rider";
let pricingLocations = [];

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

function renderRegisteredUsers() {
  const riders = registeredUsers.filter((user) => user.role === "rider");
  const count = document.querySelector("#metric-users");
  if (count) count.textContent = String(riders.length + registeredDrivers.length);
  document.querySelector("#users-count-riders").textContent = String(riders.length);
  document.querySelector("#users-count-drivers").textContent = String(registeredDrivers.length);

  const search = String(document.querySelector("#users-search").value || "").trim().toLocaleLowerCase();
  const users = selectedUserTab === "driver" ? registeredDrivers : riders;
  const filteredUsers = users.filter((user) =>
    `${user.name || ""} ${user.phone || ""}`.toLocaleLowerCase().includes(search),
  );
  document.querySelectorAll("[data-user-tab]").forEach((tab) => {
    const active = tab.dataset.userTab === selectedUserTab;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  const activeTab = document.querySelector(`[data-user-tab="${selectedUserTab}"]`);
  registeredUserList.setAttribute("aria-labelledby", activeTab.id);

  registeredUserList.replaceChildren();
  if (filteredUsers.length === 0) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = search
      ? "No accounts match your search."
      : `No ${selectedUserTab === "rider" ? "rider" : "driver"} accounts have been registered.`;
    registeredUserList.append(empty);
    return;
  }

  for (const user of filteredUsers) {
    const card = document.createElement("article");
    card.className = "admin-record";
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
        ? `Joined ${joinDateFormatter.format(registeredDate)}`
        : "Registration date unavailable";
    detail.textContent = `${user.phone || "No phone number"} · ${registeredLabel}`;

    const role = document.createElement("span");
    role.className = `admin-status-badge ${user.role}`;
    role.textContent = user.role;
    main.append(name, detail);
    if (user.role === "driver") {
      const approval = document.createElement("span");
      approval.className = `admin-status-badge ${user.status || "pending"}`;
      approval.textContent = user.status || "Approval unavailable";
      const availability = document.createElement("span");
      availability.className = `admin-status-badge ${user.isOnline ? "online" : "offline"}`;
      availability.textContent = user.isOnline ? "Online" : "Offline";
      main.append(role, approval, availability);
    } else {
      main.append(role);
    }
    card.append(main);
    const actions = document.createElement("div");
    actions.className = "admin-record-actions";
    actions.append(makeButton("View details", "user-account-details", user.id));
    if (user.role === "driver") {
      const driversLink = document.createElement("a");
      driversLink.className = "btn btn-secondary";
      driversLink.href = "drivers.html";
      driversLink.textContent = "Manage drivers";
      actions.append(driversLink);
    }
    card.append(actions);
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
    detail.textContent = `${vehicleNames[driver.vehicleType] ?? "Vehicle"} · ${driver.plateNumber || "No plate number"} · ${driver.phone || "No phone number"} · ★ ${Number(driver.rating).toFixed(1)}`;
    const badge = document.createElement("span");
    badge.className = `admin-status-badge ${driver.status}`;
    badge.textContent = driver.status;
    const availability = document.createElement("span");
    availability.className = `admin-status-badge ${driver.isOnline ? "online" : "offline"}`;
    availability.textContent = driver.isOnline ? "Online" : "Offline";
    main.append(name, detail, badge, availability);

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
  let symmetric = true;
  for (const pickupZone of zones) {
    const group = document.createElement("section");
    group.className = "fare-route-group";
    const heading = document.createElement("h3");
    heading.textContent = `Starting in ${zoneNames[pickupZone]}`;
    group.append(heading);
    for (const destinationZone of zones) {
      if (
        pickupZone !== destinationZone &&
        config.fareMatrices[vehicleType][pickupZone][destinationZone] !==
          config.fareMatrices[vehicleType][destinationZone][pickupZone]
      ) {
        symmetric = false;
      }
      const route = document.createElement("div");
      route.className = "fare-route";
      const routeLabel = document.createElement("label");
      routeLabel.className = "fare-route-label";
      routeLabel.textContent = `${zoneNames[pickupZone]} to ${zoneNames[destinationZone]}`;
      const input = document.createElement("input");
      input.id = `fare-${pickupZone}-${destinationZone}`;
      input.name = `${pickupZone}:${destinationZone}`;
      input.type = "number";
      input.min = "1";
      input.max = "100000";
      input.step = "1";
      input.required = true;
      input.value = String(config.fareMatrices[vehicleType][pickupZone][destinationZone]);
      input.dataset.pickupZone = pickupZone;
      input.dataset.destinationZone = destinationZone;
      input.setAttribute("aria-label", `${zoneNames[pickupZone]} to ${zoneNames[destinationZone]} fare in naira`);
      routeLabel.htmlFor = input.id;
      route.append(routeLabel, input);
      group.append(route);
    }
    fareMatrix.append(group);
  }
  document.querySelector("#same-price-both-ways").checked = symmetric;
}

function renderPricingLocations(locations) {
  for (const id of ["#try-fare-pickup", "#try-fare-destination"]) {
    const select = document.querySelector(id);
    select.replaceChildren();
    const prompt = document.createElement("option");
    prompt.value = "";
    prompt.textContent = locations.length ? "Choose a location" : "No active locations available";
    prompt.disabled = true;
    prompt.selected = true;
    select.append(prompt);
    for (const location of locations) {
      const option = document.createElement("option");
      option.value = location.id;
      option.textContent = location.name;
      option.dataset.zone = location.zone;
      select.append(option);
    }
    select.disabled = locations.length === 0;
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
  if (usersLoader) {
    usersLoader.showLoading();
    try {
      const [users, drivers] = await Promise.all([getRegisteredUsers(), getDrivers()]);
      registeredUsers = users.filter((user) => user.role === "rider");
      const driversById = new Map(drivers.map((driver) => [driver.id, driver]));
      registeredDrivers = users
        .filter((user) => user.role === "driver")
        .map((user) => {
          const driver = driversById.get(user.id);
          return {
            ...driver,
            ...user,
            role: "driver",
            status: driver?.status ?? "pending",
            isOnline: driver?.isOnline ?? false,
          };
        });
      renderRegisteredUsers();
      usersLoader.showLoaded();
    } catch (error) {
      usersLoader.showError(error, () => { void refreshDashboard(); });
    }
    return;
  }
  if (driversLoader) {
    driversLoader.showLoading();
    try {
      registeredDrivers = await getDrivers();
      renderDrivers(registeredDrivers);
      driversLoader.showLoaded();
    } catch (error) {
      driversLoader.showError(error, () => { void refreshDashboard(); });
    }
    return;
  }
  if (pricingLoader) {
    pricingLoader.showLoading();
    try {
      const [config, locations] = await Promise.all([loadFareConfig(), getLocations()]);
      pricingConfig = config;
      savedKekeFareMatrix = copyFareMatrix(config.fareMatrices.keke);
      pricingLocations = locations;
      renderFareMatrix(config, "keke");
      renderPricingLocations(locations);
      updatePricingDirtyState();
      pricingLoader.showLoaded();
    } catch (error) {
      pricingLoader.showError(error, () => { void refreshDashboard(); });
    }
    return;
  }

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
      loadFareConfig().then((config) => {
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

function updatePricingDirtyState() {
  const saveButton = document.querySelector("#pricing-save");
  if (!pricingConfig || !saveButton) return;
  const vehicleType = document.querySelector("#fare-vehicle-type").value;
  const dirty = [...fareMatrix.querySelectorAll("input")].some((input) => {
    const [pickupZone, destinationZone] = input.name.split(":");
    return Number(input.value) !== savedKekeFareMatrix[pickupZone][destinationZone];
  });
  document.querySelector("#pricing-unsaved").textContent = dirty
    ? "Unsaved changes"
    : "All changes saved.";
  saveButton.disabled = !dirty;
}

function copyFareMatrix(matrix) {
  return Object.fromEntries(
    Object.entries(matrix).map(([pickupZone, destinations]) => [
      pickupZone,
      { ...destinations },
    ]),
  );
}

function syncFareMatrixToConfig() {
  if (!pricingConfig) return;
  const vehicleType = document.querySelector("#fare-vehicle-type").value;
  for (const input of fareMatrix.querySelectorAll("input")) {
    const value = Number(input.value);
    if (Number.isFinite(value)) {
      pricingConfig.fareMatrices[vehicleType][input.dataset.pickupZone][input.dataset.destinationZone] = value;
    }
  }
}

function handleFareInput(event) {
  const input = event.target.closest(".fare-route input");
  if (!input) return;
  if (document.querySelector("#same-price-both-ways").checked) {
    const reverse = fareMatrix.querySelector(
      `input[data-pickup-zone="${input.dataset.destinationZone}"][data-destination-zone="${input.dataset.pickupZone}"]`,
    );
    if (reverse && reverse !== input) reverse.value = input.value;
  }
  syncFareMatrixToConfig();
  updatePricingDirtyState();
}

function handleSymmetricFareToggle(event) {
  const toggle = event.currentTarget;
  if (!toggle.checked) return;
  const zones = Object.keys(zoneNames);
  const hasDifferentReverseFares = zones.some((pickup, pickupIndex) =>
    zones.slice(pickupIndex + 1).some((destination) => {
      const forward = fareMatrix.querySelector(
        `input[data-pickup-zone="${pickup}"][data-destination-zone="${destination}"]`,
      );
      const reverse = fareMatrix.querySelector(
        `input[data-pickup-zone="${destination}"][data-destination-zone="${pickup}"]`,
      );
      return forward.value !== reverse.value;
    }),
  );
  if (
    hasDifferentReverseFares &&
    !window.confirm(
      "Some reverse-route prices differ. For each pair, the fare in the first direction shown in zone order will replace its reverse fare in this form. Nothing is saved until you confirm Save.",
    )
  ) {
    toggle.checked = false;
    return;
  }
  if (hasDifferentReverseFares) {
    zones.forEach((pickup, pickupIndex) => {
      zones.slice(pickupIndex + 1).forEach((destination) => {
        const forward = fareMatrix.querySelector(
          `input[data-pickup-zone="${pickup}"][data-destination-zone="${destination}"]`,
        );
        const reverse = fareMatrix.querySelector(
          `input[data-pickup-zone="${destination}"][data-destination-zone="${pickup}"]`,
        );
        reverse.value = forward.value;
      });
    });
  }
  syncFareMatrixToConfig();
  updatePricingDirtyState();
}

async function handlePricingSubmit(event) {
  event.preventDefault();
  const inputs = [...fareMatrix.querySelectorAll("input")];
  if (!inputs.every((input) => input.reportValidity())) return;
  const invalidFare = inputs.find((input) => {
    const value = Number(input.value);
    return !Number.isInteger(value) || value <= 0 || value > 100000;
  });
  if (invalidFare) {
    invalidFare.setCustomValidity("Enter a whole-naira fare from ₦1 to ₦100,000.");
    invalidFare.reportValidity();
    invalidFare.setCustomValidity("");
    return;
  }
  if (!window.confirm("Save these Keke fares? New estimates and bookings will use these prices.")) {
    return;
  }

  const vehicleType = document.querySelector("#fare-vehicle-type").value;
  const fareMatrices = {
    ...pricingConfig.fareMatrices,
    [vehicleType]: { ...pricingConfig.fareMatrices[vehicleType] },
  };
  for (const pickupZone of Object.keys(zoneNames)) {
    fareMatrices[vehicleType][pickupZone] = {
      ...fareMatrices[vehicleType][pickupZone],
    };
    for (const destinationZone of Object.keys(zoneNames)) {
      const input = fareMatrix.querySelector(
        `input[data-pickup-zone="${pickupZone}"][data-destination-zone="${destinationZone}"]`,
      );
      fareMatrices[vehicleType][pickupZone][destinationZone] = Number(input.value);
    }
  }
  const saveButton = document.querySelector("#pricing-save");
  saveButton.disabled = true;
  try {
    pricingConfig = await updatePricingConfig({ ...pricingConfig, fareMatrices });
    pricingConfig = await loadFareConfig();
    savedKekeFareMatrix = copyFareMatrix(pricingConfig.fareMatrices.keke);
    renderFareMatrix(pricingConfig, vehicleType);
    updatePricingDirtyState();
    showStatus("Keke fares saved. New estimates and bookings will use these prices.");
  } catch (error) {
    updatePricingDirtyState();
    showError(error.message);
  }
}

function handleTryFare(event) {
  event.preventDefault();
  const pickup = document.querySelector("#try-fare-pickup");
  const destination = document.querySelector("#try-fare-destination");
  const passengers = Number(document.querySelector("#try-fare-passengers").value);
  const pickupOption = pickup.selectedOptions[0];
  const destinationOption = destination.selectedOptions[0];
  const output = document.querySelector("#try-fare-result");
  try {
    const faresAreValid = [...fareMatrix.querySelectorAll("input")].every((input) =>
      input.checkValidity() &&
      Number.isInteger(Number(input.value)) &&
      Number(input.value) > 0 &&
      Number(input.value) <= 100000,
    );
    if (!faresAreValid) {
      throw new Error("Enter valid whole-naira fares before previewing an estimate.");
    }
    if (!pickupOption?.dataset.zone || !destinationOption?.dataset.zone) {
      throw new Error("Choose both a pickup and destination.");
    }
    const fare = calculateFare(
      pickupOption.dataset.zone,
      destinationOption.dataset.zone,
      new Date(),
      passengers,
      "keke",
    );
    output.textContent = `${formatCash(fare.perPassenger)} per passenger · ${formatCash(fare.total)} total for ${fare.passengers} passenger${fare.passengers === 1 ? "" : "s"}. Rounded to the nearest ₦50.`;
  } catch (error) {
    output.textContent = error.message;
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
      const button = event.target.closest("[data-action='user-account-details']");
      if (button) openAccountDetails(button.dataset.id);
    });
    document.querySelector(".admin-user-tabs")?.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-user-tab]");
      if (!tab) return;
      selectedUserTab = tab.dataset.userTab;
      renderRegisteredUsers();
    });
    document.querySelector(".admin-user-tabs")?.addEventListener("keydown", (event) => {
      const tabs = [...document.querySelectorAll("[data-user-tab]")];
      const currentIndex = tabs.indexOf(event.target);
      if (currentIndex < 0) return;
      const nextIndex = event.key === "ArrowRight"
        ? (currentIndex + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (currentIndex - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
      if (nextIndex < 0) return;
      event.preventDefault();
      tabs[nextIndex].focus();
      tabs[nextIndex].click();
    });
    document.querySelector("#users-search")?.addEventListener("input", renderRegisteredUsers);
    document.querySelector(".driver-status-filters")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-driver-status-filter]");
      if (!button) return;
      driverStatusFilter = button.dataset.driverStatusFilter;
      renderDrivers(registeredDrivers);
    });
    locationList?.addEventListener("click", handleLocationDelete);
    locationList?.addEventListener("submit", handleLocationSubmit);
    document.querySelector("#location-create-form")?.addEventListener("submit", handleLocationCreate);
    document.querySelector("#pricing-form")?.addEventListener("submit", handlePricingSubmit);
    fareMatrix?.addEventListener("input", handleFareInput);
    document.querySelector("#same-price-both-ways")?.addEventListener("change", handleSymmetricFareToggle);
    document.querySelector(".pricing-vehicle-selector")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-pricing-vehicle]");
      if (!button || button.disabled || !pricingConfig) return;
      document.querySelectorAll("[data-pricing-vehicle]").forEach((option) => {
        option.setAttribute("aria-pressed", String(option === button));
      });
      document.querySelector("#fare-vehicle-type").value = button.dataset.pricingVehicle;
      renderFareMatrix(pricingConfig, button.dataset.pricingVehicle);
      updatePricingDirtyState();
    });
    document.querySelector("#try-fare-form")?.addEventListener("submit", handleTryFare);
    document.querySelector("#ride-filters")?.addEventListener("input", () => {
      renderRides(adminRides);
    });
  } catch (error) {
    showError(`The admin dashboard could not be loaded: ${error.message}`);
  }
}

startAdminDashboard();
