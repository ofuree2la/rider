import {
  getCurrentDriver,
  getCurrentUser,
  getDriverRideRequests,
  getDriverRides,
  logout,
  setDriverOnline,
} from "./supabase-api.js";

const driverNameHeading = document.querySelector("#driver-name-heading");
const driverOnlineToggle = document.querySelector("#driver-online-toggle");
const dashboardStatus = document.querySelector("#dashboard-status");
const dashboardError = document.querySelector("#dashboard-error");
const pendingCount = document.querySelector("#pending-count");
const activeCount = document.querySelector("#active-count");
const logoutButton = document.querySelector("#logout-button");
const DASHBOARD_REFRESH_INTERVAL_MS = 15_000;

let driver = null;
let isRefreshRunning = false;

function showStatus(message) {
  dashboardStatus.textContent = message;
  dashboardStatus.hidden = false;
  dashboardError.hidden = true;
}

function showError(message) {
  dashboardError.textContent = message;
  dashboardError.hidden = false;
  dashboardStatus.hidden = true;
}

function redirectToLogin(user) {
  window.location.replace(
    user?.role === "rider"
      ? "../login.html"
      : user?.role === "admin"
        ? "../admin/login.html"
        : "login.html",
  );
}

async function refreshOverview() {
  const [requests, rides] = await Promise.all([
    getDriverRideRequests(driver.id),
    getDriverRides(driver.id),
  ]);
  pendingCount.textContent = String(requests.length);
  activeCount.textContent = String(
    rides.filter((ride) => ["accepted", "arriving", "on-trip"].includes(ride.status)).length,
  );
}

async function handleOnlineToggle(event) {
  const nextOnlineState = event.target.checked;
  const previousOnlineState = Boolean(driver.isOnline);
  driverOnlineToggle.disabled = true;

  try {
    await setDriverOnline(driver.id, nextOnlineState);
    driver.isOnline = nextOnlineState;
    driverOnlineToggle.checked = nextOnlineState;
    showStatus(`${driver.name} is now ${nextOnlineState ? "online" : "offline"}.`);
    await refreshOverview();
  } catch (error) {
    driver.isOnline = previousOnlineState;
    driverOnlineToggle.checked = previousOnlineState;
    showError(error.message);
  } finally {
    driverOnlineToggle.disabled = driver.status !== "approved";
  }
}

async function startDashboard() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "driver") {
      redirectToLogin(user);
      return;
    }

    driver = await getCurrentDriver();
    driverNameHeading.textContent = driver.name;
    driverOnlineToggle.checked = driver.status === "approved" && Boolean(driver.isOnline);
    driverOnlineToggle.disabled = driver.status !== "approved";

    if (driver.status !== "approved") {
      showStatus(
        driver.status === "suspended"
          ? "Your driver account is suspended. Contact Rider support for help."
          : "Your driver account is waiting for admin approval before you can go online.",
      );
    }

    logoutButton.addEventListener("click", async () => {
      try {
        await logout();
        window.location.assign("login.html");
      } catch (error) {
        showError(`Logout failed: ${error.message}`);
      }
    });
    driverOnlineToggle.addEventListener("change", handleOnlineToggle);

    await refreshOverview();
    window.setInterval(async () => {
      if (document.visibilityState !== "visible" || isRefreshRunning) {
        return;
      }

      isRefreshRunning = true;
      try {
        await refreshOverview();
      } catch (error) {
        showError(`The driver dashboard could not be refreshed: ${error.message}`);
      } finally {
        isRefreshRunning = false;
      }
    }, DASHBOARD_REFRESH_INTERVAL_MS);
  } catch (error) {
    showError(`The driver dashboard could not be loaded: ${error.message}`);
  }
}

startDashboard();
