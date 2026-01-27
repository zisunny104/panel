/**
 * 輕量級測試框架
 * 專為 panel 專案的重構測試設計
 */

class TestUtils {
  constructor() {
    this.tests = [];
    this.currentSuite = null;
    this.results = {
      total: 0,
      passed: 0,
      failed: 0,
      errors: []
    };
  }

  /**
   * 定義測試套件
   * @param {string} description - 測試套件描述
   * @param {Function} callback - 包含測試案例的函數
   */
  describe(description, callback) {
    const suite = {
      description,
      tests: []
    };
    this.currentSuite = suite;
    this.tests.push(suite);
    callback();
    this.currentSuite = null;
  }

  /**
   * 定義單個測試案例
   * @param {string} description - 測試案例描述
   * @param {Function} callback - 測試函數
   */
  it(description, callback) {
    if (!this.currentSuite) {
      throw new Error('it() must be called within describe()');
    }
    this.currentSuite.tests.push({
      description,
      callback
    });
  }

  /**
   * 斷言工具
   */
  assert = {
    /**
     * 斷言兩個值相等
     */
    equal(actual, expected, message = '') {
      if (actual !== expected) {
        throw new Error(
          message || `Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`
        );
      }
    },

    /**
     * 深度比較兩個物件
     */
    deepEqual(actual, expected, message = '') {
      const actualStr = JSON.stringify(actual);
      const expectedStr = JSON.stringify(expected);
      if (actualStr !== expectedStr) {
        throw new Error(
          message || `Expected ${expectedStr}, but got ${actualStr}`
        );
      }
    },

    /**
     * 斷言值為真
     */
    ok(value, message = '') {
      if (!value) {
        throw new Error(message || `Expected truthy value, but got ${value}`);
      }
    },

    /**
     * 斷言值為假
     */
    notOk(value, message = '') {
      if (value) {
        throw new Error(message || `Expected falsy value, but got ${value}`);
      }
    },

    /**
     * 斷言函數會拋出錯誤
     */
    throws(fn, expectedError, message = '') {
      try {
        fn();
        throw new Error(message || 'Expected function to throw an error');
      } catch (error) {
        if (expectedError) {
          if (typeof expectedError === 'string') {
            if (!error.message.includes(expectedError)) {
              throw new Error(
                `Expected error message to include "${expectedError}", but got "${error.message}"`
              );
            }
          } else if (expectedError instanceof RegExp) {
            if (!expectedError.test(error.message)) {
              throw new Error(
                `Expected error message to match ${expectedError}, but got "${error.message}"`
              );
            }
          }
        }
      }
    },

    /**
     * 斷言陣列或字串包含特定值
     */
    includes(container, value, message = '') {
      const contains = Array.isArray(container)
        ? container.includes(value)
        : typeof container === 'string'
        ? container.includes(value)
        : false;
      
      if (!contains) {
        throw new Error(
          message || `Expected ${JSON.stringify(container)} to include ${JSON.stringify(value)}`
        );
      }
    },

    /**
     * 斷言值的類型
     */
    typeOf(value, expectedType, message = '') {
      const actualType = typeof value;
      if (actualType !== expectedType) {
        throw new Error(
          message || `Expected type ${expectedType}, but got ${actualType}`
        );
      }
    },

    /**
     * 斷言值是特定類別的實例
     */
    instanceOf(value, expectedClass, message = '') {
      if (!(value instanceof expectedClass)) {
        throw new Error(
          message || `Expected instance of ${expectedClass.name}, but got ${value.constructor.name}`
        );
      }
    }
  };

  /**
   * 建立 mock 物件
   * @param {Object} methods - 要模擬的方法
   * @returns {Object} mock 物件
   */
  mock(methods = {}) {
    const mockObj = {};
    const calls = {};

    Object.keys(methods).forEach(key => {
      calls[key] = [];
      mockObj[key] = (...args) => {
        calls[key].push(args);
        return methods[key](...args);
      };
    });

    mockObj._calls = calls;
    mockObj._reset = () => {
      Object.keys(calls).forEach(key => {
        calls[key] = [];
      });
    };

    return mockObj;
  }

  /**
   * 建立 spy 函數
   * @param {Function} fn - 要監視的函數
   * @returns {Function} spy 函數
   */
  spy(fn = () => {}) {
    const calls = [];
    const spyFn = (...args) => {
      calls.push(args);
      return fn(...args);
    };
    spyFn.calls = calls;
    spyFn.callCount = () => calls.length;
    spyFn.calledWith = (...expectedArgs) => {
      return calls.some(callArgs => 
        JSON.stringify(callArgs) === JSON.stringify(expectedArgs)
      );
    };
    spyFn.reset = () => {
      calls.length = 0;
    };
    return spyFn;
  }

  /**
   * 等待條件成立
   * @param {Function} condition - 條件函數
   * @param {number} timeout - 超時時間（毫秒）
   * @param {number} interval - 檢查間隔（毫秒）
   */
  async waitFor(condition, timeout = 5000, interval = 100) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (condition()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error(`Timeout waiting for condition after ${timeout}ms`);
  }

  /**
   * 延遲執行
   * @param {number} ms - 延遲時間（毫秒）
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 執行所有測試
   * @param {string} filterPhase - 可選的階段過濾器（如 'Phase 2'）
   */
  async run(filterPhase = null) {
    this.results = {
      total: 0,
      passed: 0,
      failed: 0,
      errors: []
    };

    console.log('='.repeat(60));
    console.log('開始執行測試...');
    console.log('='.repeat(60));

    for (const suite of this.tests) {
      // 如果有過濾條件，檢查是否符合
      if (filterPhase && !suite.description.includes(filterPhase)) {
        continue;
      }

      console.log(`\n${suite.description}`);
      
      for (const test of suite.tests) {
        this.results.total++;
        try {
          await test.callback();
          this.results.passed++;
          console.log(`  ✓ ${test.description}`);
        } catch (error) {
          this.results.failed++;
          this.results.errors.push({
            suite: suite.description,
            test: test.description,
            error: error.message
          });
          console.error(`  ✗ ${test.description}`);
          console.error(`    錯誤: ${error.message}`);
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('測試結果總結');
    console.log('='.repeat(60));
    console.log(`總測試數: ${this.results.total}`);
    console.log(`通過: ${this.results.passed}`);
    console.log(`失敗: ${this.results.failed}`);
    console.log(`成功率: ${((this.results.passed / this.results.total) * 100).toFixed(2)}%`);
    console.log('='.repeat(60));

    return this.results;
  }

  /**
   * 重置測試狀態
   */
  reset() {
    this.tests = [];
    this.currentSuite = null;
    this.results = {
      total: 0,
      passed: 0,
      failed: 0,
      errors: []
    };
  }
}

// 建立全域實例
const testUtils = new TestUtils();

// 導出便利函數
const describe = testUtils.describe.bind(testUtils);
const it = testUtils.it.bind(testUtils);
const assert = testUtils.assert;
const mock = testUtils.mock.bind(testUtils);
const spy = testUtils.spy.bind(testUtils);
const waitFor = testUtils.waitFor.bind(testUtils);
const delay = testUtils.delay.bind(testUtils);

// 如果在瀏覽器環境中，掛載到 window
if (typeof window !== 'undefined') {
  window.TestUtils = testUtils;
  window.describe = describe;
  window.it = it;
  window.assert = assert;
  window.mock = mock;
  window.spy = spy;
  window.waitFor = waitFor;
  window.delay = delay;
}

// 如果在 Node.js 環境中，導出模組
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TestUtils,
    testUtils,
    describe,
    it,
    assert,
    mock,
    spy,
    waitFor,
    delay
  };
}
