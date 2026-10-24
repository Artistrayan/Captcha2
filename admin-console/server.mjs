import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const root = resolve(process.cwd(), 'dist');
const port = Number.parseInt(process.env.PORT || '3000', 10);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    return res.end('Method Not Allowed');
  }

  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    const relativePath = pathname.replace(/^\/+/, '') || 'index.html';
    const requested = resolve(root, relativePath);
    if (requested !== root && !requested.startsWith(root + sep)) {
      res.writeHead(400);
      return res.end('Bad Request');
    }

    let file = requested;
    try {
      const info = await stat(file);
      if (info.isDirectory()) file = resolve(file, 'index.html');
    } catch {
      file = resolve(root, 'index.html');
    }

    let body;
    try {
      body = await readFile(file);
    } catch {
      body = await readFile(resolve(root, 'index.html'));
      file = resolve(root, 'index.html');
    }

    res.writeHead(200, {
      'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`[ShieldCaptcha Admin] listening on 0.0.0.0:${port}`);
});
