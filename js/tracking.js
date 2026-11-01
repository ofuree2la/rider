import { getRide, rateRide, updateRide } from "./api.js?v=step4";

const rideId = new URLSearchParams(window.location.search).get("id");
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
const driverPlate = document.querySelector("#driver-plate");
const driverRating = document.querySelector("#driver-rating");
const driverPhone = document.querySelector("#driver-phone");
const verifiedBadge = document.querySelector("#verified-badge");
const ratingForm = document.querySelector("#rating-form");
const ratingThanks = document.querySelector("#rating-thanks");
const shareButton = document.querySelector("#share-trip");
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
let simulationTimer = null;

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
  progressFill.dataset.progress = String(progress);
  progressTrack.setAttribute("aria-valuenow", String(progress));

  statusSteps.forEach((step, index) => {
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
  if (ride.rating) {
    ratingForm.hidden = true;
    ratingThanks.hidden = false;
    const stars = "★".repeat(ride.rating.stars);
    ratingThanks.querySelector("p").textContent =
      `You rated this ride ${stars}. Thanks for helping improve Rider.`;
    return;
  }

  const isComplete = ride.status === "completed";
  ratingForm.hidden = !isComplete;
  ratingThanks.hidden = true;
}

function renderRide() {
  trackingContent.hidden = false;
  rideStatusLabel.textContent = getStatusLabel(ride.status);
  rideStatusBadge.textContent = ride.status.replace("-", " ");
  rideStatusBadge.dataset.status = ride.status;
  pickupElement.textContent = ride.pickup?.name ?? "Pickup unavailable";
  destinationElement.textContent = ride.destination?.name ?? "Destination unavailable";
  scheduleElement.textContent =
    `${ride.timing === "scheduled" ? "Scheduled pickup" : "Requested"} · ${formatScheduledTime(ride.scheduledAt)} · ${currencyFormatter.format(getRideTotal(ride))}`;

  const driver = ride.driver;
  driverName.textContent = driver?.name ?? "Driver details unavailable";
  driverPlate.textContent = driver?.plateNumber ?? "Not provided";
  driverRating.textContent = driver?.rating ? `★ ${driver.rating} / 5` : "Not rated";
  driverPhone.textContent = driver?.phone ?? "Not provided";
  driverPhone.href = driver?.phone ? `tel:${driver.phone.replace(/[^\d+]/g, "")}` : "";
  driverAvatar.textContent = driver?.name
    ? driver.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()
    : "R";
  verifiedBadge.hidden = !driver?.verified;
  renderProgress(ride.status);
  renderRating();

  if (ride.status === "cancelled") {
    showStatus("This scheduled ride was cancelled.");
  } else if (ride.timing === "scheduled" && new Date(ride.scheduledAt) > new Date()) {
    showStatus("Your scheduled ride is confirmed. Ride progress will update around pickup time.");
  } else if (!["completed", "cancelled"].includes(ride.status)) {
    showStatus("Ride status updates automatically in this demo.");
  } else {
    hideMessages();
  }
}

function scheduleNextStage(expectedStatus, delay) {
  window.clearTimeout(simulationTimer);
  simulationTimer = window.setTimeout(() => {
    try {
      const latestRide = getRide(ride.id);
      if (!latestRide || latestRide.status !== expectedStatus) {
        return;
      }

      const nextStage = RIDE_STAGES[getStageIndex(expectedStatus) + 1];
      if (!nextStage) {
        return;
      }

      const timestamps = {
        arriving: { arrivedAt: new Date().toISOString() },
        "on-trip": { startedAt: new Date().toISOString() },
        completed: { completedAt: new Date().toISOString() },
      };
      ride = updateRide(ride.id, {
        status: nextStage.status,
        ...timestamps[nextStage.status],
      });
      renderRide();

      if (nextStage.status === "arriving") {
        scheduleNextStage("arriving", 4200);
      } else if (nextStage.status === "on-trip") {
        scheduleNextStage("on-trip", 6500);
      }
    } catch (error) {
      showError(`Ride progress could not be updated: ${error.message}`);
    }
  }, delay);
}

function startProgressSimulation() {
  if (
    ride.status !== "accepted" ||
    (ride.timing === "scheduled" && new Date(ride.scheduledAt) > new Date())
  ) {
    return;
  }

  scheduleNextStage("accepted", 4200);
}

async function shareTrip() {
  const shareUrl = new URL(window.location.href);
  const shareData = {
    title: "My Rider trip",
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

function submitRating(event) {
  event.preventDefault();
  const formData = new FormData(ratingForm);
  const ratingValue = Number(formData.get("rating"));
  const comment = String(formData.get("comment") ?? "");

  try {
    ride = rateRide(ride.id, ratingValue, comment);
    hideMessages();
    renderRating();
  } catch (error) {
    showError(error.message);
  }
}

function startTrackingPage() {
  if (!rideId) {
    throw new Error("Open ride tracking from a booking or ride history entry.");
  }

  ride = getRide(rideId);
  if (!ride) {
    throw new Error("This ride was not found. It may have been cleared from this browser.");
  }

  renderRide();
  startProgressSimulation();
  ratingForm.addEventListener("submit", submitRating);
  shareButton.addEventListener("click", shareTrip);
}

try {
  startTrackingPage();
} catch (error) {
  showError(error.message);
}
