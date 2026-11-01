import { createRide, getDrivers, getLocations, updateRide } from "./api.js";
import { calculateFare } from "./pricing.js";

const form = document.querySelector("#booking-form");
const pickupSelect = document.querySelector("#pickup");
const destinationSelect = document.querySelector("#destination");
const passengerSelect = document.querySelector("#passengers");
const scheduledFields = document.querySelector("#scheduled-fields");
const scheduledAtInput = document.querySelector("#scheduled-at");
const fareTotalElement = document.querySelector("#fare-total");
const fareBreakdownElement = document.querySelector("#fare-breakdown");
const fareNoteElement = document.querySelector("#fare-note");
const errorElement = document.querySelector("#booking-error");
const statusElement = document.querySelector("#booking-status");
const findRideButton = document.querySelector("#find-ride");
const matchCard = document.querySelector("#match-card");
const matchDetails = document.querySelector("#match-details");
const mapRouteLabel = document.querySelector("#map-route-label");

const currencyFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});
const passengerCountFormatter = new Intl.NumberFormat("en-NG", {
  maximumFractionDigits: 0,
});

let locations = [];

function localDateTimeValue(date) {
  const offsetMilliseconds = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMilliseconds).toISOString().slice(0, 16);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

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
  errorElement.textContent = "";
  errorElement.hidden = true;
  statusElement.textContent = "";
  statusElement.hidden = true;
}

function getSelectedLocation(selectElement) {
  return locations.find((location) => location.id === selectElement.value);
}

function getFareTime() {
  const timing = form.elements.timing.value;
  if (timing === "scheduled") {
    return scheduledAtInput.value;
  }
  return new Date();
}

function getFareForCurrentSelection() {
  const pickup = getSelectedLocation(pickupSelect);
  const destination = getSelectedLocation(destinationSelect);
  if (!pickup || !destination || pickup.id === destination.id) {
    return null;
  }

  return calculateFare(pickup, destination, getFareTime(), Number(passengerSelect.value));
}

function appendBreakdownRow(label, amount, formatter = currencyFormatter) {
  const row = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = formatter.format(amount);
  row.append(term, description);
  fareBreakdownElement.append(row);
}

function updateFareEstimate() {
  const pickup = getSelectedLocation(pickupSelect);
  const destination = getSelectedLocation(destinationSelect);
  mapRouteLabel.textContent =
    pickup && destination ? `${pickup.name} to ${destination.name}` : "Choose your route";

  if (!pickup || !destination) {
    fareTotalElement.textContent = "—";
    fareBreakdownElement.replaceChildren();
    appendBreakdownRow("Base fare", 0);
    fareNoteElement.textContent = "Choose a pickup and destination to see your estimate.";
    return;
  }

  if (pickup.id === destination.id) {
    fareTotalElement.textContent = "—";
    fareBreakdownElement.replaceChildren();
    appendBreakdownRow("Base fare", 0);
    fareNoteElement.textContent = "Choose two different locations to estimate your fare.";
    return;
  }

  if (form.elements.timing.value === "scheduled" && !scheduledAtInput.value) {
    fareTotalElement.textContent = "—";
    fareBreakdownElement.replaceChildren();
    appendBreakdownRow("Base fare", 0);
    fareNoteElement.textContent = "Select a date and time to calculate your scheduled fare.";
    return;
  }

  try {
    const fare = getFareForCurrentSelection();
    fareTotalElement.textContent = currencyFormatter.format(fare.rideTotal);
    fareBreakdownElement.replaceChildren();

    appendBreakdownRow("Fare per passenger", fare.perPassenger);
    appendBreakdownRow("Passengers", fare.passengers, passengerCountFormatter);
    appendBreakdownRow("Total fare", fare.rideTotal);
    fareNoteElement.textContent =
      "Fixed demo fare per person. Time-based surcharges are off; replace placeholder fares before launch.";

    errorElement.hidden = true;
  } catch (error) {
    fareTotalElement.textContent = "Unavailable";
    fareBreakdownElement.replaceChildren();
    fareNoteElement.textContent = "We could not calculate this route's fare.";
    showError(error.message);
  }
}

function populateLocations() {
  locations = getLocations();
  pickupSelect.replaceChildren();
  destinationSelect.replaceChildren();

  for (const selectElement of [pickupSelect, destinationSelect]) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a location";
    placeholder.disabled = true;
    placeholder.selected = true;
    selectElement.append(placeholder);

    for (const location of locations) {
      const option = document.createElement("option");
      option.value = location.id;
      option.textContent = location.name;
      selectElement.append(option);
    }
  }

  if (locations.length < 2) {
    showError("At least two locations are needed before a ride can be booked.");
    findRideButton.disabled = true;
    return;
  }

  pickupSelect.value = locations[0].id;
  destinationSelect.value = locations.find((location) => location.id !== pickupSelect.value).id;
  updateLocationAvailability();
}

function updateLocationAvailability(changedSelect) {
  if (pickupSelect.value && pickupSelect.value === destinationSelect.value) {
    const otherSelect = changedSelect === pickupSelect ? destinationSelect : pickupSelect;
    const alternative = locations.find((location) => location.id !== changedSelect.value);
    if (alternative) {
      otherSelect.value = alternative.id;
    }
  }

  for (const option of pickupSelect.options) {
    option.disabled = option.value !== "" && option.value === destinationSelect.value;
  }
  for (const option of destinationSelect.options) {
    option.disabled = option.value !== "" && option.value === pickupSelect.value;
  }
  updateFareEstimate();
}

function updateTimingFields() {
  const isScheduled = form.elements.timing.value === "scheduled";
  scheduledFields.hidden = !isScheduled;
  scheduledAtInput.required = isScheduled;
  clearMessages();
  updateFareEstimate();
}

function validateBooking() {
  const pickup = getSelectedLocation(pickupSelect);
  const destination = getSelectedLocation(destinationSelect);

  if (!pickup || !destination) {
    throw new Error("Select both a pickup and destination.");
  }
  if (pickup.id === destination.id) {
    throw new Error("Pickup and destination must be different locations.");
  }
  if (form.elements.timing.value === "scheduled") {
    if (!scheduledAtInput.value) {
      throw new Error("Select the date and time for your scheduled ride.");
    }

    const scheduledDate = new Date(scheduledAtInput.value);
    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
      throw new Error("Choose a scheduled pickup time in the future.");
    }
  }

  return { pickup, destination };
}

function selectDemoDriver(drivers) {
  const verifiedDrivers = drivers.filter((driver) => driver.verified);
  if (verifiedDrivers.length === 0) {
    throw new Error("No verified drivers are available for this demo.");
  }

  return verifiedDrivers[Math.floor(Math.random() * verifiedDrivers.length)];
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function findRide(event) {
  event.preventDefault();
  clearMessages();
  matchCard.hidden = true;

  let route;
  let fare;
  try {
    route = validateBooking();
    fare = getFareForCurrentSelection();
    if (!fare) {
      throw new Error("Choose a valid pickup and destination.");
    }
  } catch (error) {
    showError(error.message);
    return;
  }

  const timing = form.elements.timing.value;
  const scheduledAt =
    timing === "scheduled"
      ? new Date(scheduledAtInput.value).toISOString()
      : new Date().toISOString();
  const rideInput = {
    pickup: route.pickup,
    destination: route.destination,
    passengers: Number(passengerSelect.value),
    timing,
    scheduledAt,
    paymentMethod: form.elements.paymentMethod.value,
    rideType: "keke",
    fare,
  };

  findRideButton.disabled = true;
  findRideButton.textContent = "Finding your keke...";
  showStatus("Finding your keke. Please wait while we match you with a verified driver.");

  try {
    const ride = createRide(rideInput);
    await wait(1400);

    const driver = selectDemoDriver(getDrivers());
    const matchedRide = updateRide(ride.id, {
      status: "accepted",
      driver,
      matchedAt: new Date().toISOString(),
    });

    matchDetails.textContent =
      `${driver.name} · ${driver.plateNumber} · ★ ${driver.rating} · ${matchedRide.pickup.name} to ${matchedRide.destination.name}`;
    matchCard.hidden = false;
    showStatus("Your keke has been matched. Tracking details will be available in the next prototype step.");
  } catch (error) {
    showError(error.message);
  } finally {
    findRideButton.disabled = false;
    findRideButton.textContent = "Find a ride";
  }
}

function startBookingPage() {
  scheduledAtInput.min = localDateTimeValue(new Date(Date.now() + 60_000));
  populateLocations();
  updateFareEstimate();

  pickupSelect.addEventListener("change", () => updateLocationAvailability(pickupSelect));
  destinationSelect.addEventListener("change", () =>
    updateLocationAvailability(destinationSelect),
  );
  passengerSelect.addEventListener("change", updateFareEstimate);
  scheduledAtInput.addEventListener("input", updateFareEstimate);
  form.querySelectorAll('input[name="timing"]').forEach((input) => {
    input.addEventListener("change", updateTimingFields);
  });
  form.addEventListener("submit", findRide);
}

try {
  startBookingPage();
} catch (error) {
  showError(`Booking could not be loaded: ${error.message}`);
  findRideButton.disabled = true;
}
