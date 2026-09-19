/* NUCLY pwa.js — install & offline layer
   Wires the install / offline UI already present in the HTML:
   #installBtn, #offlineBtn, #netChip, #offlineProgress, #installState,
   #iosSteps, #genericSteps.
*/
(function () {
  "use strict";

  var register = (typeof window === "undefined") ? false : ("serviceWorker" in navigator);
  var swPath = "sw.js";
  var standalone = window.matchMedia("(display-mode: standalone)").matches ||
                   navigator.standalone === true;
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
  var deferredPrompt = null;

  function $(id) { return document.getElementById(id); }

  function hide(el) { if (el) el.hidden = true; }
  function show(el) { if (el) el.hidden = false; }
  function fmt(bytes) {
    if (!bytes && bytes !== 0) return "?";
    if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + " MB";
    if (bytes > 1024) return (bytes / 1024).toFixed(0) + " KB";
    return bytes + " B";
  }

  function onlineState() {
    var chip = $("netChip");
    var btn = $("offlineBtn");
    if (navigator.onLine) {
      if (chip) chip.hidden = true;
      if (btn) btn.hidden = false;
    } else {
      if (chip) { chip.textContent = "Offline"; chip.hidden = false; }
      if (btn) btn.hidden = true;
    }
  }

  /* ---- install prompt ---- */
  function setupInstall() {
    var btn = $("installBtn");
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredPrompt = e;
      if (btn) show(btn);
    });
    window.addEventListener("appinstalled", function () {
      deferredPrompt = null;
      if (btn) hide(btn);
    });
    if (btn) {
      btn.addEventListener("click", function () {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function () {
          deferredPrompt = null;
          hide(btn);
        });
      });
    }

    /* Confine the "Install app" prompt to platforms that can do it. */
    if (btn && (isIOS || standalone)) {
      hide(btn);
    }
  }

  /* ---- install guidance (Install & offline panel) ---- */
  function setupGuidance() {
    var state = $("installState");
    var ios = $("iosSteps");
    var generic = $("genericSteps");

    if (!state) return;
    if (isIOS) {
      if (ios) show(ios);
      if (generic) hide(generic);
      state.innerHTML = standalone
        ? "NUCLY is installed on this device."
        : "On iPhone / iPad: open in <b>Safari</b> and use <b>Add to Home Screen</b> to make a fullscreen app icon.";
    } else if (standalone) {
      if (generic) show(generic);
      if (ios) hide(ios);
      state.innerHTML = "NUCLY is installed as an app on this device.";
    } else if (register) {
      if (generic) show(generic);
      if (ios) hide(ios);
      state.innerHTML = deferredPrompt
        ? "This device supports instant install — use the <b>Install app</b> button above."
        : "This device can install NUCLY — look for <b>Install app</b> in the address bar or browser menu.";
    } else {
      if (generic) show(generic);
      state.innerHTML = "This browser cannot install apps, but NUCLY still works offline when saved.";
    }
  }

  /* ---- save-for-offline ---- */
  function setupOffline() {
    var btn = $("offlineBtn");
    if (!btn) return;
    var label = $("offlineBtnLabel");

    btn.addEventListener("click", function () {
      if (!label) return;
      var original = label.textContent;
      label.textContent = "Saving…";
      btn.disabled = true;

      caches.keys().then(function (names) {
        var shell = "nucly-shell-" + "nucly-v2.0";
        var cache = null;
        var promise = caches.open(shell).then(function (c) {
          cache = c;
          return c.keys();
        }).then(function (existing) {
          var have = {};
          existing.forEach(function (r) { have[r.url] = true; });
          return have;
        });

        return promise.then(function (have) {
          var items = ["/", "/index.html", "/app.js", "/styles.css",
                       "/manifest.webmanifest", "/icons/icon-192.png",
                       "/icons/icon-512.png", "/vendor/opencv.js"];
          var progress = $("offlineProgress");
          var bar = $("offlineBar");
          var text = $("offlineProgressText");
          var done = 0;
          show(progress);

          return items.reduce(function (chain, url) {
            return chain.then(function () {
              var absolute = new URL(url, location.href).href;
              if (have[absolute]) {
                done += 1;
                if (bar) bar.style.width = (done / items.length * 100) + "%";
                if (text) text.textContent = "Preparing offline copy — cached " + done + " of " + items.length;
                return;
              }
              return fetch(absolute, { cache: "reload" }).then(function (resp) {
                return cache.put(absolute, resp);
              }).then(function () {
                done += 1;
                if (bar) bar.style.width = (done / items.length * 100) + "%";
                if (text) text.textContent = "Preparing offline copy — cached " + done + " of " + items.length;
              });
            });
          }, Promise.resolve());
        }).then(function () {
          if (text) text.textContent = "Offline copy ready";
          setTimeout(function () { hide(progress); }, 1200);
          if (typeof toast === "function") {
            toast("NUCLY is saved for offline use", { timeout: 3000 });
          }
        }).catch(function (err) {
          console.error("Offline save failed", err);
          if (text) text.textContent = "Offline save failed — try again";
          setTimeout(function () { hide(progress); }, 2500);
          if (typeof toast === "function") {
            toast("Offline save failed", { timeout: 3000 });
          }
        }).then(function () {
          label.textContent = original;
          btn.disabled = false;
        });
      });
    });
  }

  /* ---- service worker ---- */
  function setupWorker() {
    if (!register) return;
    window.addEventListener("load", function () {
      navigator.serviceWorker.register(swPath)
        .then(function (reg) {
          if (reg.waiting && navigator.serviceWorker.controller) {
            reg.waiting.postMessage({ type: "SKIP_WAITING" });
          }
        })
        .catch(function (err) {
          console.warn("Service worker registration failed", err);
        });
      /* Re-apply installation guidance once the worker owns the page. */
      navigator.serviceWorker.ready.then(setupGuidance);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    setupInstall();
    setupGuidance();
    setupOffline();
    setupWorker();
    onlineState();
    window.addEventListener("online", onlineState);
    window.addEventListener("offline", onlineState);
  });
})();