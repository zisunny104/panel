/**
 * 伺服器設定
 */
import dotenv from "dotenv";

// 載入環境變數
dotenv.config();

export const SERVER_CONFIG = {
  // 環境設定
  nodeEnv: process.env.NODE_ENV || "development",

  // 伺服器設定
  port: parseInt(process.env.PORT || "7645", 10),
  host: process.env.HOST || "0.0.0.0",

  // CORS設定
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
  },

  // WebSocket設定
  websocket: {
    heartbeatInterval: parseInt(
      process.env.WS_HEARTBEAT_INTERVAL || "30000",
      10
    ),
    heartbeatTimeout: parseInt(process.env.WS_HEARTBEAT_TIMEOUT || "60000", 10),
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
    // 返回預設設定
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
 * 獲取驗證碼 (從 config.json)
 */
export function getValidCreateCode() {
  const config = businessConfig || loadBusinessConfigSync();
  return config.multiScreenSync?.validCreateCode || "113151006";
}
