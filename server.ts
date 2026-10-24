import { createServer as createViteServer } from 'vite';
import { app } from './src/server/app.ts';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

// Use the platform-assigned port in production (Railway or local development).
const PORT = Number.parseInt(process.env.PORT || '3000', 10);

const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  if (!isProduction) {
    // In development mode, mount Vite middleware with HMR disabled when DISABLE_HMR is set
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    // Explicit fallback for SPA routes to transform and serve index.html
    app.use('*', async (req, res, next) => {
      // Skip API routes so 404s stay JSON
      if (req.originalUrl.startsWith('/api/')) {
        return next();
      }
      try {
        const indexPath = path.resolve(process.cwd(), 'index.html');
        let template = fs.readFileSync(indexPath, 'utf-8');
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        next(e);
      }
    });

    console.log('[Dev Server] Vite middleware integrated with Express');
  } else {
    // In production, serve built dist files
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        // Never return HTML for API requests
        if (req.originalUrl.startsWith('/api')) {
          return res.status(404).json({ error: 'Endpoint Not Found', path: req.originalUrl });
        }
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ShieldCaptcha] Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[ShieldCaptcha] Failed to start server:', err);
  process.exit(1);
});
