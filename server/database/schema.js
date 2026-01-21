/**
 * 資料庫結構驗證 - 確保所有必要的表存在
 */
import { getDatabase } from "./connection.js";
import { Logger } from "../utils/logger.js";

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
        throw new Error(`缺少必要的資料表: ${tableName}`);
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
