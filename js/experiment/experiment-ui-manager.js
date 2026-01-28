/**
 * ExperimentUIManager - 實驗UI管理器
 * 
 * 核心職責：
 * 1. 按鈕狀態管理（啟用/禁用/鎖定）
 * 2. 視覺高亮管理（按鈕高亮、電源按鈕高亮）
 * 3. UI 元件更新（進度條、計時器、狀態指示器）
 * 4. 樣式管理（CSS class 增刪改）
 * 5. 視覺提示控制（實驗模式視覺回饋）
 * 
 * 設計模式：
 * - 事件驅動：發出 UI 更新事件
 * - 依賴注入：可注入 FlowManager
 * - 單一職責：專注於 UI 層操作
 * 
 * 向後相容性：
 * - 保留原有的 CSS class 命名
 * - 保留原有的 DOM 元素 ID
 * - 保留原有的事件名稱
 * 
 * @version 1.0.0
 * @since Phase 3 - P1 Auxiliary Modules
 */

class ExperimentUIManager {
  /**
   * 建構函式
   * @param {Object} config - 配置選項
   * @param {boolean} config.enableVisualHints - 是否啟用視覺提示 (預設: true)
   * @param {number} config.highlightDuration - 高亮持續時間 (ms, 預設: 300)
   * @param {Object} config.selectors - DOM 元素選擇器映射
   */
  constructor(config = {}) {
    // 配置選項
    this.config = {
      enableVisualHints: config.enableVisualHints ?? true,
      highlightDuration: config.highlightDuration ?? 300,
      selectors: config.selectors || {},
    };

    // 依賴注入容器
    this.dependencies = {
      flowManager: null,
    };

    // UI 狀態
    this.state = {
      visualHintsEnabled: this.config.enableVisualHints,
      highlightedButtons: new Set(),
      lockedElements: new Set(),
      hiddenElements: new Set(),
    };

    // DOM 元素快取
    this.elements = new Map();

    // 事件監聽器集合
    this.listeners = new Map();

    // 初始化標記
    this.initialized = false;

    this._log("ExperimentUIManager 已建立");
  }

  // ==========================================
  // 初始化方法
  // ==========================================

  /**
   * 初始化 UI 管理器
   */
  initialize() {
    if (this.initialized) {
      this._warn("UI 管理器已經初始化");
      return;
    }

    // 快取常用的 DOM 元素
    this._cacheCommonElements();

    // 設定事件監聽器
    this._setupEventListeners();

    this.initialized = true;
    this._log("UI 管理器初始化完成");

    this._emit("ui-manager-initialized");
  }

  /**
   * 快取常用 DOM 元素
   * @private
   */
  _cacheCommonElements() {
    const commonSelectors = {
      powerSwitchArea: "#powerSwitchArea",
      pauseIndicator: "#pauseIndicator",
      experimentTimer: "#experimentTimer",
      experimentPanel: ".experiment-panel",
      visualHintsToggle: "#toggleTouchVisuals",
    };

    Object.entries(commonSelectors).forEach(([key, selector]) => {
      const element = document.querySelector(selector);
      if (element) {
        this.elements.set(key, element);
      }
    });
  }

  /**
   * 設定事件監聽器
   * @private
   */
  _setupEventListeners() {
    // 監聽視覺提示開關變化
    const toggle = this.elements.get("visualHintsToggle");
    if (toggle) {
      const handler = (e) => {
        this.setVisualHintsEnabled(e.target.checked);
      };
      toggle.addEventListener("change", handler);
      this.listeners.set("visualHintsToggle", handler);
    }
  }

  /**
   * 依賴注入：FlowManager
   */
  injectFlowManager(flowManager) {
    if (!flowManager) {
      this._warn("注入的 FlowManager 無效");
      return;
    }

    this.dependencies.flowManager = flowManager;
    this._log("已注入 FlowManager");
  }

  // ==========================================
  // 按鈕狀態管理
  // ==========================================

  /**
   * 啟用按鈕
   * @param {string|HTMLElement} buttonOrSelector - 按鈕元素或選擇器
   */
  enableButton(buttonOrSelector) {
    const button = this._getElement(buttonOrSelector);
    if (!button) return;

    button.disabled = false;
    button.classList.remove("disabled", "experiment-disabled");
    this.state.lockedElements.delete(button);

    this._emit("button-enabled", { button, selector: buttonOrSelector });
  }

  /**
   * 禁用按鈕
   * @param {string|HTMLElement} buttonOrSelector - 按鈕元素或選擇器
   * @param {string} reason - 禁用原因（顯示在 title）
   */
  disableButton(buttonOrSelector, reason = "") {
    const button = this._getElement(buttonOrSelector);
    if (!button) return;

    button.disabled = true;
    button.classList.add("disabled");
    if (reason) {
      button.title = reason;
    }

    this._emit("button-disabled", { button, selector: buttonOrSelector, reason });
  }

  /**
   * 鎖定按鈕（實驗進行中無法操作）
   * @param {string|HTMLElement} buttonOrSelector - 按鈕元素或選擇器
   */
  lockButton(buttonOrSelector) {
    const button = this._getElement(buttonOrSelector);
    if (!button) return;

    button.disabled = true;
    button.classList.add("experiment-disabled");
    this.state.lockedElements.add(button);

    this._emit("button-locked", { button, selector: buttonOrSelector });
  }

  /**
   * 解鎖按鈕
   * @param {string|HTMLElement} buttonOrSelector - 按鈕元素或選擇器
   */
  unlockButton(buttonOrSelector) {
    const button = this._getElement(buttonOrSelector);
    if (!button) return;

    button.disabled = false;
    button.classList.remove("experiment-disabled");
    this.state.lockedElements.delete(button);

    this._emit("button-unlocked", { button, selector: buttonOrSelector });
  }

  /**
   * 批量啟用按鈕
   * @param {Array<string|HTMLElement>} buttons - 按鈕列表
   */
  enableButtons(buttons) {
    buttons.forEach((btn) => this.enableButton(btn));
  }

  /**
   * 批量禁用按鈕
   * @param {Array<string|HTMLElement>} buttons - 按鈕列表
   * @param {string} reason - 禁用原因
   */
  disableButtons(buttons, reason = "") {
    buttons.forEach((btn) => this.disableButton(btn, reason));
  }

  /**
   * 批量鎖定按鈕
   * @param {Array<string|HTMLElement>} buttons - 按鈕列表
   */
  lockButtons(buttons) {
    buttons.forEach((btn) => this.lockButton(btn));
  }

  /**
   * 批量解鎖按鈕
   * @param {Array<string|HTMLElement>} buttons - 按鈕列表
   */
  unlockButtons(buttons) {
    buttons.forEach((btn) => this.unlockButton(btn));
  }

  // ==========================================
  // 按鈕高亮管理
  // ==========================================

  /**
   * 高亮按鈕（添加視覺提示）
   * @param {string|HTMLElement} buttonOrSelector - 按鈕元素或選擇器
   * @param {string} highlightType - 高亮類型 ('primary' | 'secondary' | 'shift')
   */
  highlightButton(buttonOrSelector, highlightType = "primary") {
    if (!this.state.visualHintsEnabled) return;

    const button = this._getElement(buttonOrSelector);
    if (!button) return;

    const classList = {
      primary: "next-step-highlight",
      secondary: "next-step-highlight-secondary",
      shift: "next-step-highlight-shift",
    };

    const className = classList[highlightType] || classList.primary;
    button.classList.add(className);
    this.state.highlightedButtons.add(button);

    this._emit("button-highlighted", {
      button,
      selector: buttonOrSelector,
      highlightType,
    });
  }

  /**
   * 移除按鈕高亮
   * @param {string|HTMLElement} buttonOrSelector - 按鈕元素或選擇器
   */
  unhighlightButton(buttonOrSelector) {
    const button = this._getElement(buttonOrSelector);
    if (!button) return;

    button.classList.remove(
      "next-step-highlight",
      "next-step-highlight-secondary",
      "next-step-highlight-shift"
    );
    this.state.highlightedButtons.delete(button);

    this._emit("button-unhighlighted", { button, selector: buttonOrSelector });
  }

  /**
   * 高亮電源按鈕
   * @param {boolean} enable - 是否啟用高亮
   */
  highlightPowerButton(enable) {
    const powerSwitchArea = this.elements.get("powerSwitchArea");
    if (!powerSwitchArea) {
      this._warn("找不到電源開關區域");
      return;
    }

    if (enable && this.state.visualHintsEnabled) {
      powerSwitchArea.classList.add("next-step-highlight");
      this._emit("power-button-highlighted", { enable: true });
    } else {
      powerSwitchArea.classList.remove("next-step-highlight");
      this._emit("power-button-highlighted", { enable: false });
    }
  }

  /**
   * 高亮多個按鈕
   * @param {Array<Object>} buttonConfigs - 按鈕配置列表
   * @example highlightButtons([
   *   { selector: '.button-overlay[data-label="B1"]', type: 'primary' },
   *   { selector: '.button-overlay[data-label="B2"]', type: 'secondary' }
   * ])
   */
  highlightButtons(buttonConfigs) {
    buttonConfigs.forEach(({ selector, type }) => {
      this.highlightButton(selector, type);
    });
  }

  /**
   * 清除所有按鈕高亮
   */
  clearAllHighlights() {
    // 清除電源按鈕高亮
    const powerSwitchArea = this.elements.get("powerSwitchArea");
    if (powerSwitchArea) {
      powerSwitchArea.classList.remove("next-step-highlight");
    }

    // 清除所有一般按鈕高亮
    document.querySelectorAll(".button-overlay").forEach((btn) => {
      btn.classList.remove(
        "next-step-highlight",
        "next-step-highlight-secondary",
        "next-step-highlight-shift"
      );
    });

    this.state.highlightedButtons.clear();
    this._emit("all-highlights-cleared");
  }

  // ==========================================
  // 視覺提示控制
  // ==========================================

  /**
   * 啟用/禁用視覺提示
   * @param {boolean} enabled - 是否啟用
   */
  setVisualHintsEnabled(enabled) {
    this.state.visualHintsEnabled = enabled;

    if (enabled) {
      document.body.classList.add("visual-hints-enabled");
      this._emit("visual-hints-enabled");
    } else {
      document.body.classList.remove("visual-hints-enabled");
      this.clearAllHighlights();
      this._emit("visual-hints-disabled");
    }

    this._log(`視覺提示已${enabled ? "啟用" : "禁用"}`);
  }

  /**
   * 取得視覺提示狀態
   * @returns {boolean}
   */
  isVisualHintsEnabled() {
    return this.state.visualHintsEnabled;
  }

  /**
   * 更新高亮可見性（根據實驗狀態）
   * 此方法與舊版 updateHighlightVisibility 相容
   */
  updateHighlightVisibility() {
    const toggle = this.elements.get("visualHintsToggle");
    const showHighlight = toggle && toggle.checked;

    if (!showHighlight) {
      this.setVisualHintsEnabled(false);
      return;
    }

    this.setVisualHintsEnabled(true);

    // 發出事件讓外部模組處理具體的高亮邏輯
    this._emit("highlight-visibility-updated", { enabled: showHighlight });
  }

  // ==========================================
  // UI 元件更新
  // ==========================================

  /**
   * 更新暫停指示器
   * @param {boolean} isPaused - 是否暫停
   */
  updatePauseIndicator(isPaused) {
    const indicator = this.elements.get("pauseIndicator");
    if (!indicator) return;

    indicator.style.display = isPaused ? "block" : "none";
    indicator.textContent = isPaused ? "⏸ 暫停中" : "";

    this._emit("pause-indicator-updated", { isPaused });
  }

  /**
   * 更新計時器顯示
   * @param {string} timeText - 時間文字（如 "00:05:32"）
   */
  updateTimerDisplay(timeText) {
    const timer = this.elements.get("experimentTimer");
    if (!timer) return;

    timer.textContent = `花費時間：${timeText}`;
    this._emit("timer-display-updated", { timeText });
  }

  /**
   * 更新進度條
   * @param {number} current - 當前進度
   * @param {number} total - 總進度
   */
  updateProgressBar(current, total) {
    const percentage = total > 0 ? (current / total) * 100 : 0;
    const progressBar = document.querySelector(".experiment-progress-bar");

    if (progressBar) {
      progressBar.style.width = `${percentage}%`;
      progressBar.textContent = `${current} / ${total}`;
    }

    this._emit("progress-bar-updated", { current, total, percentage });
  }

  /**
   * 更新步驟指示器
   * @param {number} currentStep - 當前步驟索引
   * @param {number} totalSteps - 總步驟數
   */
  updateStepIndicator(currentStep, totalSteps) {
    const indicator = document.querySelector(".step-indicator");
    if (!indicator) return;

    indicator.textContent = `步驟 ${currentStep + 1} / ${totalSteps}`;
    this._emit("step-indicator-updated", { currentStep, totalSteps });
  }

  /**
   * 更新單元指示器
   * @param {number} currentUnit - 當前單元索引
   * @param {number} totalUnits - 總單元數
   * @param {string} unitName - 單元名稱
   */
  updateUnitIndicator(currentUnit, totalUnits, unitName = "") {
    const indicator = document.querySelector(".unit-indicator");
    if (!indicator) return;

    const text = unitName
      ? `單元 ${currentUnit + 1} / ${totalUnits}: ${unitName}`
      : `單元 ${currentUnit + 1} / ${totalUnits}`;

    indicator.textContent = text;
    this._emit("unit-indicator-updated", { currentUnit, totalUnits, unitName });
  }

  // ==========================================
  // 元件顯示/隱藏
  // ==========================================

  /**
   * 顯示元素
   * @param {string|HTMLElement} elementOrSelector - 元素或選擇器
   * @param {string} displayType - display 類型 (預設: 'block')
   */
  showElement(elementOrSelector, displayType = "block") {
    const element = this._getElement(elementOrSelector);
    if (!element) return;

    element.style.display = displayType;
    this.state.hiddenElements.delete(element);

    this._emit("element-shown", { element, selector: elementOrSelector });
  }

  /**
   * 隱藏元素
   * @param {string|HTMLElement} elementOrSelector - 元素或選擇器
   */
  hideElement(elementOrSelector) {
    const element = this._getElement(elementOrSelector);
    if (!element) return;

    element.style.display = "none";
    this.state.hiddenElements.add(element);

    this._emit("element-hidden", { element, selector: elementOrSelector });
  }

  /**
   * 切換元素顯示/隱藏
   * @param {string|HTMLElement} elementOrSelector - 元素或選擇器
   * @param {string} displayType - display 類型 (預設: 'block')
   */
  toggleElement(elementOrSelector, displayType = "block") {
    const element = this._getElement(elementOrSelector);
    if (!element) return;

    if (element.style.display === "none") {
      this.showElement(element, displayType);
    } else {
      this.hideElement(element);
    }
  }

  /**
   * 批量顯示元素
   * @param {Array<string|HTMLElement>} elements - 元素列表
   * @param {string} displayType - display 類型
   */
  showElements(elements, displayType = "block") {
    elements.forEach((el) => this.showElement(el, displayType));
  }

  /**
   * 批量隱藏元素
   * @param {Array<string|HTMLElement>} elements - 元素列表
   */
  hideElements(elements) {
    elements.forEach((el) => this.hideElement(el));
  }

  // ==========================================
  // CSS 類別管理
  // ==========================================

  /**
   * 添加 CSS class
   * @param {string|HTMLElement} elementOrSelector - 元素或選擇器
   * @param {string|Array<string>} classNames - class 名稱（可以是陣列）
   */
  addClass(elementOrSelector, classNames) {
    const element = this._getElement(elementOrSelector);
    if (!element) return;

    const classes = Array.isArray(classNames) ? classNames : [classNames];
    element.classList.add(...classes);

    this._emit("class-added", { element, selector: elementOrSelector, classNames });
  }

  /**
   * 移除 CSS class
   * @param {string|HTMLElement} elementOrSelector - 元素或選擇器
   * @param {string|Array<string>} classNames - class 名稱（可以是陣列）
   */
  removeClass(elementOrSelector, classNames) {
    const element = this._getElement(elementOrSelector);
    if (!element) return;

    const classes = Array.isArray(classNames) ? classNames : [classNames];
    element.classList.remove(...classes);

    this._emit("class-removed", { element, selector: elementOrSelector, classNames });
  }

  /**
   * 切換 CSS class
   * @param {string|HTMLElement} elementOrSelector - 元素或選擇器
   * @param {string} className - class 名稱
   * @param {boolean} force - 強制添加/移除
   */
  toggleClass(elementOrSelector, className, force = undefined) {
    const element = this._getElement(elementOrSelector);
    if (!element) return;

    const result = element.classList.toggle(className, force);

    this._emit("class-toggled", {
      element,
      selector: elementOrSelector,
      className,
      added: result,
    });

    return result;
  }

  /**
   * 檢查是否有某個 class
   * @param {string|HTMLElement} elementOrSelector - 元素或選擇器
   * @param {string} className - class 名稱
   * @returns {boolean}
   */
  hasClass(elementOrSelector, className) {
    const element = this._getElement(elementOrSelector);
    return element ? element.classList.contains(className) : false;
  }

  // ==========================================
  // 實驗面板控制
  // ==========================================

  /**
   * 打開實驗面板
   */
  openExperimentPanel() {
    const panel = this.elements.get("experimentPanel");
    if (panel) {
      this.showElement(panel, "block");
      this._emit("experiment-panel-opened");
    }
  }

  /**
   * 關閉實驗面板
   */
  closeExperimentPanel() {
    const panel = this.elements.get("experimentPanel");
    if (panel) {
      this.hideElement(panel);
      this._emit("experiment-panel-closed");
    }
  }

  // ==========================================
  // 按鈕動畫和視覺回饋
  // ==========================================

  /**
   * 顯示按鈕按下動畫
   * @param {string|HTMLElement} buttonOrSelector - 按鈕元素或選擇器
   */
  showButtonPressAnimation(buttonOrSelector) {
    const button = this._getElement(buttonOrSelector);
    if (!button) return;

    button.classList.add("button-pressed");

    setTimeout(() => {
      button.classList.remove("button-pressed");
    }, this.config.highlightDuration);

    this._emit("button-press-animation-shown", { button, selector: buttonOrSelector });
  }

  /**
   * 閃爍按鈕（吸引注意）
   * @param {string|HTMLElement} buttonOrSelector - 按鈕元素或選擇器
   * @param {number} times - 閃爍次數
   * @param {number} interval - 閃爍間隔 (ms)
   */
  blinkButton(buttonOrSelector, times = 3, interval = 500) {
    const button = this._getElement(buttonOrSelector);
    if (!button) return;

    let count = 0;
    const blinkInterval = setInterval(() => {
      button.classList.toggle("button-blink");
      count++;

      if (count >= times * 2) {
        clearInterval(blinkInterval);
        button.classList.remove("button-blink");
      }
    }, interval);

    this._emit("button-blink-started", { button, selector: buttonOrSelector, times });
  }

  // ==========================================
  // 輔助方法
  // ==========================================

  /**
   * 取得 DOM 元素
   * @param {string|HTMLElement} elementOrSelector - 元素或選擇器
   * @returns {HTMLElement|null}
   * @private
   */
  _getElement(elementOrSelector) {
    if (elementOrSelector instanceof HTMLElement) {
      return elementOrSelector;
    }

    if (typeof elementOrSelector === "string") {
      return document.querySelector(elementOrSelector);
    }

    this._warn("無效的元素或選擇器:", elementOrSelector);
    return null;
  }

  /**
   * 發出事件
   * @param {string} eventName - 事件名稱
   * @param {Object} data - 事件數據
   * @private
   */
  _emit(eventName, data = {}) {
    const event = new CustomEvent(`ui-manager:${eventName}`, {
      detail: data,
      bubbles: true,
    });
    window.dispatchEvent(event);
  }

  /**
   * 日誌輸出
   * @param {...any} args - 日誌參數
   * @private
   */
  _log(...args) {
    if (typeof Logger !== "undefined" && Logger.debug) {
      Logger.debug("[ExperimentUIManager]", ...args);
    }
  }

  /**
   * 警告輸出
   * @param {...any} args - 警告參數
   * @private
   */
  _warn(...args) {
    if (typeof Logger !== "undefined" && Logger.warn) {
      Logger.warn("[ExperimentUIManager]", ...args);
    } else {
      console.warn("[ExperimentUIManager]", ...args);
    }
  }

  // ==========================================
  // 事件監聽器管理
  // ==========================================

  /**
   * 監聽事件
   * @param {string} eventName - 事件名稱
   * @param {Function} handler - 事件處理器
   */
  on(eventName, handler) {
    const fullEventName = `ui-manager:${eventName}`;
    window.addEventListener(fullEventName, handler);

    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(handler);
  }

  /**
   * 取消監聽事件
   * @param {string} eventName - 事件名稱
   * @param {Function} handler - 事件處理器
   */
  off(eventName, handler) {
    const fullEventName = `ui-manager:${eventName}`;
    window.removeEventListener(fullEventName, handler);

    if (this.listeners.has(eventName)) {
      const handlers = this.listeners.get(eventName);
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  // ==========================================
  // 清理方法
  // ==========================================

  /**
   * 重置 UI 管理器
   */
  reset() {
    // 清除所有高亮
    this.clearAllHighlights();

    // 重置狀態
    this.state.highlightedButtons.clear();
    this.state.lockedElements.clear();
    this.state.hiddenElements.clear();

    this._emit("ui-manager-reset");
    this._log("UI 管理器已重置");
  }

  /**
   * 清理並銷毀 UI 管理器
   */
  destroy() {
    // 移除所有事件監聽器
    this.listeners.forEach((handlers, eventName) => {
      handlers.forEach((handler) => {
        this.off(eventName, handler);
      });
    });
    this.listeners.clear();

    // 清除快取
    this.elements.clear();

    // 重置狀態
    this.reset();

    // 清除依賴
    this.dependencies.flowManager = null;

    this.initialized = false;
    this._emit("ui-manager-destroyed");
    this._log("UI 管理器已銷毀");
  }
}

// 匯出到全域（向後相容）
if (typeof window !== "undefined") {
  window.ExperimentUIManager = ExperimentUIManager;
}

// ES6 模組匯出
if (typeof module !== "undefined" && module.exports) {
  module.exports = ExperimentUIManager;
}
