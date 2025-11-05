const WebSocket = require('ws');

const url = 'ws://127.0.0.1:3000';
const sessionCode = process.argv[2] || 'TEST01';
const mode = process.argv[3] || 'listen'; // 'send' or 'listen'

const ws = new WebSocket(url);

ws.on('open', () => {
  console.log('WS connected to', url);
  ws.send(JSON.stringify({ type: 'subscribe', session: sessionCode }));
  console.log('Subscribed to session', sessionCode);

  if (mode === 'send') {
    // send a chat message after a short delay
    setTimeout(() => {
      const msg = { type: 'chat:message', session: sessionCode, from: 'ws_test_sender', role: 'Production', text: `hello from ${process.pid} at ${new Date().toISOString()}` };
      console.log('Sending chat message:', msg.text);
      ws.send(JSON.stringify(msg));
    }, 500);
  }
});

ws.on('message', (data) => {
  try {
    const j = JSON.parse(data.toString());
    console.log('Received:', JSON.stringify(j));
  } catch (e) {
    console.log('Received (raw):', data.toString());
  }
});

ws.on('close', () => console.log('WS closed'));
ws.on('error', (err) => console.error('WS error', err));

// exit after 20 seconds (longer so sender/listener overlap in tests)
setTimeout(() => {
  try { ws.close(); } catch (e) {}
  console.log('Exiting ws_chat_test', mode);
  process.exit(0);
}, 6000);
