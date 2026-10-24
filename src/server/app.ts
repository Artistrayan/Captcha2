import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { apiRouter } from './routes.ts';
import { billingRouter } from './billing.ts';

export const app = express();
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);

app.set('trust proxy', process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY !== 'false' ? 1 : false);

app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (IS_PRODUCTION) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

const configuredOrigins = [
  ...(process.env.CORS_ALLOWED_ORIGINS || '').split(','),
  process.env.APP_URL || '',
  process.env.ADMIN_APP_URL || '',
].map(value => value.trim().replace(/\/$/, '')).filter(Boolean);
const allowedDashboardOrigins = new Set(configuredOrigins);

// CAPTCHA endpoints must support customer-site embeds; domain binding is enforced server-side.
// Dashboard, billing, and admin APIs only expose CORS to configured first-party origins.
app.use((req: Request, res: Response, next: NextFunction) => {
  const isCaptchaEmbedEndpoint = /^\/api\/v1\/captcha\/(challenge|verify)$/.test(req.path);
  const origin = req.headers.origin;
  if (!IS_PRODUCTION || !origin || isCaptchaEmbedEndpoint || allowedDashboardOrigins.has(origin.replace(/\/$/, ''))) {
    return cors({
      origin: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Site-Key'],
      maxAge: 600,
    })(req, res, next);
  }
  return cors({ origin: false })(req, res, next);
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

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
