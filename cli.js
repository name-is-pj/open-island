// OpenIsland CLI — localhost only. Usage: node cli.js notify "build done"
const http = require('http');
const [,, cmd, ...rest] = process.argv;
if (cmd === 'notify') {
  const text = rest.join(' ');
  const req = http.request({ host: '127.0.0.1', port: 8178, path: '/notify', method: 'POST',
    headers: { 'Content-Type': 'application/json' } }, (res) => {
    console.log(res.statusCode === 200 ? 'Notified the island.' : 'Island not running (start it with npm start).');
  });
  req.on('error', () => console.log('Island not running (start it with npm start).'));
  req.end(JSON.stringify({ text }));
} else {
  console.log('Usage: node cli.js notify "your message"');
}
