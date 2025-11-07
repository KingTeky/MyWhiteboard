(async () => {
  try {
    const fetch = global.fetch || (await import('node-fetch')).default;
    const res = await fetch('http://localhost:3000/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const j = await res.json();
    console.log('Created session', j);
    const WebSocket = require('ws');
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
  } catch (e) { console.error('tmp_mode_test failed', e); process.exit(2); }
})();
