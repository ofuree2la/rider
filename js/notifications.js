const NOTIFICATION_SELECTOR = [
  ".booking-message",
  ".journey-message",
  ".admin-message",
  ".dashboard-message",
  ".auth-message",
  ".ride-chat-error",
  ".driver-request-notification",
  "#ride-payment-message",
].join(", ");
const NOTIFICATION_DURATION_MS = 6500;
const ERROR_DURATION_MS = 8000;
const EXIT_DURATION_MS = 450;
const notificationTimers = new WeakMap();
const notificationVersions = new WeakMap();
const lastNotificationText = new WeakMap();
let animePromise = null;

function clearNotificationTimer(element) {
  const timer = notificationTimers.get(element);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    notificationTimers.delete(element);
  }
}

function nextNotificationVersion(element) {
  const version = (notificationVersions.get(element) ?? 0) + 1;
  notificationVersions.set(element, version);
  return version;
}

function ensureAnime() {
  if (typeof window.anime === "function") {
    return Promise.resolve(true);
  }
  if (animePromise) {
    return animePromise;
  }

  animePromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.min.js";
    script.async = true;
    script.addEventListener("load", () => resolve(typeof window.anime === "function"), { once: true });
    script.addEventListener("error", () => {
      console.warn("Anime.js could not be loaded; using the browser animation fallback.");
      resolve(false);
    }, { once: true });
    document.head.append(script);
  });
  return animePromise;
}

function animate(element, entering, version) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = reducedMotion ? 0 : entering ? 420 : EXIT_DURATION_MS;
  const complete = () => {
    if (notificationVersions.get(element) !== version) {
      return;
    }
    if (entering) {
      element.classList.add("is-floating-visible");
      return;
    }
    element.hidden = true;
    element.classList.remove("is-floating-visible", "is-floating-leaving");
  };

  ensureAnime().then((animeAvailable) => {
    if (notificationVersions.get(element) !== version || element.hidden && entering) {
      return;
    }
    element.getAnimations?.().forEach((animation) => animation.cancel());
    if (animeAvailable) {
      window.anime.remove(element);
      window.anime({
        targets: element,
        opacity: entering ? [0, 1] : [1, 0],
        translateY: entering ? [-24, 0] : [0, -12],
        scale: entering ? [0.96, 1] : [1, 0.98],
        duration,
        easing: entering ? "easeOutCubic" : "easeInCubic",
        complete,
      });
      return;
    }

    if (typeof element.animate === "function") {
      const animation = element.animate(
        entering
          ? [
              { opacity: 0, transform: "translateY(-24px) scale(0.96)" },
              { opacity: 1, transform: "translateY(0) scale(1)" },
            ]
          : [
              { opacity: 1, transform: "translateY(0) scale(1)" },
              { opacity: 0, transform: "translateY(-12px) scale(0.98)" },
            ],
        { duration, easing: entering ? "cubic-bezier(0.22, 1, 0.36, 1)" : "ease-in", fill: "forwards" },
      );
      animation.onfinish = complete;
      return;
    }
    complete();
  });
}

function hideNotification(element) {
  clearNotificationTimer(element);
  nextNotificationVersion(element);
  if (typeof window.anime === "function") {
    window.anime.remove(element);
  }
  element.getAnimations?.().forEach((animation) => animation.cancel());
  element.classList.remove("is-floating-visible", "is-floating-leaving");
}

function showNotification(element) {
  if (element.hidden || !element.textContent.trim()) {
    return;
  }

  const text = element.textContent.trim();
  const wasVisible = element.classList.contains("is-floating-visible");
  if (wasVisible && lastNotificationText.get(element) === text) {
    return;
  }
  lastNotificationText.set(element, text);

  clearNotificationTimer(element);
  const version = nextNotificationVersion(element);
  const isError = element.classList.contains("error-message") ||
    element.classList.contains("ride-chat-error") ||
    element.classList.contains("is-error");
  element.classList.add("floating-notification");
  element.classList.toggle("floating-notification--error", isError);
  element.classList.toggle("floating-notification--status", !isError);
  element.classList.remove("is-floating-visible", "is-floating-leaving");
  animate(element, true, version);

  const delay = isError ? ERROR_DURATION_MS : NOTIFICATION_DURATION_MS;
  notificationTimers.set(element, window.setTimeout(() => {
    const exitVersion = nextNotificationVersion(element);
    element.classList.add("is-floating-leaving");
    animate(element, false, exitVersion);
  }, delay));
}

function collectNotifications(node, found) {
  if (!(node instanceof Element)) {
    return;
  }
  if (node.matches(NOTIFICATION_SELECTOR)) {
    found.add(node);
  }
  node.querySelectorAll(NOTIFICATION_SELECTOR).forEach((element) => found.add(element));
  const parentNotification = node.parentElement?.closest(NOTIFICATION_SELECTOR);
  if (parentNotification) {
    found.add(parentNotification);
  }
}

function processNotifications(records) {
  const found = new Set();
  for (const record of records) {
    if (record.type === "attributes") {
      collectNotifications(record.target, found);
    } else {
      collectNotifications(record.target, found);
      record.addedNodes.forEach((node) => collectNotifications(node, found));
    }
  }

  for (const element of found) {
    if (element.hidden) {
      hideNotification(element);
    } else {
      showNotification(element);
    }
  }
}

document.querySelectorAll(NOTIFICATION_SELECTOR).forEach((element) => {
  if (!element.hidden) {
    showNotification(element);
  }
});

new MutationObserver(processNotifications).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["hidden"],
  childList: true,
  characterData: true,
  subtree: true,
});
