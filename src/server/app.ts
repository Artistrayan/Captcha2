import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { apiRouter } from './routes.ts';
import { billingRouter } from './billing.ts';

export const app = express();

// Render terminates TLS and forwards client IPs through one trusted proxy hop.
// Do not trust forwarded headers from arbitrary clients in local development.
app.set('trust proxy', process.env.RENDER ? 1 : false);

// Security Headers (Helmet-equivalent hardening)
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Explicit CORS. CAPTCHA embeds need cross-origin requests; billing remains token-authenticated.
app.use(cors({
  origin: (origin, callback) => callback(null, true),
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
      console.log(`[API] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

app.use('/api/v1', apiRouter);
app.use('/api/v1/billing', billingRouter);

app.all('/api/*', (req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint Not Found', path: req.originalUrl });
});

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[API Server Error]', err?.message || err);
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err?.message,
  });
});
