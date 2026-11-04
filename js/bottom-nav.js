// Adds the floating bottom tab bar to the rider pages.
// Add <link rel="stylesheet" href="css/bottom-nav.css"> and
// <script src="js/bottom-nav.js" defer></script> to any rider page.
(function () {
  const ICONS = {
    home: '<path d="M4 11.2 12 4l8 7.2V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z"/>',
    activity:
      '<path d="M7 3.5h10a1 1 0 0 1 1 1V21l-2.2-1.6L14 21l-2-1.6L10 21l-1.8-1.6L6 21V4.5a1 1 0 0 1 1-1z"/><path d="M9.5 8.5h5M9.5 12h5"/>',
    account:
      '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3.2"/><path d="M5.8 18.2c1.4-2.1 3.6-3.2 6.2-3.2s4.8 1.1 6.2 3.2"/>',
  };

  const TABS = [
    { label: "Home", href: "book.html", icon: "home", pages: ["book.html", "index.html", ""] },
    { label: "Activity", href: "history.html", icon: "activity", pages: ["history.html", "tracking.html"] },
    { label: "Account", href: "profile.html", icon: "account", pages: ["profile.html"] },
  ];

  function currentPage() {
    return window.location.pathname.split("/").pop().toLowerCase();
  }

  function buildNav() {
    if (document.querySelector(".bottom-nav")) {
      return;
    }

    const page = currentPage();
    const nav = document.createElement("nav");
    nav.className = "bottom-nav";
    nav.setAttribute("aria-label", "Main");

    TABS.forEach((tab) => {
      const link = document.createElement("a");
      link.href = tab.href;
      if (tab.pages.includes(page)) {
        link.setAttribute("aria-current", "page");
      }
      link.innerHTML =
        `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[tab.icon]}</svg><span>${tab.label}</span>`;
      nav.append(link);
    });

    document.body.classList.add("has-bottom-nav");
    document.body.append(nav);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildNav);
  } else {
    buildNav();
  }
})();
