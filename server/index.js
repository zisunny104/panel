/**
 * Node.js + WebSocket 後端伺服器
 * Port: 7645
 * 功能: 實驗面板即時同步系統
 */
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { SERVER_CONFIG } from "./config/server.js";
import { getDatabase, closeDatabase } from "./database/connection.js";
import { validateSchema } from "./database/schema.js";
import SessionService from "./services/SessionService.js";
import ShareCodeService from "./services/ShareCodeService.js";

// 匯入路由
import healthRouter from "./routes/health.js";
import syncRouter from "./routes/sync.js";
import experimentLogsRouter from "./routes/experiment-logs.js";

// 匯入 WebSocket 系統
import { WSServer } from "./websocket/WSServer.js";
import { ConnectionManager } from "./websocket/ConnectionManager.js";
import { SessionManager } from "./websocket/SessionManager.js";
import { BroadcastManager } from "./websocket/BroadcastManager.js";
import { MessageHandler } from "./websocket/MessageHandler.js";

// 匯入日誌工具
import { Logger } from "./utils/logger.js";

// ES module 中取得目前檔案路徑
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 建立Express應用
const app = express();

// 建立 HTTP 伺服器（用於 WebSocket 升級）
const httpServer = createServer(app);

// ===== 中間件設定 =====
app.use(cors(SERVER_CONFIG.cors));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 請求日誌
app.use((req, res, next) => {
  // 過濾掉 HEAD 請求（心跳檢測），減少日誌噪音
  if (req.method !== "HEAD") {
    Logger.http(req.method, req.path);
  }
  next();
});

// ===== 靜態文件服務 (前端) =====
const publicPath = path.join(__dirname, "..");
Logger.info(`提供靜態文件服務: ${publicPath}`);
app.use(
  express.static(publicPath, {
    index: "index.html",
    extensions: ["html", "htm"],
  }),
);

// ===== 路由註冊 =====
app.use("/api/health", healthRouter);
app.use("/api/sync", syncRouter);
app.use("/api/experiment-logs", experimentLogsRouter);

// 根路徑
app.get("/", (req, res) => {
  res.json({
    name: "Panel Backend Server",
    version: "2.0.0",
    port: SERVER_CONFIG.port,
    status: "running",
    endpoints: {
      health: "/api/health",
      sync: {
        create_session: "POST /api/sync/create_session",
        generate_share_code: "POST /api/sync/generate_share_code",
        join_by_share_code: "POST /api/sync/join_by_share_code",
        get_session: "GET /api/sync/session/:sessionId",
        heartbeat: "POST /api/sync/heartbeat",
      },
      experimentLogs: {
        list: "GET /api/experiment-logs/list",
        save: "POST /api/experiment-logs/save",
        read: "GET /api/experiment-logs/read/:filename",
        delete: "DELETE /api/experiment-logs/delete/:filename",
      },
    },
  });
});

// 404處理
app.use((req, res) => {
  res.status(404).json({
    error: "NOT_FOUND",
    message: `路徑不存在: ${req.path}`,
  });
});

// 錯誤處理
app.use((err, req, res, next) => {
  console.error("伺服器錯誤:", err);
  res.status(500).json({
    error: "INTERNAL_ERROR",
    message: "伺服器內部錯誤",
    details: SERVER_CONFIG.nodeEnv === "development" ? err.message : undefined,
  });
});

// ===== 資料庫初始化 =====
try {
  Logger.info("初始化資料庫連線");
  getDatabase();
  validateSchema();
} catch (error) {
  Logger.error("資料庫初始化失敗:", error.message);
  process.exit(1);
}

// ===== 定期清理任務 =====
// 清理過期工作階段
// 清理過期分享代碼
const cleanupInterval = SERVER_CONFIG.cleanup.interval;

setInterval(() => {
  try {
    SessionService.cleanupExpiredSessions();
    ShareCodeService.cleanupExpiredCodes();
  } catch (error) {
    Logger.error("清理任務失敗:", error.message);
  }
}, cleanupInterval);

Logger.info(`清理任務已啟動 (間隔: ${cleanupInterval / 1000}秒)`);

// ===== WebSocket 系統初始化 =====
Logger.info("初始化 WebSocket 系統");

// 建立管理器
const connectionManager = new ConnectionManager();
const sessionManager = new SessionManager(connectionManager, SessionService);
const broadcastManager = new BroadcastManager(
  connectionManager,
  sessionManager,
);
const messageHandler = new MessageHandler(
  connectionManager,
  sessionManager,
  broadcastManager,
);

// 建立 WebSocket 伺服器
const wsServer = new WSServer(httpServer);
wsServer.initialize({
  connectionManager,
  messageHandler,
});

// 將 WebSocket 管理器掛載到 app.locals，供路由使用
app.locals.sessionManager = sessionManager;
app.locals.connectionManager = connectionManager;

Logger.success("WebSocket 系統已初始化");

// ===== 啟動伺服器 =====
const server = httpServer.listen(SERVER_CONFIG.port, () => {
  console.log("");
  Logger.success("================================");
  Logger.success("Panel Backend Server 已啟動");
  Logger.success("================================");
  Logger.info(
    `HTTP        <yellow>|</yellow> <cyan>http://localhost:${SERVER_CONFIG.port}</cyan>`,
  );
  Logger.info(
    `WebSocket   <yellow>|</yellow> <cyan>ws://localhost:${SERVER_CONFIG.port}/ws</cyan>`,
  );
  Logger.info(
    `心跳檢測    <yellow>|</yellow> <cyan>http://localhost:${SERVER_CONFIG.port}/api/health</cyan>`,
  );
  Logger.info("");
  Logger.debug(
    `工作階段超時  <yellow>${SERVER_CONFIG.session.timeout}</yellow> 秒`,
  );
  Logger.debug(
    `分享代碼超時  <yellow>${SERVER_CONFIG.shareCode.timeout}</yellow> 秒`,
  );
  Logger.debug(
    `心跳檢測間隔  <yellow>${SERVER_CONFIG.websocket.heartbeatInterval / 1000}</yellow> 秒`,
  );
  Logger.debug("");
});

// ===== 優雅關閉 =====
process.on("SIGINT", () => {
  Logger.warn("收到SIGINT信號，正在關閉伺服器...");

  // 關閉 WebSocket 系統
  wsServer.close();
  connectionManager.closeAll();

  // 關閉 HTTP 伺服器
  server.close(() => {
    Logger.info("HTTP伺服器已關閉");
    closeDatabase();
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  Logger.warn("收到SIGTERM信號，正在關閉伺服器...");

  // 關閉 WebSocket 系統
  wsServer.close();
  connectionManager.closeAll();

  // 關閉 HTTP 伺服器
  server.close(() => {
    console.log("HTTP伺服器已關閉");
    closeDatabase();
    process.exit(0);
  });
});
