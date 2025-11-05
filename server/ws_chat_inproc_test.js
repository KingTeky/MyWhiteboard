const WebSocket = require('ws');
const url = 'ws://127.0.0.1:3000';

function makeClient(name, sessionCode, sendAfterMs) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.on('open', () => {
      console.log(`${name} connected`);
      ws.send(JSON.stringify({ type: 'subscribe', session: sessionCode }));
      if (sendAfterMs) {
        setTimeout(() => {
          const msg = { type: 'chat:message', session: sessionCode, from: name, role: 'Production', text: `hello from ${name}` };
          console.log(`${name} sending:`, msg.text);
          ws.send(JSON.stringify(msg));
        }, sendAfterMs);
      }
    });
    ws.on('message', (data) => {
      console.log(`${name} received:`, data.toString());
    });
    ws.on('close', () => console.log(`${name} closed`));
    ws.on('error', (e) => console.error(`${name} error`, e));

    // resolve when both clients have lived long enough
    setTimeout(() => { try { ws.close(); } catch (e) {} ; resolve(); }, 4000 + (sendAfterMs || 0));
  });
}

const http = require('http');

function createSession() {
  return new Promise((resolve, reject) => {
    const opts = { hostname: '127.0.0.1', port: 3000, path: '/api/sessions', method: 'POST', headers: { 'Content-Type': 'application/json' } };
    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', (c) => body += c.toString());
      res.on('end', () => {
        try { const j = JSON.parse(body || '{}'); resolve(j.code); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write('{}');
    req.end();
  });
}

async function run() {
  console.log('Starting inproc chat test (2 clients)');
  const code = await createSession();
  console.log('Created session', code);
  // client A will send after 1.5s
  const a = makeClient('clientA', code, 1500);
  const b = makeClient('clientB', code, 0);
  await Promise.all([a, b]);
  console.log('inproc chat test done');
  process.exit(0);
}

run();
