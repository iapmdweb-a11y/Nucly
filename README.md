# NUCLY — installable PWA (no Netlify credits needed)

Full mirror of `https://gorgeous-pika-031dbb.netlify.app/` plus the **three PWA
files the live site was missing** (its HTML referenced them but they returned 404,
so nothing was installable):

| File | Purpose |
|---|---|
| `manifest.webmanifest` | Makes browsers offer "Install app" |
| `pwa.js` | Install button, iOS/Android guidance, Save-for-offline, offline indicator |
| `sw.js` | Offline cache (includes the 11 MB OpenCV engine) |

All other files were copied unchanged from the live site.

## Option 1 — Install on your own devices now (zero credits, works offline)

Your machine has no Node/Python/git, so this folder ships a tiny PowerShell
server that needs nothing installed.

**Desktop (this PC):**
1. Double-click **`NUCLY.bat`** (admin is not required).
2. A browser tab opens at `http://localhost:8800`.
3. Click **Install app** in the header → NUCLY installs as a fullscreen Windows app.

**Mobile (same Wi-Fi):**
1. Right-click `NUCLY.bat` → **Run as administrator** (admin is needed to serve on
   the network), then note the `http://<your-ip>:8800` address it prints.
2. On the phone/tablet browser open that address:
   - Android: **Install app** or menu → Add to Home screen.
   - iPhone/iPad: Safari → Share → **Add to Home Screen**.
3. Connection comes from your Wi-Fi only; after the first load, NUCLY works
   **offline** (the service worker caches everything, OpenCV included).

To keep LAN access permanent without entering admin each time:
```powershell
netsh http add urlacl url=http://+:8800/ user=Everyone          # once, as admin
netsh advfirewall firewall add rule name="NUCLY" dir=in action=allow protocol=TCP localport=8800
```

## Option 2 — Publish publicly for free (HTTPS, installable anywhere)

Static hosts give you HTTPS for free so any device can install the PWA from the
URL. No Netlify credits are involved.

### GitHub Pages (browser-only, ~2 min)
1. Go to https://github.com/new → create a repo, e.g. `nucly`.
2. Open the repo → **Add file → Upload files** → drag in the contents of this folder
   (all of it, top level). Commit.
3. Repo → **Settings → Pages** → Source: **Deploy from a branch** → `main` / root → Save.
4. Wait a minute. Your URL: `https://<username>.github.io/nucly/` — open it, click **Install app**.

### Cloudflare Pages (browser-only)
1. Go to https://dash.cloudflare.com → **Workers & Pages → Create → Pages → Upload assets**.
2. Drag this folder in, deploy, get `https://<project>.pages.dev` HTTPS URL.

### Vercel (no CLI needed)
1. Go to https://vercel.com/new → **Deploy without Git** → drag the folder → deploy.

### Surge (one command, needs Node or a browser download)
```powershell
npm i -g surge
surge C:\Users\rifae\OneDrive\Documents\Default Project\nucly-live
```

After publishing, the green **Install app** button appears in the header:
- Windows/macOS (Edge/Chrome): click **Install app**.
- Android (Chrome): Install app / Add to Home screen.
- iPhone/iPad (Safari): Share → **Add to Home Screen** (the button hides itself on iOS automatically).

## Local checks before publishing
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-nucly.ps1
```
Then at `http://localhost:8800` verify: **Install app** appears, **Save for offline**
shows a progress bar, and after saving, the site works with Wi-Fi off.