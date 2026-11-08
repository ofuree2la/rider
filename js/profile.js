import "./notifications.js";
import {
  getCurrentDriver,
  getCurrentUser,
  logout,
  updateCurrentUserProfile,
  uploadProfilePhoto,
} from "./supabase-api.js";

const expectedRole = document.body.dataset.accountRole;
const form = document.querySelector("#profile-form");
const message = document.querySelector("#profile-message");
const nameInput = document.querySelector("#profile-name");
const emailInput = document.querySelector("#profile-email");
const phoneInput = document.querySelector("#profile-phone");
const plateInput = document.querySelector("#profile-plate");
const vehicleTypeInput = document.querySelector("#profile-vehicle");
const profilePhotoInput = document.querySelector("#profile-photo-input");
const profilePhoto = document.querySelector("#profile-photo");
const profilePhotoInitials = document.querySelector("#profile-photo-initials");
const logoutButton = document.querySelector("#logout-button");
const isDriverPage = window.location.pathname.includes("/driver/");
let previewUrl = null;

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

function showProfilePhoto(url, name) {
  profilePhotoInitials.textContent = (name || "R")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  profilePhoto.hidden = !url;
  profilePhotoInitials.hidden = Boolean(url);
  if (url) {
    profilePhoto.src = url;
  } else {
    profilePhoto.removeAttribute("src");
  }
}

async function loadProfile() {
  const user = await getCurrentUser();
  if (!user || user.role !== expectedRole) {
    window.location.replace(getLoginPath(user?.role));
    return false;
  }

  nameInput.value = user.name ?? "";
  emailInput.value = user.email ?? "";
  phoneInput.value = user.phone ?? "";
  showProfilePhoto(user.avatarUrl, user.name);

  if (expectedRole === "driver" && plateInput) {
    const driver = await getCurrentDriver();
    plateInput.value = driver.plateNumber ?? "";
    vehicleTypeInput.value =
      { bike: "Bike · delivery only", keke: "Keke · up to 4 passengers", minivan: "Mini bus · up to 6 passengers" }[
        driver.vehicleType
      ] ?? "Vehicle";
  }

  return true;
}

async function handleSubmit(event) {
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
    await updateCurrentUserProfile(updates);
    const photo = profilePhotoInput.files[0];
    if (photo) {
      const result = await uploadProfilePhoto(photo);
      showProfilePhoto(result.user.avatarUrl, result.user.name);
      profilePhotoInput.value = "";
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }
      if (result.warning) {
        showMessage(result.warning, true);
        return;
      }
    }
    showMessage("Your profile has been updated. If you changed your email, confirm it from the message we sent.");
  } catch (error) {
    showMessage(error.message || "Your profile could not be updated.", true);
  }
}

function previewProfilePhoto() {
  const file = profilePhotoInput.files[0];
  if (!file) {
    return;
  }
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }
  previewUrl = URL.createObjectURL(file);
  showProfilePhoto(previewUrl, nameInput.value);
}

async function handleLogout() {
  try {
    await logout();
    window.location.assign(getLoginPath());
  } catch (error) {
    showMessage(`You could not be logged out: ${error.message}`, true);
  }
}

if (!form || !message || !nameInput || !emailInput || !phoneInput || !logoutButton) {
  throw new Error("The profile page is missing required form elements.");
}

try {
  if (await loadProfile()) {
    form.addEventListener("submit", handleSubmit);
    logoutButton.addEventListener("click", handleLogout);
    profilePhotoInput?.addEventListener("change", previewProfilePhoto);
  }
} catch (error) {
  showMessage(`Your profile could not be loaded: ${error.message}`, true);
}
