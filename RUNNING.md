# MyWhiteboard — Run & Test Instructions (server + client)

This file contains exact macOS (zsh) commands to install prerequisites, run the optional server, serve the client, and test Music Director vs Attendee flows.

---
## Quick summary

- Client: `index.html`, `styles.css`, `app.js`.
- Optional server (demo): `server/index.js` (Express) — provides simple session APIs and a director token.
- Client will fall back to localStorage-only behavior when the server is unavailable.

---
## Prerequisites

- macOS with zsh
- Node.js (v16+ recommended) if you want to run the server.

Install Node (Homebrew):

```bash
# Install Homebrew (if you don't have it)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js (LTS)
brew install node

# Verify
node --version
npm --version
```

If you prefer not to install Node, you can serve the client using Python's static server. The server-backed features will not be available.

---

## Windows (PowerShell) — quick commands

If you're on Windows and using PowerShell / pwsh, here are equivalent commands and tips to run the server and serve the client.

Prerequisite: install Node.js (LTS) if you want to run the optional server.

Recommended: install Node via winget (Windows 10/11):

```powershell
# Install Node.js LTS via winget
winget install OpenJS.NodeJS.LTS

# Verify
node --version
npm --version
```

Start the minimal server (optional):

```powershell
# from the repository root
Set-Location .\server
npm install
npm start
```

- Server listens on http://localhost:3000 by default.

Serve the client (static files) using PowerShell-friendly commands:

Option A — Python 3 (if installed):

```powershell
# from repo root
python -m http.server 8080
# open http://localhost:8080 in your browser
```

Option B — Node static server (no install required beyond npm):

```powershell
npx http-server -p 8080 .
# open http://localhost:8080
```

Notes:
- If using the optional server, the client will attempt to contact it at http://localhost:3000. You can override that by setting `window.SERVER_BASE` in the browser console or by editing `app.js` during development.
- PowerShell may block scripts or services if execution policy is restricted — you can run `Get-ExecutionPolicy` to inspect and `Set-ExecutionPolicy` if you understand the security implications.

---
## Start the minimal server (optional)

From the repository root:

```bash
cd server
npm install
npm start
```

- Server listens on http://localhost:3000.
- Sessions are persisted in `server/sessions.json`.
- If `node` is not installed, you will see `zsh: command not found: node` — install Node as above.

Stop the server with Ctrl+C.

---
## Serve the client (static files)

You must serve `index.html` from a static server for PDF.js and fetch calls to work correctly.

Option A (Python 3):

```bash
# from repo root
python3 -m http.server 8080
# open http://localhost:8080
```

Option B (npx http-server):

```bash
npx http-server -p 8080 .
# open http://localhost:8080
```

---
## Test flow: Music Director vs Attendee

1. Start server (optional) and serve the client.
2. Browser A (Music Director):
   - Open the client URL.
   - Click **Create Session**. The client will call POST /api/sessions and store a director token locally as `session_<CODE>_directorToken`.
   - Upload PDFs and click **Start Session**. The client will attempt to POST charts to `/api/sessions/<CODE>/charts` using the director token. You should see Edit/Organize controls.

3. Browser B (Attendee) — use Incognito or a different browser profile:
   - Open the client URL.
   - Enter the session code and click **Join Session**.
   - You should land in **Live** mode and Edit/Organize controls should be hidden.

4. Live mode behavior:
   - Pages render lazily as you scroll.
   - Thumbnails appear as pages render.

If the server is down, all flows fall back to localStorage-only behavior.

---
## Troubleshooting

- `zsh: command not found: node` — install Node via Homebrew or use Python to serve static files.
- If PDF pages or thumbnails fail, open DevTools Console for PDF.js errors.
- If charts are not visible to attendees, check `server/sessions.json` or verify localStorage entries.

---
## Security notes

- The demo server issues a simple director token stored in localStorage — not secure for production.
- For production: implement user auth, HTTPS, short-lived tokens, and a proper DB.

---
## Next improvements (optional)

1. Harden server authentication (passphrase or OAuth).
2. Improve Live-mode UX (pre-render first N thumbnails, skeleton placeholders, thumbnail caching).
3. Store annotations as normalized vector strokes rather than bitmaps for better scaling.

---

If you'd like, I can add npm scripts to run client+server together or a small `Makefile` to automate the flow.
