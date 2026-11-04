(function () {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const anime = window.anime;

  function animateEntrance() {
    if (reducedMotion || typeof anime !== "function") {
      return;
    }

    const targets = document.querySelectorAll(
      "main > section, main > .container > section, .auth-shell, .admin-stat-card, .journey-card",
    );
    if (!targets.length) {
      return;
    }

    anime({
      targets,
      opacity: [0, 1],
      translateY: [12, 0],
      duration: 520,
      delay: anime.stagger(65, { start: 40 }),
      easing: "easeOutCubic",
    });
  }

  function addHaptics() {
    if (!("vibrate" in navigator)) {
      return;
    }

    document.addEventListener(
      "pointerdown",
      (event) => {
        if (event.pointerType === "touch" && event.target.closest("button, a[href], [role='button']")) {
          navigator.vibrate(8);
        }
      },
      { passive: true },
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", animateEntrance, { once: true });
  } else {
    animateEntrance();
  }
  addHaptics();
})();
