/**
 * ID產生器 - 產生工作階段ID、客戶端ID和分享代碼
 */

/**
 * 產生6位大寫英數字工作階段ID
 * 格式: [A-Z0-9]{6}
 * 範例: "QX2EVX", "V0JHF3"
 */
export function generateSessionId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let sessionId = "";
  for (let i = 0; i < 6; i++) {
    sessionId += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return sessionId;
}

/**
 * 產生分頁級客戶端ID（每次重新整理產生新ID，不存localStorage）
 * 格式: D{timestamp}{random}
 * 範例: "D1736405234567ABC"
 */
export function generateClientId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `D${timestamp}${random}`;
}

/**
 * 產生6位分享代碼（5位數字 + 1位校驗碼）
 * 格式: [0-9]{6}
 * 範例: "123456"
 *
 * @param {Function} calculateChecksum - 校驗碼計算函數
 * @returns {string} 完整的6位分享代碼
 */
export function generateShareCode(calculateChecksum) {
  // 產生5位數字（10000-99999）
  const baseCode = Math.floor(10000 + Math.random() * 90000).toString();

  // 計算並附加1位校驗碼
  const checksum = calculateChecksum(baseCode);

  return baseCode + checksum;
}

/**
 * 產生實驗ID（含日期與隨機碼）
 * 格式: EXP{YYYYMMDD}{4位隨機大寫英數字}
 * 範例: "EXP20260109ABCD"
 */
export function generateExperimentId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const dateStr = `${year}${month}${day}`;

  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let randomStr = "";
  for (let i = 0; i < 4; i++) {
    randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return `EXP${dateStr}${randomStr}`;
}
