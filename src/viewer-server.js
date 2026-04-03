const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const OUTPUT_FILE = process.env.OUTPUT_FILE || 'output/intercooler-value-ranking.json';
const PUBLIC_DIR = path.resolve(process.cwd(), 'public');

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

async function readFileIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

async function sendResponse(response, statusCode, body, contentType) {
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (request.method !== 'GET') {
    await sendResponse(response, 405, 'Method Not Allowed', 'text/plain; charset=utf-8');
    return;
  }

  if (requestUrl.pathname === '/api/data') {
    const jsonPath = path.resolve(process.cwd(), OUTPUT_FILE);
    const rawJson = await readFileIfExists(jsonPath);

    if (!rawJson) {
      await sendResponse(
        response,
        404,
        JSON.stringify({ error: `Missing JSON file at ${OUTPUT_FILE}` }),
        'application/json; charset=utf-8'
      );
      return;
    }

    await sendResponse(response, 200, rawJson, 'application/json; charset=utf-8');
    return;
  }

  const normalizedPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const assetPath = path.resolve(PUBLIC_DIR, `.${normalizedPath}`);

  if (!assetPath.startsWith(PUBLIC_DIR)) {
    await sendResponse(response, 400, 'Bad Request', 'text/plain; charset=utf-8');
    return;
  }

  const fileContents = await readFileIfExists(assetPath);
  if (fileContents === null) {
    await sendResponse(response, 404, 'Not Found', 'text/plain; charset=utf-8');
    return;
  }

  const ext = path.extname(assetPath).toLowerCase();
  await sendResponse(response, 200, fileContents, contentTypes[ext] || 'application/octet-stream');
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`Internal Server Error: ${error.message}`);
  });
});

server.listen(PORT, () => {
  process.stdout.write(`Viewer running at http://localhost:${PORT}\n`);
});