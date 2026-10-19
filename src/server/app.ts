import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { apiRouter } from './routes.ts';

export const app = express();

// Security Headers (Helmet-equivalent hardening)
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Explicit CORS
app.use(cors({
  origin: (origin, callback) => {
    // In dev / preview, allow any origin or self
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Site-Key'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Sanitized structured logger (no secrets, passwords, or tokens in logs)
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path.startsWith('/api/v1')) {
      // Clean query and avoid logging body secrets
      console.log(`[API] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Mount versioned API routes
app.use('/api/v1', apiRouter);

// Centralized 404 handler for API routes
app.use('/api/v1/*', (req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint Not Found', path: req.baseUrl });
});

// Centralized error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[API Server Error]', err?.message || err);
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err?.message,
  });
});
