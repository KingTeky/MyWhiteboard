````markdown
## Running the dev servers

This project includes a small static client and an optional backend server used during development for session persistence and WebSocket testing.

### Start static client only

```bash
# from the repo root
python3 -m http.server 8080
```

Then open http://localhost:8080 in your browser.

### Start development server (client + API)

This repository includes a lightweight API server under `server/` used for session persistence and WebSocket testing.

```powershell
npm run dev
```

This script starts a static file server on port 8080 and the API server on port 3000 by default. The frontend talks to the API at `http://localhost:3000`.

Environment variables:
- `NEW_SESSION_GRACE_MS` — grace window in ms to avoid deleting brand-new sessions before clients subscribe (default: 5000)
- `DIRECTOR_DISCONNECT_GRACE_MS` — how long to wait before deleting a session after the director disconnects (default: 30000)

````
