import fetch from 'node-fetch';
import { LRUCache } from 'lru-cache';
import { env } from '../config/env.js';
import { eventBus } from './eventBus.js';
import { metricsService } from './metricsService.js';
import { normalizeUrl, validateDomainPolicy } from '../utils/validation.js';

const cache = new LRUCache({
  max: 250,
  ttl: env.cacheTtlMs
});

function streamToClient(upstreamResponse, res) {
  res.status(upstreamResponse.status);
  upstreamResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'transfer-encoding') return;
    res.setHeader(key, value);
  });
  if (upstreamResponse.body) {
    upstreamResponse.body.pipe(res);
  } else {
    res.end();
  }
}

function rewriteHtmlForProxy(body, upstreamUrl) {
  const baseHref = `${upstreamUrl.origin}/`;
  if (/<base\s/i.test(body)) return body;
  if (/<head[^>]*>/i.test(body)) {
    return body.replace(/<head([^>]*)>/i, `<head$1><base href="${baseHref}">`);
  }
  return `<base href="${baseHref}">${body}`;
}

export async function proxyHttpRequest(req, res) {
  const started = Date.now();
  const inputUrl = req.query.url;
  const tabId = req.query.tabId || req.headers['x-tab-id'] || 'default';
  const url = normalizeUrl(inputUrl);

  if (!url) {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  const policyCheck = validateDomainPolicy(url, env.domainAllowlist, env.domainBlocklist);
  if (!policyCheck.ok) {
    return res.status(403).json({ error: policyCheck.reason });
  }

  const cacheKey = `${url.href}:${req.method}`;
  if (env.cacheEnabled && req.method === 'GET') {
    const cached = cache.get(cacheKey);
    if (cached) {
      eventBus.emit('log', { level: 'info', type: 'cache_hit', tabId, url: url.href, status: cached.status });
      res.status(cached.status);
      for (const [key, value] of Object.entries(cached.headers)) res.setHeader(key, value);
      return res.send(cached.body);
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.requestTimeoutMs);
    const upstream = await fetch(url.href, {
      method: req.method,
      headers: {
        'user-agent': env.userAgent,
        ...env.headerOverrides
      },
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timeout);

    const latency = Date.now() - started;
    metricsService.markRequest(latency, tabId);
    eventBus.emit('log', { level: 'info', type: 'proxy', tabId, url: url.href, status: upstream.status, latencyMs: latency });

    if (env.cacheEnabled && req.method === 'GET') {
      const contentType = upstream.headers.get('content-type') || '';
      let body = await upstream.text();
      if (contentType.includes('text/html')) {
        body = rewriteHtmlForProxy(body, url);
      }
      const headers = Object.fromEntries(upstream.headers.entries());
      cache.set(cacheKey, { status: upstream.status, headers, body });
      res.status(upstream.status);
      Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
      return res.send(body);
    }

    return streamToClient(upstream, res);
  } catch (error) {
    metricsService.markError();
    eventBus.emit('log', { level: 'error', type: 'proxy_error', tabId, url: url.href, message: error.message });
    return res.status(502).json({ error: 'Upstream request failed.', message: error.message });
  }
}
