import "./notifications.js";
import { cancelRideRequest, createRide, getCurrentUser, getRide, getRides, rateRide } from "./supabase-api.js";
import { initializeRidePayment, isOnlinePaymentConfigured } from "./payment.js";
import { mountRideChat } from "./ride-chat.js";
import { supabase } from "./supabase-client.js";
import { clearSavedBookingConfirmation, confirmRideCancellation } from "./cancel-ride-dialog.js";
import { mountNoRideAvailablePrompt } from "./no-ride-available.js";

const rideId = new URLSearchParams(window.location.search).get("id");
const paymentResult = new URLSearchParams(window.location.search).get("payment");
const trackingError = document.querySelector("#tracking-error");
const trackingStatus = document.querySelector("#tracking-status");
const trackingContent = document.querySelector("#tracking-content");
const routeCard = document.querySelector(".route-card");
const rideStatusLabel = document.querySelector("#ride-status-label");
const rideStatusBadge = document.querySelector("#ride-status-badge");
const progressTrack = document.querySelector(".progress-track");
const progressFill = document.querySelector("#progress-fill");
const pickupElement = document.querySelector("#ride-pickup");
const destinationElement = document.querySelector("#ride-destination");
const scheduleElement = document.querySelector("#ride-schedule");
const driverAvatar = document.querySelector("#driver-avatar");
const driverName = document.querySelector("#driver-name");
const driverVehicle = document.querySelector("#driver-vehicle");
const driverPlate = document.querySelector("#driver-plate");
const driverRating = document.querySelector("#driver-rating");
const driverPhone = document.querySelector("#driver-phone");
const verifiedBadge = document.querySelector("#verified-badge");
const deliverySummary = document.querySelector("#delivery-summary");
const deliveryDescription = document.querySelector("#delivery-description");
const deliveryRecipient = document.querySelector("#delivery-recipient");
const rideChatCard = document.querySelector("#ride-chat-card");
const rideChatRoot = document.querySelector("#ride-chat");
const ratingForm = document.querySelector("#rating-form");
const ratingThanks = document.querySelector("#rating-thanks");
const shareButton = document.querySelector("#share-trip");
const paymentCard = document.querySelector("#ride-payment-card");
const paymentMessage = document.querySelector("#ride-payment-message");
const paymentButton = document.querySelector("#ride-payment-button");
const cancelRideButton = document.querySelector("#cancel-ride-button");
const cancelRideNotice = document.querySelector("#ride-cancel-notice");
const trackingNoRidePromptRoot = document.querySelector("#tracking-no-ride-prompt");
const trackingRetryCard = document.querySelector("#tracking-retry-card");
const trackingRetryDetails = document.querySelector("#tracking-retry-details");
const trackingRetryCreateButton = document.querySelector("#tracking-retry-create");
const statusSteps = [...document.querySelectorAll("[data-status-step]")];
const LAST_BOOKED_RIDE_KEY = "rider:last-booked-ride";

const RIDE_STAGES = [
  { status: "accepted", label: "Driver accepted" },
  { status: "arriving", label: "Driver arriving" },
  { status: "on-trip", label: "On your way" },
  { status: "completed", label: "Ride completed" },
];

const dateFormatter = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeStyle: "short",
});
const currencyFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

let ride = null;
let riderName = "";
let refreshTimer = null;
let rideChannel = null;
let isRefreshRunning = false;
let isRideCancellationInProgress = false;
let isRetryCreateInProgress = false;
let chatRideId = null;
let chatCleanup = null;
let pendingReplacementInput = null;
let pendingReplacementSource = null;
const REFRESH_INTERVAL_MS = 45_000;
const noRidePrompt = mountNoRideAvailablePrompt(trackingNoRidePromptRoot, {
  onTryAgain: handleTryAgain,
  onCancel: handleRideCancellation,
});

function showError(message) {
  trackingError.textContent = message;
  trackingError.hidden = false;
  trackingStatus.hidden = true;
}

function showStatus(message) {
  trackingStatus.textContent = message;
  trackingStatus.hidden = false;
  trackingError.hidden = true;
}

function hideMessages() {
  trackingError.hidden = true;
  trackingStatus.hidden = true;
}

function getStageIndex(status) {
  return RIDE_STAGES.findIndex((stage) => stage.status === status);
}

function getStatusLabel(status) {
  if (ride?.serviceType === "delivery") {
    const deliveryLabels = {
      accepted: "Courier accepted",
      arriving: "Courier arriving",
      "on-trip": "Package on the way",
      completed: "Delivery complete",
    };
    if (deliveryLabels[status]) {
      return deliveryLabels[status];
    }
    if (status === "finding") {
      return "Finding a bike courier";
    }
    if (status === "cancelled") {
      return "Delivery cancelled";
    }
  }
  const stage = RIDE_STAGES.find((candidate) => candidate.status === status);
  if (stage) {
    return stage.label;
  }
  if (status === "finding") {
    return "Finding a driver";
  }
  return status === "cancelled" ? "Ride cancelled" : "Ride update";
}

function formatScheduledTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Pickup time unavailable" : dateFormatter.format(date);
}

function getRideTotal(currentRide) {
  return currentRide.fare?.rideTotal ?? currentRide.fare?.total ?? 0;
}

function renderProgress(status) {
  const stageIndex = getStageIndex(status);
  const progress = stageIndex >= 0 ? (stageIndex + 1) * 25 : 0;
  const labels =
    ride.serviceType === "delivery"
      ? ["Courier accepted", "Courier arriving", "Package on the way", "Delivery complete"]
      : ["Driver accepted", "Driver arriving", "On your way", "Ride completed"];
  progressFill.dataset.progress = String(progress);
  progressTrack.setAttribute("aria-valuenow", String(progress));

  statusSteps.forEach((step, index) => {
    step.textContent = labels[index];
    step.classList.toggle("is-complete", stageIndex >= 0 && index < stageIndex);
    step.classList.toggle("is-current", index === stageIndex);
    if (index === stageIndex) {
      step.setAttribute("aria-current", "step");
    } else {
      step.removeAttribute("aria-current");
    }
  });
}

function renderRating() {
  const isDelivery = ride.serviceType === "delivery";
  ratingForm.querySelector("#rating-form-title").textContent =
    isDelivery ? "How was your delivery?" : "How was your ride?";
  ratingThanks.querySelector("#rating-thanks-title").textContent =
    isDelivery ? "Thanks for using Rider delivery" : "Thanks for riding with Rider";
  ratingForm.querySelector(".eyebrow").textContent = isDelivery ? "Delivery complete" : "Ride complete";
  if (ride.rating) {
    ratingForm.hidden = true;
    ratingThanks.hidden = false;
    const stars = "★".repeat(ride.rating.stars);
    ratingThanks.querySelector("p").textContent =
      `You rated this ${isDelivery ? "delivery" : "ride"} ${stars}. Thanks for helping improve Rider.`;
    return;
  }

  const isComplete = ride.status === "completed";
  ratingForm.hidden = !isComplete;
  ratingThanks.hidden = true;
}

function renderPayment() {
  const isOnline = ride.paymentMethod === "online";
  paymentCard.hidden = !isOnline || ride.status === "cancelled";
  if (!isOnline) return;

  paymentButton.hidden = true;
  paymentButton.disabled = false;
  if (ride.paymentStatus === "paid") {
    paymentMessage.textContent = "Payment confirmed. Your driver can start the trip.";
    return;
  }
  if (paymentResult === "review") {
    paymentMessage.textContent =
      "Paystack reported a successful payment, but it could not be applied to this ride. Do not pay again; contact Rider support.";
    return;
  }
  if (["accepted", "arriving"].includes(ride.status)) {
    if (!isOnlinePaymentConfigured()) {
      paymentMessage.textContent =
        "Online payment setup is incomplete. Do not start the trip; contact Rider support.";
      return;
    }
    paymentButton.hidden = false;
    paymentMessage.textContent =
      paymentResult === "failed"
        ? "Payment was not confirmed. You can try again."
        : "Your driver has accepted. Pay securely before the trip starts.";
    return;
  }
  paymentMessage.textContent =
    ride.status === "finding"
      ? "Payment becomes available after a driver accepts your request."
      : "This ride is not currently eligible for online payment.";
}

function renderRide() {
  trackingContent.hidden = false;
  routeCard.hidden = ride.status === "cancelled";
  noRidePrompt.render(ride);
  cancelRideButton.hidden = !["finding", "accepted", "arriving"].includes(ride.status);
  cancelRideButton.disabled = isRideCancellationInProgress;
  cancelRideButton.textContent = isRideCancellationInProgress ? "Cancelling..." : "Cancel request";
  cancelRideNotice.hidden = ride.status !== "on-trip";
  rideStatusLabel.textContent = getStatusLabel(ride.status);
  rideStatusBadge.textContent = ride.status.replace("-", " ");
  rideStatusBadge.dataset.status = ride.status;
  pickupElement.textContent = ride.pickup?.name ?? "Pickup unavailable";
  destinationElement.textContent = ride.destination?.name ?? "Destination unavailable";
  scheduleElement.textContent =
    `${ride.timing === "scheduled" ? "Scheduled pickup · " + formatScheduledTime(ride.scheduledAt) : "Requested now"} · ${currencyFormatter.format(getRideTotal(ride))}`;
  deliverySummary.hidden = ride.serviceType !== "delivery";
  if (ride.serviceType === "delivery") {
    deliveryDescription.textContent = ride.deliveryDescription ?? "Not provided";
    deliveryRecipient.textContent =
      `${ride.recipientName ?? "Not provided"} · ${ride.recipientPhone ?? "No phone number"}`;
  }

  const driver = ride.driver;
  driverName.textContent = driver?.name ?? "Driver details unavailable";
  driverVehicle.textContent =
    driver
      ? {
          bike: "Bike courier",
          keke: "Keke",
          minivan: "Mini bus",
        }[driver.vehicleType] ?? "Vehicle"
      : "Assigned after acceptance";
  driverPlate.textContent = driver?.plateNumber ?? "Not provided";
  driverRating.textContent = driver?.rating ? `★ ${driver.rating} / 5` : "Not rated";
  driverPhone.textContent = driver?.phone ?? "Not provided";
  driverPhone.href = driver?.phone ? `tel:${driver.phone.replace(/[^\d+]/g, "")}` : "";
  if (driver?.avatarUrl) {
    const image = document.createElement("img");
    image.src = driver.avatarUrl;
    image.alt = "";
    driverAvatar.replaceChildren(image);
  } else {
    driverAvatar.textContent = driver?.name
      ? driver.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()
      : "R";
  }
  verifiedBadge.hidden = !driver?.verified;
  const canChat = Boolean(ride.driverId) && ["accepted", "arriving", "on-trip"].includes(ride.status);
  rideChatCard.hidden = !canChat;
  if (canChat && chatRideId !== ride.id) {
    chatCleanup?.();
    rideChatRoot.replaceChildren();
    chatRideId = ride.id;
    chatCleanup = mountRideChat(rideChatRoot, ride.id);
  } else if (!canChat && chatCleanup) {
    chatCleanup();
    chatCleanup = null;
    chatRideId = null;
    rideChatRoot.replaceChildren();
  }
  renderProgress(ride.status);
  renderRating();
  renderPayment();

  if (ride.status === "cancelled") {
    showStatus(`This ${ride.serviceType === "delivery" ? "delivery" : "booking"} was cancelled.`);
  } else if (ride.status === "accepted" && riderName) {
    showStatus(`Ride requested by ${riderName}`);
  } else if (ride.timing === "scheduled" && new Date(ride.scheduledAt) > new Date()) {
    showStatus(`Your scheduled ${ride.serviceType === "delivery" ? "delivery" : "ride"} is confirmed. Updates will continue around pickup time.`);
  } else if (!["completed", "cancelled"].includes(ride.status)) {
    showStatus("Ride status updates automatically when your driver changes the trip status.");
  } else {
    hideMessages();
  }
}

async function refreshRideStatus() {
  if (isRefreshRunning || document.visibilityState !== "visible") {
    return;
  }

  isRefreshRunning = true;
  try {
    const latestRide = await getRide(ride.id);
    if (!latestRide) {
      throw new Error("This ride is no longer available to your account.");
    }
    ride = latestRide;
    hideMessages();
    renderRide();
    if (["completed", "cancelled"].includes(ride.status) && refreshTimer !== null) {
      window.clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (ride.status === "cancelled") {
      clearSavedBookingConfirmation(ride.id);
      cleanupRideTracking();
    }
  } catch (error) {
    showError(`Ride status could not be refreshed: ${error.message}`);
  } finally {
    isRefreshRunning = false;
  }
}

function handleRideRealtimeStatus(status, error) {
  if (status === "SUBSCRIBED") {
    refreshRideStatus();
    return;
  }

  if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
    showStatus("Live ride updates are unavailable. We’ll keep checking for updates.");
    if (error) {
      console.error("Ride tracking Realtime channel error.", error);
    }
  }
}

function cleanupRideTracking() {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
  document.removeEventListener("visibilitychange", handleTrackingVisibility);
  window.removeEventListener("pagehide", cleanupRideTracking);
  noRidePrompt.cleanup();
  chatCleanup?.();
  if (rideChannel) {
    supabase.removeChannel(rideChannel);
    rideChannel = null;
  }
}

async function handleRideCancellation() {
  if (!ride || !["finding", "accepted", "arriving"].includes(ride.status)) {
    return;
  }
  noRidePrompt.setBusy(true);
  try {
    const confirmation = await confirmRideCancellation(ride);
    if (!confirmation?.confirmed) {
      return;
    }

    isRideCancellationInProgress = true;
    cancelRideButton.disabled = true;
    cancelRideButton.textContent = "Cancelling...";
    const cancelledRide = await cancelRideRequest(ride.id, confirmation.reason);
    if (cancelledRide.status !== "cancelled") {
      throw new Error("The ride was not cancelled. Refresh and check its current status.");
    }
    ride = { ...cancelledRide, driver: ride.driver };
    clearSavedBookingConfirmation(ride.id);
    cleanupRideTracking();
    renderRide();
    showStatus("Your request has been cancelled. You can book another ride whenever you’re ready.");
  } catch (error) {
    showError(error.message);
  } finally {
    isRideCancellationInProgress = false;
    noRidePrompt.setBusy(false);
    if (ride && ["finding", "accepted", "arriving"].includes(ride.status)) {
      cancelRideButton.disabled = false;
      cancelRideButton.textContent = "Cancel request";
    }
  }
}

function getRideInputForRetry(currentRide) {
  return {
    serviceType: currentRide.serviceType,
    vehicleType: currentRide.vehicleType,
    pickup: currentRide.pickup,
    destination: currentRide.destination,
    passengers: currentRide.passengers,
    timing: "now",
    scheduledAt: null,
    paymentMethod: currentRide.paymentMethod,
    fare: currentRide.fare,
    deliveryDescription: currentRide.deliveryDescription,
    recipientName: currentRide.recipientName,
    recipientPhone: currentRide.recipientPhone,
  };
}

async function findReplacementRide(previousRide, input) {
  const rides = await getRides({
    userId: ride.userId,
    createdAfter: previousRide.createdAt,
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

function saveBookingRideId(nextRideId) {
  try {
    window.sessionStorage.setItem(LAST_BOOKED_RIDE_KEY, nextRideId);
  } catch (error) {
    console.error("The replacement booking could not be saved for page refresh.", error);
  }
}

function startRideRealtimeUpdates() {
  if (rideChannel) {
    supabase.removeChannel(rideChannel);
  }
  rideChannel = supabase
    .channel(`rider-ride-status:${ride.id}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "rides",
        filter: `id=eq.${ride.id}`,
      },
      refreshRideStatus,
    )
    .subscribe(handleRideRealtimeStatus);
}

function completeReplacementRide(newRide) {
  pendingReplacementInput = null;
  pendingReplacementSource = null;
  trackingRetryCard.hidden = true;
  ride = newRide;
  saveBookingRideId(newRide.id);
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("id", newRide.id);
  nextUrl.searchParams.delete("payment");
  window.history.replaceState(null, "", nextUrl);
  renderRide();
  startRideRealtimeUpdates();
  showStatus("Your new request has been sent to matching approved drivers.");
}

async function createReplacementRide() {
  if (!pendingReplacementInput || isRetryCreateInProgress) {
    return;
  }

  isRetryCreateInProgress = true;
  trackingRetryCreateButton.disabled = true;
  try {
    const newRide = await createRide(pendingReplacementInput);
    completeReplacementRide(newRide);
  } catch (error) {
    try {
      const replacementRide = await findReplacementRide(
        pendingReplacementSource,
        pendingReplacementInput,
      );
      if (replacementRide) {
        completeReplacementRide(replacementRide);
        showStatus("Your request was already sent. Tracking has been updated.");
        return;
      }
    } catch (lookupError) {
      console.error("The replacement ride outcome could not be checked.", lookupError);
    }

    console.error("The replacement ride request could not be created.", error);
    trackingRetryDetails.textContent =
      "Your previous request was cancelled, but the new request could not be sent. Your trip details are saved; try sending again.";
  } finally {
    isRetryCreateInProgress = false;
    trackingRetryCreateButton.disabled = false;
  }
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
      latestRide = await getRide(previousRide.id);
    } catch (refreshError) {
      showError("Connection problem. Check the ride status before trying again.");
      console.error("The old request status could not be confirmed after retry cancellation.", {
        cancelError,
        refreshError,
      });
      return;
    }

    if (latestRide && ["accepted", "arriving", "on-trip"].includes(latestRide.status)) {
      ride = latestRide;
      renderRide();
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

  clearSavedBookingConfirmation(previousRide.id);
  ride = { ...cancelledRide, driver: previousRide.driver };
  renderRide();
  pendingReplacementInput = retryInput;
  pendingReplacementSource = previousRide;
  trackingRetryDetails.textContent = "Your old request is cancelled. Sending a new request with the same trip details.";
  trackingRetryCard.hidden = false;
  await createReplacementRide();
}

function handleTrackingVisibility() {
  if (document.visibilityState === "visible") {
    refreshRideStatus();
  }
}

async function shareTrip() {
  const shareUrl = new URL(window.location.href);
  const shareData = {
    title: ride.serviceType === "delivery" ? "My Rider delivery" : "My Rider trip",
    text: `${ride.pickup.name} to ${ride.destination.name} with ${ride.driver?.name ?? "my Rider driver"}.`,
    url: shareUrl.href,
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(`${shareData.text} Track my trip: ${shareData.url}`);
      showStatus("Trip details copied. Send them to someone you trust.");
    } else {
      window.prompt("Copy and share these ride details:", `${shareData.text} ${shareData.url}`);
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      showError(`Trip details could not be shared: ${error.message}`);
    }
  }
}

async function submitRating(event) {
  event.preventDefault();
  const formData = new FormData(ratingForm);
  const ratingValue = Number(formData.get("rating"));
  const comment = String(formData.get("comment") ?? "");

  try {
    ride = await rateRide(ride.id, ratingValue, comment);
    hideMessages();
    renderRating();
  } catch (error) {
    showError(error.message);
  }
}

async function payForRide() {
  paymentButton.disabled = true;
  paymentMessage.textContent = "Preparing secure Paystack checkout…";
  try {
    const result = await initializeRidePayment(ride.id);
    if (result.paid) {
      ride = await getRide(ride.id);
      renderRide();
      return;
    }
    window.location.assign(result.authorizationUrl);
  } catch (error) {
    paymentMessage.textContent = error.message;
    paymentButton.disabled = false;
  }
}

async function startTrackingPage() {
  if (!rideId) {
    throw new Error("Open ride tracking from a booking or ride history entry.");
  }

  ride = await getRide(rideId);
  if (!ride) {
    throw new Error("This ride was not found. It may have been cleared from this browser.");
  }
  const rider = await getCurrentUser();
  if (!rider) {
    throw new Error("Please sign in to view your ride tracking details.");
  }
  riderName = rider.name?.trim() ?? "";

  renderRide();
  startRideRealtimeUpdates();
  refreshTimer = window.setInterval(refreshRideStatus, REFRESH_INTERVAL_MS);
  document.addEventListener("visibilitychange", handleTrackingVisibility);
  window.addEventListener("pagehide", cleanupRideTracking, { once: true });
  ratingForm.addEventListener("submit", submitRating);
  shareButton.addEventListener("click", shareTrip);
  paymentButton.addEventListener("click", payForRide);
  cancelRideButton.addEventListener("click", handleRideCancellation);
  trackingRetryCreateButton.addEventListener("click", createReplacementRide);
  if (paymentResult === "confirmed") {
    paymentMessage.textContent = "Payment confirmation received. Refreshing ride status…";
  } else if (paymentResult === "failed") {
    paymentMessage.textContent = "Payment was not confirmed. You can try again when eligible.";
  } else if (paymentResult === "error") {
    paymentMessage.textContent = "Payment verification could not be completed. Contact Rider support before trying again.";
  }
}

try {
  await startTrackingPage();
} catch (error) {
  showError(error.message);
}
