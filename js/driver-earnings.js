import "./notifications.js";
import { getCurrentDriver, getCurrentUser, getDriverRides, logout } from "./supabase-api.js";

const driverNameHeading = document.querySelector("#driver-name-heading");
const todayCount = document.querySelector("#today-count");
const todayEarnings = document.querySelector("#today-earnings");
const weekEarnings = document.querySelector("#week-earnings");
const completedTotal = document.querySelector("#completed-total");
const allTimeEarnings = document.querySelector("#alltime-earnings");
const earningsError = document.querySelector("#earnings-error");
const logoutButton = document.querySelector("#logout-button");
const EARNINGS_REFRESH_INTERVAL_MS = 60_000;
let earningsRefreshTimer = null;
let driverIsOnline = false;
const currencyFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

function showError(message) {
  earningsError.textContent = message;
  earningsError.hidden = false;
}

function formatCash(amount) {
  return currencyFormatter.format(Number(amount ?? 0));
}

function getRideTotal(ride) {
  return ride?.fare?.rideTotal ?? ride?.fare?.total ?? 0;
}

function summarizeEarnings(rides) {
  const completedRides = rides.filter((ride) => ride.status === "completed");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6);

  const completedToday = completedRides.filter((ride) => {
    if (!ride.completedAt) {
      return false;
    }
    return new Date(ride.completedAt) >= today;
  });
  const completedThisWeek = completedRides.filter((ride) => {
    if (!ride.completedAt) {
      return false;
    }
    return new Date(ride.completedAt) >= weekStart;
  });

  return {
    completedToday,
    completedRides,
    completedThisWeek,
  };
}

async function refreshEarnings(driverId) {
  earningsError.hidden = true;
  const rides = await getDriverRides(driverId, {
    includeDriver: false,
    includeRiderPhone: false,
  });
  const { completedToday, completedRides, completedThisWeek } = summarizeEarnings(rides);
  todayCount.textContent = String(completedToday.length);
  todayEarnings.textContent = formatCash(
    completedToday.reduce((sum, ride) => sum + Number(getRideTotal(ride)), 0),
  );
  weekEarnings.textContent = formatCash(
    completedThisWeek.reduce((sum, ride) => sum + Number(getRideTotal(ride)), 0),
  );
  completedTotal.textContent = `${completedRides.length} trips`;
  allTimeEarnings.textContent = formatCash(
    completedRides.reduce((sum, ride) => sum + Number(getRideTotal(ride)), 0),
  );
}

function stopEarningsRefresh() {
  if (earningsRefreshTimer !== null) {
    window.clearInterval(earningsRefreshTimer);
    earningsRefreshTimer = null;
  }
}

function startEarningsRefresh(driverId) {
  if (!driverIsOnline || earningsRefreshTimer !== null) {
    return;
  }
  earningsRefreshTimer = window.setInterval(async () => {
    if (document.visibilityState !== "visible" || !driverIsOnline) {
      return;
    }
    try {
      await refreshEarnings(driverId);
    } catch (error) {
      showError(`Earnings could not be refreshed: ${error.message}`);
    }
  }, EARNINGS_REFRESH_INTERVAL_MS);
}

function handleDriverAvailabilityChange(event) {
  driverIsOnline = Boolean(event.detail?.isOnline);
  if (driverIsOnline) {
    startEarningsRefresh(driverId);
  } else {
    stopEarningsRefresh();
  }
}

function handleDriverSessionEnded() {
  stopEarningsRefresh();
}

let driverId = null;

async function startEarningsPage() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "driver") {
      window.location.replace(
        user?.role === "rider"
          ? "../login.html"
          : user?.role === "admin"
            ? "../admin/login.html"
            : "login.html",
      );
      return;
    }

    const driver = await getCurrentDriver();
    driverId = driver.id;
    driverIsOnline = Boolean(driver.isOnline && driver.status === "approved");
    driverNameHeading.textContent = driver.name;
    logoutButton.addEventListener("click", async () => {
      try {
        await logout();
        window.location.assign("login.html");
      } catch (error) {
        showError(`Logout failed: ${error.message}`);
      }
    });

    await refreshEarnings(driver.id);
    document.addEventListener("driver-availability-state-changed", handleDriverAvailabilityChange);
    document.addEventListener("driver-session-ended", handleDriverSessionEnded);
    startEarningsRefresh(driver.id);
    window.addEventListener("pagehide", () => {
      stopEarningsRefresh();
      document.removeEventListener("driver-availability-state-changed", handleDriverAvailabilityChange);
      document.removeEventListener("driver-session-ended", handleDriverSessionEnded);
    }, { once: true });
  } catch (error) {
    showError(`Earnings could not be loaded: ${error.message}`);
  }
}

startEarningsPage();
