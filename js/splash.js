import { getCurrentUser } from "./supabase-api.js";

const STANDARD_DELAY_MS = 2000;
const REDUCED_MOTION_DELAY_MS = 350;

function isReducedMotionPreferred() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

async function getDestination() {
  try {
    return (await getCurrentUser()) ? "book.html" : "index.html";
  } catch (error) {
    console.error("Could not check the Rider session before redirecting:", error);
    return "index.html";
  }
}

function redirectTo(destination) {
  const url = new URL(destination, window.location.href);
  if (destination === "index.html") {
    url.searchParams.set("splash", "complete");
  }
  window.location.replace(url.href);
}

async function startSplash() {
  if (document.body.hasAttribute("data-splash-entry")) {
    const url = new URL(window.location.href);
    if (url.searchParams.get("splash") === "complete") {
      url.searchParams.delete("splash");
      window.history.replaceState({}, "", url.href);
      return;
    }

    window.location.replace(new URL("splash.html", window.location.href).href);
    return;
  }

  if (!document.body.hasAttribute("data-splash-screen")) {
    return;
  }

  const reducedMotion = isReducedMotionPreferred();
  const delay = reducedMotion ? REDUCED_MOTION_DELAY_MS : STANDARD_DELAY_MS;
  const leaveDelay = reducedMotion ? 0 : 300;
  const splashScreen = document.querySelector(".splash-screen");

  window.setTimeout(async () => {
    splashScreen.classList.add("is-leaving");
    window.setTimeout(async () => {
      redirectTo(await getDestination());
    }, leaveDelay);
  }, delay - leaveDelay);
}

startSplash();
