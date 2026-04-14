const state = {
  tabs: [{ id: crypto.randomUUID(), title: 'New Tab', url: 'https://example.com' }],
  activeTabId: null,
  history: JSON.parse(localStorage.getItem('sigmundHistory') || '[]')
};
state.activeTabId = state.tabs[0].id;

const tabsEl = document.getElementById('tabs');
const urlInput = document.getElementById('urlInput');
const proxyFrame = document.getElementById('proxyFrame');
const logsEl = document.getElementById('logs');
const metricsEl = document.getElementById('metrics');
const errorPanel = document.getElementById('errorPanel');

function activeTab() {
  return state.tabs.find((tab) => tab.id === state.activeTabId);
}

function saveHistory(url) {
  state.history.unshift({ url, ts: Date.now() });
  state.history = state.history.slice(0, 100);
  localStorage.setItem('sigmundHistory', JSON.stringify(state.history));
}

function renderTabs() {
  tabsEl.innerHTML = '';
  state.tabs.forEach((tab) => {
    const btn = document.createElement('button');
    btn.className = `tab ${tab.id === state.activeTabId ? 'active' : ''}`;
    btn.textContent = tab.title;
    btn.onclick = () => {
      state.activeTabId = tab.id;
      renderTabs();
      navigate(tab.url, false);
    };
    tabsEl.appendChild(btn);
  });
}

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function navigate(input, persist = true) {
  const url = normalizeUrl(input);
  if (!url) {
    errorPanel.textContent = 'Invalid URL.';
    return;
  }

  const tab = activeTab();
  tab.url = url;
  tab.title = new URL(url).hostname;
  urlInput.value = url;
  renderTabs();
  if (persist) saveHistory(url);

  const target = `/api/proxy?tabId=${encodeURIComponent(tab.id)}&url=${encodeURIComponent(url)}`;
  proxyFrame.src = target;
}

function bootLogStream() {
  const stream = new EventSource('/logs/stream');
  stream.onmessage = (event) => {
    const line = JSON.parse(event.data);
    if (line.level === 'error') errorPanel.textContent = line.message || 'Proxy error';
    logsEl.textContent = `${JSON.stringify(line)}\n${logsEl.textContent}`.slice(0, 9000);
  };
}

async function refreshMetrics() {
  const resp = await fetch('/api/metrics');
  const data = await resp.json();
  metricsEl.textContent = `Requests: ${data.requests}\nErrors: ${data.errors}\nAvg latency: ${data.avgLatencyMs}ms\nActive tabs: ${data.activeTabCount}`;
}

document.getElementById('goBtn').onclick = () => navigate(urlInput.value);
document.getElementById('newTabBtn').onclick = () => {
  const tab = { id: crypto.randomUUID(), title: 'New Tab', url: 'https://example.com' };
  state.tabs.push(tab);
  state.activeTabId = tab.id;
  renderTabs();
  navigate(tab.url, false);
};

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') navigate(urlInput.value);
});

setInterval(() => refreshMetrics().catch(() => null), 5000);
bootLogStream();
renderTabs();
navigate(activeTab().url, false);
refreshMetrics().catch(() => null);
