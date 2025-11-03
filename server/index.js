const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.resolve(__dirname, 'sessions.json');

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

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
  res.json({ ok: true });
});

// Get charts
app.get('/api/sessions/:code/charts', (req, res) => {
  const code = req.params.code.toUpperCase();
  const s = store[code];
  if (!s) return res.status(404).json({ error: 'not_found' });
  res.json({ charts: s.charts || [] });
});

app.listen(PORT, () => {
  console.log(`MyWhiteboard server listening on http://localhost:${PORT}`);
});
