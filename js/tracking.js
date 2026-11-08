import { getRide, rateRide } from "./supabase-api.js";
import { initializeRidePayment, isOnlinePaymentConfigured } from "./payment.js";
import { mountRideChat } from "./ride-chat.js";
import { supabase } from "./supabase-client.js";

const rideId = new URLSearchParams(window.location.search).get("id");
const paymentResult = new URLSearchParams(window.location.search).get("payment");
const trackingError = document.querySelector("#tracking-error");
const trackingStatus = document.querySelector("#tracking-status");
const trackingContent = document.querySelector("#tracking-content");
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
const statusSteps = [...document.querySelectorAll("[data-status-step]")];

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
let refreshTimer = null;
let rideChannel = null;
let isRefreshRunning = false;
let chatRideId = null;
let chatCleanup = null;
const REFRESH_INTERVAL_MS = 45_000;

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
  paymentCard.hidden = !isOnline;
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
  chatCleanup?.();
  if (rideChannel) {
    supabase.removeChannel(rideChannel);
    rideChannel = null;
  }
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

  renderRide();
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
  refreshTimer = window.setInterval(refreshRideStatus, REFRESH_INTERVAL_MS);
  document.addEventListener("visibilitychange", handleTrackingVisibility);
  window.addEventListener("pagehide", cleanupRideTracking, { once: true });
  ratingForm.addEventListener("submit", submitRating);
  shareButton.addEventListener("click", shareTrip);
  paymentButton.addEventListener("click", payForRide);
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
