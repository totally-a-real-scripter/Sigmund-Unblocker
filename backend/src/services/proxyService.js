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
  const proxyPrefix = '/api/proxy?url=';
  const toAbsoluteUrl = (rawUrl) => {
    const value = rawUrl.trim();
    if (!value || value.startsWith('#') || value.startsWith('data:') || value.startsWith('javascript:') || value.startsWith('blob:')) {
      return null;
    }

    if (value.startsWith('//')) return `${upstreamUrl.protocol}${value}`;
    try {
      return new URL(value, upstreamUrl.href).href;
    } catch {
      return null;
    }
  };

  const toProxyUrl = (rawUrl) => {
    const absolute = toAbsoluteUrl(rawUrl);
    if (!absolute) return rawUrl;
    return `${proxyPrefix}${encodeURIComponent(absolute)}`;
  };

  let rewritten = body.replace(
    /\s(href|src|action|poster)=["']([^"']+)["']/gi,
    (full, attr, value) => ` ${attr}="${toProxyUrl(value)}"`
  );

  rewritten = rewritten.replace(
    /\ssrcset=["']([^"']+)["']/gi,
    (full, srcsetValue) => {
      const entries = srcsetValue
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const [urlPart, descriptor] = entry.split(/\s+/, 2);
          const proxiedUrl = toProxyUrl(urlPart);
          return descriptor ? `${proxiedUrl} ${descriptor}` : proxiedUrl;
        });
      return ` srcset="${entries.join(', ')}"`;
    }
  );

  const runtimePatch = `
<script>
(() => {
  const toProxy = (input) => {
    const value = String(input || '');
    if (!value || value.startsWith('/api/proxy?url=') || value.startsWith('data:') || value.startsWith('javascript:') || value.startsWith('blob:')) return value;
    try {
      const absolute = new URL(value, window.location.href).href;
      return '/api/proxy?url=' + encodeURIComponent(absolute);
    } catch {
      return value;
    }
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = (resource, init) => {
    if (typeof resource === 'string') return originalFetch(toProxy(resource), init);
    if (resource instanceof Request) return originalFetch(new Request(toProxy(resource.url), resource), init);
    return originalFetch(resource, init);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return originalOpen.call(this, method, toProxy(url), ...rest);
  };

  document.addEventListener('click', (event) => {
    const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    anchor.setAttribute('href', toProxy(href));
  }, { capture: true });
})();
</script>`;

  if (/<head[^>]*>/i.test(rewritten)) {
    return rewritten.replace(/<head([^>]*)>/i, `<head$1>${runtimePatch}`);
  }

  return `${runtimePatch}${rewritten}`;
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
      const isTextLike = /^text\/|application\/(javascript|json|xml|x-www-form-urlencoded)/i.test(contentType);

      if (isTextLike) {
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
    }

    return streamToClient(upstream, res);
  } catch (error) {
    metricsService.markError();
    eventBus.emit('log', { level: 'error', type: 'proxy_error', tabId, url: url.href, message: error.message });
    return res.status(502).json({ error: 'Upstream request failed.', message: error.message });
  }
}
