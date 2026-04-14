import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { env } from '../config/env.js';

const SKIPPED_FETCH_DESTINATIONS = new Set([
  'audio',
  'font',
  'image',
  'manifest',
  'object',
  'script',
  'style',
  'track',
  'video'
]);

function shouldSkipRateLimit(req) {
  const dest = String(req.headers['sec-fetch-dest'] || '').toLowerCase();
  return SKIPPED_FETCH_DESTINATIONS.has(dest);
}

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
  skip: shouldSkipRateLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded.' }
});
