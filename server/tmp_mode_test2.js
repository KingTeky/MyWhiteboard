const http = require('http');
const WebSocket = require('ws');

function createSession() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({});
    const opts = { hostname: 'localhost', port: 3000, path: '/api/sessions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
    const req = http.request(opts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => {
        try { const j = JSON.parse(data); resolve(j); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  try {
    const j = await createSession();
    console.log('Created session', j);
    const ws = new WebSocket('ws://localhost:3000');
    ws.on('open', () => {
      console.log('WS open, subscribing');
      ws.send(JSON.stringify({ type: 'subscribe', session: j.code, token: j.directorToken }));
      setTimeout(() => {
        console.log('Sending mode:change organize');
        ws.send(JSON.stringify({ type: 'mode:change', session: j.code, mode: 'organize' }));
      }, 800);
      setTimeout(() => {
        console.log('Sending mode:change live');
        ws.send(JSON.stringify({ type: 'mode:change', session: j.code, mode: 'live' }));
      }, 1600);
      setTimeout(() => {
        console.log('Closing WS');
        ws.close();
      }, 3000);
    });
    ws.on('message', (d) => console.log('WS msg', d.toString()));
    ws.on('close', () => { console.log('WS closed'); process.exit(0); });
    ws.on('error', (e) => { console.error('WS error', e); process.exit(1); });
  } catch (e) { console.error('tmp_mode_test2 failed', e); process.exit(2); }
})();
