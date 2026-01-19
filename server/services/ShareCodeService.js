/**
 * 分享代碼服務 - 管理分享代碼的產生、驗證和過期
 */
import { query, queryOne, execute } from "../database/connection.js";
import { generateShareCode } from "../utils/idGenerator.js";
import { calculateChecksum, validateChecksum } from "../utils/checksum.js";
import { getCurrentTimestamp, isExpired } from "../utils/time.js";
import { SERVER_CONFIG } from "../config/server.js";
import { SHARE_CODE_CONSTANTS, ERROR_CODES } from "../config/constants.js";

class ShareCodeService {
  /**
   * 產生新的分享代碼
   * @param {string} sessionId - 工作階段ID
   * @param {string} clientId - 客戶端ID
   * @returns {Object} { share_code, session_id, expires_at }
   */
  generateCode(sessionId, clientId) {
    const share_code = generateShareCode(calculateChecksum);
    const created_at = getCurrentTimestamp();
    const expires_at = created_at + SERVER_CONFIG.shareCode.timeout;
    const defaultData = JSON.stringify({});

    try {
      execute(
        `INSERT INTO share_codes (code, session_id, created_by, created_at, expires_at, used, checksum_valid, single_use, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          share_code,
          sessionId,
          clientId,
          created_at,
          expires_at,
          0,
          1,
          1,
          defaultData,
        ]
      );

      console.log(`分享代碼已產生: ${share_code} (session: ${sessionId})`);

      return {
        share_code,
        session_id: sessionId,
        created_at,
        expires_at,
      };
    } catch (error) {
      console.error("產生分享代碼失敗:", error.message);
      throw new Error(ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * 驗證分享代碼並取得對應的工作階段
   * @param {string} shareCode - 8位分享代碼
   * @returns {Object|null} { session_id } 或錯誤對象
   */
  validateCode(shareCode) {
    // 格式驗證
    if (shareCode.length !== SHARE_CODE_CONSTANTS.LENGTH) {
      return { error: ERROR_CODES.INVALID_SHARE_CODE };
    }

    // 校驗碼驗證
    if (!validateChecksum(shareCode)) {
      return { error: ERROR_CODES.INVALID_SHARE_CODE };
    }

    try {
      const codeData = queryOne(`SELECT * FROM share_codes WHERE code = ?`, [
        shareCode,
      ]);

      if (!codeData) {
        return { error: ERROR_CODES.SHARE_CODE_NOT_FOUND };
      }

      // 檢查是否過期
      if (isExpired(codeData.created_at, SERVER_CONFIG.shareCode.timeout)) {
        console.log(`分享代碼已過期: ${shareCode}`);
        this.deleteCode(shareCode);
        return { error: ERROR_CODES.SHARE_CODE_EXPIRED };
      }

      // 檢查是否已使用
      if (codeData.used === 1) {
        return { error: ERROR_CODES.SHARE_CODE_NOT_FOUND };
      }

      return {
        session_id: codeData.session_id,
        created_at: codeData.created_at,
        expires_at: codeData.expires_at,
      };
    } catch (error) {
      console.error("驗證分享代碼失敗:", error.message);
      throw new Error(ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * 取得分享代碼資訊（不進行驗證，只回傳狀態）
   * @param {string} shareCode - 8位分享代碼
   * @returns {Object} { session_id, expired, used, expires_at, created_at } 或錯誤對象
   */
  getCodeInfo(shareCode) {
    // 格式驗證
    if (shareCode.length !== SHARE_CODE_CONSTANTS.LENGTH) {
      return { error: ERROR_CODES.INVALID_SHARE_CODE };
    }

    // 校驗碼驗證
    if (!validateChecksum(shareCode)) {
      return { error: ERROR_CODES.INVALID_SHARE_CODE };
    }

    try {
      const codeData = queryOne(`SELECT * FROM share_codes WHERE code = ?`, [
        shareCode,
      ]);

      if (!codeData) {
        return { error: ERROR_CODES.SHARE_CODE_NOT_FOUND };
      }

      // 檢查是否過期
      const expired = isExpired(
        codeData.created_at,
        SERVER_CONFIG.shareCode.timeout
      );

      return {
        session_id: codeData.session_id,
        expired: expired,
        used: codeData.used === 1,
        expires_at: codeData.expires_at,
        created_at: codeData.created_at,
      };
    } catch (error) {
      console.error("取得分享代碼資訊失敗:", error.message);
      throw new Error(ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * @param {string} shareCode - 分享代碼
   * @param {string} usedBy - 使用者的客戶端ID
   * @returns {boolean} 是否標記成功
   */
  markAsUsed(shareCode, usedBy) {
    const used_at = getCurrentTimestamp();

    try {
      const result = execute(
        `UPDATE share_codes SET used = 1, used_by = ?, used_at = ? WHERE code = ?`,
        [usedBy, used_at, shareCode]
      );

      if (result.changes > 0) {
        console.log(`分享代碼已使用: ${shareCode} (by: ${usedBy})`);
        return true;
      }

      return false;
    } catch (error) {
      console.error("標記分享代碼失敗:", error.message);
      throw new Error(ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * 刪除分享代碼
   * @param {string} shareCode - 分享代碼
   * @returns {boolean} 是否刪除成功
   */
  deleteCode(shareCode) {
    try {
      const result = execute(`DELETE FROM share_codes WHERE code = ?`, [
        shareCode,
      ]);

      return result.changes > 0;
    } catch (error) {
      console.error("刪除分享代碼失敗:", error.message);
      throw new Error(ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * 清理過期的分享代碼（定期執行）
   * @returns {number} 清理的代碼數量
   */
  cleanupExpiredCodes() {
    const expirationTime =
      getCurrentTimestamp() - SERVER_CONFIG.shareCode.timeout;

    try {
      const result = execute(`DELETE FROM share_codes WHERE created_at < ?`, [
        expirationTime,
      ]);

      if (result.changes > 0) {
        console.log(`[清理] 已清除 ${result.changes} 個過期分享代碼`);
      }

      return result.changes;
    } catch (error) {
      console.error("清理分享代碼失敗:", error.message);
      throw new Error(ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * 取得工作階段的所有分享代碼
   * @param {string} sessionId - 工作階段ID
   * @returns {Array} 分享代碼列表
   */
  getCodesBySession(sessionId) {
    try {
      const codes = query(
        `SELECT * FROM share_codes WHERE session_id = ? ORDER BY created_at DESC`,
        [sessionId]
      );

      return codes;
    } catch (error) {
      console.error("查詢分享代碼失敗:", error.message);
      throw new Error(ERROR_CODES.DATABASE_ERROR);
    }
  }
}

// 匯出單例
export default new ShareCodeService();
