/* Install availability belongs to the browser; only dismissal is persisted here. */
(() => {
  "use strict";
  const banner = document.getElementById("install-banner");
  const install = document.getElementById("install-app");
  const dismiss = document.getElementById("dismiss-install");
  const key = "nectarspend-install-dismissed";
  const cooldown = 7 * 24 * 60 * 60 * 1000;
  const display = window.matchMedia("(display-mode: standalone)");
  let pending = null;
  let dismissed = false;
  const standalone = () => display.matches || navigator.standalone === true;
  const hide = () => { banner.hidden = true; };
  const remember = () => {
    dismissed = true;
    try { localStorage.setItem(key, String(Date.now())); } catch { /* Private browsing. */ }
  };
  const suppressed = () => {
    if (dismissed) return true;
    try {
      const saved = Number(localStorage.getItem(key));
      return saved > 0 && Date.now() - saved < cooldown;
    } catch { return false; }
  };
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    if (standalone() || suppressed()) return;
    pending = event;
    banner.hidden = false;
  });
  dismiss.addEventListener("click", () => { remember(); pending = null; hide(); });
  install.addEventListener("click", async () => {
    if (!pending || standalone()) { hide(); return; }
    const prompt = pending;
    pending = null;
    hide();
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome !== "accepted") remember();
    } catch { remember(); }
  });
  window.addEventListener("appinstalled", () => { pending = null; hide(); });
  display.addEventListener("change", () => { if (standalone()) { pending = null; hide(); } });
  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => { /* The online app remains usable if registration is unavailable. */ });
    });
  }
})();
