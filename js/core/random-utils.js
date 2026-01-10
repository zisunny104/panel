/**
 * 隨機化工具模組
 * 提供可重現的隨機化功能，確保相同的種子產生相同的隨機序列
 */

/**
 * 基於種子建立可重現的隨機數產生器
 * @param {string|number} seed - 種子值（可以是字串或數字）
 * @returns {Function} 回傳一個隨機數產生函數（回傳 0-1 之間的數字）
 */
function createSeededRandom(seed) {
  // 將字串種子轉換為數字種子
  let numericSeed = 0;
  if (typeof seed === "string") {
    for (let i = 0; i < seed.length; i++) {
      numericSeed =
        ((numericSeed << 5) - numericSeed + seed.charCodeAt(i)) & 0xffffffff;
    }
  } else {
    numericSeed = seed || 0;
  }

  // 使用線性同餘產生器 (LCG)
  return function () {
    numericSeed = (numericSeed * 1664525 + 1013904223) & 0xffffffff;
    return (numericSeed >>> 0) / 4294967296;
  };
}

/**
 * 使用 Fisher-Yates 演算法洗牌陣列
 * @param {Array} array - 要洗牌的陣列
 * @param {Function} randomFunc - 隨機數產生函數
 * @returns {Array} 洗牌後的新陣列（不修改原陣列）
 */
function shuffleArray(array, randomFunc) {
  const result = [...array]; // 建立副本
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(randomFunc() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 處理組合單元的隨機化邏輯
 * @param {Object} combination - 組合物件
 * @param {string} experimentId - 實驗ID（用作種子）
 * @returns {Array} 排序後的單元ID列表
 */
function getCombinationUnitIds(combination, experimentId = null) {
  let unitIds = [];

  // console.log("[RandomUtils] 處理組合:", {
  //   combination_id: combination.combination_id,
  //   is_randomizable: combination.is_randomizable,
  //   experimentId: experimentId,
  // });

  if (Array.isArray(combination.units)) {
    // 簡單陣列格式
    unitIds = combination.units;
    // console.log("[RandomUtils] 簡單陣列格式，單元:", unitIds);
  } else if (combination.units && typeof combination.units === "object") {
    // 複雜格式（隨機化）
    // console.log("[RandomUtils] 複雜格式:", {
    //   randomizable: combination.units.randomizable,
    //   fixed: combination.units.fixed,
    // });

    if (combination.is_randomizable && combination.units.randomizable) {
      const seed = experimentId || "default";
      const seededRandom = createSeededRandom(seed);
      const randomized = shuffleArray(
        [...combination.units.randomizable],
        seededRandom
      );
      unitIds = randomized;
      // console.log("[RandomUtils] 隨機化後:", unitIds);
    } else if (combination.units.randomizable) {
      // 非隨機化，直接使用 randomizable 的順序
      unitIds = [...combination.units.randomizable];
      // console.log("[RandomUtils] 非隨機，直接使用:", unitIds);
    }

    // 處理 fixed 單元
    if (combination.units.fixed) {
      // console.log("[RandomUtils] 處理 fixed 單元前:", unitIds);

      // 分類處理以確保順序正確
      const fixedFirst = [];
      const fixedLast = [];
      const fixedOther = [];

      combination.units.fixed.forEach((fixed) => {
        if (fixed.position === "first") {
          fixedFirst.push(fixed.unit_id);
        } else if (fixed.position === "last") {
          fixedLast.push(fixed.unit_id);
        } else {
          fixedOther.push(fixed.unit_id);
        }
      });

      // console.log("[RandomUtils] Fixed 分類:", {
      //   first: fixedFirst,
      //   other: fixedOther,
      //   last: fixedLast,
      // });

      // 組合: first + 原本的 + other + last
      unitIds = [...fixedFirst, ...unitIds, ...fixedOther, ...fixedLast];
      // console.log("[RandomUtils] 處理 fixed 單元後:", unitIds);
    }
  }

  // console.log("[RandomUtils] 最終單元列表:", unitIds);
  return unitIds;
}

/**
 * 產生新的實驗ID（6位字母數字隨機字串）
 * @returns {string} 產生的實驗ID
 */
function generateNewExperimentId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 匯出函數供其他模組使用
export const RandomUtils = {
  createSeededRandom,
  shuffleArray,
  getCombinationUnitIds,
  generateNewExperimentId,
};

// 保持向後相容的全域物件
window.RandomUtils = RandomUtils;
