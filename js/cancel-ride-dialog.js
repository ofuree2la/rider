const LAST_BOOKED_RIDE_KEY = "rider:last-booked-ride";

const cancellationReasons = [
  ["found another ride", "Found another ride"],
  ["plans changed", "Plans changed"],
  ["driver too far", "Driver is too far away"],
  ["booked by mistake", "Booked by mistake"],
  ["other", "Other"],
];

let activeDialog = null;

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

export function confirmRideCancellation(ride) {
  if (activeDialog?.open) {
    return Promise.resolve(null);
  }

  const previousFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "ride-cancel-dialog";
  dialog.setAttribute("aria-labelledby", "ride-cancel-title");

  const content = document.createElement("div");
  content.className = "ride-cancel-dialog-content";
  content.append(
    createTextElement("span", "eyebrow accent", "Cancel ride"),
    createTextElement("h2", "ride-cancel-dialog-title", "Cancel this request?"),
  );
  content.querySelector("h2").id = "ride-cancel-title";

  const warningText =
    ride.status === "arriving"
      ? "Your driver is on the way. Cancel anyway?"
      : ride.status === "accepted"
        ? "A driver has accepted your ride. Cancel anyway?"
        : "This will cancel your request for this ride.";
  const warning = createTextElement("p", "ride-cancel-dialog-warning", warningText);
  if (ride.status === "arriving") {
    warning.dataset.severity = "high";
  }
  content.append(warning);

  const reasonLabel = createTextElement("label", "ride-cancel-reason-label", "Reason (optional)");
  reasonLabel.htmlFor = "ride-cancel-reason";
  const reasonSelect = document.createElement("select");
  reasonSelect.id = "ride-cancel-reason";
  reasonSelect.className = "ride-cancel-reason";
  reasonSelect.name = "cancellation-reason";
  const emptyReason = document.createElement("option");
  emptyReason.value = "";
  emptyReason.textContent = "Choose a reason";
  reasonSelect.append(emptyReason);
  for (const [value, label] of cancellationReasons) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    reasonSelect.append(option);
  }
  content.append(reasonLabel, reasonSelect);

  const actions = document.createElement("div");
  actions.className = "ride-cancel-dialog-actions";
  const keepButton = document.createElement("button");
  keepButton.type = "button";
  keepButton.className = "btn btn-secondary";
  keepButton.textContent = "Keep my ride";
  keepButton.addEventListener("click", () => dialog.close("keep"));

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "btn btn-danger";
  confirmButton.textContent = "Cancel request";
  confirmButton.addEventListener("click", () => dialog.close("confirm"));
  actions.append(keepButton, confirmButton);
  content.append(actions);
  dialog.append(content);

  return new Promise((resolve) => {
    activeDialog = dialog;
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        dialog.close("dismiss");
      }
    });
    dialog.addEventListener(
      "close",
      () => {
        const result =
          dialog.returnValue === "confirm"
            ? { confirmed: true, reason: reasonSelect.value || null }
            : null;
        dialog.remove();
        activeDialog = null;
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
          previousFocus.focus();
        }
        resolve(result);
      },
      { once: true },
    );
    document.body.append(dialog);
    dialog.showModal();
    keepButton.focus();
  });
}

export function clearSavedBookingConfirmation(rideId) {
  try {
    if (window.sessionStorage.getItem(LAST_BOOKED_RIDE_KEY) === rideId) {
      window.sessionStorage.removeItem(LAST_BOOKED_RIDE_KEY);
    }
  } catch (error) {
    console.error("The cancelled booking reference could not be cleared.", error);
  }
}
