const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const projectRoot = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function resolvePath(urlPath) {
  if (urlPath === '/' || urlPath === '') {
    return path.join(projectRoot, 'public', 'index.html');
  }

  if (urlPath.startsWith('/output/')) {
    return path.join(projectRoot, urlPath);
  }

  return path.join(projectRoot, 'public', urlPath);
}

function isInsideProjectRoot(filePath) {
  const normalizedRoot = path.normalize(projectRoot + path.sep);
  const normalizedPath = path.normalize(filePath);
  return normalizedPath.startsWith(normalizedRoot);
}

const server = http.createServer((req, res) => {
  const requestedPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const filePath = resolvePath(requestedPath);

  if (!isInsideProjectRoot(filePath)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Viewer running at http://localhost:${PORT}`);
});
