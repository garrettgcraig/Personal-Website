// Service worker for Devereux breach alerts: shows push notifications and opens the
// page when one is tapped. Scope: /devereux/.
self.addEventListener("push", (event) => {
  let msg = { title: "Devereux Slough", body: "Breach outlook update", url: "/devereux/" };
  try { msg = { ...msg, ...event.data.json() }; } catch (e) {}
  event.waitUntil(self.registration.showNotification(msg.title, {
    body: msg.body, icon: "/devereux/icon-192.png", badge: "/devereux/icon-192.png",
    tag: "devereux-breach", renotify: true, data: { url: msg.url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/devereux/";
  event.waitUntil((async () => {
    const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) if (w.url.includes("/devereux/")) { await w.focus(); return w.navigate(url); }
    return clients.openWindow(url);
  })());
});
