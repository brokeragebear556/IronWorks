# Ironworks

A self-hosted app for your gun collection: a 3D bench for every gun, its lower, upper, parts and
attachments, plus purchase and range logs, price tracking, metadata lookups and a dashboard.
It runs on your computer at **http://127.0.0.1:8080**. Like Jellyfin, you can let other devices on your
network open it too (with a password): see [Other devices on your network](#other-devices-on-your-network).

## Install

You need **Python 3.10+** and **Node.js 20+**. The setup script checks for both and offers to install
whatever is missing (with winget on Windows, or your package manager on Linux, after asking). Then it
installs the Python packages into `.venv`, runs `npm ci` for the web app and builds it. It's safe to run again.

| | Windows | Linux / macOS |
|---|---|---|
| Install everything | double-click **setup.bat** | `bash setup.sh` (add `--yes` to skip the questions) |
| Start the app | double-click **Start Ironworks.bat** | `bash start-ironworks.sh` |

The start scripts run setup automatically the first time, so you can also go straight to them.
The app opens at http://127.0.0.1:8080. Close the window (Windows) or press Ctrl+C (Linux) to stop it.

A fresh install starts with two **demo guns** (a Daniel Defense DDM4 V7 and a Glock 17) so there's something to
look at. Add your own with **+ Add gun** and remove the demos whenever you like.

### Good to know

- **Your data stays on your computer.** Your guns (`guns/`), database (`data/ironworks.db`) and exports are
  listed in `.gitignore`, so they are never committed or pushed.
- Start it by hand: `.venv\Scripts\python.exe -m server` (Windows) or `.venv/bin/python -m server` (Linux).
- If the folder is copied between Windows and Linux, each system keeps its own Python environment
  (`.venv-windows` / `.venv-linux`) next to the other's `.venv`. Your guns and data work on both.
- On Debian/Ubuntu the distro's Node.js can be older than 20. If setup says so, install a current one from
  https://nodejs.org or with `nvm install --lts`.
- Another port: put `WB_PORT=8090` before the start command (Linux), or run `set WB_PORT=8090` first (Windows).
- File names are case-sensitive on Linux. Keep photo names as the app saved them.

## Other devices on your network

By default Ironworks only answers on the computer it runs on. To open it from a phone, tablet or another
computer on the same network (the way Jellyfin works):

1. On the computer running Ironworks, open **Settings → Network**.
2. Set a password, then tick **Let other devices on my network open Ironworks**.
3. Restart Ironworks (close its window or press Ctrl+C, then start it again). It now prints the address
   to use, for example `http://192.168.1.20:8080`, and Settings → Network shows it too.
4. On the other device, open that address and sign in with the password.

- **This computer** never asks for the password.
- **Signed-in devices** can see and change everything, including serial numbers and NFA records, so only use this
  on a network you trust. Ironworks isn't reachable from the internet unless you forward a port on your router (don't).
- Only someone at this computer can turn network access on or off or change the password. Changing the password
  or turning access off signs every other device out.
- **Firewall:** the first time, Windows may ask whether Python can use the network. Allow **private networks** only.
  On Linux with a firewall, allow the port, for example `sudo ufw allow 8080/tcp`.
- Other websites can't reach it through your browser: writes must come from Ironworks' own pages, and requests
  for unknown host names are refused.

## How it's organised

```
server/            Python API (FastAPI)
  app.py           routes
  library.py       reads and writes the gun folders
  db.py            SQLite: logs, price history, lookups, plans, settings
  providers.py     metadata providers (local files, product page, saved-page upload)
  wikidata.py      the Wikidata provider (model facts, no prices)
  parsing.py       reads specs, prices and photos out of product pages
  prices.py        price tracking and its background schedule
  analytics.py     numbers for the dashboard
web/               React + TypeScript app (Vite)
  src/three/       3D model builders and the viewer
  src/pages/       Library, Workbench (gun page + tabs), Dashboard, Settings
demo/guns/         the two demo guns, copied into guns/ on a fresh install
guns/              one folder per gun: gun.json, parts/, photos/, receipts/ (see guns/README.md)
data/catalog.json  trigger, charging handle, finish and attachment options
data/ironworks.db  your logs, price history, settings (created on first run)
tests/             API tests (pytest)
```

**Gun folders are the source of truth.** Add a gun with the **+ Add gun** button or by copying a
folder in `guns/` and editing its `gun.json`. Anything removed in the app is moved to `guns/_removed/`
rather than deleted.

## Metadata providers

Like Jellyfin's metadata providers, each one fills in details from a different source. Turn them on,
off and reorder them in **Settings → Metadata providers**, then use **Metadata → Look up** on any gun or part
and tick what to apply.

- **Local files** reads saved product pages (`.html`, saved with Ctrl+S in your browser) and PDFs in the
  scan folder (by default the `Collection` folder this app sits in). Works offline.
- **Product page lookup** fetches a store or manufacturer page you link. Some stores block automated
  requests (Palmetto State Armory returns 403). When that happens, save the page from your browser and drop it
  on the gun's Metadata tab (**Add from a saved page**), or put it in the scan folder.
- **Wikidata** looks up free, open facts about well-known gun models: maker, cartridge, length, weight,
  muzzle velocity, capacity, country, year and a photo. It has no prices and covers common models only.
  Wikimedia requires apps to say how to reach whoever runs them, so enter your own email or web address
  under Settings → Metadata providers → Wikidata. It's kept in your local settings and sent only to Wikidata.
  Guns only, not parts; Refresh only fills in specs you haven't set, and only from a close name match.

**Price tracking** re-checks tracked product pages on a schedule (Settings → Price tracking, default every
24 hours while the app is running) and keeps the history for the charts and price alerts.

## Experimental features

Settings → Experimental. **Photo on model** lays a product photo over the 3D model. It is off by default.

## Development

```powershell
# API with tests
.\.venv\Scripts\python.exe -m pytest -q tests

# web app with hot reload (API must be running on :8080)
cd web
npm run dev        # http://localhost:5173
npm run build      # production build served by the Python server
npx oxlint src     # lint
```

On Linux the same commands work with `.venv/bin/python` (or `.venv-linux/bin/python`). If `web/node_modules`
came from Windows, delete it and run `npm install` before building: some build tools are per-system.

Python packages are pinned in `requirements.txt`; JavaScript packages in `web/package-lock.json`.
All pinned Python packages have prebuilt Linux wheels (x86-64 and ARM64) for Python 3.10–3.13.
