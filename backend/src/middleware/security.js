import helmet from 'helmet';
import cors from 'cors';
import { env } from '../config/env.js';

export const securityMiddleware = [
  helmet({ contentSecurityPolicy: false }),
  cors({
    origin: env.allowedOrigins.includes('*') ? true : env.allowedOrigins,
    credentials: true
  })
];
