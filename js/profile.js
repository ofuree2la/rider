import { getCurrentDriver, getCurrentUser, logout, updateCurrentUserProfile } from "./api.js";

const expectedRole = document.body.dataset.accountRole;
const form = document.querySelector("#profile-form");
const message = document.querySelector("#profile-message");
const nameInput = document.querySelector("#profile-name");
const emailInput = document.querySelector("#profile-email");
const phoneInput = document.querySelector("#profile-phone");
const plateInput = document.querySelector("#profile-plate");
const logoutButton = document.querySelector("#logout-button");
const isDriverPage = window.location.pathname.includes("/driver/");

function getLoginPath(role = expectedRole) {
  if (role === "driver") {
    return isDriverPage ? "login.html" : "driver/login.html";
  }
  return isDriverPage ? "../login.html" : "login.html";
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.hidden = !text;
  message.classList.toggle("status-message", !isError);
  message.classList.toggle("error-message", isError);
}

function loadProfile() {
  const user = getCurrentUser();
  if (!user || user.role !== expectedRole) {
    window.location.replace(getLoginPath(user?.role));
    return false;
  }

  nameInput.value = user.name ?? "";
  emailInput.value = user.email ?? "";
  phoneInput.value = user.phone ?? "";

  if (expectedRole === "driver" && plateInput) {
    plateInput.value = getCurrentDriver().plateNumber ?? "";
  }

  return true;
}

function handleSubmit(event) {
  event.preventDefault();
  showMessage("");

  const formData = new FormData(form);
  const updates = {
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
  };
  if (expectedRole === "driver") {
    updates.plateNumber = formData.get("plateNumber");
  }

  try {
    updateCurrentUserProfile(updates);
    showMessage("Your profile has been updated.");
  } catch (error) {
    showMessage(error.message || "Your profile could not be updated.", true);
  }
}

function handleLogout() {
  try {
    logout();
    window.location.assign(getLoginPath());
  } catch (error) {
    showMessage(`You could not be logged out: ${error.message}`, true);
  }
}

if (!form || !message || !nameInput || !emailInput || !phoneInput || !logoutButton) {
  throw new Error("The profile page is missing required form elements.");
}

try {
  if (loadProfile()) {
    form.addEventListener("submit", handleSubmit);
    logoutButton.addEventListener("click", handleLogout);
  }
} catch (error) {
  showMessage(`Your profile could not be loaded: ${error.message}`, true);
}
