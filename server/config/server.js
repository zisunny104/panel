/**
 * 伺服器設定
 */
import dotenv from "dotenv";
import os from "os";

// 載入環境變數
dotenv.config();

export const SERVER_CONFIG = {
  // 環境設定
  nodeEnv: process.env.NODE_ENV || "development",

  // 伺服器設定
  port: parseInt(process.env.PORT || "7645", 10),
  host: process.env.HOST || "0.0.0.0",
  displayHost: process.env.DISPLAY_HOST || os.hostname(),

  // CORS設定
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
  },

  // WebSocket設定
  websocket: {
    heartbeatInterval: parseInt(
      process.env.WS_HEARTBEAT_INTERVAL || "30000",
      10,
    ),
    heartbeatTimeout: parseInt(process.env.WS_HEARTBEAT_TIMEOUT || "60000", 10),
    // Rate limiting for incoming messages (tokens)
    // 說明：每個連線有獨立 token bucket，用以限制單一連線的速率
    // - capacity：突發可用 token 數
    // - refillPerSec：每秒補回的 token 數（長期平均速率）
    // - violationThreshold：違規次數達此值則會關閉該連線
    rateLimit: {
      // 預設值（已微調為較保守設定，適合 100~300 連線常態）：
      // - capacity: 突發容錯（短時間 burst 容許的最大 token），
      // - refillPerSec: 長期平均速率（每秒補回 token），
      // - violationThreshold: 違規次數達此值則關閉該連線
      capacity: parseInt(process.env.WS_RATE_LIMIT_CAPACITY || "20", 10),
      refillPerSec: parseInt(
        process.env.WS_RATE_LIMIT_REFILL_PER_SEC || "10",
        10,
      ),
      violationThreshold: parseInt(
        process.env.WS_RATE_LIMIT_VIOLATION_THRESHOLD || "5",
        10,
      ),
    },
    // Interval for low-frequency session validation (ms)
    // 說明：較高成本的 session 驗證（例如查 DB 是否仍有效）應以此排程處理，
    // 避免心跳時直接查 DB 導致高頻 I/O。
    sessionValidationInterval: parseInt(
      process.env.WS_SESSION_VALIDATION_INTERVAL || "300000",
      10,
    ),
  },

  // 工作階段設定
  session: {
    timeout: parseInt(process.env.SESSION_TIMEOUT || "1800", 10),
    inactiveTimeout: parseInt(process.env.INACTIVE_TIMEOUT || "600", 10),
    maxClients: parseInt(process.env.MAX_CLIENTS || "6", 10),
  },

  // 分享代碼設定
  shareCode: {
    timeout: parseInt(process.env.SHARE_CODE_TIMEOUT || "300", 10),
  },

  // 清理設定
  cleanup: {
    interval: parseInt(process.env.CLEANUP_INTERVAL || "120000", 10),
  },

  // 日誌設定
  log: {
    level: process.env.LOG_LEVEL || "info",
  },
};

/**
 * 從 config.json 讀取業務設定
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let businessConfig = null;

export function loadBusinessConfigSync() {
  if (businessConfig) return businessConfig;

  try {
    const configPath = resolve(__dirname, "../../data/config.json");
    const configData = readFileSync(configPath, "utf-8");
    businessConfig = JSON.parse(configData);

    console.log("業務設定載入成功");
    return businessConfig;
  } catch (error) {
    console.error("載入 config.json 失敗:", error.message);
    // 回傳預設設定
    return {
      multiScreenSync: {
        validCreateCode: "113151006",
        maxClients: 6,
        enableSync: true,
      },
    };
  }
}

/**
 * 取得驗證碼 (從 config.json)
 */
export function getValidCreateCode() {
  const config = businessConfig || loadBusinessConfigSync();
  return config.multiScreenSync?.validCreateCode || "113151006";
}
