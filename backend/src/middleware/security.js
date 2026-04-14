import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { env } from '../config/env.js';

export const securityMiddleware = [
  helmet({ contentSecurityPolicy: false }),
  cors({
    origin: env.allowedOrigins.includes('*') ? true : env.allowedOrigins,
    credentials: true
  })
];

export const proxyRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.maxRps,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded.' }
});
