/**
 * 工作階段服務 - 管理實驗工作階段的生命週期
 */
import { query, queryOne, execute } from "../database/connection.js";
import { generateSessionId } from "../utils/idGenerator.js";
import { getCurrentTimestamp, isExpired } from "../utils/time.js";
import { SERVER_CONFIG } from "../config/server.js";
import { SESSION_CONSTANTS, ERROR_CODES } from "../config/constants.js";

class SessionService {
  /**
   * 建立新的工作階段
   * @param {string} clientId - 客戶端ID（分頁級）
   * @returns {Object} { sessionId, clientId, created_at }
   */
  createSession(clientId) {
    const sessionId = generateSessionId();
    const id = `session_${sessionId}_${Date.now()}`;
    const created_at = getCurrentTimestamp();
    const defaultData = JSON.stringify({});

    try {
      execute(
        `INSERT INTO sessions (id, session_id, created_by, created_at, updated_at, last_active_at, data, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          sessionId,
          clientId,
          created_at,
          created_at,
          created_at,
          defaultData,
          1,
        ]
      );

      console.log(`工作階段已建立: ${sessionId} (client: ${clientId})`);

      return {
        sessionId,
        clientId,
        created_at,
      };
    } catch (error) {
      console.error("建立工作階段失敗:", error.message);
      throw new Error(ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * 查詢工作階段資訊
   * @param {string} sessionId - 工作階段ID
   * @returns {Object|null} 工作階段資料或null
   */
  getSession(sessionId) {
    try {
      const session = queryOne(`SELECT * FROM sessions WHERE session_id = ?`, [
        sessionId,
      ]);

      if (!session) {
        return null;
      }

      // 檢查是否過期
      if (isExpired(session.last_active_at, SERVER_CONFIG.session.timeout)) {
        console.log(`工作階段已過期: ${sessionId}`);
        this.deleteSession(sessionId);
        return null;
      }

      return session;
    } catch (error) {
      console.error("查詢工作階段失敗:", error.message);
      throw new Error(ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * 更新工作階段的最後活動時間
   * @param {string} sessionId - 工作階段ID
   * @returns {boolean} 是否更新成功
   */
  updateLastActive(sessionId) {
    const timestamp = getCurrentTimestamp();

    try {
      const result = execute(
        `UPDATE sessions SET updated_at = ?, last_active_at = ? WHERE session_id = ?`,
        [timestamp, timestamp, sessionId]
      );

      return result.changes > 0;
    } catch (error) {
      console.error("更新工作階段失敗:", error.message);
      throw new Error(ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * 刪除工作階段
   * @param {string} sessionId - 工作階段ID
   * @returns {boolean} 是否刪除成功
   */
  deleteSession(sessionId) {
    try {
      const result = execute(`DELETE FROM sessions WHERE session_id = ?`, [
        sessionId,
      ]);

      if (result.changes > 0) {
        console.log(`工作階段已刪除: ${sessionId}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error("刪除工作階段失敗:", error.message);
      throw new Error(ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * 清理過期的工作階段（定期執行）
   * @returns {number} 清理的工作階段數量
   */
  cleanupExpiredSessions() {
    const expirationTime =
      getCurrentTimestamp() - SERVER_CONFIG.session.timeout;

    try {
      // 1. 先找出所有過期的 session_id
      const expiredSessions = query(
        `SELECT session_id FROM sessions WHERE last_active_at < ?`,
        [expirationTime]
      );

      if (expiredSessions.length === 0) {
        return 0;
      }

      const sessionIds = expiredSessions.map((s) => s.session_id);
      const placeholders = sessionIds.map(() => "?").join(",");

      // 2. 刪除相關的 state_updates（如果有）
      try {
        execute(
          `DELETE FROM state_updates WHERE session_id IN (${placeholders})`,
          sessionIds
        );
      } catch (error) {
        // state_updates 表可能不存在或為空，忽略錯誤
        console.log("清理 state_updates 略過:", error.message);
      }

      // 3. 刪除相關的 share_codes
      execute(
        `DELETE FROM share_codes WHERE session_id IN (${placeholders})`,
        sessionIds
      );

      // 4. 最後刪除 sessions
      const result = execute(
        `DELETE FROM sessions WHERE session_id IN (${placeholders})`,
        sessionIds
      );

      if (result.changes > 0) {
        console.log(`[清理] 已清除 ${result.changes} 個過期工作階段`);
      }

      return result.changes;
    } catch (error) {
      console.error("清理工作階段失敗:", error.message);
      throw new Error(ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * 取得所有活動中的工作階段
   * @returns {Array} 活動中工作階段列表
   */
  getActiveSessions() {
    const expirationTime =
      getCurrentTimestamp() - SERVER_CONFIG.session.timeout;

    try {
      const sessions = query(
        `SELECT * FROM sessions WHERE last_active_at >= ? AND is_active = 1 ORDER BY created_at DESC`,
        [expirationTime]
      );

      return sessions;
    } catch (error) {
      console.error("查詢活動中工作階段失敗:", error.message);
      throw new Error(ERROR_CODES.DATABASE_ERROR);
    }
  }
}

// 匯出單例
export default new SessionService();
