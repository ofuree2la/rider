import { calculateFare, loadFareConfig } from "./pricing.js";
import { createRide, getCurrentUser, getRides } from "./supabase-api.js";
import { createVehicleArt } from "./vehicle-art.js";

const plannerScreen = document.querySelector("#planner-screen");
const sheet = document.querySelector("#ride-options-sheet");
const sheetPanel = document.querySelector(".ride-options-panel");
const dragArea = document.querySelector(".ride-options-drag-area");
const grabberButton = document.querySelector("#ride-options-grabber");
const sheetScroll = document.querySelector("#ride-options-scroll");
const closeButton = document.querySelector("#ride-options-close");
const routeButton = document.querySelector("#ride-options-route");
const routeText = document.querySelector("#ride-options-route-text");
const fareTotal = document.querySelector("#ride-options-fare-total");
const vehicleFare = document.querySelector("#ride-options-fare");
const fareBreakdown = document.querySelector("#ride-options-fare-breakdown");
const fareNote = document.querySelector("#ride-options-fare-note");
const errorMessage = document.querySelector("#ride-options-error");
const existingActions = document.querySelector("#ride-options-existing-actions");
const trackLink = document.querySelector("#ride-options-track-link");
const cancelRequestButton = document.querySelector("#ride-options-cancel-request");
const continueButton = document.querySelector("#ride-options-continue");
const scheduleButton = document.querySelector("#ride-options-schedule");
const paymentMethod = document.querySelector("#ride-options-payment-method");
const vehicleIconRoot = document.querySelector("#ride-option-icon");
const vehicleOptions = [
  ["keke", vehicleIconRoot],
  ["bike", document.querySelector("#ride-option-bike")],
  ["minivan", document.querySelector("#ride-option-minivan")],
];

const OPEN_RIDE_STATUSES = new Set(["finding", "accepted", "arriving"]);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const currencyFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

let selectedRoute = null;
let passengerCount = 1;
let timing = "now";
let scheduledAt = null;
let isSubmitting = false;
let existingRideFound = false;
let resumeAfterSelection = false;
let returnFocusTarget = null;
let closingTimer = null;
let activeDrag = null;
let suppressNextSheetClick = false;

const rideOptionsStylesheet = [...document.styleSheets].find((stylesheet) =>
  stylesheet.href && new URL(stylesheet.href).pathname.endsWith("/css/ride-options.css"),
);
const dragOffsetRule = rideOptionsStylesheet
  ? [...rideOptionsStylesheet.cssRules].find((rule) =>
    rule instanceof CSSStyleRule && rule.selectorText === ".ride-options-sheet.is-open .ride-options-panel.is-dragging",
  )
  : null;

if (!dragOffsetRule) {
  throw new Error("The ride options drag styles are unavailable.");
}

for (const [type, root] of vehicleOptions) {
  const art = createVehicleArt(type);
  art.classList.add("vehicle-art--small");
  root.replaceChildren(art);
}

function isRideOpen(ride) {
  return OPEN_RIDE_STATUSES.has(ride.status);
}

function isOpenImmediateRide(ride) {
  return isRideOpen(ride) && ride.timing === "now" && !ride.scheduledAt;
}

function isOpenScheduledRide(ride) {
  return ride.status === "finding" && ride.timing === "scheduled" && ride.scheduledAt;
}

function setError(message, href = null, label = null) {
  errorMessage.replaceChildren();
  errorMessage.hidden = !message;
  existingActions.hidden = true;
  existingRideFound = false;
  if (!message) {
    return;
  }
  errorMessage.append(document.createTextNode(message));
  if (href && label) {
    errorMessage.append(document.createTextNode(" "));
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    errorMessage.append(link);
  }
}

function clearErrors() {
  setError("");
  existingActions.hidden = true;
}

function updateRouteSummary() {
  if (!selectedRoute) {
    routeText.textContent = "Choose pickup and destination";
    return;
  }
  routeText.textContent = `${selectedRoute.pickup.name}  →  ${selectedRoute.destination.name}`;
}

function updateFareEstimate() {
  continueButton.disabled = isSubmitting || existingRideFound || !selectedRoute;
  fareNote.hidden = true;
  if (!selectedRoute) {
    fareTotal.textContent = "—";
    vehicleFare.textContent = "—";
    fareBreakdown.textContent = "Choose a route to see the fare.";
    continueButton.disabled = true;
    return;
  }
  if (timing === "scheduled" && (!scheduledAt || new Date(scheduledAt) <= new Date())) {
    fareTotal.textContent = "—";
    vehicleFare.textContent = "—";
    fareBreakdown.textContent = "Choose a future pickup time.";
    continueButton.disabled = true;
    return;
  }
  try {
    const fare = calculateFare(
      selectedRoute.pickup,
      selectedRoute.destination,
      timing === "scheduled" ? scheduledAt : new Date(),
      passengerCount,
      "keke",
    );
    const amount = fare.rideTotal ?? fare.total;
    fareTotal.textContent = currencyFormatter.format(amount);
    vehicleFare.textContent = currencyFormatter.format(amount);
    fareBreakdown.textContent =
      `Base fare ${currencyFormatter.format(fare.perPassenger)} × ${passengerCount} ` +
      `${passengerCount === 1 ? "passenger" : "passengers"}`;
    continueButton.disabled = isSubmitting || existingRideFound;
  } catch (error) {
    fareTotal.textContent = "Unavailable";
    vehicleFare.textContent = "—";
    fareBreakdown.textContent = "This route cannot be priced right now.";
    fareNote.textContent = error.message;
    fareNote.hidden = false;
    continueButton.disabled = true;
  }
}

function getSheetOffsets() {
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const panelHeight = sheetPanel.getBoundingClientRect().height;
  const collapsedHeight = Math.min(400, viewportHeight * 0.66);
  const halfHeight = Math.min(620, viewportHeight * 0.78);
  return {
    expanded: 0,
    half: Math.max(0, panelHeight - halfHeight),
    collapsed: Math.max(0, panelHeight - collapsedHeight),
  };
}

function setSheetSnap(snap) {
  sheet.classList.remove("is-collapsed", "is-half", "is-expanded");
  sheet.classList.add(`is-${snap}`);
  sheetPanel.classList.remove("is-dragging");
  dragOffsetRule.style.removeProperty("--ride-options-drag-offset");
  if (snap !== "expanded") {
    sheetScroll.scrollTop = 0;
  }
  grabberButton.setAttribute("aria-expanded", String(snap !== "collapsed"));
  activeDrag = null;
}

function toggleSheetSnap() {
  if (sheet.classList.contains("is-expanded") || sheet.classList.contains("is-collapsed")) {
    setSheetSnap("half");
    return;
  }
  setSheetSnap("expanded");
}

function snapFromKeyboard(direction) {
  const names = ["expanded", "half", "collapsed"];
  const current = names.findIndex((name) => sheet.classList.contains(`is-${name}`));
  const next = Math.max(0, Math.min(names.length - 1, current + direction));
  setSheetSnap(names[next]);
}

function beginSheetDrag(event, source, scrollTop = 0) {
  if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) {
    return;
  }
  activeDrag = {
    pointerId: event.pointerId,
    startY: event.clientY,
    panelDragStartY: event.clientY,
    currentOffset: getSheetOffsets()[
      ["expanded", "half", "collapsed"].find((name) => sheet.classList.contains(`is-${name}`))
    ],
    source,
    scrollTop,
    scrollingContent: false,
    moved: false,
    sheetDragging: false,
    lastY: event.clientY,
    lastTime: performance.now(),
    velocity: 0,
  };
}

function updateDragOffset(offset) {
  const maxOffset = getSheetOffsets().collapsed;
  const boundedOffset = Math.max(0, Math.min(maxOffset, offset));
  dragOffsetRule.style.setProperty("--ride-options-drag-offset", `${boundedOffset}px`);
  return boundedOffset;
}

function startPanelMotion() {
  if (!activeDrag || activeDrag.sheetDragging) {
    return;
  }
  activeDrag.sheetDragging = true;
  sheetPanel.classList.add("is-dragging");
  const captureTarget = activeDrag.source === "header" ? dragArea : sheetScroll;
  if (!captureTarget.hasPointerCapture(activeDrag.pointerId)) {
    captureTarget.setPointerCapture(activeDrag.pointerId);
  }
}

function moveSheetPointer(event, source) {
  if (!activeDrag || activeDrag.pointerId !== event.pointerId) {
    return;
  }
  const deltaY = event.clientY - activeDrag.startY;
  const now = performance.now();
  const elapsed = Math.max(1, now - activeDrag.lastTime);
  activeDrag.velocity = (event.clientY - activeDrag.lastY) / elapsed;
  activeDrag.lastY = event.clientY;
  activeDrag.lastTime = now;

  if (!activeDrag.moved && Math.abs(deltaY) < 4) {
    return;
  }
  activeDrag.moved = true;

  if (source === "scroll" && !activeDrag.sheetDragging) {
    const canCollapse = sheet.classList.contains("is-expanded") || sheet.classList.contains("is-half");
    const scrollOffset = activeDrag.scrollTop - deltaY;
    if (scrollOffset >= 0) {
      event.preventDefault();
      if (!sheetScroll.hasPointerCapture(event.pointerId)) {
        sheetScroll.setPointerCapture(event.pointerId);
      }
      sheetScroll.scrollTop = scrollOffset;
      return;
    }
    if (!canCollapse) {
      event.preventDefault();
      sheetScroll.scrollTop = 0;
      return;
    }
    event.preventDefault();
    sheetScroll.scrollTop = 0;
    activeDrag.panelDragStartY = activeDrag.startY + activeDrag.scrollTop;
    startPanelMotion();
  }

  event.preventDefault();
  startPanelMotion();
  updateDragOffset(activeDrag.currentOffset + event.clientY - activeDrag.panelDragStartY);
}

function finishSheetPointer(event, cancelled = false) {
  if (!activeDrag || activeDrag.pointerId !== event.pointerId) {
    return;
  }
  const drag = activeDrag;
  if (!drag.sheetDragging) {
    activeDrag = null;
    suppressNextSheetClick = drag.moved;
    window.setTimeout(() => {
      suppressNextSheetClick = false;
    }, 0);
    return;
  }
  const offsets = getSheetOffsets();
  const names = ["expanded", "half", "collapsed"];
  const currentOffset = Number.parseFloat(
    dragOffsetRule.style.getPropertyValue("--ride-options-drag-offset"),
  ) || 0;
  let nearest = names.reduce((best, name, index) =>
    Math.abs(offsets[name] - currentOffset) < Math.abs(offsets[names[best]] - currentOffset)
      ? index
      : best, 0);

  if (!cancelled && Math.abs(drag.velocity) > 0.5) {
    nearest = Math.max(0, Math.min(names.length - 1, nearest + Math.sign(drag.velocity)));
  }
  suppressNextSheetClick = drag.moved;
  setSheetSnap(names[nearest]);
  window.setTimeout(() => {
    suppressNextSheetClick = false;
  }, 0);
}

function setServerFare(ride) {
  const serverFare = ride.fare?.rideTotal ?? ride.fare?.total;
  if (typeof serverFare === "number" && Number.isFinite(serverFare)) {
    fareTotal.textContent = new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: ride.fare.currency || "NGN",
      maximumFractionDigits: 0,
    }).format(serverFare);
    vehicleFare.textContent = fareTotal.textContent;
    const billedPassengers = ride.fare.passengers ?? passengerCount;
    fareBreakdown.textContent = typeof ride.fare.perPassenger === "number"
      ? `Base fare ${currencyFormatter.format(ride.fare.perPassenger)} × ${billedPassengers} ` +
        `${billedPassengers === 1 ? "passenger" : "passengers"}`
      : `Base fare for ${billedPassengers} ${billedPassengers === 1 ? "passenger" : "passengers"}`;
  }
}

function openSheet(route) {
  if (!route?.pickup || !route?.destination || route.pickup.id === route.destination.id) {
    return;
  }
  selectedRoute = route;
  passengerCount = Number(route.passengers) || passengerCount;
  timing = route.timing === "scheduled" ? "scheduled" : "now";
  scheduledAt = timing === "scheduled" ? route.scheduledAt : null;
  returnFocusTarget = document.querySelector("#planner-destination");
  updateRouteSummary();
  clearErrors();
  updateFareEstimate();
  sheet.hidden = false;
  sheet.classList.remove("is-closing");
  setSheetSnap("half");
  plannerScreen.setAttribute("aria-hidden", "true");
  document.body.classList.add("ride-options-open");
  requestAnimationFrame(() => sheet.classList.add("is-open"));
  closeButton.focus();
}

function finishCloseSheet(restoreFocus, afterClose) {
  sheet.hidden = true;
  sheet.classList.remove("is-closing", "is-collapsed", "is-half", "is-expanded");
  sheetPanel.classList.remove("is-dragging");
  dragOffsetRule.style.removeProperty("--ride-options-drag-offset");
  activeDrag = null;
  plannerScreen.removeAttribute("aria-hidden");
  document.body.classList.remove("ride-options-open");
  if (restoreFocus && returnFocusTarget?.isConnected && !returnFocusTarget.hidden) {
    returnFocusTarget.focus();
  }
  returnFocusTarget = null;
  afterClose?.();
}

function closeSheet({ restoreFocus = true, afterClose = null } = {}) {
  if (sheet.hidden) {
    return;
  }
  sheet.classList.remove("is-open");
  sheetPanel.classList.remove("is-dragging");
  dragOffsetRule.style.removeProperty("--ride-options-drag-offset");
  activeDrag = null;
  if (!reducedMotion.matches) {
    sheet.classList.add("is-closing");
  }
  if (closingTimer !== null) {
    window.clearTimeout(closingTimer);
  }
  closingTimer = window.setTimeout(() => {
    closingTimer = null;
    finishCloseSheet(restoreFocus, afterClose);
  }, reducedMotion.matches ? 0 : 240);
}

function showExistingRide(ride) {
  trackLink.href = `tracking.html?id=${encodeURIComponent(ride.id)}`;
  cancelRequestButton.hidden = !OPEN_RIDE_STATUSES.has(ride.status);
  setError("You already have an open request.");
  existingRideFound = true;
  continueButton.disabled = true;
  existingActions.hidden = false;
  window.dispatchEvent(new CustomEvent("rider:ride-options-existing-ride", {
    detail: { ride },
  }));
}

function findMatchingRecentRide(rides, attemptStartedAt) {
  return rides.find((ride) => {
    if (!isRideOpen(ride) || !ride.createdAt ||
      new Date(ride.createdAt).getTime() < attemptStartedAt - 10_000) {
      return false;
    }
    if (
      ride.pickup?.id !== selectedRoute.pickup.id ||
      ride.destination?.id !== selectedRoute.destination.id ||
      ride.timing !== timing
    ) {
      return false;
    }
    return timing !== "scheduled" ||
      Math.abs(new Date(ride.scheduledAt).getTime() - new Date(scheduledAt).getTime()) < 60_000;
  });
}

async function refreshRides(userId) {
  return getRides({ userId, includeDriver: false });
}

async function showFriendlyCreateError(error, user, attemptStartedAt) {
  const details = [error?.message, error?.code, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ");
  let rides = [];
  let refreshError = null;
  try {
    rides = await refreshRides(user.id);
  } catch (lookupError) {
    refreshError = lookupError;
    console.error("Ride state could not be refreshed after a booking error.", lookupError);
  }

  const submittedRide = findMatchingRecentRide(rides, attemptStartedAt);
  if (submittedRide) {
    setServerFare(submittedRide);
    window.dispatchEvent(new CustomEvent("rider:ride-options-created", {
      detail: { ride: submittedRide },
    }));
    closeSheet({ restoreFocus: false });
    window.dispatchEvent(new CustomEvent("rider:planner-close-after-booking"));
    return;
  }

  const openImmediateRide = rides.find(isOpenImmediateRide);
  if (openImmediateRide && timing === "now") {
    showExistingRide(openImmediateRide);
    return;
  }

  const openScheduledRides = rides.filter(isOpenScheduledRide);
  if (
    /no more than 5 open scheduled rides|no more than five open scheduled rides/i.test(details) ||
    (timing === "scheduled" && openScheduledRides.length >= 5)
  ) {
    setError(
      "You already have 5 open scheduled rides. Manage one before scheduling another.",
      "history.html",
      "View ride history",
    );
    return;
  }

  if (/no valid fare|no fare is configured|fare settings have not|choose active pickup and destination/i.test(details)) {
    setError("This route is unavailable right now. Choose different campus locations or try again later.");
    return;
  }

  if (/network|fetch|connection|timed?\s*out|offline|load failed/i.test(details) || refreshError) {
    setError(
      "We couldn’t confirm whether your request was sent. Check Ride history before trying again.",
      "history.html",
      "View ride history",
    );
    return;
  }

  setError("Your ride request could not be sent. Please check your trip details and try again.");
  console.error("The ride request could not be created.", error);
}

async function createRideRequest() {
  if (isSubmitting || !selectedRoute) {
    return;
  }
  clearErrors();
  if (selectedRoute.pickup.id === selectedRoute.destination.id) {
    setError("Pickup and destination must be different places.");
    return;
  }
  if (timing === "scheduled" && (!scheduledAt || new Date(scheduledAt) <= new Date())) {
    setError("Choose a pickup time in the future.");
    return;
  }

  isSubmitting = true;
  continueButton.disabled = true;
  continueButton.textContent = "Finding your keke...";
  let riderUser = null;
  let attemptStartedAt = 0;
  try {
    riderUser = await getCurrentUser();
    if (!riderUser || riderUser.role !== "rider") {
      throw new Error("Please sign in with a Rider account to request a ride.");
    }

    await loadFareConfig();
    const existingRides = await refreshRides(riderUser.id);
    if (timing === "now") {
      const openRide = existingRides.find(isOpenImmediateRide);
      if (openRide) {
        showExistingRide(openRide);
        return;
      }
    } else {
      const openScheduledRides = existingRides.filter(isOpenScheduledRide);
      if (openScheduledRides.length >= 5) {
        setError(
          "You already have 5 open scheduled rides. Manage one before scheduling another.",
          "history.html",
          "View ride history",
        );
        return;
      }
    }

    const fare = calculateFare(
      selectedRoute.pickup,
      selectedRoute.destination,
      timing === "scheduled" ? scheduledAt : new Date(),
      passengerCount,
      "keke",
    );
    attemptStartedAt = Date.now();
    const ride = await createRide({
      serviceType: "passenger",
      vehicleType: "keke",
      pickup: selectedRoute.pickup,
      destination: selectedRoute.destination,
      passengers: passengerCount,
      timing,
      scheduledAt: timing === "scheduled" ? new Date(scheduledAt).toISOString() : null,
      paymentMethod: paymentMethod.value,
      customerEmail: riderUser.email,
      fare,
    });
    setServerFare(ride);
    window.dispatchEvent(new CustomEvent("rider:ride-options-created", {
      detail: { ride },
    }));
    closeSheet({ restoreFocus: false });
    window.dispatchEvent(new CustomEvent("rider:planner-close-after-booking"));
  } catch (error) {
    if (!riderUser || riderUser.role !== "rider") {
      setError(error.message || "Sign in with a Rider account to request a ride.");
      return;
    }
    await showFriendlyCreateError(error, riderUser, attemptStartedAt || Date.now());
  } finally {
    isSubmitting = false;
    continueButton.textContent = "Select Keke";
    updateFareEstimate();
  }
}

function handleScheduleSelection(event) {
  const selection = event.detail;
  passengerCount = Number(selection.passengers) || passengerCount;
  timing = selection.timing === "scheduled" ? "scheduled" : "now";
  scheduledAt = timing === "scheduled" ? selection.scheduledAt : null;
  updateFareEstimate();
  if (resumeAfterSelection && selectedRoute) {
    resumeAfterSelection = false;
    openSheet({ ...selectedRoute, passengers: passengerCount, timing, scheduledAt });
  }
}

window.addEventListener("rider:planner-route-selected", (event) => {
  resumeAfterSelection = false;
  openSheet(event.detail);
});

window.addEventListener("rider:planner-selection-changed", handleScheduleSelection);

window.addEventListener("rider:planner-open-time-picker", () => {
  resumeAfterSelection = true;
  closeSheet({ restoreFocus: false });
});

window.addEventListener("rider:planner-focus-field", () => {
  closeSheet({ restoreFocus: false });
});

window.addEventListener("rider:planner-close-after-booking", () => {
  resumeAfterSelection = false;
});

window.addEventListener("rider:booking-auth-state", (event) => {
  if (event.detail?.state === "signed-in") {
    return;
  }
  selectedRoute = null;
  resumeAfterSelection = false;
  clearErrors();
  closeSheet({ restoreFocus: false });
  updateFareEstimate();
});

routeButton.addEventListener("click", () => {
  clearErrors();
  resumeAfterSelection = true;
  closeSheet({
    restoreFocus: false,
    afterClose: () => window.dispatchEvent(new CustomEvent("rider:planner-focus-field", {
      detail: { field: "pickup" },
    })),
  });
});

document.querySelector("#ride-option-keke").addEventListener("click", () => {
  clearErrors();
  updateFareEstimate();
});

closeButton.addEventListener("click", () => {
  clearErrors();
  closeSheet();
});

document.querySelector("[data-ride-options-close]").addEventListener("click", () => {
  clearErrors();
  closeSheet();
});

dragArea.addEventListener("pointerdown", (event) => {
  if (event.target.closest("#ride-options-close")) {
    return;
  }
  beginSheetDrag(event, "header");
});
sheetScroll.addEventListener("pointerdown", (event) => {
  beginSheetDrag(event, "scroll", sheetScroll.scrollTop);
});
sheet.addEventListener("pointermove", (event) => {
  if (activeDrag) {
    moveSheetPointer(event, activeDrag.source);
  }
});
sheet.addEventListener("pointerup", (event) => finishSheetPointer(event));
sheet.addEventListener("pointercancel", (event) => finishSheetPointer(event, true));

sheet.addEventListener("click", (event) => {
  if (!suppressNextSheetClick) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  suppressNextSheetClick = false;
}, true);

grabberButton.addEventListener("click", toggleSheetSnap);
grabberButton.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp") {
    event.preventDefault();
    snapFromKeyboard(-1);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    snapFromKeyboard(1);
  }
});

scheduleButton.addEventListener("click", () => {
  clearErrors();
  resumeAfterSelection = true;
  closeSheet({
    restoreFocus: false,
    afterClose: () => window.dispatchEvent(new Event("rider:planner-open-time-picker")),
  });
});

continueButton.addEventListener("click", createRideRequest);

cancelRequestButton.addEventListener("click", () => {
  const rideId = new URL(trackLink.href, window.location.href).searchParams.get("id");
  window.dispatchEvent(new CustomEvent("rider:ride-options-cancel-existing", {
    detail: { rideId },
  }));
  closeSheet({ restoreFocus: false });
  window.dispatchEvent(new CustomEvent("rider:planner-close-after-booking"));
});

document.addEventListener("keydown", (event) => {
  if (sheet.hidden) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    clearErrors();
    closeSheet();
    return;
  }
  if (event.key === "Tab") {
    const focusable = [...sheet.querySelectorAll(
      'button:not([disabled]), a[href], select:not([disabled])',
    )].filter((element) => !element.hidden && element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

window.addEventListener("popstate", () => {
  if (!sheet.hidden) {
    clearErrors();
    closeSheet({ restoreFocus: false });
  }
});

void loadFareConfig().catch((error) => {
  console.error("Fare estimates could not be loaded for ride options.", error);
});

updateFareEstimate();
