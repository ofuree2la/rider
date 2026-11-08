import "./notifications.js";
import { getCurrentUser, getRideMessages, sendRideMessage } from "./supabase-api.js";

const dateFormatter = new Intl.DateTimeFormat("en-NG", {
  hour: "numeric",
  minute: "2-digit",
});

export function mountRideChat(root, rideId) {
  const log = document.createElement("ol");
  log.className = "ride-chat-messages";
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  log.setAttribute("aria-label", "Ride messages");

  const error = document.createElement("p");
  error.className = "ride-chat-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const form = document.createElement("form");
  form.className = "ride-chat-form";
  const input = document.createElement("textarea");
  input.name = "message";
  input.rows = 2;
  input.maxLength = 1000;
  input.required = true;
  input.placeholder = "Write a message";
  input.setAttribute("aria-label", "Message");
  const send = document.createElement("button");
  send.type = "submit";
  send.className = "btn btn-primary";
  send.textContent = "Send";
  form.append(input, send);
  root.replaceChildren(log, error, form);

  let disposed = false;
  let senderId = null;
  let otherSenderLabel = "Driver";
  let timer = null;
  let isRefreshing = false;
  let previousIds = new Set();

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
  }

  function getErrorDetails(sendError) {
    return `${sendError?.message ?? ""} ${sendError?.cause?.message ?? ""}`;
  }

  function renderMessages(messages) {
    const shouldScroll =
      log.scrollHeight - log.scrollTop - log.clientHeight < 80 || previousIds.size === 0;

    if (messages.length === 0 && log.children.length === 0) {
      const empty = document.createElement("li");
      empty.className = "ride-chat-empty";
      empty.textContent = "No messages yet. Send a message to coordinate your pickup.";
      log.append(empty);
    } else if (messages.length > 0) {
      log.querySelector(".ride-chat-empty")?.remove();
    }

    for (const message of messages) {
      if (previousIds.has(message.id)) continue;
      const item = document.createElement("li");
      item.className = "ride-chat-message";
      item.classList.toggle("is-own-message", message.senderId === senderId);

      const sender = document.createElement("strong");
      sender.textContent = message.senderId === senderId ? "You" : otherSenderLabel;
      const body = document.createElement("p");
      body.textContent = message.body;
      const time = document.createElement("time");
      const date = new Date(message.createdAt);
      time.textContent = Number.isNaN(date.getTime()) ? "" : dateFormatter.format(date);
      item.append(sender, body, time);
      log.append(item);
      previousIds.add(message.id);
    }

    if (messages.length > 0 && shouldScroll) {
      log.scrollTop = log.scrollHeight;
    }
  }

  async function refreshMessages() {
    if (isRefreshing || disposed) return;
    isRefreshing = true;
    try {
      const messages = await getRideMessages(rideId);
      if (!disposed) {
        error.hidden = true;
        renderMessages(messages);
      }
    } catch (loadError) {
      if (!disposed) {
        showError(`Ride messages could not be loaded: ${loadError.message}`);
      }
    } finally {
      isRefreshing = false;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;

    send.disabled = true;
    error.hidden = true;
    try {
      await sendRideMessage(rideId, message);
      input.value = "";
      await refreshMessages();
    } catch (sendError) {
      if (/message limit reached/i.test(getErrorDetails(sendError))) {
        showError("You’ve reached the chat limit of 15 messages per minute. Please wait before sending another.");
      } else {
        showError(`Message could not be sent: ${sendError.message}`);
      }
    } finally {
      send.disabled = false;
      input.focus();
    }
  });

  getCurrentUser()
    .then((user) => {
      if (!user || disposed) return;
      senderId = user.id;
      otherSenderLabel = user.role === "driver" ? "Rider" : "Driver";
      return refreshMessages();
    })
    .catch((loadError) => {
      if (!disposed) {
        showError(`Ride chat could not be opened: ${loadError.message}`);
      }
    });

  timer = window.setInterval(() => {
    if (!disposed && document.visibilityState === "visible") {
      refreshMessages();
    }
  }, 5000);

  return () => {
    disposed = true;
    window.clearInterval(timer);
  };
}
