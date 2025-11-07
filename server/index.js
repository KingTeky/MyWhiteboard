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

const CHAT_DEBUG_LOG = path.join(DATA_DIR, 'chat_debug.log');

function appendChatDebug(line) {
  try {
    const ts = new Date().toISOString();
    fs.appendFileSync(CHAT_DEBUG_LOG, `[${ts}] ${line}\n`, 'utf8');
  } catch (e) {
    try { console.warn('failed to write chat debug log', e); } catch (e) {}
  }
}

// Pages payload validation limits (can be overridden via env vars)
const PAGES_MAX_COUNT = parseInt(process.env.PAGES_MAX_COUNT || '1000', 10); // max number of page objects
const PAGES_MAX_TOTAL_BYTES = parseInt(process.env.PAGES_MAX_TOTAL_BYTES || '4000000', 10); // ~4 MB total JSON size
const PAGES_MAX_PER_PAGE_BYTES = parseInt(process.env.PAGES_MAX_PER_PAGE_BYTES || '500000', 10); // ~500 KB per page

/**
 * Validate a pages payload object.
 * Returns { ok: true } when valid, otherwise { ok: false, message, status }
 */
function validatePagesPayload(pages) {
  if (!pages || typeof pages !== 'object' || Array.isArray(pages)) {
    return { ok: false, message: 'invalid pages payload (expected object)', status: 400 };
  }
  const pageKeys = Object.keys(pages);
  if (pageKeys.length > PAGES_MAX_COUNT) {
    return { ok: false, message: `pages count ${pageKeys.length} exceeds limit ${PAGES_MAX_COUNT}` };
  }

  // Check total serialized size
  let totalJson;
  try {
    totalJson = JSON.stringify(pages);
  } catch (e) {
    return { ok: false, message: 'unable to stringify pages payload', status: 400 };
  }
  const totalBytes = Buffer.byteLength(totalJson, 'utf8');
  if (totalBytes > PAGES_MAX_TOTAL_BYTES) {
    return { ok: false, message: `pages payload too large (${totalBytes} bytes) > ${PAGES_MAX_TOTAL_BYTES}` };
  }

  // Per-page size check (stringify each page object)
  for (const k of pageKeys) {
    try {
      const pj = JSON.stringify(pages[k]);
      const pb = Buffer.byteLength(pj, 'utf8');
      if (pb > PAGES_MAX_PER_PAGE_BYTES) {
        return { ok: false, message: `page ${k} payload too large (${pb} bytes) > ${PAGES_MAX_PER_PAGE_BYTES}` };
      }
    } catch (e) {
      return { ok: false, message: `invalid page object for key ${k}`, status: 400 };
    }
  }

  return { ok: true };
}

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
// Map of sessionCode -> director disconnect grace timer id
const directorDisconnectTimers = new Map();

// Setup WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  // expect a subscribe message from client: { type: 'subscribe', session: '<CODE>' }
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (msg) => {
    try {
      const j = JSON.parse(msg.toString());
      // Treat any message that references a session as activity so mode switches
      // or other lightweight messages don't look like a director disconnect.
      try {
        if (j && j.session) {
          const code = (j.session || '').toString().toUpperCase();
          if (store[code]) {
            store[code].lastActivity = Date.now();
            persist();
            try { scheduleInactivityCleanup(code); } catch (e) {}
            // Helpful debug log when clients explicitly signal mode changes
            try {
              if (j.type === 'mode:change') {
                console.log(`WS mode change: session=${code} mode=${j.mode || 'unknown'}`);
                try { appendChatDebug(`mode_change session=${code} mode=${j.mode||'unknown'}`); } catch (e) {}
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
      if (j && j.type === 'subscribe' && j.session) {
        const code = (j.session || '').toString().toUpperCase();
        ws.session = code;
              if (!sessionClients.has(code)) sessionClients.set(code, new Set());
              const clientsSet = sessionClients.get(code);
              const alreadySubscribed = clientsSet.has(ws);
              if (!alreadySubscribed) {
                clientsSet.add(ws);
                try { console.log(`WS subscribe: client added to session ${code} (clients=${clientsSet.size})`); } catch (e) {}
              } else {
                try { console.log(`WS subscribe: client already subscribed to session ${code} (clients=${clientsSet.size})`); } catch (e) {}
              }
              try { appendChatDebug(`subscribe session=${code} clients=${sessionClients.get(code).size} pid=${process.pid}`); } catch (e) {}
              // mark activity when a client subscribes and (re)schedule inactivity cleanup
              try { if (store[code]) { store[code].lastActivity = Date.now(); persist(); scheduleInactivityCleanup(code); } } catch (e) {}

              // mark that at least one websocket client has connected for this session
              try { if (store[code]) { store[code].seenClients = true; persist(); } } catch (e) {}

              // If the subscribe message included a directorToken and it matches the
              // session's director token, mark this websocket as the director so we
              // can react to director disconnects.
              try {
                if (j && j.token && store[code] && store[code].directorToken && j.token === store[code].directorToken) {
                  const wasDirector = !!ws.isDirector;
                  ws.isDirector = true;
                  if (!wasDirector) {
                    try { console.log(`WS subscribe: director connected for session ${code}`); } catch (e) {}
                  } else {
                    try { console.log(`WS subscribe: director already connected for session ${code}`); } catch (e) {}
                  }
                  try { appendChatDebug(`director_connect session=${code} pid=${process.pid}`); } catch (e) {}
                  // If a director disconnect timer was scheduled, cancel it - director returned
                  try {
                    if (directorDisconnectTimers.has(code)) {
                      clearTimeout(directorDisconnectTimers.get(code));
                      directorDisconnectTimers.delete(code);
                      try { console.log(`Cleared director disconnect timer for session ${code}`); } catch (e) {}
                    }
                  } catch (e) {}
                }
              } catch (e) {}
      }
      // Allow clients to push single-page updates which will be broadcast to session members
      if (j && j.type === 'page:update' && j.session && j.pageId && j.page && typeof j.page === 'object') {
        const code = (j.session || '').toString().toUpperCase();
        if (!store[code]) {
          // ignore updates for unknown sessions
          return;
        }
        // per-page size validation
        try {
          const pj = JSON.stringify(j.page);
          const pb = Buffer.byteLength(pj, 'utf8');
          if (pb > PAGES_MAX_PER_PAGE_BYTES) {
            try { ws.send(JSON.stringify({ type: 'error', message: `page ${j.pageId} payload too large` })); } catch (e) {}
            return;
          }
        } catch (e) {
          return; // invalid page object
        }

        // ensure pages map exists
        store[code].pages = store[code].pages || {};
        // merge/update page entry; keep provided fields
        store[code].pages[j.pageId] = Object.assign({}, store[code].pages[j.pageId] || {}, j.page);
        try { store[code].lastActivity = Date.now(); persist(); scheduleInactivityCleanup(code); } catch (e) {}

        // broadcast single-page update to clients
        const payload = JSON.stringify({ type: 'page:update', pageId: j.pageId, page: store[code].pages[j.pageId] });
        const clients = sessionClients.get(code) || new Set();
        clients.forEach(c => { try { c.send(payload); } catch (e) {} });
        return;
      }

        // Allow chat messages from clients: { type: 'chat:message', session, from, role, text }
        if (j && j.type === 'chat:message' && j.session && typeof j.text === 'string') {
          const code = (j.session || '').toString().toUpperCase();
          if (!store[code]) {
            // unknown session - ignore
            return;
          }

    try { console.log(`Received chat: session=${code} from=${j.from || 'anonymous'} role=${j.role || ''} text=${(j.text||'').slice(0,80)}`); } catch (e) {}
    try { appendChatDebug(`recv session=${code} from=${j.from||'anon'} role=${j.role||''} text=${(j.text||'').replace(/\n/g,' ').slice(0,200)}`); } catch (e) {}

          // basic validation and sanitization
          const text = String(j.text).substring(0, 2000); // cap length
          const from = j.from ? String(j.from).substring(0, 128) : 'anonymous';
          const role = j.role ? String(j.role).substring(0, 48) : '';

          const msgObj = { id: `${Date.now()}_${Math.random().toString(36).substr(2,6)}`, from, role, text, at: Date.now() };
          // preserve a temporary client-side id when provided so clients can reconcile
          if (j.clientTempId) {
            try { msgObj.clientTempId = String(j.clientTempId).substring(0, 128); } catch (e) {}
          }

          // append to in-memory session chat history (keep last 200)
          store[code].chat = Array.isArray(store[code].chat) ? store[code].chat : [];
          store[code].chat.push(msgObj);
          if (store[code].chat.length > 200) store[code].chat = store[code].chat.slice(-200);

          try { store[code].lastActivity = Date.now(); persist(); scheduleInactivityCleanup(code); } catch (e) {}

          // broadcast chat message to session clients
          const cpayload = JSON.stringify({ type: 'chat:message', message: msgObj });
          const cclients = sessionClients.get(code) || new Set();
    try { console.log(`Broadcasting chat message to ${cclients.size} clients in session ${code}`); } catch (e) {}
    try { appendChatDebug(`broadcast session=${code} targets=${cclients.size} msgid=${msgObj.id}`); } catch (e) {}
    cclients.forEach(c => { try { c.send(cpayload); } catch (e) { console.warn('failed to send chat to client', e); appendChatDebug(`send_err session=${code} err=${e.message||e}`); } });
          return;
        }
    } catch (e) {
      // ignore malformed
    }
  });

  ws.on('close', () => {
    if (ws.session && sessionClients.has(ws.session)) {
      const code = ws.session;
      const clients = sessionClients.get(code);
      clients.delete(ws);

      // If this websocket was the director, remove the session immediately
      // and disconnect remaining clients.
      if (ws.isDirector) {
        try { appendChatDebug(`director_disconnect session=${code}`); } catch (e) {}
        // Instead of deleting immediately, schedule a short grace period so
        // transient network disconnects don't cause an immediate session removal.
        try {
          const GRACE_MS = parseInt(process.env.DIRECTOR_DISCONNECT_GRACE_MS || '30000', 10);
          // Only schedule a director-disconnect cleanup if no other clients remain.
          // If other clients are still connected, do not delete the session.
          const remaining = sessionClients.get(code) || new Set();
          if (remaining.size === 0) {
            if (directorDisconnectTimers.has(code)) {
              clearTimeout(directorDisconnectTimers.get(code));
              directorDisconnectTimers.delete(code);
            }
            const tid = setTimeout(() => {
              try {
                // Close any remaining clients (should be none) and delete session after grace
                const rem = sessionClients.get(code) || new Set();
                rem.forEach(c => { try { c.close(); } catch (e) {} });
                try { sessionClients.delete(code); } catch (e) {}
                try { deleteSession(code); } catch (e) {}
                try { appendChatDebug(`director_disconnect_cleanup session=${code}`); } catch (e) {}
              } catch (e) {}
              if (directorDisconnectTimers.has(code)) directorDisconnectTimers.delete(code);
            }, GRACE_MS);
            directorDisconnectTimers.set(code, tid);
            try { console.log(`WS director disconnected for session ${code}, scheduled deletion in ${GRACE_MS}ms`); } catch (e) {}
          } else {
            // Other clients remain; keep the session active and clear any director timer
            try { if (directorDisconnectTimers.has(code)) { clearTimeout(directorDisconnectTimers.get(code)); directorDisconnectTimers.delete(code); } } catch (e) {}
            try { console.log(`WS director disconnected for session ${code} but ${remaining.size} client(s) remain; session retained`); } catch (e) {}
          }
        } catch (e) { try { deleteSession(code); } catch (err) {} }
        return;
      }

      // If no clients remain, delete the session immediately per new policy
      if (!sessionClients.has(code) || sessionClients.get(code).size === 0) {
        try { sessionClients.delete(code); } catch (e) {}
        try { deleteSession(code); } catch (e) {}
        return;
      }
      // otherwise update lastActivity and reschedule cleanup
      try { if (store[code]) { store[code].lastActivity = Date.now(); persist(); scheduleInactivityCleanup(code); } } catch (e) {}
    }
  });
});

// Helper: remove session data and persist
function deleteSession(code) {
  try {
    try {
      console.log(`deleteSession: removing session ${code}. store keys before delete: ${Object.keys(store).join(',')}`);
    } catch (e) {}
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
    const DELAY_MS = 35 * 60 * 1000; // 35 minutes

    const clients = sessionClients.get(code) || new Set();
    // If no connected clients, normally we'd delete immediately. However,
    // avoid deleting sessions that were just created and where the client
    // hasn't had time to open the WebSocket yet. Use a short grace window
    // for newly-created sessions to avoid race conditions between the
    // HTTP create and the subsequent WS subscribe.
    const NEW_SESSION_GRACE_MS = parseInt(process.env.NEW_SESSION_GRACE_MS || '5000', 10);
    if (clients.size === 0) {
      const s = store[code] || {};
      // If this session has never had any websocket clients subscribe, do not
      // delete it just because currently no clients are connected. This allows
      // the director to create a session, upload charts and edit without
      // immediately opening a websocket. Only delete when the session has had
      // subscribers previously (seenClients === true) and now all have left.
      if (!s.seenClients) {
        // No clients have ever connected -> keep session alive and do nothing.
        return;
      }

      const age = s.lastActivity ? (Date.now() - s.lastActivity) : Number.POSITIVE_INFINITY;
      if (age < NEW_SESSION_GRACE_MS) {
        // schedule a one-shot re-check after the grace window
        if (cleanupTimers.has(code)) { clearTimeout(cleanupTimers.get(code)); cleanupTimers.delete(code); }
        const tid = setTimeout(() => {
          try {
            const clientsNow = sessionClients.get(code) || new Set();
            if (clientsNow.size === 0) {
              try { deleteSession(code); } catch (e) {}
            }
          } catch (e) {}
          if (cleanupTimers.has(code)) cleanupTimers.delete(code);
        }, NEW_SESSION_GRACE_MS);
        cleanupTimers.set(code, tid);
        return;
      }
      // otherwise proceed to immediate deletion
      try { deleteSession(code); } catch (e) {}
      return;
    }

    // If there are connected clients but no charts, do NOT delete immediately.
    // Keep the session while clients are connected so live features (chat, page updates)
    // continue to function even before charts are added. We'll only delete when
    // clients are gone or after the inactivity timeout below.
    const hasCharts = Array.isArray(store[code].charts) && store[code].charts.length > 0;

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
      // no connected clients -> delete immediately per policy, but only if
      // the session had previously seen websocket clients. Preserve newly
      // created sessions that never had any subscribers.
      if (s && s.seenClients) {
        deleteSession(code);
      }
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
    const payload = JSON.stringify({ type: 'charts:update', charts: (store[code] && store[code].charts) || [], pages: (store[code] && store[code].pages) || {} });
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
  const now = Date.now();
  // createdAt: when the session was created. seenClients: whether any websocket
  // client has ever subscribed to this session. These help decide deletion rules.
  const session = { code, directorToken, charts: [], chat: [], lastActivity: now, createdAt: now, seenClients: false };
  store[code] = session;
  persist();
  try { console.log(`API: created session ${code}`); } catch (e) {}
  res.json({ code, directorToken });
});

// Get recent chat messages for a session (optional ?limit=N)
app.get('/api/sessions/:code/chat', (req, res) => {
  const code = req.params.code.toUpperCase();
  const s = store[code];
  if (!s) return res.status(404).json({ error: 'not_found' });
  const limit = parseInt(req.query.limit || '200', 10);
  const chat = Array.isArray(s.chat) ? s.chat.slice(-limit) : [];
  // mark activity
  try { s.lastActivity = Date.now(); persist(); scheduleInactivityCleanup(code); } catch (e) {}
  res.json({ chat });
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
  try { console.log(`API: save charts for ${code} token=${token ? 'present' : 'absent'}`); } catch (e) {}
  const s = store[code];
  if (!s) return res.status(404).json({ error: 'not_found' });
  if (!token || token !== s.directorToken) return res.status(403).json({ error: 'forbidden' });

  const charts = Array.isArray(req.body.charts) ? req.body.charts : [];
  s.charts = charts;
  // accept charts and optionally pages
  if (req.body && Array.isArray(req.body.charts)) {
    s.charts = req.body.charts;
  }
  if (req.body && req.body.pages && typeof req.body.pages === 'object') {
    // Validate pages payload size and structure to avoid extremely large posts
    const pages = req.body.pages;
    const validation = validatePagesPayload(pages);
    if (!validation.ok) {
      // 413 Payload Too Large is appropriate for size limits
      return res.status(validation.status || 413).json({ error: validation.message });
    }
    s.pages = pages;
  }
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
  res.json({ charts: s.charts || [], pages: s.pages || {} });
});

// Validate director token
app.post('/api/sessions/:code/validate-token', (req, res) => {
  const code = req.params.code.toUpperCase();
  const token = req.header('x-director-token');
  const s = store[code];
  if (!s) return res.status(404).json({ error: 'not_found' });
  if (!token || token !== s.directorToken) return res.status(403).json({ error: 'forbidden' });
  // token matches
  try { s.lastActivity = Date.now(); persist(); scheduleInactivityCleanup(code); } catch (e) {}
  return res.json({ ok: true });
});

// Delete session (director only)
app.delete('/api/sessions/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const token = req.header('x-director-token');
  try { console.log(`API: delete session ${code} token=${token ? 'present' : 'absent'}`); } catch (e) {}
  const s = store[code];
  if (!s) return res.status(404).json({ error: 'not_found' });
  if (!token || token !== s.directorToken) return res.status(403).json({ error: 'forbidden' });

  // Remove immediately and persist
  try {
    deleteSession(code);
    persist();
    // broadcast an empty charts update to any connected clients (they will be removed shortly)
    try { broadcastSessionUpdate(code); } catch (e) {}
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'delete_failed' });
  }
});

server.listen(PORT, () => {
  console.log(`MyWhiteboard server listening on http://localhost:${PORT}`);
});
