// Simple static file server for headless recording
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || '/home/recorder/public';
const PORT = parseInt(process.argv[3] || '53694');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

http.createServer((req, res) => {
  let p = path.join(ROOT, req.url.split('?')[0]);
  if (p.endsWith('/')) p = path.join(p, 'index.html');
  fs.readFile(p, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(p);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log('server ready on port ' + PORT);
  // Signal readiness to parent process via stdout
  if (process.send) process.send('ready');
});
