import "./notifications.js";
import {
  getCurrentDriver,
  getCurrentUser,
  logout,
  updateCurrentUserProfile,
  uploadProfilePhoto,
} from "./supabase-api.js?v=account-details";
import { attachPhotoPicker } from "./photo-picker.js";
import { createLoadingState } from "./loading.js";

const expectedRole = document.body.dataset.accountRole;
const form = document.querySelector("#profile-form");
const profileShell = document.querySelector(".profile-card-shell");
const profileContent = document.querySelector("#profile-content");
const profileLoading = createLoadingState(profileShell, profileContent, {
  label: "Loading your profile…",
});
const message = document.querySelector("#profile-message");
const nameInput = document.querySelector("#profile-name");
const emailInput = document.querySelector("#profile-email");
const phoneInput = document.querySelector("#profile-phone");
const plateInput = document.querySelector("#profile-plate");
const vehicleTypeInput = document.querySelector("#profile-vehicle");
const bankNameInput = document.querySelector("#profile-bank-name");
const bankAccountInput = document.querySelector("#profile-bank-account");
const profilePhotoInput = document.querySelector("#profile-photo-input");
const profilePhoto = document.querySelector("#profile-photo");
const profilePhotoInitials = document.querySelector("#profile-photo-initials");
const profileDisplayName = document.querySelector("#profile-display-name");
const driverApprovalStatus = document.querySelector("#driver-approval-status");
const driverProfileRating = document.querySelector("#driver-profile-rating");
const logoutButton = document.querySelector("#logout-button");
const isDriverPage = window.location.pathname.includes("/driver/");
const photoPicker = profilePhotoInput
  ? attachPhotoPicker(profilePhotoInput, { shape: "profile" })
  : null;
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
  emailInput.readOnly = true;
  phoneInput.value = user.phone ?? "";
  profileDisplayName.textContent = user.name ?? "";
  showProfilePhoto(user.avatarUrl, user.name);

  if (expectedRole === "driver" && plateInput) {
    const driver = await getCurrentDriver();
    plateInput.value = driver.plateNumber ?? "";
    bankNameInput.value = driver.bankName ?? "";
    bankAccountInput.value = driver.bankAccountNumber ?? "";
    vehicleTypeInput.value =
      { bike: "Bike · delivery only", keke: "Keke · up to 4 passengers", minivan: "Mini bus · up to 6 passengers" }[
        driver.vehicleType
      ] ?? "Vehicle";
    driverApprovalStatus.textContent = driver.status ?? "Status unavailable";
    driverApprovalStatus.dataset.status = driver.status ?? "";
    if (Number.isFinite(driver.rating) && driver.rating > 0) {
      driverProfileRating.textContent = `★ ${driver.rating.toFixed(1)} / 5`;
      driverProfileRating.hidden = false;
    } else {
      driverProfileRating.hidden = true;
    }
    document.querySelector("#driver-availability-description").textContent =
      driver.status === "approved"
        ? `You are currently ${driver.isOnline ? "online" : "offline"}. Change your availability from the driver dashboard.`
        : "You can change your availability after your driver account is approved.";
  }

  return true;
}

async function handleSubmit(event) {
  event.preventDefault();
  showMessage("");

  const formData = new FormData(form);
  const updates = {
    name: formData.get("name"),
    phone: formData.get("phone"),
  };
  if (expectedRole === "driver") {
    updates.plateNumber = formData.get("plateNumber");
    updates.bankName = formData.get("bankName");
    updates.bankAccountNumber = formData.get("bankAccountNumber");
  }

  try {
    let updatedUser = await updateCurrentUserProfile(updates);
    const photo = photoPicker?.getFile();
    if (photo) {
      photoPicker.setStatus("Uploading your photo…", "uploading");
      const result = await uploadProfilePhoto(photo);
      updatedUser = result.user;
      showProfilePhoto(updatedUser.avatarUrl, updatedUser.name);
      photoPicker.clear();
      photoPicker.setStatus("Profile photo uploaded.", "success");
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }
      if (result.warning) {
        showMessage(result.warning, true);
        return;
      }
    }
    if (expectedRole === "driver") {
      bankNameInput.value = updatedUser.bankName ?? bankNameInput.value;
      bankAccountInput.value = updatedUser.bankAccountNumber ?? bankAccountInput.value;
    }
    profileDisplayName.textContent = updatedUser.name ?? "";
    showMessage("Your profile has been updated.");
  } catch (error) {
    if (photoPicker?.getFile()) {
      photoPicker.setStatus(error.message || "The photo could not be uploaded.", "error");
    }
    showMessage(error.message || "Your profile could not be updated.", true);
  }
}

function previewProfilePhoto(event) {
  const file = event.detail?.file;
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

async function startProfile() {
  profileLoading.showLoading();
  showMessage("");
  if (await loadProfile()) {
    form.addEventListener("submit", handleSubmit);
    logoutButton.addEventListener("click", handleLogout);
    profilePhotoInput?.addEventListener("photo-picker:ready", previewProfilePhoto);
    profileLoading.showLoaded();
  }
}

async function retryProfileLoad() {
  try {
    await startProfile();
  } catch (error) {
    profileLoading.showError(error, retryProfileLoad);
  }
}

await retryProfileLoad();

window.addEventListener("pagehide", () => {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
}, { once: true });
