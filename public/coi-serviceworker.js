/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */
let coepCredentialless = false;
if (typeof window === 'undefined') {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

  self.addEventListener("message", (ev) => {
    if (!ev.data) {
      return;
    } else if (ev.data.type === "deregister") {
      self.registration
        .unregister()
        .then(() => {
          return self.clients.matchAll();
        })
        .then((clients) => {
          clients.forEach((client) => client.navigate(client.url));
        });
    } else if (ev.data.type === "coepCredentialless") {
      coepCredentialless = ev.data.value;
    }
  });

  self.addEventListener("fetch", function (e) {
    const r = e.request;
    if (r.cache === "only-if-cached" && r.mode !== "same-origin") {
      return;
    }

    const request =
      coepCredentialless && r.mode === "no-cors"
        ? new Request(r, {
            credentials: "omit",
          })
        : r;

    e.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 0) {
            return response;
          }

          const newHeaders = new Headers(response.headers);
          newHeaders.set(
            "Cross-Origin-Embedder-Policy",
            coepCredentialless ? "credentialless" : "require-corp"
          );
          newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
          });
        })
        .catch((err) => console.error(err))
    );
  });
} else {
  (() => {
    const reloadedBySelf = window.sessionStorage.getItem("coiReloadedBySelf");
    window.sessionStorage.removeItem("coiReloadedBySelf");
    const coepDegrading = reloadedBySelf === "coepdegrade";

    // You can customize the behavior of this script through a global `coi` variable.
    const coi = {
      shouldRegister: () => !reloadedBySelf,
      shouldDeregister: () => false,
      coepCredentialless: () => true,
      coepDegrade: () => true,
      doReload: () => window.location.reload(),
      quiet: false,
      ...window.coi,
    };

    const n = navigator;

    if (coi.shouldDeregister()) {
      n.serviceWorker &&
        n.serviceWorker.controller &&
        n.serviceWorker.controller.postMessage({ type: "deregister" });
    }

    // If we're already coi: do nothing. Perhaps it was manually configured earlier.
    if (window.crossOriginIsolated !== false) {
      !coi.quiet &&
        console.log(
          "👍 crossOriginIsolated is already enabled. No changes were needed."
        );
      return;
    }

    if (!coi.shouldRegister()) {
      !coi.quiet && console.log("Registration is disabled.");
      return;
    }

    if (!n.serviceWorker) {
      !coi.quiet &&
        console.error("COOP/COEP Service Worker not registered: Service Worker is not available.");
      return;
    }

    n.serviceWorker.register(window.document.currentScript.src).then(
      (registration) => {
        !coi.quiet &&
          console.log("COOP/COEP Service Worker registered", registration.scope);

        registration.addEventListener("updatefound", () => {
          !coi.quiet &&
            console.log(
              "Reloading to enable crossOriginIsolation via COOP/COEP headers..."
            );
          // Reload once there's a new service worker controlling the page
          registration.installing.addEventListener("statechange", function () {
            if (this.state === "activated") {
              coi.doReload();
            }
          });
        });

        // If the registration is active, but it's not controlling the page
        if (registration.active && !n.serviceWorker.controller) {
          !coi.quiet &&
            console.log(
              "Reloading to enable crossOriginIsolation via COOP/COEP headers..."
            );
          coi.doReload();
        }
      },
      (err) => {
        !coi.quiet &&
          console.error("COOP/COEP Service Worker failed to register:", err);
      }
    );
  })();
}
