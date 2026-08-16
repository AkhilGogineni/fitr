/*
 * The service worker, doing one job.
 *
 * A push notification can only be delivered to a service worker — there is no
 * other API for it — so this file exists because the price watch needs to reach
 * a phone, not because the app wants offline support. It deliberately does not
 * cache anything: an offline wardrobe would need a cache-invalidation strategy,
 * and a stale cutout served from last month's deploy is a worse bug than not
 * working on the Underground.
 *
 * Hand-written and served from `public/` rather than generated. A build step
 * that produces a service worker is a build step that can produce a *stale*
 * service worker, and this one is thirty lines that will not change.
 */

self.addEventListener("install", () => {
  // Take over immediately rather than waiting for every tab to close. There is
  // no cached state for a new version to be inconsistent with.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  // A push with no payload is still worth showing: iOS in particular will
  // silently unsubscribe a worker that receives a push and shows nothing.
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "fitr";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "Something you're watching changed.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Tagging by match id means a second drop on the same product replaces
      // the first notification instead of stacking another one up.
      tag: payload.tag || "fitr",
      data: { url: payload.url || "/watch" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/watch";

  // Focus an open tab if there is one rather than opening a third copy of the
  // app, which is what happens by default and is always wrong.
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.includes(target) && "focus" in client) return client.focus();
        }
        return self.clients.openWindow(target);
      }),
  );
});
