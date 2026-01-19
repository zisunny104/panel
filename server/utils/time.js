/**
 * 時間工具函數
 */

/**
 * 取得目前時間戳（秒）
 * @returns {number} Unix時間戳（秒）
 */
export function getCurrentTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 判斷時間戳是否過期
 *
 * @param {number} timestamp - 要檢查的時間戳（秒）
 * @param {number} timeoutSeconds - 超時時長（秒）
 * @returns {boolean} 是否已過期
 */
export function isExpired(timestamp, timeoutSeconds) {
  const currentTime = getCurrentTimestamp();
  return currentTime - timestamp > timeoutSeconds;
}

/**
 * 格式化時間戳為ISO字符串
 * @param {number} timestamp - Unix時間戳（秒）
 * @returns {string} ISO 8601格式字符串
 */
export function formatTimestamp(timestamp) {
  return new Date(timestamp * 1000).toISOString();
}
