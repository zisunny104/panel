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

// 設定信任代理（支援 Nginx 反向代理）
app.set("trust proxy", true);

// 建立 HTTP 伺服器（用於 WebSocket 升級）
const httpServer = createServer(app);

// ===== 中間件設定 =====
app.use(cors(SERVER_CONFIG.cors));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 自動取得完整網址 middleware
app.use((req, res, next) => {
  // 利用 req.protocol 和 req.get('host') 自動組裝完整網址
  const protocol = req.protocol;
  const host = req.get("host");
  req.fullUrl = `${protocol}://${host}${req.originalUrl}`;
  req.baseUrl = `${protocol}://${host}`; // 基礎 URL（不含路徑）
  next();
});

// 請求日誌
app.use((req, res, next) => {
  // 過濾掉 HEAD 請求（心跳檢測），減少日誌噪音
  if (req.method !== "HEAD") {
    Logger.http(req.method, req.path);
  }
  next();
});

// ===== 靜態檔案服務 (前端) =====
const publicPath = path.join(__dirname, "..");
Logger.info("初始化靜態檔案服務");
Logger.debug(`靜態檔案路徑: <cyan>${publicPath}</cyan>`);
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
    fullUrl: req.fullUrl, // 測試自動取得的完整網址
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

Logger.info("初始化清理任務");

setInterval(() => {
  try {
    SessionService.cleanupExpiredSessions();
    ShareCodeService.cleanupExpiredCodes();
  } catch (error) {
    Logger.error("清理任務失敗:", error.message);
  }
}, cleanupInterval);

Logger.success("清理任務已啟動");

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
  Logger.success("Panel Backend Server 已啟動");

  // 伺服器綁定在 0.0.0.0，客戶端可通過多種方式存取
  // 前端使用 window.location 自動決定實際網址，所以這裡只作為參考顯示
  Logger.info(
    `<yellow>|</yellow> 綁定網址: <dim>0.0.0.0:${SERVER_CONFIG.port}</dim>`,
  );
  Logger.info(`  HTTP      <yellow>|</yellow> <cyan>/api/*</cyan>`);
  Logger.info(
    `  WebSocket <yellow>|</yellow> <cyan>/ws</cyan> <dim>(ws://host:port/ws)</dim>`,
  );
  Logger.info(`  健康檢測  <yellow>|</yellow> <cyan>/api/health</cyan>`);
  Logger.info(
    `工作階段超時: <cyan>${SERVER_CONFIG.session.timeout}</cyan> 秒 <yellow>|</yellow> 分享代碼超時: <cyan>${SERVER_CONFIG.shareCode.timeout}</cyan> 秒`,
  );
  Logger.info(
    `心跳檢測間隔: <cyan>${SERVER_CONFIG.websocket.heartbeatInterval / 1000}</cyan> 秒 <yellow>|</yellow> 心跳檢測超時: <cyan>${SERVER_CONFIG.websocket.heartbeatTimeout / 1000}</cyan> 秒`,
  );
  Logger.info(
    `清理任務間隔: <cyan>${SERVER_CONFIG.cleanup.interval / 1000}</cyan> 秒`,
  );
  Logger.info("");
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
    Logger.info("HTTP伺服器已關閉");
    closeDatabase();
    process.exit(0);
  });
});
