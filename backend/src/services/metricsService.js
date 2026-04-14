class MetricsService {
  constructor() {
    this.requests = 0;
    this.errors = 0;
    this.totalLatency = 0;
    this.activeTabs = new Set();
  }

  markRequest(latencyMs, tabId) {
    this.requests += 1;
    this.totalLatency += latencyMs;
    if (tabId) this.activeTabs.add(tabId);
  }

  markError() {
    this.errors += 1;
  }

  snapshot() {
    return {
      requests: this.requests,
      errors: this.errors,
      avgLatencyMs: this.requests ? Number((this.totalLatency / this.requests).toFixed(2)) : 0,
      activeTabCount: this.activeTabs.size,
      uptimeSec: Math.round(process.uptime())
    };
  }
}

export const metricsService = new MetricsService();
