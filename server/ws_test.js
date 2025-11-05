const WebSocket = require('ws');
const url = 'ws://127.0.0.1:3000';
const sessionCode = process.argv[2] || '97116X';
const ws = new WebSocket(url);

ws.on('open', () => {
  console.log('WS connected to', url);
  // send subscribe
  ws.send(JSON.stringify({ type: 'subscribe', session: sessionCode }));
  console.log('Sent subscribe for session', sessionCode);
});

ws.on('message', (data) => {
  console.log('Message received:', data.toString());
});

ws.on('close', () => console.log('WS closed'));
ws.on('error', (err) => console.error('WS error', err));

// exit after 8 seconds
setTimeout(() => {
  console.log('Exiting ws_test');
  try { ws.close(); } catch (e) {}
  process.exit(0);
}, 8000);
