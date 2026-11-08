const WAITING_DELAY_MS = 2 * 60 * 1000;
const SNOOZE_STORAGE_PREFIX = "rider:no-ride-snooze:";

function getVehicleLabel(vehicleType) {
  const labels = {
    keke: "keke",
    minivan: "minibus",
    bike: "bike",
  };
  return labels[vehicleType] ?? "ride";
}

function getSnoozeKey(rideId) {
  return `${SNOOZE_STORAGE_PREFIX}${rideId}`;
}

function readSnoozeUntil(rideId) {
  try {
    const savedValue = Number(window.sessionStorage.getItem(getSnoozeKey(rideId)));
    return Number.isFinite(savedValue) ? savedValue : 0;
  } catch (error) {
    console.error("The waiting reminder could not be restored.", error);
    return 0;
  }
}

export function mountNoRideAvailablePrompt(root, { onTryAgain, onCancel }) {
  const section = document.createElement("section");
  section.className = "no-ride-available";
  section.hidden = true;
  section.setAttribute("aria-live", "polite");
  section.setAttribute("aria-labelledby", "no-ride-available-title");

  const title = document.createElement("h3");
  title.id = "no-ride-available-title";
  const message = document.createElement("p");
  message.textContent = "Matching drivers may still accept your request. You can keep waiting, try again, or cancel.";

  const actions = document.createElement("div");
  actions.className = "no-ride-available-actions";
  const keepWaitingButton = document.createElement("button");
  keepWaitingButton.type = "button";
  keepWaitingButton.className = "btn btn-secondary";
  keepWaitingButton.textContent = "Keep waiting";

  const tryAgainButton = document.createElement("button");
  tryAgainButton.type = "button";
  tryAgainButton.className = "btn btn-primary";
  tryAgainButton.textContent = "Try again";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "btn btn-danger";
  cancelButton.textContent = "Cancel request";

  actions.append(keepWaitingButton, tryAgainButton, cancelButton);
  section.append(title, message, actions);
  root.append(section);

  let currentRide = null;
  let timer = null;
  let isBusy = false;
  const snoozesByRideId = new Map();

  function setButtonsDisabled(disabled) {
    keepWaitingButton.disabled = disabled;
    tryAgainButton.disabled = disabled;
    cancelButton.disabled = disabled;
  }

  function render(ride = currentRide) {
    currentRide = ride;
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }

    if (
      !ride ||
      ride.status !== "finding" ||
      ride.timing !== "now" ||
      !ride.createdAt
    ) {
      section.hidden = true;
      return;
    }

    const createdAt = new Date(ride.createdAt).getTime();
    if (!Number.isFinite(createdAt)) {
      section.hidden = true;
      console.error("The ride has an invalid database creation timestamp.", ride.id);
      return;
    }

    title.textContent = `No ${getVehicleLabel(ride.vehicleType)} available right now`;
    const waitingUntil = Math.max(
      createdAt + WAITING_DELAY_MS,
      snoozesByRideId.get(ride.id) ?? readSnoozeUntil(ride.id),
    );
    const remaining = waitingUntil - Date.now();
    section.hidden = remaining > 0;
    setButtonsDisabled(isBusy);

    if (remaining > 0) {
      timer = window.setTimeout(() => render(ride), remaining);
    }
  }

  async function runAction(action) {
    if (isBusy || !currentRide) {
      return;
    }
    isBusy = true;
    setButtonsDisabled(true);
    try {
      await action(currentRide);
    } finally {
      isBusy = false;
      render();
    }
  }

  keepWaitingButton.addEventListener("click", () => {
    if (!currentRide || isBusy) {
      return;
    }
    const snoozedUntil = Date.now() + WAITING_DELAY_MS;
    snoozesByRideId.set(currentRide.id, snoozedUntil);
    try {
      window.sessionStorage.setItem(getSnoozeKey(currentRide.id), String(snoozedUntil));
    } catch (error) {
      console.error("The waiting reminder could not be saved.", error);
    }
    render();
  });
  tryAgainButton.addEventListener("click", () => runAction(onTryAgain));
  cancelButton.addEventListener("click", () => runAction(onCancel));

  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      render();
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return {
    render,
    setBusy(busy) {
      isBusy = busy;
      setButtonsDisabled(busy);
    },
    cleanup() {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      section.remove();
    },
  };
}
