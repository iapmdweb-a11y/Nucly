# NUCLY v2 — Installable IHC Nuclear Counter

NUCLY is a local, privacy-preserving immunohistochemistry (IHC) nuclear counter built with OpenCV.js. All images are processed on-device — nothing is uploaded anywhere.

This folder is a **PWA (Progressive Web App)**: one codebase that installs as a native-looking app on **Windows, macOS, Android, and iOS**.

## Folder contents

| File | Purpose |
|------|---------|
| `index.html` | The NUCLY app itself |
| `opencv.js` | OpenCV engine (bundled locally for offline use) |
| `manifest.webmanifest` | PWA manifest (makes it installable) |
| `sw.js` | Service worker (enables offline mode) |
| `icons/` | App icons (192, 512, apple-touch) |

## How to run it

PWAs must be served over HTTP (browsers refuse the manifest on `file://`). Two options:

### Option A — Local server (works fully offline, one command)
```powershell
# from the nucly-app folder
npx --yes serve .
```
or with Python:
```powershell
python -m http.server 8080
```
Then open `http://localhost:8080` in your browser.

### Option B — Host online (so it's available on any device, anywhere)
Upload the `nucly-app` folder to GitHub Pages / Netlify / Vercel and open the URL. The app then installs from the same URL on every device.

## Install on Desktop (Windows / macOS)

**Install button:** while the app is open, click **⬇️ Install App** (top panel) and confirm.

Alternatively, via browser menu:
- **Windows (Edge or Chrome):** click the app icon in the address bar (⊕ Install), or menu → **Apps → Install NUCLY**. You'll get a Start menu / desktop shortcut that opens fullscreen, no browser chrome.
- **macOS (Chrome/Edge):** menu → **Install NUCLY** (adds to Applications / Dock).

## Install on Mobile (Android / iOS)

- **Android (Chrome):** menu (⋮) → **Add to Home screen / Install app**. You get a fullscreen app icon in your launcher. Works offline after first load.
- **iPhone / iPad (Safari):** Share (⬆️) → **Add to Home Screen**. Icon appears on the home screen; opens fullscreen.

## Notes

- Fully **offline** after the first visit (OpenCV runtime is bundled).
- Tip for phone-camera microscopy photos: use **✨ Auto-Enhance** before AI analysis.
- App loads OpenCV in the background; wait for "OpenCV Ready" in the status bar before running AI.