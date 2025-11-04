const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.resolve(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'sessions.json');

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// We'll create an HTTP server so we can attach a WebSocket server to it
const server = http.createServer(app);

// Ensure data directory exists and migrate old sessions.json if present
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const OLD_FILE = path.resolve(__dirname, 'sessions.json');
  if (fs.existsSync(OLD_FILE) && !fs.existsSync(DATA_FILE)) {
    try {
      fs.renameSync(OLD_FILE, DATA_FILE);
      console.log('migrated sessions.json to server/data/sessions.json');
    } catch (e) {
      console.warn('failed to migrate sessions.json to data folder', e);
    }
  }
} catch (e) { console.warn('data dir check failed', e); }

// Map of sessionCode -> Set of WebSocket clients
const sessionClients = new Map();
// Map of sessionCode -> cleanup timer id (Node timeout)
const cleanupTimers = new Map();

// Setup WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  // expect a subscribe message from client: { type: 'subscribe', session: '<CODE>' }
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (msg) => {
    try {
      const j = JSON.parse(msg.toString());
      if (j && j.type === 'subscribe' && j.session) {
        const code = (j.session || '').toString().toUpperCase();
        ws.session = code;
        if (!sessionClients.has(code)) sessionClients.set(code, new Set());
        sessionClients.get(code).add(ws);
        // mark activity when a client subscribes and (re)schedule inactivity cleanup
        try { if (store[code]) { store[code].lastActivity = Date.now(); persist(); scheduleInactivityCleanup(code); } } catch (e) {}
      }
    } catch (e) {
      // ignore malformed
    }
  });

  ws.on('close', () => {
    if (ws.session && sessionClients.has(ws.session)) {
      const code = ws.session;
      sessionClients.get(code).delete(ws);
      if (sessionClients.get(code).size === 0) {
        sessionClients.delete(code);
        // No connected clients -> delete session immediately (per updated policy)
        try { deleteSession(code); } catch (e) {}
      }
    }
  });
});

// Helper: remove session data and persist
function deleteSession(code) {
  try {
    delete store[code];
    persist();
  } catch (e) {
    console.error('Failed to delete session', code, e);
  }
  try { if (cleanupTimers.has(code)) { clearTimeout(cleanupTimers.get(code)); cleanupTimers.delete(code); } } catch (e) {}
}

// Schedule inactivity cleanup for a session: delete immediately if no clients;
// if clients are present and charts exist, schedule deletion after 75 minutes of inactivity.
function scheduleInactivityCleanup(code) {
  try {
    if (!store[code]) return;
    const DELAY_MS = 75 * 60 * 1000; // 75 minutes

    const clients = sessionClients.get(code) || new Set();
    // If no connected clients, remove immediately per new policy
    if (clients.size === 0) {
      deleteSession(code);
      return;
    }

    // If there are connected clients but no charts, delete immediately
    const hasCharts = Array.isArray(store[code].charts) && store[code].charts.length > 0;
    if (!hasCharts) {
      deleteSession(code);
      return;
    }

    // Otherwise, schedule inactivity timeout. Reset any existing timer.
    if (cleanupTimers.has(code)) { clearTimeout(cleanupTimers.get(code)); cleanupTimers.delete(code); }
    const tid = setTimeout(() => {
      const clientsNow = sessionClients.get(code) || new Set();
      // If clients are still connected, check lastActivity timestamp
      if (clientsNow.size > 0) {
        const last = (store[code] && store[code].lastActivity) ? store[code].lastActivity : 0;
        if (Date.now() - last >= DELAY_MS - 1000) {
          deleteSession(code);
        }
      } else {
        // no clients at timer fire -> delete immediately
        deleteSession(code);
      }
      if (cleanupTimers.has(code)) cleanupTimers.delete(code);
    }, DELAY_MS);
    cleanupTimers.set(code, tid);
  } catch (e) { console.error('scheduleInactivityCleanup failed for', code, e); }
}

// Simple ping/pong to clean dead clients
setInterval(() => {
  wss.clients.forEach((c) => {
    if (!c.isAlive) return c.terminate();
    c.isAlive = false;
    c.ping(() => {});
  });
}, 30000);

// Simple file-backed store
let store = {};
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    store = raw ? JSON.parse(raw) : {};
  }
} catch (e) {
  console.error('Failed to read sessions.json:', e);
  store = {};
}

// On startup, remove any sessions with no connected clients immediately; for
// sessions that have connected clients, schedule inactivity cleanup as needed.
try {
  Object.keys(store).forEach(code => {
    const s = store[code];
    const clients = sessionClients.get(code) || new Set();
    if (clients.size === 0) {
      // no connected clients -> delete immediately per policy
      deleteSession(code);
    } else {
      // clients present on startup (rare) -> schedule inactivity cleanup
      try { scheduleInactivityCleanup(code); } catch (e) { /* ignore */ }
    }
  });
} catch (e) { console.error('startup cleanup scheduling failed', e); }

function persist() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to write sessions.json:', e);
  }
}

function broadcastSessionUpdate(code) {
  try {
    const clients = sessionClients.get(code) || new Set();
    const payload = JSON.stringify({ type: 'charts:update', charts: (store[code] && store[code].charts) || [] });
    clients.forEach(ws => {
      try { ws.send(payload); } catch (e) {}
    });
  } catch (e) { /* noop */ }
}

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function generateToken() {
  return Math.random().toString(36).substring(2, 12);
}

// Create a session
app.post('/api/sessions', (req, res) => {
  const code = generateCode();
  const directorToken = generateToken();
  const session = { code, directorToken, charts: [], lastActivity: Date.now() };
  store[code] = session;
  persist();
  res.json({ code, directorToken });
});

// Get session metadata (no token in response)
app.get('/api/sessions/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const s = store[code];
  if (!s) return res.status(404).json({ error: 'not_found' });
  // mark read as activity and (re)schedule inactivity cleanup
  try { s.lastActivity = Date.now(); persist(); scheduleInactivityCleanup(code); } catch (e) {}
  // return charts and a flag whether it has charts
  res.json({ code: s.code, charts: s.charts || [], hasCharts: (s.charts && s.charts.length > 0) });
});

// Save charts (director only)
app.post('/api/sessions/:code/charts', (req, res) => {
  const code = req.params.code.toUpperCase();
  const token = req.header('x-director-token');
  const s = store[code];
  if (!s) return res.status(404).json({ error: 'not_found' });
  if (!token || token !== s.directorToken) return res.status(403).json({ error: 'forbidden' });

  const charts = Array.isArray(req.body.charts) ? req.body.charts : [];
  s.charts = charts;
  // update last activity and (re)schedule inactivity cleanup
  try { s.lastActivity = Date.now(); scheduleInactivityCleanup(code); } catch (e) {}
  store[code] = s;
  persist();
  // broadcast to any connected viewers of this session
  try { broadcastSessionUpdate(code); } catch (e) {}
  res.json({ ok: true });
});

// Get charts
app.get('/api/sessions/:code/charts', (req, res) => {
  const code = req.params.code.toUpperCase();
  const s = store[code];
  if (!s) return res.status(404).json({ error: 'not_found' });
  // treat chart fetch as activity
  try { s.lastActivity = Date.now(); persist(); scheduleInactivityCleanup(code); } catch (e) {}
  res.json({ charts: s.charts || [] });
});

server.listen(PORT, () => {
  console.log(`MyWhiteboard server listening on http://localhost:${PORT}`);
});
