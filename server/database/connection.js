/**
 * 資料庫連線管理 - 使用Node.js內建的node:sqlite模組
 */
import { DatabaseSync } from "node:sqlite";
import { DATABASE_CONFIG } from "../config/database.js";
import { Logger } from "../utils/logger.js";

let dbInstance = null;

/**
 * 初始化並取得資料庫實例（單例模式）
 */
export function getDatabase() {
  if (dbInstance) {
    return dbInstance;
  }

  try {
    // 建立資料庫連線
    const db = new DatabaseSync(DATABASE_CONFIG.path);

    // 設定WAL模式
    if (DATABASE_CONFIG.options.enableWAL) {
      db.exec("PRAGMA journal_mode = WAL;");
    }

    // 設定同步模式
    db.exec(`PRAGMA synchronous = ${DATABASE_CONFIG.options.synchronous};`);

    // 設定快取大小
    db.exec(`PRAGMA cache_size = ${DATABASE_CONFIG.options.cacheSize};`);

    // 啟用外鍵約束
    if (DATABASE_CONFIG.options.foreignKeys) {
      db.exec("PRAGMA foreign_keys = ON;");
    }

    // 設定WAL自動checkpoint
    if (DATABASE_CONFIG.options.walAutoCheckpoint) {
      db.exec(
        `PRAGMA wal_autocheckpoint = ${DATABASE_CONFIG.options.walAutoCheckpoint};`,
      );
    }

    Logger.success(`資料庫連線成功 | ${DATABASE_CONFIG.path}`);

    dbInstance = db;
    return db;
  } catch (error) {
    Logger.error("資料庫連線失敗:", error.message);
    throw error;
  }
}

/**
 * 執行查詢並回傳所有結果
 * @param {string} sql - SQL查詢語句
 * @param {Array} params - 參數化查詢的參數
 * @returns {Array} 查詢結果數組
 */
export function query(sql, params = []) {
  const db = getDatabase();
  try {
    const stmt = db.prepare(sql);
    const results = stmt.all(...params);
    return results;
  } catch (error) {
    console.error("查詢執行失敗:", error.message, "\nSQL:", sql);
    throw error;
  }
}

/**
 * 執行查詢並回傳第一行結果
 * @param {string} sql - SQL查詢語句
 * @param {Array} params - 參數化查詢的參數
 * @returns {Object|null} 查詢結果（單行）或null
 */
export function queryOne(sql, params = []) {
  const db = getDatabase();
  try {
    const stmt = db.prepare(sql);
    const result = stmt.get(...params);
    return result || null;
  } catch (error) {
    console.error("查詢執行失敗:", error.message, "\nSQL:", sql);
    throw error;
  }
}

/**
 * 執行INSERT/UPDATE/DELETE操作
 * @param {string} sql - SQL語句
 * @param {Array} params - 參數化查詢的參數
 * @returns {Object} { changes, lastInsertRowid }
 */
export function execute(sql, params = []) {
  const db = getDatabase();
  try {
    const stmt = db.prepare(sql);
    const info = stmt.run(...params);
    return {
      changes: info.changes,
      lastInsertRowid: info.lastInsertRowid,
    };
  } catch (error) {
    console.error("執行失敗:", error.message, "\nSQL:", sql);
    throw error;
  }
}

/**
 * 關閉資料庫連線
 */
export function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    Logger.info("資料庫連線已關閉");
  }
}
