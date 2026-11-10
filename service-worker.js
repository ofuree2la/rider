self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data?.json() ?? {};
    } catch (error) {
      console.error("A push notification payload could not be parsed.", error);
    }

    const openClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    const hasVisibleDriverPage = openClients.some((client) =>
      client.visibilityState === "visible" &&
      new URL(client.url).pathname.includes("/driver/"),
    );
    if (hasVisibleDriverPage) {
      return;
    }

    await self.registration.showNotification(
      payload.title || "New Rider request",
      {
        body: payload.body || "A matching ride request is available.",
        icon: new URL("./assets/rider-mark.svg", self.location.href).href,
        badge: new URL("./assets/rider-mark.svg", self.location.href).href,
        tag: payload.tag || "rider-new-request",
        renotify: false,
        data: { url: payload.url || "" },
      },
    );
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    let destination = new URL("./driver/trips.html", self.registration.scope);
    try {
      const requestedUrl = new URL(event.notification.data?.url || destination.href);
      if (requestedUrl.origin === self.location.origin) {
        destination = requestedUrl;
      }
    } catch (error) {
      console.error("The push notification destination was invalid.", error);
    }

    const openClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existingClient = openClients.find((client) => new URL(client.url).origin === destination.origin);
    if (existingClient) {
      await existingClient.navigate(destination.href);
      return existingClient.focus();
    }
    return self.clients.openWindow(destination.href);
  })());
});
