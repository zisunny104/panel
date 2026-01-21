/**
 * 資料庫結構驗證 - 確保所有必要的表存在
 */
import { getDatabase } from "./connection.js";
import { Logger } from "../utils/logger.js";

/**
 * 資料表建立語句
 */
const TABLE_SCHEMAS = {
  sessions: `
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      data TEXT DEFAULT '{}',
      is_active INTEGER DEFAULT 1
    )
  `,
  share_codes: `
    CREATE TABLE share_codes (
      code TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER DEFAULT 0,
      checksum_valid INTEGER DEFAULT 1,
      single_use INTEGER DEFAULT 0,
      data TEXT DEFAULT '{}'
    )
  `,
  experiment_ids: `
    CREATE TABLE experiment_ids (
      id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      data TEXT DEFAULT '{}'
    )
  `,
  state_updates: `
    CREATE TABLE state_updates (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      state_type TEXT NOT NULL,
      state_data TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `,
};

/**
 * 建立資料表
 */
function createTable(tableName) {
  const db = getDatabase();
  const schema = TABLE_SCHEMAS[tableName];

  if (!schema) {
    throw new Error(`未知的資料表: ${tableName}`);
  }

  try {
    db.exec(schema);
    Logger.success(`資料表已建立: ${tableName}`);
  } catch (error) {
    Logger.error(`建立資料表失敗 ${tableName}:`, error.message);
    throw error;
  }
}

/**
 * 驗證資料庫結構
 */
export function validateSchema() {
  const db = getDatabase();

  const requiredTables = [
    "sessions",
    "share_codes",
    "experiment_ids",
    "state_updates",
  ];

  try {
    for (const tableName of requiredTables) {
      const result = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(tableName);

      if (!result) {
        Logger.warn(`資料表不存在，正在建立: ${tableName}`);
        createTable(tableName);
      }
    }

    Logger.success("資料庫結構驗證通過");
    return true;
  } catch (error) {
    Logger.error("資料庫結構驗證失敗:", error.message);
    throw error;
  }
}

/**
 * 取得資料表資訊
 */
export function getTableInfo(tableName) {
  const db = getDatabase();
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns;
}
