import { getCurrentUser, getLocations } from "./supabase-api.js";

const plannerButton = document.querySelector("#planner-open-button");
const plannerScreen = document.querySelector("#planner-screen");
const plannerCloseButton = document.querySelector("#planner-close");
const matchCard = document.querySelector("#match-card");
const pickupInput = document.querySelector("#planner-pickup");
const destinationInput = document.querySelector("#planner-destination");
const placeList = document.querySelector("#planner-place-list");
const placeListLabel = document.querySelector("#planner-place-list-label");
const locationMessage = document.querySelector("#planner-location-message");
const typeFilters = document.querySelector("#planner-type-filters");
const timeChip = document.querySelector("#planner-time-chip");
const timePicker = document.querySelector("#planner-time-picker");
const scheduleChoice = document.querySelector("#planner-schedule-choice");
const scheduleFields = document.querySelector("#planner-schedule-fields");
const scheduledDateInput = document.querySelector("#planner-scheduled-date");
const scheduledTimeInput = document.querySelector("#planner-scheduled-time");
const scheduleMessage = document.querySelector("#planner-schedule-message");
const passengerChip = document.querySelector("#planner-passenger-chip");
const passengerPicker = document.querySelector("#planner-passenger-picker");
const passengerValue = document.querySelector("#planner-passenger-value");
const passengerDecrease = document.querySelector("#planner-passenger-decrease");
const passengerIncrease = document.querySelector("#planner-passenger-increase");
const swapLocationsButton = document.querySelector("#planner-swap-locations");
const clearPickupButton = document.querySelector('[data-clear-location="pickup"]');
const clearDestinationButton = document.querySelector('[data-clear-location="destination"]');

const RECENT_LOCATION_LIMIT = 5;
const DEFAULT_PASSENGER_COUNT = 1;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let authState = "loading";
let bookingReady = false;
let currentUserId = null;
let locations = [];
let locationTypes = [];
let recentLocationIds = [];
let pickup = null;
let destination = null;
let activeField = "destination";
let searchQuery = "";
let activeTypeFilter = "";
let passengerCount = DEFAULT_PASSENGER_COUNT;
let timing = "now";
let scheduledAt = null;
let returnFocusTarget = null;
let plannerOpen = false;
let historyEntryPending = false;
let closingTimer = null;
let loadGeneration = 0;
let rebookHandled = false;

function getStorageKey(name) {
  return `rider:planner:${currentUserId}:${name}`;
}

function readStorage(key, fallback) {
  try {
    const savedValue = window.localStorage.getItem(key);
    return savedValue === null ? fallback : savedValue;
  } catch (error) {
    console.error(`Planner preference "${key}" could not be read.`, error);
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.error(`Planner preference "${key}" could not be saved.`, error);
  }
}

function normalizeSearchText(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function hasOpenRideCard() {
  return matchCard.isConnected && !matchCard.hidden;
}

function renderEntry() {
  const canOpenPlanner =
    authState === "signed-in" && bookingReady && !hasOpenRideCard();
  plannerButton.hidden = !canOpenPlanner;
  if (!canOpenPlanner && plannerOpen) {
    closePlanner({ restoreFocus: false, fromHistory: true });
  }
}

function maybeOpenRebookPlanner() {
  const params = new URLSearchParams(window.location.search);
  if (
    authState === "signed-in" &&
    bookingReady &&
    params.has("rebookPickup") &&
    params.has("rebookDestination") &&
    !plannerOpen
  ) {
    openPlanner();
  }
}

function setLocationMessage(message, isError = false) {
  locationMessage.textContent = message;
  locationMessage.hidden = !message;
  locationMessage.classList.toggle("is-error", isError);
}

function setPickerVisibility(button, picker, visible) {
  picker.hidden = !visible;
  button.setAttribute("aria-expanded", String(visible));
}

function hidePickers() {
  setPickerVisibility(timeChip, timePicker, false);
  setPickerVisibility(passengerChip, passengerPicker, false);
}

function formatLocalDateTime(date) {
  const offsetMilliseconds = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMilliseconds).toISOString().slice(0, 16);
}

function updateScheduleMinimum() {
  const earliest = new Date(Date.now() + 60_000);
  const earliestLocal = formatLocalDateTime(earliest);
  const [minimumDate, minimumTime] = earliestLocal.split("T");
  scheduledDateInput.min = minimumDate;
  scheduledTimeInput.min =
    scheduledDateInput.value === minimumDate ? minimumTime : "00:00";
  if (!scheduledDateInput.value || scheduledDateInput.value < minimumDate) {
    scheduledDateInput.value = minimumDate;
  }
  if (
    !scheduledTimeInput.value ||
    (scheduledDateInput.value === minimumDate && scheduledTimeInput.value < minimumTime)
  ) {
    scheduledTimeInput.value = minimumTime;
  }
}

function setScheduleMessage(message, isError = false) {
  scheduleMessage.textContent = message;
  scheduleMessage.classList.toggle("is-error", isError);
  scheduleMessage.hidden = !message;
}

function formatScheduledTime(value) {
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function updateTimeChip() {
  timeChip.textContent = timing === "scheduled" && scheduledAt
    ? formatScheduledTime(scheduledAt)
    : "Now";
}

function updatePassengerChip() {
  passengerChip.textContent = `${passengerCount} ${passengerCount === 1 ? "passenger" : "passengers"}`;
  passengerValue.textContent = `${passengerCount} ${passengerCount === 1 ? "passenger" : "passengers"}`;
  passengerDecrease.disabled = passengerCount <= 1;
  passengerIncrease.disabled = passengerCount >= 4;
  swapLocationsButton.disabled = !pickup || !destination;
  clearPickupButton.hidden = !pickup;
  clearDestinationButton.hidden = !destination;
}

function getSavedRecentIds() {
  const savedValue = readStorage(getStorageKey("recent-locations"), "[]");
  try {
    const recentIds = JSON.parse(savedValue);
    return Array.isArray(recentIds) ? recentIds.filter((id) => typeof id === "string") : [];
  } catch (error) {
    console.error("Saved recent campus locations could not be parsed.", error);
    return [];
  }
}

function saveRecentLocation(location) {
  recentLocationIds = [
    location.id,
    ...recentLocationIds.filter((id) => id !== location.id),
  ].slice(0, RECENT_LOCATION_LIMIT);
  writeStorage(getStorageKey("recent-locations"), JSON.stringify(recentLocationIds));
}

function getLocationsForQuery() {
  const normalizedQuery = normalizeSearchText(searchQuery);
  return locations.filter((location) => {
    if (activeTypeFilter && location.type !== activeTypeFilter) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    const searchableText = normalizeSearchText(
      `${location.name} ${location.id.replace(/-/g, " ")} ${location.zone} ${location.type ?? ""}`,
    );
    return searchableText.includes(normalizedQuery);
  });
}

function createPlaceButton(location) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "planner-place-option";
  button.setAttribute("role", "option");
  button.setAttribute("aria-selected", String(
    location.id === pickup?.id || location.id === destination?.id,
  ));
  button.dataset.locationId = location.id;

  const icon = document.createElement("span");
  icon.className = "planner-place-icon";
  icon.setAttribute("aria-hidden", "true");
  const name = document.createElement("span");
  name.className = "planner-place-name";
  name.textContent = location.name;
  const detail = document.createElement("span");
  detail.className = "planner-place-detail";
  detail.textContent = location.type || location.zone;
  button.append(icon, name, detail);
  return button;
}

function createPlaceGroup(title, places) {
  if (places.length === 0) {
    return null;
  }
  const group = document.createElement("section");
  group.className = "planner-place-group";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", title);
  const heading = document.createElement("h3");
  heading.className = "planner-place-group-title";
  heading.textContent = title;
  group.append(heading);
  for (const place of places) {
    group.append(createPlaceButton(place));
  }
  return group;
}

function renderTypeFilters() {
  typeFilters.replaceChildren();
  typeFilters.hidden = locationTypes.length === 0;
  if (locationTypes.length === 0) {
    return;
  }
  const filters = ["", ...locationTypes];
  for (const type of filters) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "planner-filter-chip";
    button.textContent = type || "All";
    button.setAttribute("aria-pressed", String(activeTypeFilter === type));
    button.addEventListener("click", () => {
      activeTypeFilter = type;
      renderTypeFilters();
      renderLocations();
    });
    typeFilters.append(button);
  }
}

function renderLocations() {
  placeList.replaceChildren();
  placeList.setAttribute("aria-busy", String(locations.length === 0));
  if (locations.length === 0) {
    const loading = document.createElement("p");
    loading.className = "planner-place-empty";
    loading.textContent = "Loading campus locations...";
    placeList.append(loading);
    return;
  }

  if (activeField === "destination" && !pickup) {
    const prompt = document.createElement("div");
    prompt.className = "planner-pickup-prompt";
    const promptText = document.createElement("p");
    promptText.textContent = "Choose a pickup location first.";
    const choosePickupButton = document.createElement("button");
    choosePickupButton.type = "button";
    choosePickupButton.className = "planner-pickup-action";
    choosePickupButton.textContent = "Choose pickup";
    choosePickupButton.addEventListener("click", () => focusLocationField("pickup"));
    prompt.append(promptText, choosePickupButton);
    placeList.append(prompt);
    return;
  }

  const filteredPlaces = getLocationsForQuery();
  const filteredIds = new Set(filteredPlaces.map((location) => location.id));
  const recentPlaces = recentLocationIds
    .map((id) => locations.find((location) => location.id === id))
    .filter((location) => location && filteredIds.has(location.id));
  const recentIds = new Set(recentPlaces.map((location) => location.id));
  const allPlaces = filteredPlaces.filter((location) => !recentIds.has(location.id));
  const groups = [];
  const recentGroup = createPlaceGroup("Recent", recentPlaces);
  if (recentGroup) {
    groups.push(recentGroup);
  }

  if (locationTypes.length > 0) {
    for (const type of locationTypes) {
      const typePlaces = allPlaces.filter((location) => location.type === type);
      const group = createPlaceGroup(type, typePlaces);
      if (group) {
        groups.push(group);
      }
    }
    const untypedPlaces = allPlaces.filter((location) => !location.type);
    const untypedGroup = createPlaceGroup("Other campus locations", untypedPlaces);
    if (untypedGroup) {
      groups.push(untypedGroup);
    }
  } else {
    const byZone = new Map();
    for (const location of allPlaces) {
      const zone = location.zone || "Campus locations";
      byZone.set(zone, [...(byZone.get(zone) ?? []), location]);
    }
    for (const [zone, places] of byZone) {
      const group = createPlaceGroup(zone, places);
      if (group) {
        groups.push(group);
      }
    }
  }

  if (groups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "planner-place-empty";
    empty.textContent = searchQuery.trim()
      ? "No matching place. Try a shorter name or check the spelling."
      : "No campus locations are available.";
    placeList.append(empty);
    return;
  }
  placeList.append(...groups);
}

function focusLocationField(field) {
  activeField = field;
  searchQuery = "";
  document.querySelector("#planner-location-tools").hidden = false;
  placeListLabel.textContent = field === "pickup" ? "Choose a pickup" : "Choose a destination";
  if (field === "pickup" || pickup) {
    setLocationMessage("");
  } else {
    setLocationMessage("Choose a pickup location to get started.");
  }
  renderLocations();
  const input = field === "pickup" ? pickupInput : destinationInput;
  input.focus();
}

function dispatchRouteSelection() {
  if (!pickup || !destination) {
    return;
  }
  document.querySelector("#planner-location-tools").hidden = true;
  setLocationMessage("");
  window.dispatchEvent(new CustomEvent("rider:planner-route-selected", {
    detail: {
      pickup,
      destination,
      passengers: passengerCount,
      timing,
      scheduledAt,
    },
  }));
}

function selectLocation(location) {
  if (activeField === "pickup") {
    if (destination?.id === location.id) {
      destination = null;
      destinationInput.value = "";
      setLocationMessage("Pickup and destination must be different places.", true);
    } else {
      setLocationMessage("");
    }
    pickup = location;
    pickupInput.value = location.name;
    writeStorage(getStorageKey("last-pickup"), location.id);
  } else {
    if (!pickup) {
      setLocationMessage("Choose a pickup location before selecting a destination.", true);
      focusLocationField("pickup");
      return;
    }
    if (pickup.id === location.id) {
      setLocationMessage("Pickup and destination must be different places.", true);
      return;
    }
    destination = location;
    destinationInput.value = location.name;
    setLocationMessage("");
  }

  saveRecentLocation(location);
  updatePassengerChip();
  if (pickup && destination) {
    dispatchRouteSelection();
    return;
  }

  if (activeField === "pickup") {
    focusLocationField("destination");
    return;
  }
  renderLocations();
}

function updateLocationControls() {
  clearPickupButton.hidden = !pickup;
  clearDestinationButton.hidden = !destination;
  swapLocationsButton.disabled = !pickup || !destination;
}

function clearLocation(field) {
  if (field === "pickup") {
    pickup = null;
    pickupInput.value = "";
    writeStorage(getStorageKey("last-pickup"), "");
  } else {
    destination = null;
    destinationInput.value = "";
  }
  updateLocationControls();
  focusLocationField(field);
}

function swapLocations() {
  if (!pickup || !destination) {
    return;
  }
  [pickup, destination] = [destination, pickup];
  pickupInput.value = pickup.name;
  destinationInput.value = destination.name;
  writeStorage(getStorageKey("last-pickup"), pickup.id);
  activeField = "destination";
  searchQuery = "";
  setLocationMessage("");
  renderLocations();
  updateLocationControls();
}

function consumeRebookRoute() {
  if (rebookHandled) {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const pickupId = params.get("rebookPickup");
  const destinationId = params.get("rebookDestination");
  if (!pickupId || !destinationId) {
    return;
  }
  rebookHandled = true;
  const requestedVehicle = params.get("vehicle");
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.delete("rebookPickup");
  nextUrl.searchParams.delete("rebookDestination");
  nextUrl.searchParams.delete("passengers");
  nextUrl.searchParams.delete("vehicle");
  window.history.replaceState(window.history.state, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  const savedPickup = locations.find((location) => location.id === pickupId);
  const savedDestination = locations.find((location) => location.id === destinationId);
  if (!savedPickup || !savedDestination || savedPickup.id === savedDestination.id) {
    setLocationMessage("That saved route is no longer available. Choose your locations again.", true);
    return;
  }
  pickup = savedPickup;
  destination = savedDestination;
  pickupInput.value = pickup.name;
  destinationInput.value = destination.name;
  const requestedPassengers = Number(params.get("passengers"));
  passengerCount = Number.isInteger(requestedPassengers)
    ? Math.max(1, Math.min(4, requestedPassengers))
    : DEFAULT_PASSENGER_COUNT;
  updatePassengerChip();
  writeStorage(getStorageKey("last-pickup"), pickup.id);
  updateLocationControls();
  if (requestedVehicle && requestedVehicle !== "keke") {
    setLocationMessage("That vehicle is not available for new bookings yet. Choose a Keke ride instead.", true);
    return;
  }
  dispatchRouteSelection();
}

function handleLocationInput(input, field) {
  activeField = field;
  searchQuery = input.value;
  if (field === "pickup" && pickup?.name !== input.value) {
    pickup = null;
  }
  if (field === "destination" && destination?.name !== input.value) {
    destination = null;
    document.querySelector("#planner-location-tools").hidden = false;
  }
  placeListLabel.textContent = field === "pickup" ? "Choose a pickup" : "Choose a destination";
  setLocationMessage("");
  updateLocationControls();
  renderLocations();
}

async function loadPlannerData(generation) {
  placeList.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "planner-place-empty";
  loading.textContent = "Loading campus locations...";
  placeList.append(loading);
  placeList.setAttribute("aria-busy", "true");
  try {
    const user = await getCurrentUser();
    if (generation !== loadGeneration || !plannerOpen) {
      return;
    }
    if (!user || user.role !== "rider") {
      setLocationMessage("Sign in with a Rider account to plan a trip.", true);
      return;
    }

    if (currentUserId !== user.id || locations.length === 0) {
      currentUserId = user.id;
      locations = await getLocations();
      if (generation !== loadGeneration || !plannerOpen) {
        return;
      }
      locationTypes = [...new Set(
        locations.map((location) => location.type?.trim()).filter(Boolean),
      )].sort((first, second) => first.localeCompare(second));
      recentLocationIds = getSavedRecentIds();
      const lastPickupId = readStorage(getStorageKey("last-pickup"), "");
      pickup = locations.find((location) => location.id === lastPickupId) ?? null;
      pickupInput.value = pickup?.name ?? "";
      destination = null;
      destinationInput.value = "";
    }

    renderTypeFilters();
    placeList.setAttribute("aria-busy", "false");
    document.querySelector("#planner-location-tools").hidden = false;
    placeListLabel.textContent = activeField === "pickup" ? "Choose a pickup" : "Choose a destination";
    renderLocations();
    consumeRebookRoute();
    updateLocationControls();
    if (!pickup) {
      setLocationMessage("Choose a pickup location to get started.");
    } else {
      setLocationMessage("");
    }
  } catch (error) {
    if (generation !== loadGeneration || !plannerOpen) {
      return;
    }
    console.error("The campus locations for the ride planner could not be loaded.", error);
    placeList.setAttribute("aria-busy", "false");
    placeList.replaceChildren();
    const errorMessage = document.createElement("p");
    errorMessage.className = "planner-place-empty is-error";
    errorMessage.textContent = "Campus locations could not be loaded. Check your connection and try again.";
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.className = "planner-pickup-action";
    retryButton.textContent = "Try again";
    retryButton.addEventListener("click", () => loadPlannerData(generation));
    placeList.append(errorMessage, retryButton);
  }
}

function getFocusableElements() {
  return [...plannerScreen.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) =>
    !element.closest("[hidden]") && element.getClientRects().length > 0,
  );
}

function openPlanner() {
  if (plannerButton.hidden || hasOpenRideCard() || plannerOpen) {
    return;
  }
  plannerOpen = true;
  returnFocusTarget = plannerButton;
  activeField = "destination";
  searchQuery = "";
  if (closingTimer !== null) {
    window.clearTimeout(closingTimer);
    closingTimer = null;
  }
  plannerScreen.hidden = false;
  plannerScreen.classList.remove("is-closing");
  document.body.classList.add("planner-screen-open");
  hidePickers();
  document.querySelector("#planner-location-tools").hidden = false;
  requestAnimationFrame(() => plannerScreen.classList.add("is-open"));
  plannerCloseButton.focus();
  window.history.pushState({ ...window.history.state, riderPlanner: true }, "", window.location.href);
  historyEntryPending = true;
  loadGeneration += 1;
  void loadPlannerData(loadGeneration);
  window.setTimeout(() => destinationInput.focus(), 0);
}

function finishClosingPlanner(restoreFocus) {
  plannerScreen.hidden = true;
  plannerScreen.classList.remove("is-closing");
  document.body.classList.remove("planner-screen-open");
  if (restoreFocus && returnFocusTarget?.isConnected && !returnFocusTarget.hidden) {
    returnFocusTarget.focus();
  }
  returnFocusTarget = null;
}

function closePlanner({ restoreFocus = true, fromHistory = false } = {}) {
  if (!plannerOpen) {
    return;
  }
  plannerOpen = false;
  loadGeneration += 1;
  hidePickers();
  plannerScreen.classList.remove("is-open");
  if (!reducedMotion.matches) {
    plannerScreen.classList.add("is-closing");
  }
  if (historyEntryPending && !fromHistory) {
    historyEntryPending = false;
    window.history.back();
  } else {
    historyEntryPending = false;
  }
  if (closingTimer !== null) {
    window.clearTimeout(closingTimer);
  }
  const closeDelay = reducedMotion.matches ? 0 : 240;
  closingTimer = window.setTimeout(() => {
    closingTimer = null;
    finishClosingPlanner(restoreFocus);
  }, closeDelay);
}

function handleFocusTrap(event) {
  if (!plannerOpen || event.key !== "Tab") {
    return;
  }
  const focusableElements = getFocusableElements();
  if (focusableElements.length === 0) {
    event.preventDefault();
    plannerCloseButton.focus();
    return;
  }
  const first = focusableElements[0];
  const last = focusableElements[focusableElements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

window.addEventListener("rider:booking-auth-state", (event) => {
  authState = event.detail.state;
  if (authState !== "signed-in") {
    bookingReady = false;
    closePlanner({ restoreFocus: false });
  }
  renderEntry();
  maybeOpenRebookPlanner();
});

window.addEventListener("rider:booking-ready", () => {
  bookingReady = true;
  renderEntry();
  maybeOpenRebookPlanner();
});

plannerButton.addEventListener("click", openPlanner);
plannerCloseButton.addEventListener("click", () => closePlanner());

pickupInput.addEventListener("focus", () => focusLocationField("pickup"));
destinationInput.addEventListener("focus", () => focusLocationField("destination"));
pickupInput.addEventListener("input", () => handleLocationInput(pickupInput, "pickup"));
destinationInput.addEventListener("input", () => handleLocationInput(destinationInput, "destination"));
placeList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-location-id]");
  if (!button) {
    return;
  }
  const location = locations.find((candidate) => candidate.id === button.dataset.locationId);
  if (location) {
    selectLocation(location);
  }
});

timeChip.addEventListener("click", () => {
  const isExpanded = timeChip.getAttribute("aria-expanded") === "true";
  setPickerVisibility(passengerChip, passengerPicker, false);
  setPickerVisibility(timeChip, timePicker, !isExpanded);
  if (!isExpanded) {
    scheduleFields.hidden = timing !== "scheduled";
    document.querySelector("#planner-now-choice").setAttribute("aria-pressed", String(timing === "now"));
    scheduleChoice.setAttribute("aria-pressed", String(timing === "scheduled"));
    if (timing === "scheduled" && scheduledAt) {
      const localValue = formatLocalDateTime(new Date(scheduledAt));
      [scheduledDateInput.value, scheduledTimeInput.value] = localValue.split("T");
    }
    updateScheduleMinimum();
  }
});

document.querySelector("#planner-now-choice").addEventListener("click", () => {
  timing = "now";
  scheduledAt = null;
  scheduleFields.hidden = true;
  document.querySelector("#planner-now-choice").setAttribute("aria-pressed", "true");
  scheduleChoice.setAttribute("aria-pressed", "false");
  updateTimeChip();
  setPickerVisibility(timeChip, timePicker, false);
  window.dispatchEvent(new CustomEvent("rider:planner-selection-changed", {
    detail: { passengers: passengerCount, timing, scheduledAt },
  }));
});

scheduleChoice.addEventListener("click", () => {
  scheduleFields.hidden = false;
  document.querySelector("#planner-now-choice").setAttribute("aria-pressed", "false");
  scheduleChoice.setAttribute("aria-pressed", "true");
  setScheduleMessage("");
  updateScheduleMinimum();
  scheduledDateInput.focus();
});

scheduledDateInput.addEventListener("change", updateScheduleMinimum);

document.querySelector("#planner-time-apply").addEventListener("click", () => {
  const localDateTime = `${scheduledDateInput.value}T${scheduledTimeInput.value}`;
  const chosenDate = new Date(localDateTime);
  if (
    !scheduledDateInput.value ||
    !scheduledTimeInput.value ||
    Number.isNaN(chosenDate.getTime()) ||
    chosenDate.getTime() < Date.now() + 60_000
  ) {
    setScheduleMessage("Choose a date and time at least one minute from now.", true);
    updateScheduleMinimum();
    scheduledDateInput.focus();
    return;
  }
  timing = "scheduled";
  scheduledAt = chosenDate.toISOString();
  updateTimeChip();
  setPickerVisibility(timeChip, timePicker, false);
  setScheduleMessage("");
  window.dispatchEvent(new CustomEvent("rider:planner-selection-changed", {
    detail: { passengers: passengerCount, timing, scheduledAt },
  }));
});

passengerChip.addEventListener("click", () => {
  const isExpanded = passengerChip.getAttribute("aria-expanded") === "true";
  setPickerVisibility(timeChip, timePicker, false);
  setPickerVisibility(passengerChip, passengerPicker, !isExpanded);
  if (!isExpanded) {
    passengerDecrease.focus();
  }
});

function setPassengerCount(nextCount) {
  passengerCount = Math.max(1, Math.min(4, nextCount));
  updatePassengerChip();
  window.dispatchEvent(new CustomEvent("rider:planner-selection-changed", {
    detail: { passengers: passengerCount, timing, scheduledAt },
  }));
}

window.addEventListener("rider:ride-options-passengers-changed", (event) => {
  passengerCount = Math.max(1, Math.min(4, Number(event.detail?.passengers) || 1));
  updatePassengerChip();
});

passengerDecrease.addEventListener("click", () => setPassengerCount(passengerCount - 1));
passengerIncrease.addEventListener("click", () => setPassengerCount(passengerCount + 1));
clearPickupButton.addEventListener("click", () => clearLocation("pickup"));
clearDestinationButton.addEventListener("click", () => clearLocation("destination"));
swapLocationsButton.addEventListener("click", swapLocations);

window.addEventListener("rider:planner-focus-field", (event) => {
  focusLocationField(event.detail?.field === "destination" ? "destination" : "pickup");
});

window.addEventListener("rider:planner-open-time-picker", () => {
  setPickerVisibility(passengerChip, passengerPicker, false);
  setPickerVisibility(timeChip, timePicker, true);
  scheduleFields.hidden = true;
  document.querySelector("#planner-now-choice").setAttribute("aria-pressed", "true");
  scheduleChoice.setAttribute("aria-pressed", "false");
  updateScheduleMinimum();
  timeChip.focus();
});

document.addEventListener("keydown", (event) => {
  if (!plannerOpen || !document.querySelector("#ride-options-sheet").hidden) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closePlanner();
  } else {
    handleFocusTrap(event);
  }
});

window.addEventListener("popstate", () => {
  if (!plannerOpen) {
    return;
  }
  historyEntryPending = false;
  closePlanner({ fromHistory: true });
});

window.addEventListener("rider:planner-close-after-booking", () => {
  closePlanner({ restoreFocus: false });
});

const rideCardObserver = new MutationObserver(renderEntry);
rideCardObserver.observe(matchCard, { attributes: true, attributeFilter: ["hidden"] });
rideCardObserver.observe(matchCard.parentElement, { childList: true });

updateTimeChip();
updatePassengerChip();
