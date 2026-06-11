const http = require('http');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const host = '127.0.0.1';
const port = 4173;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const relative = urlPath === '/' ? '/playground/index.html' : urlPath;
  const resolved = path.resolve(root, '.' + relative);

  if (!resolved.startsWith(root)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  let finalPath = resolved;
  if (fs.existsSync(finalPath) && fs.statSync(finalPath).isDirectory()) {
    finalPath = path.join(finalPath, 'index.html');
  }

  fs.readFile(finalPath, (error, data) => {
    if (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(error.code === 'ENOENT' ? 'Not found' : String(error));
      return;
    }

    res.writeHead(200, {
      'Content-Type': mime[path.extname(finalPath).toLowerCase()] || 'application/octet-stream'
    });
    res.end(data);
  });
});

server.listen(port, host, () => {
  console.log(`playground server listening at http://${host}:${port}/`);
});
