const plannerButton = document.querySelector("#planner-open-button");
const plannerBridge = document.querySelector("#planner-bridge");
const plannerCloseButton = document.querySelector("#planner-bridge-close");
const matchCard = document.querySelector("#match-card");

let authState = "loading";
let bookingReady = false;
let returnFocusTarget = null;

function hasOpenRideCard() {
  return matchCard.isConnected && !matchCard.hidden;
}

function closePlannerBridge({ restoreFocus = true } = {}) {
  if (plannerBridge.hidden) {
    return;
  }
  plannerBridge.hidden = true;
  document.body.classList.remove("planner-bridge-open");
  if (restoreFocus && returnFocusTarget?.isConnected && !returnFocusTarget.hidden) {
    returnFocusTarget.focus();
  }
  returnFocusTarget = null;
}

function renderEntry() {
  const canOpenPlanner =
    authState === "signed-in" && bookingReady && !hasOpenRideCard();
  plannerButton.hidden = !canOpenPlanner;
  if (!canOpenPlanner) {
    closePlannerBridge({ restoreFocus: false });
  }
}

function openPlannerBridge() {
  if (plannerButton.hidden || hasOpenRideCard()) {
    return;
  }
  returnFocusTarget = plannerButton;
  plannerBridge.hidden = false;
  document.body.classList.add("planner-bridge-open");
  plannerCloseButton.focus();
}

window.addEventListener("rider:booking-auth-state", (event) => {
  authState = event.detail.state;
  if (authState !== "signed-in") {
    bookingReady = false;
  }
  renderEntry();
});

window.addEventListener("rider:booking-ready", () => {
  bookingReady = true;
  renderEntry();
});

plannerButton.addEventListener("click", openPlannerBridge);
plannerCloseButton.addEventListener("click", () => closePlannerBridge());

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !plannerBridge.hidden) {
    closePlannerBridge();
  } else if (event.key === "Tab" && !plannerBridge.hidden) {
    event.preventDefault();
    plannerCloseButton.focus();
  }
});

const rideCardObserver = new MutationObserver(renderEntry);
rideCardObserver.observe(matchCard, { attributes: true, attributeFilter: ["hidden"] });
rideCardObserver.observe(matchCard.parentElement, { childList: true });
