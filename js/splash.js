import { getCurrentUser } from "./api.js";

const SPLASH_SESSION_KEY = "rider.splash.seen";
const STANDARD_DELAY_MS = 2000;
const REDUCED_MOTION_DELAY_MS = 350;

function isReducedMotionPreferred() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getDestination() {
  try {
    return getCurrentUser() ? "book.html" : "index.html";
  } catch (error) {
    console.error("Could not check the Rider session before redirecting:", error);
    return "index.html";
  }
}

function redirectTo(destination, sessionStorageAvailable = true) {
  const url = new URL(destination, window.location.href);
  if (!sessionStorageAvailable && destination === "index.html") {
    url.searchParams.set("splash", "complete");
  }
  window.location.replace(url.href);
}

function startSplash() {
  if (document.body.hasAttribute("data-splash-entry")) {
    const url = new URL(window.location.href);
    if (url.searchParams.get("splash") === "complete") {
      url.searchParams.delete("splash");
      window.history.replaceState({}, "", url.href);
      return;
    }

    try {
      if (window.sessionStorage.getItem(SPLASH_SESSION_KEY) === "true") {
        return;
      }
    } catch (error) {
      console.warn("Session storage is unavailable; showing the splash with a one-time URL fallback.", error);
    }

    window.location.replace(new URL("splash.html", window.location.href).href);
    return;
  }

  if (!document.body.hasAttribute("data-splash-screen")) {
    return;
  }

  let sessionStorageAvailable = true;
  try {
    if (window.sessionStorage.getItem(SPLASH_SESSION_KEY) === "true") {
      redirectTo(getDestination());
      return;
    }
  } catch (error) {
    sessionStorageAvailable = false;
    console.warn("Session storage is unavailable; the splash will use a one-time URL fallback.", error);
  }

  const reducedMotion = isReducedMotionPreferred();
  const delay = reducedMotion ? REDUCED_MOTION_DELAY_MS : STANDARD_DELAY_MS;
  const leaveDelay = reducedMotion ? 0 : 300;
  const splashScreen = document.querySelector(".splash-screen");

  window.setTimeout(() => {
    splashScreen.classList.add("is-leaving");
    window.setTimeout(() => {
      if (sessionStorageAvailable) {
        try {
          window.sessionStorage.setItem(SPLASH_SESSION_KEY, "true");
        } catch (error) {
          sessionStorageAvailable = false;
          console.warn("Could not save the Rider splash session; using a one-time URL fallback.", error);
        }
      }

      redirectTo(getDestination(), sessionStorageAvailable);
    }, leaveDelay);
  }, delay - leaveDelay);
}

startSplash();
