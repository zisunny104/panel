/**
 * metrics - Prometheus 格式指標模組（不依賴外部套件）
 *
 * - 輸出 Prometheus text 格式指標，可由 Prometheus server 透過 HTTP 抓取（/metrics）
 * - 涵蓋連線數、速率限制、心跳遺失、記憶體等必要伺服器指標
 * - 供健康狀態觀察與告警規則制定使用
 */

let _wsTotalConnections = 0;
let _wsAuthenticatedConnections = 0;
let _wsActiveSessions = 0;
let _wsRateLimitViolationsTotal = 0;
let _wsHeartbeatMissedTotal = 0;

function setConnectionStats({
  totalConnections = 0,
  authenticatedConnections = 0,
  activeSessions = 0,
} = {}) {
  _wsTotalConnections = totalConnections;
  _wsAuthenticatedConnections = authenticatedConnections;
  _wsActiveSessions = activeSessions;
}

function incrementRateLimitViolations() {
  _wsRateLimitViolationsTotal += 1;
}

function incrementHeartbeatMissed() {
  _wsHeartbeatMissedTotal += 1;
}

function _formatMetric(name, value, help, type = "gauge") {
  let out = `# HELP ${name} ${help}\n`;
  out += `# TYPE ${name} ${type}\n`;
  out += `${name} ${value}\n`;
  return out;
}

const register = {
  contentType: "text/plain; version=0.0.4; charset=utf-8",
  async metrics() {
    const mem = process.memoryUsage();
    const uptime = process.uptime();

    let out = "";
    out += _formatMetric(
      "ws_total_connections",
      _wsTotalConnections,
      "Total WebSocket connections managed by server",
      "gauge",
    );
    out += _formatMetric(
      "ws_authenticated_connections",
      _wsAuthenticatedConnections,
      "Number of authenticated WebSocket connections",
      "gauge",
    );
    out += _formatMetric(
      "ws_active_sessions",
      _wsActiveSessions,
      "Number of active in-memory sessions",
      "gauge",
    );
    out += _formatMetric(
      "ws_rate_limit_violations_total",
      _wsRateLimitViolationsTotal,
      "Total number of rate limit violations",
      "counter",
    );
    out += _formatMetric(
      "ws_heartbeat_missed_total",
      _wsHeartbeatMissedTotal,
      "Total number of missed heartbeats / timed-out connections",
      "counter",
    );

    out += _formatMetric(
      "process_memory_rss_bytes",
      mem.rss,
      "Resident Set Size (bytes)",
      "gauge",
    );
    out += _formatMetric(
      "process_memory_heap_used_bytes",
      mem.heapUsed,
      "Heap used (bytes)",
      "gauge",
    );
    out += _formatMetric(
      "process_uptime_seconds",
      Math.floor(uptime),
      "Process uptime in seconds",
      "gauge",
    );

    return out;
  },
};

export const metrics = {
  register,
  setConnectionStats,
  incrementRateLimitViolations,
  incrementHeartbeatMissed,
};
