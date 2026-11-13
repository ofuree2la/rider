function createSkeletons() {
  const skeletons = document.createElement("div");
  skeletons.className = "rider-loading-state__skeletons";
  skeletons.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 3; index += 1) {
    const line = document.createElement("span");
    line.className = "rider-loading-state__skeleton";
    skeletons.append(line);
  }
  return skeletons;
}

export function createLoadingState(container, content, { label = "Loading" } = {}) {
  if (!(container instanceof HTMLElement) || !(content instanceof HTMLElement)) {
    throw new TypeError("A loading state requires a container and content element.");
  }

  const state = container.querySelector(":scope > .rider-loading-state") ??
    document.createElement("div");
  state.className = "rider-loading-state";
  state.setAttribute("role", "status");
  state.setAttribute("aria-live", "polite");
  state.setAttribute("aria-atomic", "true");
  if (!state.isConnected) {
    state.hidden = false;
    container.insertBefore(state, content);
  }

  function showLoading() {
    container.setAttribute("aria-busy", "true");
    content.hidden = true;
    state.replaceChildren();
    const spinner = document.createElement("span");
    spinner.className = "rider-loading-state__spinner";
    spinner.setAttribute("aria-hidden", "true");
    const message = document.createElement("p");
    message.className = "rider-loading-state__message";
    message.textContent = label;
    state.append(spinner, message, createSkeletons());
    state.hidden = false;
  }

  function showLoaded() {
    container.setAttribute("aria-busy", "false");
    state.hidden = true;
    state.replaceChildren();
    content.hidden = false;
    content.classList.remove("rider-loading-fade-in");
    requestAnimationFrame(() => content.classList.add("rider-loading-fade-in"));
  }

  function showError(error, retry) {
    container.setAttribute("aria-busy", "false");
    content.hidden = true;
    const message = document.createElement("p");
    message.className = "rider-loading-state__message";
    message.textContent = error instanceof Error ? error.message : String(error);
    state.replaceChildren(message);
    if (typeof retry === "function") {
      const button = document.createElement("button");
      button.className = "rider-loading-state__retry";
      button.type = "button";
      button.textContent = "Retry";
      button.addEventListener("click", retry, { once: true });
      state.append(button);
    }
    state.hidden = false;
  }

  function showEmpty(message) {
    container.setAttribute("aria-busy", "false");
    content.hidden = true;
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "rider-loading-state__message";
    emptyMessage.textContent = message;
    state.replaceChildren(emptyMessage);
    state.hidden = false;
  }

  return { showLoading, showLoaded, showError, showEmpty };
}
