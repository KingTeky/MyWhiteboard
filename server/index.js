const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.resolve(__dirname, 'sessions.json');

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// We'll create an HTTP server so we can attach a WebSocket server to it
const server = http.createServer(app);

// Map of sessionCode -> Set of WebSocket clients
const sessionClients = new Map();

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
      }
    } catch (e) {
      // ignore malformed
    }
  });

  ws.on('close', () => {
    if (ws.session && sessionClients.has(ws.session)) {
      sessionClients.get(ws.session).delete(ws);
      if (sessionClients.get(ws.session).size === 0) sessionClients.delete(ws.session);
    }
  });
});

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
  const session = { code, directorToken, charts: [] };
  store[code] = session;
  persist();
  res.json({ code, directorToken });
});

// Get session metadata (no token in response)
app.get('/api/sessions/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const s = store[code];
  if (!s) return res.status(404).json({ error: 'not_found' });
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
  res.json({ charts: s.charts || [] });
});

server.listen(PORT, () => {
  console.log(`MyWhiteboard server listening on http://localhost:${PORT}`);
});
