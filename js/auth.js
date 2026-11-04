import { getCurrentUser, login, logout, signup } from "./api.js";

const form = document.querySelector("[data-auth-form]");
const message = document.querySelector("#auth-message");
const accountRole = document.body.dataset.accountRole;
const isSignup = form?.dataset.authMode === "signup";

function getDestination(role) {
  return role === "driver" || role === "admin" ? "dashboard.html" : "book.html";
}

function showMessage(text, isError = true) {
  message.textContent = text;
  message.hidden = !text;
  message.classList.toggle("error-message", isError);
  message.classList.toggle("status-message", !isError);
}

function redirectForExistingSession() {
  try {
    const user = getCurrentUser();
    if (!user) {
      return;
    }

    if (user.role === accountRole) {
      window.location.replace(getDestination(user.role));
      return;
    }

    showMessage(
      `You are signed in as a ${user.role}. Log out first or use the ${user.role} sign-in page.`,
    );
  } catch (error) {
    showMessage(`Your saved session could not be checked: ${error.message}`);
  }
}

function handleSubmit(event) {
  event.preventDefault();
  showMessage("");

  const formData = new FormData(form);
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  try {
    let user;

    if (isSignup) {
      const passwordConfirmation = String(formData.get("passwordConfirmation") ?? "");
      if (password !== passwordConfirmation) {
        throw new Error("The passwords do not match.");
      }

      user = signup({
        name: formData.get("fullName"),
        email,
        phone: formData.get("phone"),
        password,
        role: accountRole,
        ...(accountRole === "driver"
          ? { plateNumber: formData.get("plateNumber") }
          : {}),
      });
    } else {
      user = login(email, password, accountRole);
    }

    window.location.assign(getDestination(user.role));
  } catch (error) {
    showMessage(error.message || "Your account could not be processed.");
  }
}

if (!form || !message || !["rider", "driver", "admin"].includes(accountRole)) {
  throw new Error("This Rider sign-in page is missing required account settings.");
}

form.addEventListener("submit", handleSubmit);
redirectForExistingSession();

window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    redirectForExistingSession();
  }
});

document.querySelector("[data-logout]")?.addEventListener("click", () => {
  try {
    logout();
    showMessage("You have been logged out.", false);
  } catch (error) {
    showMessage(`Logout failed: ${error.message}`);
  }
});
