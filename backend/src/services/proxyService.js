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

const cookieJar = new LRUCache({
  max: 1_000,
  ttl: 1000 * 60 * 60
});

function getCookieJarKey(tabId, url) {
  return `${tabId}:${url.hostname.toLowerCase()}`;
}

function storeUpstreamCookies(tabId, upstreamUrl, upstreamHeaders) {
  const setCookieHeaders = upstreamHeaders.raw()['set-cookie'] || [];
  if (!setCookieHeaders.length) return;

  const jarKey = getCookieJarKey(tabId, upstreamUrl);
  const existing = cookieJar.get(jarKey) || {};

  for (const header of setCookieHeaders) {
    const [pair] = String(header).split(';');
    const [name, ...valueParts] = pair.split('=');
    const cookieName = name?.trim();
    if (!cookieName) continue;
    const cookieValue = valueParts.join('=').trim();
    existing[cookieName] = cookieValue;
  }

  cookieJar.set(jarKey, existing);
}

function getUpstreamCookieHeader(tabId, upstreamUrl) {
  const jar = cookieJar.get(getCookieJarKey(tabId, upstreamUrl));
  if (!jar) return null;
  const entries = Object.entries(jar).filter(([name, value]) => name && value !== undefined);
  if (!entries.length) return null;
  return entries.map(([name, value]) => `${name}=${value}`).join('; ');
}

function decodeProxyUrl(value) {
  if (!value) return null;
  try {
    const ref = new URL(value, 'http://sigmund.local');
    if (ref.pathname !== '/api/proxy') return null;
    const target = ref.searchParams.get('url');
    return target ? new URL(target) : null;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value = '') {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function buildUpstreamHeaders(req, upstreamUrl, tabId) {
  const forwarded = {
    'user-agent': env.userAgent,
    ...env.headerOverrides
  };
  const passThroughHeaderNames = [
    'accept',
    'accept-language',
    'accept-encoding',
    'cache-control',
    'pragma',
    'content-type',
    'range'
  ];

  for (const name of passThroughHeaderNames) {
    if (req.headers[name]) forwarded[name] = req.headers[name];
  }

  const refererTarget = decodeProxyUrl(req.headers.referer);
  if (refererTarget) {
    forwarded.referer = refererTarget.href;
  }

  // Do not forward browser Origin to upstream by default.
  // In a same-origin iframe proxy setup, the browser Origin is usually this app
  // origin, which causes strict CSRF/CORS failures on many target sites.

  const cookieHeader = getUpstreamCookieHeader(tabId, upstreamUrl);
  if (cookieHeader) forwarded.cookie = cookieHeader;

  return forwarded;
}

function streamToClient(upstreamResponse, res) {
  res.status(upstreamResponse.status);
  upstreamResponse.headers.forEach((value, key) => {
    const normalized = key.toLowerCase();
    if (
      normalized === 'transfer-encoding' ||
      normalized === 'content-length' ||
      normalized === 'content-encoding' ||
      normalized === 'content-security-policy' ||
      normalized === 'content-security-policy-report-only' ||
      normalized === 'x-frame-options' ||
      normalized === 'frame-options' ||
      normalized === 'set-cookie'
    ) return;
    res.setHeader(key, value);
  });
  if (upstreamResponse.body) {
    upstreamResponse.body.pipe(res);
  } else {
    res.end();
  }
}

function createUrlHelpers(upstreamUrl) {
  const proxyPrefix = '/api/proxy?url=';

  const toAbsoluteUrl = (rawUrl = '') => {
    const value = decodeHtmlEntities(rawUrl).trim();
    if (!value || value.startsWith('#') || value.startsWith('data:') || value.startsWith('javascript:') || value.startsWith('blob:')) {
      return null;
    }
    const isLikelyBareModuleSpecifier = !value.startsWith('/') && !value.startsWith('.') && !value.startsWith('//') && !/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value);
    if (isLikelyBareModuleSpecifier) return null;

    if (value.startsWith('//')) return `${upstreamUrl.protocol}${value}`;
    try {
      return new URL(value, upstreamUrl.href).href;
    } catch {
      return null;
    }
  };

  const toProxyUrl = (rawUrl = '') => {
    const absolute = toAbsoluteUrl(rawUrl);
    if (!absolute) return rawUrl;
    return `${proxyPrefix}${encodeURIComponent(absolute)}`;
  };

  return { toProxyUrl };
}

function rewriteCssForProxy(body, upstreamUrl) {
  const { toProxyUrl } = createUrlHelpers(upstreamUrl);
  let rewritten = body.replace(
    /url\(\s*(['"]?)([^"')]+)\1\s*\)/gi,
    (full, quote, value) => `url("${toProxyUrl(value)}")`
  );

  rewritten = rewritten.replace(
    /@import\s+(?:url\()?\s*(['"])([^"']+)\1\s*\)?/gi,
    (full, quote, value) => full.replace(value, toProxyUrl(value))
  );

  return rewritten;
}

function rewriteJavascriptForProxy(body, upstreamUrl) {
  const { toProxyUrl } = createUrlHelpers(upstreamUrl);
  let rewritten = body.replace(
    /\b(from\s*['"])([^'"]+)(['"])/g,
    (full, prefix, value, suffix) => `${prefix}${toProxyUrl(value)}${suffix}`
  );

  rewritten = rewritten.replace(
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
    (full, quote, value) => `import(${quote}${toProxyUrl(value)}${quote})`
  );

  rewritten = rewritten.replace(
    /\bnew\s+Worker\(\s*(['"])([^'"]+)\1/g,
    (full, quote, value) => `new Worker(${quote}${toProxyUrl(value)}${quote}`
  );

  return rewritten;
}

function rewriteHtmlForProxy(body, upstreamUrl) {
  const { toProxyUrl } = createUrlHelpers(upstreamUrl);
  const urlAttributes = [
    'href',
    'src',
    'action',
    'poster',
    'formaction',
    'data',
    'manifest',
    'ping'
  ].join('|');

  let rewritten = body.replace(
    new RegExp(`\\s(${urlAttributes})=(['"])([^"']+)\\2`, 'gi'),
    (full, attr, quote, value) => ` ${attr}=${quote}${toProxyUrl(value)}${quote}`
  );

  rewritten = rewritten.replace(
    new RegExp(`\\s(${urlAttributes})=([^\\s"'=<>` + '`' + `]+)`, 'gi'),
    (full, attr, value) => ` ${attr}="${toProxyUrl(value)}"`
  );

  rewritten = rewritten.replace(
    /\s(?:srcset|imagesrcset)=["']([^"']+)["']/gi,
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
  const upstreamDocumentUrl = ${JSON.stringify(upstreamUrl.href)};
  const sameOriginProxyPrefix = '/api/proxy?url=';

  const isBypassScheme = (value) => (
    value.startsWith('data:') ||
    value.startsWith('javascript:') ||
    value.startsWith('blob:') ||
    value.startsWith('mailto:') ||
    value.startsWith('tel:')
  );

  const toProxy = (input) => {
    const value = String(input || '');
    if (!value || value.startsWith(sameOriginProxyPrefix) || isBypassScheme(value) || value.startsWith('#')) return value;
    try {
      const absolute = new URL(value, upstreamDocumentUrl).href;
      return sameOriginProxyPrefix + encodeURIComponent(absolute);
    } catch {
      return value;
    }
  };

  const rewriteElementUrlAttribute = (element, attributeName) => {
    if (!element || !attributeName) return;
    const name = String(attributeName).toLowerCase();
    if (!['src', 'href', 'action', 'formaction', 'poster', 'data', 'manifest', 'ping'].includes(name)) return;
    const current = element.getAttribute(name);
    if (!current) return;
    const proxied = toProxy(current);
    if (proxied !== current) {
      element.setAttribute(name, proxied);
    }
  };

  const rewriteElementUrlProperties = (element) => {
    if (!element) return;
    if (typeof element.src === 'string' && element.getAttribute && element.getAttribute('src')) {
      const raw = element.getAttribute('src');
      const proxied = toProxy(raw);
      if (proxied !== raw) element.setAttribute('src', proxied);
    }
    if (typeof element.href === 'string' && element.getAttribute && element.getAttribute('href')) {
      const raw = element.getAttribute('href');
      const proxied = toProxy(raw);
      if (proxied !== raw) element.setAttribute('href', proxied);
    }
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = (resource, init) => {
    if (typeof resource === 'string') return originalFetch(toProxy(resource), init);
    if (resource instanceof Request) {
      const cloned = resource.clone();
      return originalFetch(new Request(toProxy(cloned.url), cloned), init);
    }
    return originalFetch(resource, init);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return originalOpen.call(this, method, toProxy(url), ...rest);
  };

  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    const shouldProxy = ['src', 'href', 'action', 'formaction', 'poster', 'data', 'manifest', 'ping']
      .includes(String(name || '').toLowerCase());
    const nextValue = shouldProxy && typeof value === 'string' ? toProxy(value) : value;
    return originalSetAttribute.call(this, name, nextValue);
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        rewriteElementUrlAttribute(mutation.target, mutation.attributeName);
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        rewriteElementUrlProperties(node);
        node.querySelectorAll?.('[src],[href],[action],[formaction],[poster],[data],[manifest],[ping]').forEach((child) => {
          rewriteElementUrlProperties(child);
          rewriteElementUrlAttribute(child, 'src');
          rewriteElementUrlAttribute(child, 'href');
          rewriteElementUrlAttribute(child, 'action');
          rewriteElementUrlAttribute(child, 'formaction');
          rewriteElementUrlAttribute(child, 'poster');
          rewriteElementUrlAttribute(child, 'data');
          rewriteElementUrlAttribute(child, 'manifest');
          rewriteElementUrlAttribute(child, 'ping');
        });
      }
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src', 'href', 'action', 'formaction', 'poster', 'data', 'manifest', 'ping']
  });

  if (window.EventSource) {
    const OriginalEventSource = window.EventSource;
    window.EventSource = function(url, config) {
      return new OriginalEventSource(toProxy(url), config);
    };
    window.EventSource.prototype = OriginalEventSource.prototype;
  }

  if (window.Worker) {
    const OriginalWorker = window.Worker;
    window.Worker = function(url, options) {
      return new OriginalWorker(toProxy(url), options);
    };
    window.Worker.prototype = OriginalWorker.prototype;
  }

  if (window.SharedWorker) {
    const OriginalSharedWorker = window.SharedWorker;
    window.SharedWorker = function(url, options) {
      return new OriginalSharedWorker(toProxy(url), options);
    };
    window.SharedWorker.prototype = OriginalSharedWorker.prototype;
  }

  if (navigator.serviceWorker && navigator.serviceWorker.register) {
    const originalRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = (scriptURL, options) => originalRegister(toProxy(scriptURL), options);
  }

  if (navigator.sendBeacon) {
    const originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => originalSendBeacon(toProxy(url), data);
  }

  document.addEventListener('click', (event) => {
    const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    anchor.setAttribute('href', toProxy(href));
  }, { capture: true });
})();
</script>`;

  if (/<head[^>]*>/i.test(rewritten)) {
    return rewritten.replace(/<head([^>]*)>/i, `<head$1>${runtimePatch}`);
  }

  return `${runtimePatch}${rewritten}`;
}

function resolveFallbackProxyTarget(req) {
  const refererTarget = decodeProxyUrl(req.headers.referer);
  if (!refererTarget) return null;

  const relativeRequest = req.url.startsWith('/') ? req.url.slice(1) : req.url;
  if (!relativeRequest || relativeRequest.startsWith('proxy')) return null;

  try {
    return new URL(relativeRequest, refererTarget.href).href;
  } catch {
    return null;
  }
}

export async function proxyHttpRequest(req, res) {
  const started = Date.now();
  const inputUrl = req.query.url || resolveFallbackProxyTarget(req);
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
    const upstreamHeaders = buildUpstreamHeaders(req, url, tabId);
    const supportsBody = !['GET', 'HEAD'].includes(req.method.toUpperCase());
    const upstream = await fetch(url.href, {
      method: req.method,
      headers: upstreamHeaders,
      body: supportsBody ? req : undefined,
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timeout);
    storeUpstreamCookies(tabId, url, upstream.headers);

    const latency = Date.now() - started;
    metricsService.markRequest(latency, tabId);
    eventBus.emit('log', { level: 'info', type: 'proxy', tabId, url: url.href, status: upstream.status, latencyMs: latency });

    const contentType = upstream.headers.get('content-type') || '';
    const isTextLike = /^text\/|application\/(javascript|json|xml|x-www-form-urlencoded)/i.test(contentType);
    const isHtml = contentType.includes('text/html');
    const isCss = contentType.includes('text/css');
    const isJavascript = /javascript|ecmascript|x-javascript/i.test(contentType);

    if (isTextLike) {
      let body = await upstream.text();
      if (isHtml) {
        body = rewriteHtmlForProxy(body, url);
      } else if (isCss) {
        body = rewriteCssForProxy(body, url);
      } else if (isJavascript) {
        body = rewriteJavascriptForProxy(body, url);
      }

      const headers = Object.fromEntries(upstream.headers.entries());
      delete headers['content-length'];
      delete headers['Content-Length'];
      delete headers['content-encoding'];
      delete headers['Content-Encoding'];
      if (isHtml) {
        delete headers['content-security-policy'];
        delete headers['Content-Security-Policy'];
        delete headers['content-security-policy-report-only'];
        delete headers['Content-Security-Policy-Report-Only'];
        delete headers['x-frame-options'];
        delete headers['X-Frame-Options'];
        delete headers['frame-options'];
        delete headers['Frame-Options'];
      }
      delete headers['set-cookie'];
      delete headers['Set-Cookie'];

      if (env.cacheEnabled && req.method === 'GET') {
        cache.set(cacheKey, { status: upstream.status, headers, body });
      }

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
