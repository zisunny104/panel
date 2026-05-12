/**
 * ID產生器 - 產生工作階段ID、客戶端ID和分享代碼
 * 使用 crypto.randomInt / crypto.randomBytes 確保密碼學安全隨機性
 */
import { randomInt, randomBytes } from "node:crypto";

const ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomAlphanum(length) {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += ALPHANUM[randomInt(ALPHANUM.length)];
  }
  return result;
}

/**
 * 產生6位大寫英數字工作階段ID
 * 格式: [A-Z0-9]{6}
 */
export function generateSessionId() {
  return randomAlphanum(6);
}

/**
 * 產生分頁級客戶端ID
 * 格式: D{timestamp}{random-hex}
 */
export function generateClientId() {
  const timestamp = Date.now();
  const random = randomBytes(3).toString("hex").toUpperCase();
  return `D${timestamp}${random}`;
}

/**
 * 產生6位分享代碼（5位數字 + 1位校驗碼）
 * @param {Function} calculateChecksum - 校驗碼計算函數
 */
export function generateShareCode(calculateChecksum) {
  const baseCode = String(randomInt(10000, 100000));
  const checksum = calculateChecksum(baseCode);
  return baseCode + checksum;
}

/**
 * 產生實驗ID
 * 格式: 6位大寫英數字隨機碼
 */
export function generateExperimentId() {
  return randomAlphanum(6);
}
