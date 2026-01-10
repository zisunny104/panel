/**
 * 校驗碼計算工具 - 用於分享代碼驗證（6位純數字）
 */

/**
 * 計算1位校驗碼（基於 Luhn 演算法變體）
 *
 * @param {string} baseCode - 基礎代碼（5位數字）
 * @returns {string} 1位校驗碼（數字 0-9）
 */
export function calculateChecksum(baseCode) {
  if (baseCode.length !== 5 || !/^\d{5}$/.test(baseCode)) {
    throw new Error("基礎代碼必須為5位數字");
  }

  // 使用 Luhn 演算法變體計算校驗碼
  let sum = 0;
  for (let i = 0; i < baseCode.length; i++) {
    let digit = parseInt(baseCode[i]);

    // 從右到左，偶數位置（從1開始計數）數字乘以2
    if ((baseCode.length - i) % 2 === 0) {
      digit *= 2;
      // 如果結果大於9，將兩位數相加
      if (digit > 9) {
        digit = Math.floor(digit / 10) + (digit % 10);
      }
    }

    sum += digit;
  }

  // 計算校驗碼：(10 - (sum % 10)) % 10
  const checksum = (10 - (sum % 10)) % 10;

  return checksum.toString();
}

/**
 * 驗證分享代碼的校驗碼
 *
 * @param {string} fullCode - 完整的6位分享代碼
 * @returns {boolean} 校驗碼是否正確
 */
export function validateChecksum(fullCode) {
  if (fullCode.length !== 6 || !/^\d{6}$/.test(fullCode)) {
    return false;
  }

  const baseCode = fullCode.substring(0, 5);
  const providedChecksum = fullCode.substring(5, 6);
  const calculatedChecksum = calculateChecksum(baseCode);

  return providedChecksum === calculatedChecksum;
}
