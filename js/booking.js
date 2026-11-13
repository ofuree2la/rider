import "./notifications.js";
import {
  cancelRideRequest,
  createRide,
  getCurrentUser,
  getLocations,
  getRide,
  getRides,
} from "./supabase-api.js";
import { calculateFare, loadFareConfig } from "./pricing.js";
import { isOnlinePaymentConfigured } from "./payment.js";
import { supabase } from "./supabase-client.js";
import { clearSavedBookingConfirmation, confirmRideCancellation } from "./cancel-ride-dialog.js";
import { mountNoRideAvailablePrompt } from "./no-ride-available.js";

const form = document.querySelector("#booking-form");
const pickupInput = document.querySelector("#pickup");
const destinationInput = document.querySelector("#destination");
const pickupSuggestions = document.querySelector("#pickup-suggestions");
const destinationSuggestions = document.querySelector("#destination-suggestions");
const passengerSelect = document.querySelector("#passengers");
const passengerFields = document.querySelector("#passenger-fields");
const vehicleTypeInputs = [...document.querySelectorAll('input[name="vehicle-type"]')];
const deliveryFields = document.querySelector("#delivery-fields");
const deliveryDescriptionInput = document.querySelector("#delivery-description");
const recipientNameInput = document.querySelector("#recipient-name");
const recipientPhoneInput = document.querySelector("#recipient-phone");
const scheduledFields = document.querySelector("#scheduled-fields");
const scheduledAtInput = document.querySelector("#scheduled-at");
const fareTotalElement = document.querySelector("#fare-total");
const fareBreakdownElement = document.querySelector("#fare-breakdown");
const fareNoteElement = document.querySelector("#fare-note");
const errorElement = document.querySelector("#booking-error");
const statusElement = document.querySelector("#booking-status");
const findRideButton = document.querySelector("#find-ride");
const matchCard = document.querySelector("#match-card");
const matchCardContent = document.querySelector("#match-card-content");
const matchTitle = document.querySelector("#match-title");
const matchDetails = document.querySelector("#match-details");
const matchTrackingLink = document.querySelector("#match-tracking-link");
const matchCancelButton = document.querySelector("#match-cancel-button");
const matchBookAgainLink = document.querySelector("#match-book-again-link");
const bookingNoRidePromptRoot = document.querySelector("#booking-no-ride-prompt");
const bookingRetryCard = document.querySelector("#booking-retry-card");
const bookingRetryTitle = document.querySelector("#booking-retry-title");
const bookingRetryDetails = document.querySelector("#booking-retry-details");
const bookingRetryCreateButton = document.querySelector("#booking-retry-create");
const mapRouteLabel = document.querySelector("#map-route-label");
const paymentMethodSelect = document.querySelector("#payment-method");
const onlinePaymentOption = paymentMethodSelect.querySelector('option[value="online"]');
const emailField = document.querySelector("#email-field");
const emailInput = document.querySelector("#customer-email");
const LAST_BOOKED_RIDE_KEY = "rider:last-booked-ride";
const RIDE_STATUS_REFRESH_INTERVAL_MS = 45_000;
const CANCELLATION_FEEDBACK_MS = 1_500;
const CANCELLATION_COLLAPSE_MS = 400;
const reusableMatchCardContent = document.createDocumentFragment();
reusableMatchCardContent.append(...matchCardContent.childNodes);

const currencyFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});
const passengerCountFormatter = new Intl.NumberFormat("en-NG", {
  maximumFractionDigits: 0,
});

let locations = [];
let currentUser = null;
let selectedPickup = null;
let selectedDestination = null;
let bookingStatusChannel = null;
let bookingStatusTimer = null;
let bookingStatusRideId = null;
let bookingStatusGeneration = 0;
let isBookingStatusRefreshRunning = false;
let isBookingCancellationInProgress = false;
let isRetryCreateInProgress = false;
let currentBookingRide = null;
let pendingReplacementInput = null;
let pendingReplacementSource = null;
let cancellationFeedbackTimer = null;
let cancellationCollapseTimer = null;
let cancellationFeedbackRideId = null;
const activeSuggestionIndexes = new WeakMap();
const noRidePrompt = mountNoRideAvailablePrompt(bookingNoRidePromptRoot, {
  onTryAgain: handleTryAgain,
  onCancel: handleBookingCancellation,
});

function localDateTimeValue(date) {
  const offsetMilliseconds = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMilliseconds).toISOString().slice(0, 16);
}

function getRideInputForRetry(ride) {
  return {
    serviceType: ride.serviceType,
    vehicleType: ride.vehicleType,
    pickup: ride.pickup,
    destination: ride.destination,
    passengers: ride.passengers,
    timing: "now",
    scheduledAt: null,
    paymentMethod: ride.paymentMethod,
    customerEmail: currentUser.email,
    fare: ride.fare,
    deliveryDescription: ride.deliveryDescription,
    recipientName: ride.recipientName,
    recipientPhone: ride.recipientPhone,
  };
}

async function findOpenImmediateRide() {
  const rides = await getRides({
    userId: currentUser.id,
    status: "finding",
    includeDriver: false,
  });
  return rides
    .filter((ride) => ride.timing === "now" && !ride.scheduledAt)
    .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt))[0] ?? null;
}

function saveBookingRideId(rideId) {
  try {
    window.sessionStorage.setItem(LAST_BOOKED_RIDE_KEY, rideId);
    return true;
  } catch (error) {
    console.error("The submitted booking could not be saved for page refresh.", error);
    return false;
  }
}

function completeReplacementBooking(ride) {
  pendingReplacementInput = null;
  pendingReplacementSource = null;
  bookingRetryCard.hidden = true;
  saveBookingRideId(ride.id);
  showSubmittedRide(ride);
  showStatus("Your new request has been sent to matching approved drivers.");
  if (!["completed", "cancelled"].includes(ride.status)) {
    watchBookingStatus(ride.id);
  }
}

async function createReplacementBooking() {
  if (!pendingReplacementInput || isRetryCreateInProgress) {
    return;
  }

  isRetryCreateInProgress = true;
  bookingRetryCreateButton.disabled = true;
  bookingRetryTitle.textContent = "Finding a new ride";
  bookingRetryDetails.textContent = "Sending a new request with the same trip details...";
  try {
    const newRide = await createRide(pendingReplacementInput);
    completeReplacementBooking(newRide);
  } catch (error) {
    try {
      const replacementRide = await findReplacementRide(
        pendingReplacementSource,
        pendingReplacementInput,
      );
      if (replacementRide) {
        completeReplacementBooking(replacementRide);
        showStatus("Your request was already sent. You can track it here.");
        return;
      }
    } catch (lookupError) {
      console.error("The replacement request outcome could not be checked.", lookupError);
    }

    console.error("The replacement ride request could not be created.", error);
    bookingRetryTitle.textContent = "Your request was cancelled, but a new request was not sent";
    bookingRetryDetails.textContent =
      "Your previous request was cancelled, but the new request could not be sent. Your booking details are still available; try sending again.";
  } finally {
    isRetryCreateInProgress = false;
    bookingRetryCreateButton.disabled = false;
  }
}

async function findReplacementRide(previousRide, input) {
  const rides = await getRides({
    userId: currentUser.id,
    createdAfter: previousRide.createdAt,
    includeDriver: false,
  });
  const previousCreatedAt = new Date(previousRide.createdAt).getTime();
  return rides
    .filter((candidate) =>
      candidate.id !== previousRide.id &&
      candidate.timing === "now" &&
      candidate.status !== "cancelled" &&
      new Date(candidate.createdAt).getTime() > previousCreatedAt &&
      candidate.serviceType === input.serviceType &&
      candidate.vehicleType === input.vehicleType &&
      candidate.pickup?.id === input.pickup?.id &&
      candidate.destination?.id === input.destination?.id,
    )
    .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt))[0] ?? null;
}

async function handleTryAgain(previousRide) {
  const retryInput = getRideInputForRetry(previousRide);
  let cancelledRide;
  try {
    cancelledRide = await cancelRideRequest(previousRide.id, "other");
    if (cancelledRide.status !== "cancelled") {
      throw new Error("The old request was not cancelled.");
    }
  } catch (cancelError) {
    let latestRide;
    try {
      latestRide = await getRide(previousRide.id, { includeDriver: false });
    } catch (refreshError) {
      showError("Connection problem. Check the ride status before trying again.");
      console.error("The old request status could not be confirmed after retry cancellation.", {
        cancelError,
        refreshError,
      });
      return;
    }

    if (latestRide && ["accepted", "arriving", "on-trip"].includes(latestRide.status)) {
      currentBookingRide = latestRide;
      showSubmittedRide(latestRide, true);
      showStatus("A driver accepted your request. No new request was created.");
      return;
    }
    if (latestRide?.status !== "cancelled") {
      showError("We couldn’t cancel the existing request, so no new request was created. Please keep waiting or cancel it.");
      console.error("The old request could not be cancelled before retrying.", cancelError);
      return;
    }
    cancelledRide = latestRide;
  }

  stopBookingStatusUpdates();
  clearSavedBookingConfirmation(previousRide.id);
  removeBookingCard();
  pendingReplacementInput = retryInput;
  pendingReplacementSource = previousRide;
  bookingRetryTitle.textContent = "Finding a new ride";
  bookingRetryDetails.textContent = "Sending a new request with the same trip details...";
  bookingRetryCard.hidden = false;
  await createReplacementBooking();
}

function showError(message, link = null) {
  errorElement.textContent = message;
  if (link) {
    errorElement.append(document.createTextNode(" "));
    const anchor = document.createElement("a");
    anchor.href = link.href;
    anchor.textContent = link.label;
    errorElement.append(anchor);
  }

  errorElement.hidden = false;
  statusElement.hidden = true;
}

function getErrorDetails(error) {
  const messages = [];
  let currentError = error;
  for (let depth = 0; currentError && depth < 4; depth += 1) {
    if (currentError.message) {
      messages.push(currentError.message);
    }
    if (currentError.code) {
      messages.push(String(currentError.code));
    }
    currentError = currentError.cause;
  }
  return messages.join(" ");
}

async function showBookingSubmissionError(error) {
  const details = getErrorDetails(error);
  if (/network|fetch|connection|timed?\s*out|offline|load failed/i.test(details)) {
    showError("Connection problem. Check your connection and try again. Your request may still be open; check Ride history first.");
    return;
  }

  if (/no more than 5 open scheduled rides/i.test(details)) {
    showError(
      "You already have 5 open scheduled rides. Manage them before booking another.",
      { href: "history.html", label: "View ride history" },
    );
    return;
  }

  if (
    /rides_one_open_immediate_per_rider_idx/i.test(details) ||
    (/\b23505\b/.test(details) && /open immediate/i.test(details))
  ) {
    let openRide = null;
    try {
      const rides = await getRides({
        userId: currentUser.id,
        status: "finding",
        includeDriver: false,
      });
      openRide = rides.find((ride) => ride.timing === "now" && !ride.scheduledAt);
      if (openRide) {
        saveBookingRideId(openRide.id);
        showSubmittedRide(openRide, true);
        watchBookingStatus(openRide.id);
      }
    } catch (lookupError) {
      console.error("The existing open request could not be found after a duplicate booking.", lookupError);
    }

    showError(
      "You already have an open request.",
      openRide
        ? {
            href: `tracking.html?id=${encodeURIComponent(openRide.id)}`,
            label: "Track your open request",
          }
        : { href: "history.html", label: "View ride history" },
    );
    return;
  }

  showError(error.message);
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

function clearCancellationFeedbackTimers() {
  if (cancellationFeedbackTimer !== null) {
    window.clearTimeout(cancellationFeedbackTimer);
    cancellationFeedbackTimer = null;
  }
  if (cancellationCollapseTimer !== null) {
    window.clearTimeout(cancellationCollapseTimer);
    cancellationCollapseTimer = null;
  }
  cancellationFeedbackRideId = null;
}

function restoreMatchCardContent() {
  if (reusableMatchCardContent.childNodes.length > 0) {
    matchCardContent.replaceChildren(reusableMatchCardContent);
  }
}

function ensureMatchCardMounted() {
  if (!matchCard.isConnected) {
    form.insertAdjacentElement("afterend", matchCard);
  }
}

function removeBookingCard() {
  clearCancellationFeedbackTimers();
  matchCard.hidden = true;
  matchCard.classList.remove("cancellation-feedback", "is-collapsing");
  matchCard.remove();
  currentBookingRide = null;
  noRidePrompt.render(null);
}

function finishCancellationFeedback(rideId) {
  if (cancellationFeedbackRideId !== rideId) {
    return;
  }
  clearCancellationFeedbackTimers();
  matchCard.hidden = true;
  matchCard.classList.remove("cancellation-feedback", "is-collapsing");
  matchCard.remove();
}

function showCancellationFeedback(rideId) {
  clearCancellationFeedbackTimers();
  stopBookingStatusUpdates();
  clearSavedBookingConfirmation(rideId);
  currentBookingRide = null;
  noRidePrompt.render(null);
  clearMessages();
  ensureMatchCardMounted();
  restoreMatchCardContent();
  reusableMatchCardContent.append(...matchCardContent.childNodes);

  const message = document.createElement("div");
  message.className = "cancellation-confirmation";
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  const checkIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  checkIcon.setAttribute("viewBox", "0 0 24 24");
  checkIcon.setAttribute("aria-hidden", "true");
  const checkPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  checkPath.setAttribute("d", "m5 12 4 4L19 6");
  checkIcon.append(checkPath);
  const messageText = document.createElement("span");
  messageText.textContent = "Cancelled successfully";
  message.append(checkIcon, messageText);
  matchCardContent.replaceChildren(message);
  matchCard.classList.remove("is-collapsing");
  matchCard.classList.add("cancellation-feedback");
  matchCard.hidden = false;
  cancellationFeedbackRideId = rideId;

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  cancellationFeedbackTimer = window.setTimeout(() => {
    cancellationFeedbackTimer = null;
    if (cancellationFeedbackRideId !== rideId) {
      return;
    }
    if (prefersReducedMotion) {
      finishCancellationFeedback(rideId);
      return;
    }
    matchCard.classList.add("is-collapsing");
    cancellationCollapseTimer = window.setTimeout(
      () => finishCancellationFeedback(rideId),
      CANCELLATION_COLLAPSE_MS,
    );
  }, prefersReducedMotion ? 1_000 : CANCELLATION_FEEDBACK_MS);
}

function showSubmittedRide(ride, restored = false) {
  if (["cancelled", "completed"].includes(ride.status)) {
    clearSavedBookingConfirmation(ride.id);
    removeBookingCard();
    return;
  }
  clearCancellationFeedbackTimers();
  ensureMatchCardMounted();
  restoreMatchCardContent();
  matchCard.classList.remove("cancellation-feedback", "is-collapsing");
  currentBookingRide = ride;
  noRidePrompt.render(ride);
  const isDelivery = ride.serviceType === "delivery";
  const serviceName = isDelivery ? "Delivery" : "Ride";
  if (ride.status === "on-trip") {
    matchTitle.textContent = `${serviceName} in progress`;
    matchDetails.textContent = "The trip has started, so this ride can no longer be cancelled. Open tracking for current updates.";
  } else if (["accepted", "arriving"].includes(ride.status)) {
    matchTitle.textContent = `${serviceName} accepted`;
    matchDetails.textContent = "A driver has accepted your request. Open tracking to see their details and follow trip updates.";
  } else {
    matchTitle.textContent = restored ? `${serviceName} request saved` : `${serviceName} request submitted`;
    matchDetails.textContent = restored
      ? `Your request is ${ride.status.replace("-", " ")}. Open tracking for current updates.`
      : ride.paymentMethod === "online"
        ? "Your request is sent to approved drivers. When a driver accepts, open tracking to pay securely before the trip starts."
        : `Your ${isDelivery ? "delivery" : "ride"} request is saved for ${ride.pickup.name} to ${ride.destination.name}. A matching driver can accept it from the Rider Driver dashboard.`;
  }
  matchTrackingLink.href = `tracking.html?id=${encodeURIComponent(ride.id)}`;
  matchCancelButton.hidden = !["finding", "accepted", "arriving"].includes(ride.status);
  matchCancelButton.disabled = isBookingCancellationInProgress;
  matchCancelButton.textContent = isBookingCancellationInProgress ? "Cancelling..." : "Cancel request";
  matchTrackingLink.hidden = false;
  matchBookAgainLink.hidden = true;
  matchCard.hidden = false;
}

async function handleBookingCancellation() {
  if (!currentBookingRide || !["finding", "accepted", "arriving"].includes(currentBookingRide.status)) {
    return;
  }
  noRidePrompt.setBusy(true);
  try {
    const confirmation = await confirmRideCancellation(currentBookingRide);
    if (!confirmation?.confirmed) {
      return;
    }

    const rideId = currentBookingRide.id;
    isBookingCancellationInProgress = true;
    matchCancelButton.disabled = true;
    matchCancelButton.textContent = "Cancelling...";
    const cancelledRide = await cancelRideRequest(rideId, confirmation.reason);
    if (cancelledRide.status !== "cancelled") {
      throw new Error("The ride was not cancelled. Refresh and check its current status.");
    }
    showCancellationFeedback(rideId);
  } catch (error) {
    showError(error.message);
  } finally {
    isBookingCancellationInProgress = false;
    noRidePrompt.setBusy(false);
    if (currentBookingRide && ["finding", "accepted", "arriving"].includes(currentBookingRide.status)) {
      matchCancelButton.disabled = false;
      matchCancelButton.textContent = "Cancel request";
    }
  }
}

function stopBookingStatusUpdates() {
  bookingStatusGeneration += 1;
  bookingStatusRideId = null;
  if (bookingStatusTimer !== null) {
    window.clearInterval(bookingStatusTimer);
    bookingStatusTimer = null;
  }
  if (bookingStatusChannel) {
    supabase.removeChannel(bookingStatusChannel);
    bookingStatusChannel = null;
  }
}

async function refreshBookingStatus(rideId) {
  if (
    isBookingStatusRefreshRunning ||
    document.visibilityState !== "visible" ||
    bookingStatusRideId !== rideId
  ) {
    return;
  }
  const requestGeneration = bookingStatusGeneration;
  isBookingStatusRefreshRunning = true;
  try {
    const latestRide = await getRide(rideId, { includeDriver: false });
    if (bookingStatusRideId !== rideId || bookingStatusGeneration !== requestGeneration) {
      return;
    }
    if (!latestRide) {
      throw new Error("This ride is no longer available to your account.");
    }
    if (["cancelled", "completed"].includes(latestRide.status)) {
      clearSavedBookingConfirmation(rideId);
      stopBookingStatusUpdates();
      showSubmittedRide(latestRide, true);
      return;
    }
    showSubmittedRide(latestRide, true);
  } catch (error) {
    showError(`Your ride status could not be refreshed: ${error.message}`);
  } finally {
    isBookingStatusRefreshRunning = false;
  }
}

function watchBookingStatus(rideId) {
  stopBookingStatusUpdates();
  bookingStatusRideId = rideId;
  const watchGeneration = bookingStatusGeneration;
  bookingStatusChannel = supabase
    .channel(`booking-ride-status:${rideId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "rides",
        filter: `id=eq.${rideId}`,
      },
      () => refreshBookingStatus(rideId),
    )
    .subscribe((status, error) => {
      if (bookingStatusRideId !== rideId || bookingStatusGeneration !== watchGeneration) {
        return;
      }
      if (status === "SUBSCRIBED") {
        refreshBookingStatus(rideId);
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        showStatus("Live ride updates are unavailable. We’ll keep checking for updates.");
        if (error) {
          console.error("Booking ride status Realtime channel error.", error);
        }
      }
    });
  bookingStatusTimer = window.setInterval(
    () => refreshBookingStatus(rideId),
    RIDE_STATUS_REFRESH_INTERVAL_MS,
  );
}

async function restoreLastBooking() {
  let previousRideId;
  try {
    previousRideId = window.sessionStorage.getItem(LAST_BOOKED_RIDE_KEY);
  } catch (error) {
    showStatus(`This browser cannot restore your previous booking after refresh: ${error.message}`);
    return;
  }
  if (!previousRideId) {
    return;
  }
  try {
    const previousRide = await getRide(previousRideId, { includeDriver: false });
    if (!previousRide) {
      window.sessionStorage.removeItem(LAST_BOOKED_RIDE_KEY);
      return;
    }
    if (["cancelled", "completed"].includes(previousRide.status)) {
      clearSavedBookingConfirmation(previousRideId);
      removeBookingCard();
      return;
    }
    showSubmittedRide(previousRide, true);
    watchBookingStatus(previousRideId);
  } catch (error) {
    try {
      window.sessionStorage.removeItem(LAST_BOOKED_RIDE_KEY);
    } catch (storageError) {
      console.error("A stale booking reference could not be cleared.", storageError);
    }
    showStatus(`Your previous ride could not be restored. Open Ride history to find it. ${error.message}`);
  }
}

async function restoreOpenImmediateRide() {
  const openRide = await findOpenImmediateRide();
  if (!openRide || currentBookingRide?.id === openRide.id) {
    return;
  }

  saveBookingRideId(openRide.id);
  showSubmittedRide(openRide, true);
  watchBookingStatus(openRide.id);
}

function resetBookingCardForNewRequest() {
  clearCancellationFeedbackTimers();
  stopBookingStatusUpdates();
  matchCard.hidden = true;
  matchCard.classList.remove("cancellation-feedback", "is-collapsing");
  restoreMatchCardContent();
  bookingRetryCard.hidden = true;
  noRidePrompt.render(null);
}

function getFareTime() {
  const timing = form.elements.timing.value;
  if (timing === "scheduled") {
    return scheduledAtInput.value;
  }
  return new Date();
}

function getFareForCurrentSelection() {
  const pickup = selectedPickup;
  const destination = selectedDestination;
  if (!pickup || !destination || pickup.id === destination.id) {
    return null;
  }

  const vehicleType = getVehicleType();
  const billableCount = vehicleType === "bike" ? 1 : Number(passengerSelect.value);
  return calculateFare(pickup, destination, getFareTime(), billableCount, vehicleType);
}

function getVehicleType() {
  return vehicleTypeInputs.find((input) => input.checked)?.value ?? "keke";
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
  const pickup = selectedPickup;
  const destination = selectedDestination;
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

    if (getVehicleType() === "bike") {
      appendBreakdownRow("Bike delivery fee", fare.perPassenger);
    } else {
      appendBreakdownRow("Fare per passenger", fare.perPassenger);
      appendBreakdownRow("Passengers", fare.passengers, passengerCountFormatter);
    }
    appendBreakdownRow("Total fare", fare.rideTotal);
    fareNoteElement.textContent =
      getVehicleType() === "bike"
        ? "Fixed demo fee per delivery. Replace placeholder fares before launch."
        : "Fixed demo fare per person. Replace placeholder fares before launch.";

    errorElement.hidden = true;
  } catch (error) {
    fareTotalElement.textContent = "Unavailable";
    fareBreakdownElement.replaceChildren();
    fareNoteElement.textContent = "We could not calculate this route's fare.";
    showError(error.message);
  }
}

async function populateLocations() {
  locations = await getLocations();
  if (locations.length < 2) {
    showError("At least two locations are needed before a ride can be booked.");
    findRideButton.disabled = true;
  }
}

function normalizeSearchText(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function findLocationMatches(query, excludedLocationId) {
  const normalizedQuery = normalizeSearchText(query);
  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);

  return locations
    .filter((location) => location.id !== excludedLocationId)
    .map((location) => {
      const normalizedName = normalizeSearchText(location.name);
      const normalizedId = normalizeSearchText(location.id.replace(/-/g, " "));
      const searchableText = `${normalizedName} ${normalizedId}`;
      const allWordsMatch =
        queryWords.length > 0 &&
        queryWords.every((word) =>
          searchableText.split(/\s+/).some((candidate) => candidate.startsWith(word)),
        );

      if (!normalizedQuery || normalizedName.includes(normalizedQuery) || allWordsMatch) {
        const score = normalizedName.startsWith(normalizedQuery)
          ? 0
          : normalizedName.includes(normalizedQuery)
            ? 1
            : 2;
        return { location, score };
      }

      return null;
    })
    .filter(Boolean)
    .sort((first, second) => first.score - second.score || first.location.name.localeCompare(second.location.name))
    .slice(0, 8)
    .map(({ location }) => location);
}

function closeSuggestions(input, listbox) {
  listbox.hidden = true;
  listbox.replaceChildren();
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  activeSuggestionIndexes.delete(input);
}

function selectLocation(input, listbox, location, onSelect) {
  input.value = location.name;
  input.dataset.locationId = location.id;
  closeSuggestions(input, listbox);
  onSelect(location);
  clearMessages();
  updateFareEstimate();
}

function renderSuggestions(input, listbox, onSelect) {
  const otherSelectedLocation =
    input === pickupInput ? selectedDestination : selectedPickup;
  const matches = findLocationMatches(input.value, otherSelectedLocation?.id);
  listbox.replaceChildren();

  if (matches.length === 0) {
    const emptyMessage = document.createElement("div");
    emptyMessage.className = "suggestion-empty";
    emptyMessage.textContent = input.value.trim()
      ? "No matching campus locations"
      : "No available locations";
    listbox.append(emptyMessage);
    listbox.hidden = false;
    input.setAttribute("aria-expanded", "true");
    return;
  }

  matches.forEach((location, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "location-suggestion";
    option.id = `${listbox.id}-option-${index}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.textContent = location.name;
    option.addEventListener("pointerdown", (event) => event.preventDefault());
    option.addEventListener("click", () => selectLocation(input, listbox, location, onSelect));
    listbox.append(option);
  });

  activeSuggestionIndexes.set(input, -1);
  listbox.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function moveActiveSuggestion(input, listbox, direction) {
  const options = [...listbox.querySelectorAll('[role="option"]')];
  if (options.length === 0) {
    return;
  }

  const currentIndex = activeSuggestionIndexes.get(input) ?? -1;
  const nextIndex =
    currentIndex === -1
      ? direction > 0 ? 0 : options.length - 1
      : (currentIndex + direction + options.length) % options.length;

  options.forEach((option, index) => {
    const isActive = index === nextIndex;
    option.setAttribute("aria-selected", String(isActive));
    if (isActive) {
      input.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({ block: "nearest" });
    }
  });
  activeSuggestionIndexes.set(input, nextIndex);
}

function enableLocationAutocomplete(input, listbox, onSelect) {
  input.addEventListener("input", () => {
    input.dataset.locationId = "";
    onSelect(null);
    clearMessages();
    renderSuggestions(input, listbox, onSelect);
    updateFareEstimate();
  });

  input.addEventListener("focus", () => renderSuggestions(input, listbox, onSelect));

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (listbox.hidden) {
        renderSuggestions(input, listbox, onSelect);
      }
      moveActiveSuggestion(input, listbox, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" && !listbox.hidden) {
      const activeIndex = activeSuggestionIndexes.get(input) ?? -1;
      const activeOption = listbox.querySelectorAll('[role="option"]')[activeIndex];
      if (activeOption) {
        event.preventDefault();
        activeOption.click();
      }
    } else if (event.key === "Escape") {
      closeSuggestions(input, listbox);
    }
  });

  input.addEventListener("blur", () => {
    window.setTimeout(() => closeSuggestions(input, listbox), 100);
  });
}

function updateTimingFields() {
  const isScheduled = form.elements.timing.value === "scheduled";
  scheduledFields.hidden = !isScheduled;
  scheduledAtInput.required = isScheduled;
  clearMessages();
  updateFareEstimate();
}

function updateVehicleFields() {
  const vehicleType = getVehicleType();
  const isDelivery = vehicleType === "bike";
  vehicleTypeInputs.forEach((input) => {
    input.closest(".ride-option").classList.toggle("active", input.checked);
  });
  deliveryFields.hidden = !isDelivery;
  for (const input of [deliveryDescriptionInput, recipientNameInput, recipientPhoneInput]) {
    input.required = isDelivery;
    input.disabled = !isDelivery;
  }
  passengerSelect.disabled = isDelivery;
  passengerSelect.required = !isDelivery;
  passengerFields.hidden = isDelivery;

  const capacity = vehicleType === "minivan" ? 6 : 4;
  for (const option of passengerSelect.options) {
    option.disabled = Number(option.value) > capacity;
  }
  if (!isDelivery && Number(passengerSelect.value) > capacity) {
    passengerSelect.value = String(capacity);
  }
  findRideButton.textContent = isDelivery ? "Request delivery" : "Find a ride";
  clearMessages();
  updateFareEstimate();
}

function validateBooking() {
  const pickup = selectedPickup;
  const destination = selectedDestination;

  if (!pickup || !destination) {
    throw new Error("Choose both pickup and destination from the location suggestions.");
  }
  if (pickup.id === destination.id) {
    throw new Error("Pickup and destination must be different locations.");
  }
  if (getVehicleType() === "bike") {
    if (!deliveryDescriptionInput.value.trim()) {
      throw new Error("Describe the package you are sending.");
    }
    if (!recipientNameInput.value.trim()) {
      throw new Error("Enter the recipient's name.");
    }
    if (recipientPhoneInput.value.replace(/\D/g, "").length < 10) {
      throw new Error("Enter a valid recipient phone number.");
    }
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

async function updatePaymentFields() {
  const isOnline = paymentMethodSelect.value === "online";
  emailField.hidden = !isOnline;
  emailInput.required = false;
  emailInput.readOnly = true;
  emailInput.value = currentUser?.email ?? "";
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function findRide(event) {
  event.preventDefault();
  clearMessages();
  resetBookingCardForNewRequest();

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
  const vehicleType = getVehicleType();
  const isDelivery = vehicleType === "bike";
  const rideInput = {
    serviceType: isDelivery ? "delivery" : "passenger",
    vehicleType,
    pickup: route.pickup,
    destination: route.destination,
    passengers: isDelivery ? 0 : Number(passengerSelect.value),
    timing,
    scheduledAt,
    paymentMethod: form.elements.paymentMethod.value,
    customerEmail: currentUser.email,
    fare,
    deliveryDescription: isDelivery ? deliveryDescriptionInput.value.trim() : null,
    recipientName: isDelivery ? recipientNameInput.value.trim() : null,
    recipientPhone: isDelivery ? recipientPhoneInput.value.trim() : null,
  };

  findRideButton.disabled = true;
  findRideButton.textContent = isDelivery ? "Sending request..." : "Finding a driver...";
  showStatus(
    isDelivery
      ? "Sending your package delivery request to approved bike couriers."
      : "Finding a matching driver for your ride.",
  );

  try {
    if (rideInput.paymentMethod === "online" && !isOnlinePaymentConfigured()) {
      throw new Error("Online payments are not configured yet. Please choose cash.");
    }
    const ride = await createRide(rideInput);
    const bookingSavedForRefresh = saveBookingRideId(ride.id);
    showSubmittedRide(ride);
    showStatus(
      !bookingSavedForRefresh
          ? "Your request was submitted, but this browser could not save it for display after a refresh. Use Track your ride or Ride history to reopen it."
          : rideInput.paymentMethod === "online"
            ? "Your request is sent. Once a driver accepts, complete payment from the tracking page before the trip starts."
            : "Your request has been sent to matching approved drivers. Track this page for acceptance and progress.",
    );
    if (!["completed", "cancelled"].includes(ride.status)) {
      watchBookingStatus(ride.id);
    }
  } catch (error) {
    await showBookingSubmissionError(error);
  } finally {
    findRideButton.disabled = false;
    findRideButton.textContent = getVehicleType() === "bike" ? "Request delivery" : "Find a ride";
  }
}

async function startBookingPage() {
  scheduledAtInput.min = localDateTimeValue(new Date(Date.now() + 60_000));
  onlinePaymentOption.disabled = !isOnlinePaymentConfigured();
  if (onlinePaymentOption.disabled) {
    onlinePaymentOption.textContent = "Pay online (setup in progress)";
  } else {
    onlinePaymentOption.textContent = "Pay online (after driver accepts)";
  }
  currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "rider") {
    showError("Sign in with a Rider account before requesting a ride.");
    const signInLink = document.querySelector("#booking-signin-link");
    signInLink.hidden = false;
    findRideButton.disabled = true;
    return;
  }
  emailInput.value = currentUser.email;
  const restoreBooking = async () => {
    await restoreLastBooking();
    try {
      await restoreOpenImmediateRide();
    } catch (error) {
      showError("Your existing open request could not be checked. Open Ride history to find or cancel it.");
      console.error("An open immediate ride could not be restored on the booking page.", error);
    }
  };
  await Promise.all([restoreBooking(), loadFareConfig(), populateLocations()]);
  updateFareEstimate();

  enableLocationAutocomplete(pickupInput, pickupSuggestions, (location) => {
    selectedPickup = location;
  });
  enableLocationAutocomplete(destinationInput, destinationSuggestions, (location) => {
    selectedDestination = location;
  });
  passengerSelect.addEventListener("change", updateFareEstimate);
  vehicleTypeInputs.forEach((input) => input.addEventListener("change", updateVehicleFields));
  scheduledAtInput.addEventListener("input", updateFareEstimate);
  form.querySelectorAll('input[name="timing"]').forEach((input) => {
    input.addEventListener("change", updateTimingFields);
  });
  paymentMethodSelect.addEventListener("change", updatePaymentFields);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const currentRideId = new URL(matchTrackingLink.href).searchParams.get("id");
      if (currentRideId && !matchCard.hidden) {
        refreshBookingStatus(currentRideId);
      }
    }
  });
  window.addEventListener("pagehide", () => {
    stopBookingStatusUpdates();
    clearCancellationFeedbackTimers();
    noRidePrompt.cleanup();
  }, { once: true });
  updateVehicleFields();
  await updatePaymentFields();
  matchCancelButton.addEventListener("click", handleBookingCancellation);
  bookingRetryCreateButton.addEventListener("click", createReplacementBooking);
  form.addEventListener("submit", findRide);
}

try {
  await startBookingPage();
} catch (error) {
  showError(`Booking could not be loaded: ${error.message}`);
  findRideButton.disabled = true;
}
