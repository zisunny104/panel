/*
Simple WebSocket stress test script
Usage:
  node ws-stress.js --connections=100 --rate=1 --duration=60 --ramp=10

This script will:
- POST /api/sync/create_session to obtain a sessionId
- Open N WebSocket connections to ws://localhost:7645/ws
- Authenticate each connection with { type: 'auth', data: { sessionId, clientId, role: 'viewer' }}
- Each authenticated client will send a 'heartbeat' message at `rate` messages/sec for `duration` seconds
- Periodically fetch /metrics for server-side metrics

Note: place this file under server/test and run from project root with:
  node server/test/ws-stress.js --connections=100 --rate=1 --duration=60 --ramp=10
*/

import http from "http";
import { URL } from "url";
import WebSocket from "ws";

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function httpPost(path, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data || {});
    const req = http.request(
      {
        hostname: "localhost",
        port: 7645,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try {
            const json = JSON.parse(body || "{}");
            resolve({ status: res.statusCode, body: json });
          } catch (e) {
            resolve({ status: res.statusCode, body: body });
          }
        });
      },
    );

    req.on("error", (e) => reject(e));
    req.write(payload);
    req.end();
  });
}

function httpGet(path) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: "localhost", port: 7645, path }, (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      })
      .on("error", (e) => reject(e));
  });
}

async function main() {
  const args = parseArgs();
  const connections = parseInt(args.connections || "100", 10);
  const rate = parseFloat(args.rate || "1"); // per second per client
  const duration = parseInt(args.duration || "60", 10); // seconds
  const ramp = parseInt(args.ramp || "10", 10); // seconds to ramp up connections

  console.log(
    `Stress test: connections=${connections}, rate=${rate}/s, duration=${duration}s, ramp=${ramp}s`,
  );

  // Create session
  const createRes = await httpPost("/api/sync/create_session", {});
  if (createRes.status !== 201 && createRes.status !== 200) {
    console.error("Failed to create session", createRes);
    process.exit(1);
  }
  const sessionId =
    createRes.body.data?.sessionId ||
    createRes.body.sessionId ||
    createRes.body.data?.sessionId;
  if (!sessionId) {
    console.error("No sessionId returned", createRes.body);
    process.exit(1);
  }
  console.log("sessionId:", sessionId);

  const clients = [];
  let connected = 0;
  let authSuccess = 0;
  let closed = 0;
  let errors = 0;

  // metrics polling
  const metricsSamples = [];
  const metricsInterval = setInterval(async () => {
    try {
      const r = await httpGet("/metrics");
      metricsSamples.push({ t: Date.now(), body: r.body });
    } catch (e) {
      // ignore
    }
  }, 5000);

  function connectClient(i) {
    return new Promise((resolve) => {
      const clientId = `stress_${Date.now()}_${i}`;
      const ws = new WebSocket("ws://localhost:7645/ws");
      let authenticated = false;
      let sendInterval = null;

      ws.on("open", () => {
        connected++;
        // send auth
        const authMsg = JSON.stringify({
          type: "auth",
          data: { sessionId, clientId, role: "viewer" },
        });
        ws.send(authMsg);
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "auth_success") {
            authSuccess++;
            authenticated = true;
            // start sending heartbeats at rate
            const intervalMs = Math.max(1, Math.floor(1000 / rate));
            sendInterval = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) {
                const hb = JSON.stringify({
                  type: "heartbeat",
                  data: { clientId, timestamp: Math.floor(Date.now() / 1000) },
                });
                ws.send(hb);
              }
            }, intervalMs);
            resolve();
          } else if (
            msg.type === "error" &&
            msg.data &&
            msg.data.code === "RATE_LIMIT_EXCEEDED"
          ) {
            // rate limit, count as error
            errors++;
          }
        } catch (e) {
          // ignore
        }
      });

      ws.on("close", (code, reason) => {
        closed++;
        if (sendInterval) clearInterval(sendInterval);
      });

      ws.on("error", (e) => {
        errors++;
      });

      clients.push({ ws, clientId });
    });
  }

  // ramped connect
  const start = Date.now();
  for (let i = 0; i < connections; i++) {
    const delay = Math.floor((i * ramp * 1000) / connections);
    await new Promise((r) => setTimeout(r, delay));
    await connectClient(i);
    if ((i + 1) % 10 === 0) console.log(`Connected ${i + 1}/${connections}`);
  }

  console.log(
    `All clients connected. Auth success: ${authSuccess}/${connections}. Running for ${duration}s...`,
  );

  await new Promise((r) => setTimeout(r, duration * 1000));

  // teardown
  clients.forEach((c) => {
    try {
      c.ws.close(1000, "test complete");
    } catch (e) {}
  });
  clearInterval(metricsInterval);

  // wait a moment
  await new Promise((r) => setTimeout(r, 2000));

  // final metrics
  try {
    const r = await httpGet("/metrics");
    metricsSamples.push({ t: Date.now(), body: r.body });
  } catch (e) {}

  const summary = {
    targetConnections: connections,
    connected,
    authSuccess,
    closed,
    errors,
    metricsSamplesCount: metricsSamples.length,
  };

  console.log("Test summary:", summary);
  // save metrics samples to file
  try {
    const fs = await import("fs/promises");
    await fs.writeFile(
      "ws-stress-metrics.log",
      metricsSamples
        .map((s) => `--- ${new Date(s.t).toISOString()} ---\n${s.body}`)
        .join("\n"),
      "utf-8",
    );
    console.log("Saved metrics to ws-stress-metrics.log");
  } catch (e) {
    // ignore
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("Error in stress test", e);
  process.exit(1);
});
