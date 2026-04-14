const SEARCH_ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', queryUrl: 'https://duckduckgo.com/?q=%s' },
  google: { name: 'Google', queryUrl: 'https://www.google.com/search?q=%s' },
  bing: { name: 'Bing', queryUrl: 'https://www.bing.com/search?q=%s' },
  brave: { name: 'Brave', queryUrl: 'https://search.brave.com/search?q=%s' }
};

const APP_SHORTCUTS = [
  { label: 'YouTube', url: 'https://www.youtube.com/' },
  { label: 'Discord', url: 'https://discord.com/app' },
  { label: 'Reddit', url: 'https://www.reddit.com/' },
  { label: 'X', url: 'https://x.com/' },
  { label: 'GitHub', url: 'https://github.com/' },
  { label: 'Twitch', url: 'https://www.twitch.tv/' }
];

const state = {
  tabs: [{ id: crypto.randomUUID(), title: 'New Tab', url: 'https://duckduckgo.com' }],
  activeTabId: null,
  history: JSON.parse(localStorage.getItem('sigmundHistory') || '[]'),
  selectedEngine: localStorage.getItem('sigmundSearchEngine') || 'duckduckgo',
  controlsHidden: localStorage.getItem('sigmundControlsHidden') === 'true',
  floatingPos: JSON.parse(localStorage.getItem('sigmundFloatingPos') || '{"x":null,"y":null}')
};

state.activeTabId = state.tabs[0].id;
if (!SEARCH_ENGINES[state.selectedEngine]) state.selectedEngine = 'duckduckgo';

function activeTab() {
  return state.tabs.find((tab) => tab.id === state.activeTabId);
}

function saveHistory(url) {
  state.history.unshift({ url, ts: Date.now() });
  state.history = state.history.slice(0, 100);
  localStorage.setItem('sigmundHistory', JSON.stringify(state.history));
}

function normalizeUrlOrSearch(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const hasProtocol = /^https?:\/\//i.test(trimmed);
  const looksLikeDomain = /^[^\s]+\.[^\s]{2,}/.test(trimmed) && !trimmed.includes(' ');

  if (hasProtocol || looksLikeDomain) {
    const candidate = hasProtocol ? trimmed : `https://${trimmed}`;
    try {
      return new URL(candidate).href;
    } catch {
      return null;
    }
  }

  const engine = SEARCH_ENGINES[state.selectedEngine] || SEARCH_ENGINES.duckduckgo;
  return engine.queryUrl.replace('%s', encodeURIComponent(trimmed));
}

function titleFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('duckduckgo.com')) return `DuckDuckGo: ${parsed.searchParams.get('q') || 'Search'}`;
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'New Tab';
  }
}

function init() {
  const el = {
    urlInput: document.getElementById('urlInput'),
    proxyFrame: document.getElementById('proxyFrame'),
    goBtn: document.getElementById('goBtn'),
    newTabBtn: document.getElementById('newTabBtn'),
    hideBarBtn: document.getElementById('hideBarBtn'),
    controlBar: document.getElementById('controlBar'),
    floatingToggle: document.getElementById('floatingToggle'),
    engineSelect: document.getElementById('engineSelect'),
    appShortcuts: document.getElementById('appShortcuts'),
    logs: document.getElementById('logs'),
    metrics: document.getElementById('metrics'),
    errorPanel: document.getElementById('errorPanel'),
    statusBody: document.getElementById('statusBody'),
    toggleStatusBtn: document.getElementById('toggleStatusBtn')
  };

  const required = ['urlInput', 'proxyFrame', 'goBtn', 'newTabBtn', 'hideBarBtn', 'controlBar', 'floatingToggle', 'engineSelect', 'appShortcuts'];
  const missing = required.filter((key) => !el[key]);
  if (missing.length) {
    console.error(`Sigmund UI failed to initialize. Missing elements: ${missing.join(', ')}`);
    return;
  }

  function navigate(input, persist = true) {
    const targetUrl = normalizeUrlOrSearch(input);
    if (!targetUrl) {
      if (el.errorPanel) el.errorPanel.textContent = 'Invalid URL or query.';
      return;
    }

    const tab = activeTab();
    tab.url = targetUrl;
    tab.title = titleFromUrl(targetUrl);
    el.urlInput.value = targetUrl;
    if (persist) saveHistory(targetUrl);

    const target = `/api/proxy?tabId=${encodeURIComponent(tab.id)}&url=${encodeURIComponent(targetUrl)}`;
    el.proxyFrame.src = target;
    if (el.errorPanel) el.errorPanel.textContent = '';
  }

  function bootLogStream() {
    if (!el.logs) return;
    const stream = new EventSource('/logs/stream');
    stream.onmessage = (event) => {
      const line = JSON.parse(event.data);
      if (line.level === 'error' && el.errorPanel) el.errorPanel.textContent = line.message || 'Proxy error';
      el.logs.textContent = `${JSON.stringify(line)}\n${el.logs.textContent}`.slice(0, 10000);
    };
  }

  async function refreshMetrics() {
    if (!el.metrics) return;
    const resp = await fetch('/api/metrics');
    const data = await resp.json();
    el.metrics.textContent = [
      `Engine: ${SEARCH_ENGINES[state.selectedEngine].name}`,
      `Requests: ${data.requests}`,
      `Errors: ${data.errors}`,
      `Avg latency: ${data.avgLatencyMs}ms`,
      `Active tabs: ${data.activeTabCount}`
    ].join('\n');
  }

  function addNewTab(url = 'https://duckduckgo.com') {
    const tab = { id: crypto.randomUUID(), title: titleFromUrl(url), url };
    state.tabs.push(tab);
    state.activeTabId = tab.id;
    navigate(url, false);
  }

  function populateEngineSelect() {
    el.engineSelect.innerHTML = '';
    Object.entries(SEARCH_ENGINES).forEach(([key, value]) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = value.name;
      if (state.selectedEngine === key) option.selected = true;
      el.engineSelect.appendChild(option);
    });
  }

  function populateAppShortcuts() {
    APP_SHORTCUTS.forEach((app) => {
      const btn = document.createElement('button');
      btn.className = 'app-shortcut';
      btn.type = 'button';
      btn.textContent = app.label;
      btn.addEventListener('click', () => navigate(app.url));
      el.appShortcuts.appendChild(btn);
    });
  }

  let floatingToggleIgnoreClickUntil = 0;

  function setControlsHidden(hidden) {
    state.controlsHidden = hidden;
    localStorage.setItem('sigmundControlsHidden', String(hidden));
    el.controlBar.hidden = hidden;
    el.floatingToggle.hidden = !hidden;

    if (hidden) {
      floatingToggleIgnoreClickUntil = Date.now() + 250;
    }
  }

  function clampFloatingButton() {
    const margin = 8;
    const maxX = window.innerWidth - el.floatingToggle.offsetWidth - margin;
    const maxY = window.innerHeight - el.floatingToggle.offsetHeight - margin;
    const x = Math.min(Math.max(state.floatingPos.x ?? window.innerWidth - 60, margin), maxX);
    const y = Math.min(Math.max(state.floatingPos.y ?? 16, margin), maxY);
    state.floatingPos = { x, y };
    el.floatingToggle.style.left = `${x}px`;
    el.floatingToggle.style.top = `${y}px`;
  }

  function makeFloatingDraggable() {
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let dragging = false;

    el.floatingToggle.addEventListener('pointerdown', (event) => {
      dragging = true;
      const rect = el.floatingToggle.getBoundingClientRect();
      dragOffsetX = event.clientX - rect.left;
      dragOffsetY = event.clientY - rect.top;
      el.floatingToggle.setPointerCapture(event.pointerId);
    });

    el.floatingToggle.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      state.floatingPos.x = event.clientX - dragOffsetX;
      state.floatingPos.y = event.clientY - dragOffsetY;
      clampFloatingButton();
    });

    const stopDragging = () => {
      if (!dragging) return;
      dragging = false;
      localStorage.setItem('sigmundFloatingPos', JSON.stringify(state.floatingPos));
    };

    el.floatingToggle.addEventListener('pointerup', stopDragging);
    el.floatingToggle.addEventListener('pointercancel', stopDragging);
  }

  el.goBtn.addEventListener('click', () => navigate(el.urlInput.value));
  el.newTabBtn.addEventListener('click', () => addNewTab());
  el.hideBarBtn.addEventListener('click', () => setControlsHidden(true));
  el.floatingToggle.addEventListener('click', () => {
    if (Date.now() < floatingToggleIgnoreClickUntil) return;
    if (state.controlsHidden) setControlsHidden(false);
  });

  el.urlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') navigate(el.urlInput.value);
  });

  el.engineSelect.addEventListener('change', (event) => {
    state.selectedEngine = event.target.value;
    localStorage.setItem('sigmundSearchEngine', state.selectedEngine);
    refreshMetrics().catch(() => null);
  });

  if (el.toggleStatusBtn && el.statusBody) {
    el.toggleStatusBtn.addEventListener('click', () => {
      const collapsed = el.statusBody.classList.toggle('collapsed');
      el.toggleStatusBtn.textContent = collapsed ? '+' : '–';
    });
  }

  window.addEventListener('resize', clampFloatingButton);

  populateEngineSelect();
  populateAppShortcuts();
  setControlsHidden(state.controlsHidden);
  clampFloatingButton();
  makeFloatingDraggable();
  bootLogStream();
  setInterval(() => refreshMetrics().catch(() => null), 5000);
  refreshMetrics().catch(() => null);
  navigate(activeTab().url, false);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
