import dotenv from 'dotenv';

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || 'production',
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || '0.0.0.0',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '*').split(',').map((v) => v.trim()),
  cacheEnabled: process.env.CACHE_ENABLED !== 'false',
  cacheTtlMs: Number(process.env.CACHE_TTL_MS || 30_000),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 20_000),
  maxRps: Number(process.env.MAX_RPS || 60),
  domainAllowlist: (process.env.DOMAIN_ALLOWLIST || '').split(',').map((v) => v.trim()).filter(Boolean),
  domainBlocklist: (process.env.DOMAIN_BLOCKLIST || '').split(',').map((v) => v.trim()).filter(Boolean),
  userAgent: process.env.PROXY_USER_AGENT || 'Sigmund-Unblocker/1.0',
  wispWsUrl: process.env.WISP_WS_URL || 'ws://wisp:4000',
  headerOverrides: process.env.HEADER_OVERRIDES ? JSON.parse(process.env.HEADER_OVERRIDES) : {}
};
