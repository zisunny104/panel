/**
 * ExperimentUIManager - 管理實驗面板的 UI 控件與狀態同步
 *
 * 負責快取常用 DOM 元素、綁定與觸發 UI 事件，並回應
 * ExperimentFlowManager 的狀態變更以更新畫面與互動。
 *
 * 此檔案聚焦於現行行為與公開 API，說明反映目前實作與責任範圍。
 */

class ExperimentUIManager {
  /**
   * 建構函式
   * @param {Object} config - 配置選項
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
      panelUIInitialized: false,
    };

    // DOM 元素快取
    this.elements = new Map();

    // 事件監聽器集合
    this.listeners = new Map();

    // 初始化標記
    this.initialized = false;

    Logger.debug("ExperimentUIManager 已建立");
  }

  // ==========================================
  // 初始化方法
  // ==========================================

  /**
   * 初始化 UI 管理器
   */
  initialize() {
    if (this.initialized) {
      Logger.warn("UI 管理器已經初始化");
      return;
    }

    // 快取常用的 DOM 元素
    this._cacheCommonElements();

    this.initialized = true;
    Logger.debug("UI 管理器初始化完成");

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
   * 依賴注入：FlowManager
   */
  injectFlowManager(flowManager) {
    if (!flowManager) {
      Logger.warn("注入的 FlowManager 無效");
      return;
    }

    this.dependencies.flowManager = flowManager;
    Logger.debug("已注入 FlowManager");

    try {
      // 鎖定事件：當實驗正在 RUNNING 或 PAUSED 時，停用 experimentId 與 組合選擇
      flowManager.on(ExperimentFlowManager.EVENT.LOCKED, () => {
        Logger.debug("收到 flow:locked，鎖定實驗相關輸入");
        this._handleFlowLocked(true);
      });

      // 解鎖事件：實驗結束或重置時恢復
      flowManager.on(ExperimentFlowManager.EVENT.UNLOCKED, () => {
        Logger.debug("收到 flow:unlocked，解除鎖定");
        this._handleFlowLocked(false);
      });

      // 受試者名稱允許編輯事件（PAUSED 時為 true）
      flowManager.on(ExperimentFlowManager.EVENT.PARTICIPANT_EDIT, (data) => {
        const allowed = !!data?.allowed;
        Logger.debug(
          "收到 flow:participant_edit，允許編輯受試者名稱:",
          allowed,
        );
        this._handleParticipantEditAllowed(allowed);
      });

      Logger.debug("已綁定 FlowManager 事件: locked/unlocked/participant_edit");
    } catch (e) {
      Logger.warn("綁定 FlowManager 事件失敗", e);
    }
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
   * 停用按鈕
   * @param {string|HTMLElement} buttonOrSelector - 按鈕元素或選擇器
   * @param {string} reason - 停用原因（顯示在 title）
   */
  disableButton(buttonOrSelector, reason = "") {
    const button = this._getElement(buttonOrSelector);
    if (!button) return;

    button.disabled = true;
    button.classList.add("disabled");
    if (reason) {
      button.title = reason;
    }

    this._emit("button-disabled", {
      button,
      selector: buttonOrSelector,
      reason,
    });
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
   * 處理 FlowManager 的鎖定/解鎖事件
   * @private
   */
  _handleFlowLocked(locked) {
    // 實驗 ID 輸入框
    const idInput = document.querySelector("#experimentIdInput");
    if (idInput) {
      idInput.disabled = !!locked;
      if (locked) {
        idInput.classList.add("experiment-disabled");
      } else {
        idInput.classList.remove("experiment-disabled");
      }
    }

    // 組合選擇器
    const comboContainer = document.querySelector(
      "#combinationSelectorContainer",
    );
    if (comboContainer) {
      // 將所有互動元素設為 disabled
      comboContainer
        .querySelectorAll("button,input,li,select")
        .forEach((el) => {
          try {
            el.disabled = !!locked;
            if (locked) el.classList.add("experiment-disabled");
            else el.classList.remove("experiment-disabled");
          } catch (e) {}
        });
    }

    // 若有需要，也可以發出事件
    this._emit("flow:locked:ui", { locked });
  }

  /**
   * 處理受試者名稱編輯允許信號
   * @private
   */
  _handleParticipantEditAllowed(allowed) {
    const pInput = document.querySelector("#participantNameInput");
    if (pInput) {
      // 當 allowed 為 true 表示可編輯，否則只讀
      pInput.readOnly = !allowed;
      if (allowed) {
        pInput.classList.remove("experiment-disabled");
        pInput.removeAttribute("disabled");
      } else {
        pInput.classList.add("experiment-disabled");
        pInput.setAttribute("disabled", "true");
      }
    }
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
   * 批次啟用按鈕
   * @param {Array<string|HTMLElement>} buttons - 按鈕列表
   */
  enableButtons(buttons) {
    buttons.forEach((btn) => this.enableButton(btn));
  }

  /**
   * 批次停用按鈕
   * @param {Array<string|HTMLElement>} buttons - 按鈕列表
   * @param {string} reason - 停用原因
   */
  disableButtons(buttons, reason = "") {
    buttons.forEach((btn) => this.disableButton(btn, reason));
  }

  /**
   * 批次鎖定按鈕
   * @param {Array<string|HTMLElement>} buttons - 按鈕列表
   */
  lockButtons(buttons) {
    buttons.forEach((btn) => this.lockButton(btn));
  }

  /**
   * 批次解鎖按鈕
   * @param {Array<string|HTMLElement>} buttons - 按鈕列表
   */
  unlockButtons(buttons) {
    buttons.forEach((btn) => this.unlockButton(btn));
  }

  // ==========================================
  // 按鈕高亮管理
  // ==========================================

  /**
   * 高亮按鈕（新增視覺提示）
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
      "next-step-highlight-shift",
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
      Logger.warn("找不到電源開關區域");
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
        "next-step-highlight-shift",
      );
    });

    this.state.highlightedButtons.clear();
    this._emit("all-highlights-cleared");
  }

  // ==========================================
  // 視覺提示控制
  // ==========================================

  /**
   * 啟用/停用視覺提示
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

    Logger.debug(`視覺提示已${enabled ? "啟用" : "停用"}`);
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
    // prefer class-based hiding; use show/hide helpers for consistency
    try {
      if (isPaused) this.showElement(indicator, "block");
      else this.hideElement(indicator);
    } catch (e) {}
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
   * @param {number} current - 目前進度
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
   * @param {number} currentStep - 目前步驟索引
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
   * @param {number} currentUnit - 目前單元索引
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

    // remove class-based hidden flag if present (preference for class-based control)
    if (element.classList.contains("is-hidden")) {
      element.classList.remove("is-hidden");
    }

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

    // prefer class-based hiding to allow stylesheet control
    element.classList.add("is-hidden");

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

    const isClassHidden = element.classList.contains("is-hidden");
    if (isClassHidden) {
      this.showElement(element, displayType);
    } else {
      this.hideElement(element);
    }
  }

  /**
   * 批次顯示元素
   * @param {Array<string|HTMLElement>} elements - 元素列表
   * @param {string} displayType - display 類型
   */
  showElements(elements, displayType = "block") {
    elements.forEach((el) => this.showElement(el, displayType));
  }

  /**
   * 批次隱藏元素
   * @param {Array<string|HTMLElement>} elements - 元素列表
   */
  hideElements(elements) {
    elements.forEach((el) => this.hideElement(el));
  }

  // ==========================================
  // CSS 類別管理
  // ==========================================

  /**
   * 新增 CSS class
   * @param {string|HTMLElement} elementOrSelector - 元素或選擇器
   * @param {string|Array<string>} classNames - class 名稱（可以是陣列）
   */
  addClass(elementOrSelector, classNames) {
    const element = this._getElement(elementOrSelector);
    if (!element) return;

    const classes = Array.isArray(classNames) ? classNames : [classNames];
    element.classList.add(...classes);

    this._emit("class-added", {
      element,
      selector: elementOrSelector,
      classNames,
    });
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

    this._emit("class-removed", {
      element,
      selector: elementOrSelector,
      classNames,
    });
  }

  /**
   * 切換 CSS class
   * @param {string|HTMLElement} elementOrSelector - 元素或選擇器
   * @param {string} className - class 名稱
   * @param {boolean} force - 強制新增/移除
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

    this._emit("button-press-animation-shown", {
      button,
      selector: buttonOrSelector,
    });
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

    this._emit("button-blink-started", {
      button,
      selector: buttonOrSelector,
      times,
    });
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

    Logger.warn("無效的元素或選擇器:", elementOrSelector);
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
    Logger.debug("UI 管理器已重置");
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
    Logger.debug("UI 管理器已銷毀");
  }

  // ==========================================
  // 通用UI組件渲染方法
  // ==========================================

  /**
   * 渲染組合選擇器
   * @param {HTMLElement|string} container - 容器元素或選擇器
   * @param {Array} combinations - 組合資料陣列
   * @param {Object} options - 可選配置
   * @returns {HTMLElement} 渲染後的容器元素
   */
  renderCombinationSelector(container, combinations, options = {}) {
    const containerEl =
      typeof container === "string"
        ? document.querySelector(container)
        : container;
    if (!containerEl) {
      Logger.error("找不到容器元素:", container);
      return null;
    }
    const renderNow = () => {
      const config = {
        showTitle: options.showTitle !== false,
        title: options.title || "單元組合",
        activeId: options.activeId || null,
        onSelect: options.onSelect || null,
        ...options,
      };

      // 如果容器是 ul 元素，直接在其中新增項目
      if (containerEl.tagName === "UL") {
        containerEl.innerHTML = combinations
          .map(
            (combo) => `
        <li class="combination-item ${combo.id === config.activeId ? "active" : ""}"
            data-combination-id="${combo.id}">
          <div class="combo-name">${combo.name}</div>
          <div class="combo-desc">${combo.description || ""}</div>
        </li>
      `,
          )
          .join("");
        // 如果目標是 UL 元素且要求顯示標題，則在 UL 之前插入一個 h3 作為 fallback
        if (config.showTitle) {
          const existingTitle = containerEl.previousElementSibling;
          if (
            !existingTitle ||
            !existingTitle.classList.contains("combination-selector-title")
          ) {
            const titleEl = document.createElement("h3");
            titleEl.className = "combination-selector-title";
            titleEl.textContent = config.title;
            containerEl.parentNode &&
              containerEl.parentNode.insertBefore(titleEl, containerEl);
            Logger.debug("組合選擇器: 已插入 fallback 標題", {
              title: config.title,
            });
          }
        }
      } else {
        // 否則產生完整的 HTML
        const html = `
        <div class="combination-selector-section experiment-ui-card">
          ${config.showTitle ? `<h3>${config.title}</h3>` : ""}
          <ul class="experiment-default-list">
            ${combinations
              .map(
                (combo) => `
              <li class="combination-item ${combo.id === config.activeId ? "active" : ""}"
                  data-combination-id="${combo.id}">
                <div class="combo-name">${combo.name}</div>
                <div class="combo-desc">${combo.description || ""}</div>
              </li>
            `,
              )
              .join("")}
          </ul>
        </div>
      `;
        containerEl.innerHTML = html;
      }

      // 記錄容器與標題使用情況，便於偵錯
      Logger.debug("renderCombinationSelector: containerTag", {
        tag: containerEl.tagName,
        showTitle: config.showTitle,
        title: config.title,
      });

      // 綁定點擊事件
      if (config.onSelect) {
        const items = containerEl.querySelectorAll(".combination-item");
        items.forEach((item) => {
          item.addEventListener("click", () => {
            const comboId = item.dataset.combinationId;
            // 移除所有 active class
            items.forEach((i) => i.classList.remove("active"));
            // 新增到點擊的項目
            item.classList.add("active");
            // 呼叫回調
            config.onSelect(comboId);
          });
        });
      }

      Logger.debug("組合選擇器已渲染", { count: combinations.length });
      return containerEl;
    };

    // 如果面板祖先被隱藏 (display:none)，延遲渲染直到可見
    const panelAncestor = containerEl.closest(".experiment-panel");
    if (
      panelAncestor &&
      window.getComputedStyle(panelAncestor).display === "none"
    ) {
      const mo = new MutationObserver((mutations, obs) => {
        if (window.getComputedStyle(panelAncestor).display !== "none") {
          obs.disconnect();
          renderNow();
        }
      });
      mo.observe(panelAncestor, {
        attributes: true,
        attributeFilter: ["style", "class"],
      });
      return containerEl;
    }

    return renderNow();
  }

  /**
   * 更新組合選擇器的選中狀態
   * @param {HTMLElement|string} container - 容器元素或選擇器
   * @param {string} activeId - 要選中的組合ID
   */
  updateCombinationSelection(container, activeId) {
    const containerEl =
      typeof container === "string"
        ? document.querySelector(container)
        : container;
    if (!containerEl) {
      Logger.warn("找不到容器元素:", container);
      return;
    }

    // 移除所有 active class
    const items = containerEl.querySelectorAll(".combination-item");
    items.forEach((item) => item.classList.remove("active"));

    // 為指定的組合新增 active class
    const activeItem = containerEl.querySelector(
      `[data-combination-id="${activeId}"]`,
    );
    if (activeItem) {
      activeItem.classList.add("active");
    }

    Logger.debug("組合選擇器選中狀態已更新", { activeId });
  }

  /**
   * 渲染實驗單元面板
   * @param {HTMLElement|string} container - 容器元素或選擇器
   * @param {Array} units - 單元資料陣列
   * @param {Array} unitIds - 要顯示的單元ID陣列（可選，用於過濾）
   * @param {Object} options - 可選配置
   * @returns {HTMLElement} 渲染後的容器元素
   */
  renderUnitsPanel(container, units, unitIds = null, options = {}) {
    const containerEl =
      typeof container === "string"
        ? document.querySelector(container)
        : container;
    if (!containerEl) {
      Logger.error("找不到容器元素:", container);
      return null;
    }

    const renderNow = () => {
      const config = {
        showHeader: options.showHeader !== false,
        headerTitle: options.headerTitle || "實驗單元",
        showSelectAll: options.showSelectAll !== false,
        showPowerOptions: options.showPowerOptions !== false,
        includeStartup: options.includeStartup !== false,
        includeShutdown: options.includeShutdown !== false,
        enableSorting: options.enableSorting !== false,
        onUnitToggle: options.onUnitToggle || null,
        onReorder: options.onReorder || null,
        ...options,
      };

      // 顯示所有單元，但根據 unitIds 設定預設勾選狀態
      let displayUnits = units;
      if (unitIds && Array.isArray(unitIds)) {
        displayUnits = units.map((unit) => ({
          ...unit,
          checked: unitIds.includes(unit.unit_id || unit.id),
        }));
        Logger.debug("設定單元勾選狀態:", {
          total: units.length,
          preselected: unitIds.length,
          unitIds,
        });
      } else {
        displayUnits = units.map((unit) => ({
          ...unit,
          checked: false,
        }));
      }

      const html = `
      <div class="experiment-panel-units experiment-ui-card">
        ${
          config.showHeader
            ? `
          <div class="units-header">
            <span>${config.headerTitle}</span>
            ${
              config.showSelectAll
                ? `
              <label class="select-all-checkbox">
                <input type="checkbox" id="selectAllUnits" checked>
                <span>全選</span>
              </label>
            `
                : ""
            }
          </div>
        `
            : ""
        }
        <div class="units-list-container">
          <ul class="experiment-units-list">
            ${
              config.showPowerOptions && config.includeStartup
                ? `
              <li class="power-option-card startup-card">
                <label class="unit-checkbox">
                  <input type="checkbox" id="includeStartup" checked>
                </label>
                <div class="unit-sort">
                  <div class="power-option-title">機器開機</div>
                  <div class="power-option-subtitle">POWER_ON • 開始實驗前先開機</div>
                </div>
              </li>
            `
                : ""
            }
            ${displayUnits
              .map(
                (unit, index) => `
              <li data-unit-id="${unit.unit_id || unit.id}">
                <label class="unit-checkbox">
                  <input type="checkbox" name="unitCheckbox" value="${unit.unit_id || unit.id}" ${unit.checked !== false ? "checked" : ""}>
                </label>
                <div class="unit-sort">
                  <div class="unit-info-title">${unit.unit_name || unit.title || unit.name || "未命名單元"}</div>
                  <div class="unit-info-subtitle">${unit.unit_id || unit.id} • ${unit.stepCount || unit.steps?.length || 0} 步驟</div>
                </div>
                ${
                  config.enableSorting
                    ? `
                  <div class="unit-controls">
                    <button class="unit-sort-btn unit-up-btn ${index === 0 ? "disabled" : ""}"
                            title="上移" ${index === 0 ? "disabled" : ""}>▲</button>
                    <button class="unit-sort-btn unit-down-btn ${index === displayUnits.length - 1 ? "disabled" : ""}"
                            title="下移" ${index === displayUnits.length - 1 ? "disabled" : ""}>▼</button>
                    <span class="unit-drag-handle" title="拖曳排序">⋮⋮</span>
                  </div>
                `
                    : ""
                }
              </li>
            `,
              )
              .join("")}
            ${
              config.showPowerOptions && config.includeShutdown
                ? `
              <li class="power-option-card shutdown-card">
                <label class="unit-checkbox">
                  <input type="checkbox" id="includeShutdown" checked>
                </label>
                <div class="unit-sort">
                  <div class="power-option-title">機器關機</div>
                  <div class="power-option-subtitle">POWER_OFF • 完成關機才結束實驗</div>
                </div>
              </li>
            `
                : ""
            }
          </ul>
        </div>
      </div>
    `;

      containerEl.innerHTML = html;

      // 綁定全選事件
      if (config.showSelectAll) {
        const selectAllCheckbox = containerEl.querySelector("#selectAllUnits");
        if (selectAllCheckbox) {
          selectAllCheckbox.addEventListener("change", (e) => {
            const checkboxes = containerEl.querySelectorAll(
              "input[name=\"unitCheckbox\"]",
            );
            checkboxes.forEach((cb) => (cb.checked = e.target.checked));
            if (config.onUnitToggle) {
              config.onUnitToggle({
                type: "select-all",
                checked: e.target.checked,
              });
            }
          });
        }
      }

      // 綁定單元切換事件
      if (config.onUnitToggle) {
        const checkboxes = containerEl.querySelectorAll(
          "input[name=\"unitCheckbox\"]",
        );
        checkboxes.forEach((checkbox) => {
          checkbox.addEventListener("change", (e) => {
            config.onUnitToggle({
              type: "unit",
              unitId: e.target.value,
              checked: e.target.checked,
            });
          });
        });
      }

      // 綁定排序按鈕事件
      if (config.enableSorting && config.onReorder) {
        const upButtons = containerEl.querySelectorAll(".unit-up-btn");
        const downButtons = containerEl.querySelectorAll(".unit-down-btn");

        upButtons.forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const li = e.target.closest("li");
            const unitId = li.dataset.unitId;
            // 交換順序
            const unitList = containerEl.querySelector(
              ".experiment-units-list",
            );
            const items = Array.from(
              unitList.querySelectorAll("li[data-unit-id]"),
            );
            const currentIndex = items.findIndex(
              (item) => item.dataset.unitId === unitId,
            );
            if (currentIndex > 0) {
              // 交換 DOM
              const temp = items[currentIndex];
              items[currentIndex - 1].parentNode.insertBefore(
                temp,
                items[currentIndex - 1],
              );
              // 重新更新按鈕狀態
              this._updateSortButtonStates(containerEl);
              // 回調
              config.onReorder({ unitId, direction: "up" });
            }
          });
        });

        downButtons.forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const li = e.target.closest("li");
            const unitId = li.dataset.unitId;
            // 交換順序
            const unitList = containerEl.querySelector(
              ".experiment-units-list",
            );
            const items = Array.from(
              unitList.querySelectorAll("li[data-unit-id]"),
            );
            const currentIndex = items.findIndex(
              (item) => item.dataset.unitId === unitId,
            );
            if (currentIndex < items.length - 1) {
              // 交換 DOM
              const nextItem = items[currentIndex + 1];
              li.parentNode.insertBefore(nextItem, li);
              // 重新更新按鈕狀態
              this._updateSortButtonStates(containerEl);
              // 回調
              config.onReorder({ unitId, direction: "down" });
            }
          });
        });
      }

      // 綁定拖曳事件
      if (config.enableSorting) {
        this._setupUnitDragAndDrop(containerEl, config);
      }

      Logger.debug("單元面板已渲染", { count: displayUnits.length });
      return containerEl;
    };

    const panelAncestor = containerEl.closest(".experiment-panel");
    if (
      panelAncestor &&
      window.getComputedStyle(panelAncestor).display === "none"
    ) {
      const mo = new MutationObserver((mutations, obs) => {
        if (window.getComputedStyle(panelAncestor).display !== "none") {
          obs.disconnect();
          renderNow();
        }
      });
      mo.observe(panelAncestor, {
        attributes: true,
        attributeFilter: ["style", "class"],
      });
      return containerEl;
    }

    return renderNow();
  }

  /**
   * 設定單元拖曳功能（使用原始的 mousemove + touchmove 方式）
   * @private
   */
  _setupUnitDragAndDrop(containerEl, config) {
    const unitList = containerEl.querySelector(".experiment-units-list");
    if (!unitList) return;

    let draggedLi = null;
    let placeholder = null;

    // 只對普通單元項目啟用拖曳，排除電源卡片
    const handles = unitList.querySelectorAll(
      "li:not(.power-option-card) .unit-drag-handle",
    );

    handles.forEach((handle) => {
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        startDrag(handle, e.clientX, e.clientY);
      });
      handle.addEventListener("touchstart", (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        startDrag(handle, touch.clientX, touch.clientY);
      });
    });

    const startDrag = (handle, startX, startY) => {
      draggedLi = handle.closest("li");
      if (!draggedLi) return;

      placeholder = document.createElement("li");
      placeholder.className = "drag-placeholder";
      placeholder.style.height = `${draggedLi.offsetHeight}px`;

      const originalStyle = draggedLi.style.cssText;
      draggedLi.classList.add("dragging");
      draggedLi.style.position = "fixed";
      draggedLi.style.zIndex = "1000";
      draggedLi.style.pointerEvents = "none";
      draggedLi.style.width = `${draggedLi.offsetWidth}px`;
      draggedLi.style.left = `${startX - draggedLi.offsetWidth / 2}px`;
      draggedLi.style.top = `${startY - draggedLi.offsetHeight / 2}px`;
      draggedLi.setAttribute("data-original-style", originalStyle);
      draggedLi.parentNode.insertBefore(placeholder, draggedLi.nextSibling);
      handle.classList.add("dragging-handle");

      document.addEventListener("mousemove", onMouseDrag);
      document.addEventListener("mouseup", onMouseDrop);
      document.addEventListener("touchmove", onTouchDrag, { passive: false });
      document.addEventListener("touchend", onTouchDrop);
    };

    const onMouseDrag = (e) => {
      if (!draggedLi) return;
      updateDragPosition(e.clientX, e.clientY);
    };

    const onTouchDrag = (e) => {
      if (!draggedLi) return;
      e.preventDefault();
      const touch = e.touches[0];
      updateDragPosition(touch.clientX, touch.clientY);
    };

    const updateDragPosition = (clientX, clientY) => {
      draggedLi.style.left = `${clientX - draggedLi.offsetWidth / 2}px`;
      draggedLi.style.top = `${clientY - draggedLi.offsetHeight / 2}px`;

      // 只在普通單元項目之間進行排序，排除電源卡片
      const items = Array.from(unitList.children).filter(
        (item) => !item.classList.contains("power-option-card"),
      );
      let insertBefore = null;

      for (let item of items) {
        if (item === draggedLi || item === placeholder) continue;
        const rect = item.getBoundingClientRect();
        const itemCenterY = rect.top + rect.height / 2;
        if (clientY < itemCenterY) {
          insertBefore = item;
          break;
        }
      }

      // 確保插入位置在開機卡片之後，關機卡片之前
      const startupCard = unitList.querySelector(".startup-card");
      const shutdownCard = unitList.querySelector(".shutdown-card");

      if (insertBefore) {
        // 如果插入位置是開機卡片之前，則插入到開機卡片之後
        if (insertBefore === startupCard) {
          unitList.insertBefore(placeholder, startupCard.nextSibling);
        } else {
          unitList.insertBefore(placeholder, insertBefore);
        }
      } else {
        // 如果沒有找到插入位置，插入到關機卡片之前
        if (shutdownCard) {
          unitList.insertBefore(placeholder, shutdownCard);
        } else {
          unitList.appendChild(placeholder);
        }
      }
    };

    const onMouseDrop = () => {
      endDrag();
    };

    const onTouchDrop = () => {
      endDrag();
    };

    const endDrag = () => {
      if (!draggedLi || !placeholder) return;

      document.removeEventListener("mousemove", onMouseDrag);
      document.removeEventListener("mouseup", onMouseDrop);
      document.removeEventListener("touchmove", onTouchDrag);
      document.removeEventListener("touchend", onTouchDrop);

      draggedLi.classList.remove("dragging");
      const originalStyle = draggedLi.getAttribute("data-original-style") || "";
      draggedLi.style.cssText = originalStyle;
      draggedLi.removeAttribute("data-original-style");

      placeholder.parentNode.insertBefore(draggedLi, placeholder);
      placeholder.remove();

      const handle = draggedLi.querySelector(".unit-drag-handle");
      if (handle) handle.classList.remove("dragging-handle");

      // 重新更新按鈕狀態
      this._updateSortButtonStates(containerEl);

      // 執行回調
      if (config.onReorder) {
        const allItems = Array.from(
          unitList.querySelectorAll("li[data-unit-id]"),
        );
        const newIndex = allItems.indexOf(draggedLi);
        config.onReorder({
          unitId: draggedLi.dataset.unitId,
          newIndex: newIndex,
        });
      }

      draggedLi = null;
      placeholder = null;
    };

    Logger.debug("單元拖曳功能已啟用");
  }

  /**
   * 更新排序按鈕狀態
   * @private
   */
  _updateSortButtonStates(containerEl) {
    const unitList = containerEl.querySelector(".experiment-units-list");
    if (!unitList) return;

    const items = Array.from(unitList.querySelectorAll("li[data-unit-id]"));

    items.forEach((item, index) => {
      const upBtn = item.querySelector(".unit-up-btn");
      const downBtn = item.querySelector(".unit-down-btn");

      if (upBtn) {
        if (index === 0) {
          upBtn.classList.add("disabled");
          upBtn.disabled = true;
        } else {
          upBtn.classList.remove("disabled");
          upBtn.disabled = false;
        }
      }

      if (downBtn) {
        if (index === items.length - 1) {
          downBtn.classList.add("disabled");
          downBtn.disabled = true;
        } else {
          downBtn.classList.remove("disabled");
          downBtn.disabled = false;
        }
      }
    });
  }

  /**
   * 渲染實驗控制面板
   * @param {HTMLElement|string} container - 容器元素或選擇器
   * @param {Object} options - 可選配置
   * @returns {HTMLElement} 渲染後的容器元素
   */
  renderExperimentControls(container, options = {}) {
    const containerEl =
      typeof container === "string"
        ? document.querySelector(container)
        : container;
    if (!containerEl) {
      Logger.error("找不到容器元素:", container);
      return null;
    }

    const renderNow = () => {
      const config = {
        showExperimentId: options.showExperimentId !== false,
        showParticipantName: options.showParticipantName !== false,
        showTimer: options.showTimer !== false,
        experimentId: options.experimentId || "",
        participantName: options.participantName || "",
        onStart: options.onStart || null,
        onPause: options.onPause || null,
        onStop: options.onStop || null,
        onRegenerateId: options.onRegenerateId || null,
        ...options,
      };

      const html = `
      <div class="experiment-panel-actions" id="experimentPanelActions">
        <div class="input-section">
          ${
            config.showExperimentId
              ? `
            <div class="form-group">
              <label for="experimentIdInput">實驗ID:</label>
              <div class="experiment-id-group">
                <input type="text" id="experimentIdInput" class="form-input"
                       maxlength="10" placeholder="載入中..." value="${config.experimentId}">
                <button id="regenerateIdButton" class="btn-secondary" title="重新產生實驗ID">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                       stroke-linecap="round" stroke-linejoin="round" class="icon-sm">
                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                    <path d="M21 3v5h-5"></path>
                    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
                    <path d="M3 21v-5h5"></path>
                  </svg>
                </button>
              </div>
            </div>
          `
              : ""
          }

          ${
            config.showParticipantName
              ? `
            <div class="form-group">
              <label for="participantNameInput">受試者名稱:</label>
              <input type="text" id="participantNameInput" class="form-input"
                     placeholder="受試者名稱" value="${config.participantName}">
            </div>
          `
              : ""
          }

          <div class="form-group experiment-control-group">
            <div class="experiment-control-header">
              <label>實驗控制</label>
              ${config.showTimer ? "<div id=\"experimentTimer\" class=\"experiment-timer\">00:00.000</div>" : ""}
            </div>

            <div id="experimentIdRow" class="experiment-start-row">
              <button id="startExperimentBtn" class="experiment-start-btn btn-success">
                ▶ 開始實驗
              </button>
            </div>

            <div id="experimentControlButtons" class="experiment-control-buttons is-hidden">
              <button id="pauseExperimentBtn" class="experiment-pause-btn btn-primary">
                ⏸ 暫停
              </button>
              <button id="stopExperimentBtn" class="experiment-stop-btn btn-danger">
                ⏹ 停止
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

      containerEl.innerHTML = html;

      // 綁定事件
      if (config.onStart) {
        const startBtn = containerEl.querySelector("#startExperimentBtn");
        if (startBtn) {
          startBtn.addEventListener("click", () => {
            // 隱藏開始按鈕，顯示控制按鈕
            const startRow = containerEl.querySelector("#experimentIdRow");
            const controlBtns = containerEl.querySelector(
              "#experimentControlButtons",
            );
            if (startRow) {
              this.hideElement(startRow);
            }
            if (controlBtns) {
              this.showElement(controlBtns, "flex");
            }

            // 啟動計時器
            if (config.showTimer) {
              this.startExperimentTimer(
                containerEl.querySelector("#experimentTimer"),
              );
            }

            // 執行回調
            config.onStart();
          });
        }
      }

      if (config.onPause) {
        const pauseBtn = containerEl.querySelector("#pauseExperimentBtn");
        if (pauseBtn) {
          // 初始狀態由 _updateExperimentControlsForStarted 設定
          // UI 與計時器狀態由 FlowManager 事件驅動（_updateExperimentControlsForPaused/Resumed）
          pauseBtn.addEventListener("click", (e) => {
            e.preventDefault();
            const isPaused = pauseBtn.dataset.isPaused === "true";
            if (!isPaused) {
              config.onPause();
            } else {
              config.onResume?.();
            }
          });
        }
      }

      if (config.onStop) {
        const stopBtn = containerEl.querySelector("#stopExperimentBtn");
        if (stopBtn) {
          stopBtn.addEventListener("click", () => {
            // 計時器停止由 FlowManager STOPPED 事件驅動（_handleFlowStopped → stopExperimentTimer）

            // 重置暫停按鈕狀態
            const pauseBtn = containerEl.querySelector("#pauseExperimentBtn");
            if (pauseBtn) {
              pauseBtn.textContent = "⏸ 暫停";
              pauseBtn.classList.remove("btn-secondary");
              pauseBtn.classList.add("btn-primary");
              pauseBtn.dataset.isPaused = "false";
            }

            // 重置按鈕狀態
            const startRow = containerEl.querySelector("#experimentIdRow");
            const controlBtns = containerEl.querySelector(
              "#experimentControlButtons",
            );
            if (startRow) {
              this.showElement(startRow, "flex");
            }
            if (controlBtns) {
              this.hideElement(controlBtns);
            }

            // 重置計時器顯示
            if (config.showTimer) {
              const timerEl = containerEl.querySelector("#experimentTimer");
              if (timerEl) timerEl.textContent = "00:00.000";
            }

            // 執行回調
            config.onStop();
          });
        }
      }

      if (config.onRegenerateId) {
        const regenBtn = containerEl.querySelector("#regenerateIdButton");
        if (regenBtn) {
          regenBtn.addEventListener("click", config.onRegenerateId);
        }
      }

      Logger.debug("實驗控制面板已渲染");
      return containerEl;
    };

    const panelAncestor = containerEl.closest(".experiment-panel");
    if (
      panelAncestor &&
      window.getComputedStyle(panelAncestor).display === "none"
    ) {
      const mo = new MutationObserver((mutations, obs) => {
        if (window.getComputedStyle(panelAncestor).display !== "none") {
          obs.disconnect();
          renderNow();
        }
      });
      mo.observe(panelAncestor, {
        attributes: true,
        attributeFilter: ["style", "class"],
      });
      return containerEl;
    }

    return renderNow();
  }

  /**
   * 啟動實驗計時器（委派給 experimentTimerManager）
   */
  startExperimentTimer() {
    window.experimentTimerManager.startExperimentTimer();
    Logger.debug("實驗計時器已啟動");
  }

  /**
   * 暫停實驗計時器（委派給 experimentTimerManager）
   * @returns {boolean} 是否成功暫停
   */
  pauseExperimentTimer() {
    const etm = window.experimentTimerManager;
    if (!etm.experimentStartTime) {
      Logger.warn("計時器未在執行中");
      return false;
    }
    if (etm.experimentPaused) {
      Logger.warn("計時器已處於暫停狀態");
      return false;
    }
    etm.pauseExperimentTimer();
    Logger.debug("實驗計時器已暫停");
    return true;
  }

  /**
   * 恢復實驗計時器（委派給 experimentTimerManager）
   * @returns {boolean} 是否成功恢復
   */
  resumeExperimentTimer() {
    const etm = window.experimentTimerManager;
    if (!etm.experimentStartTime) {
      Logger.warn("計時器未在執行中");
      return false;
    }
    if (!etm.experimentPaused) {
      Logger.warn("計時器未在暫停狀態");
      return false;
    }
    etm.resumeExperimentTimer();
    Logger.debug("實驗計時器已恢復");
    return true;
  }

  /**
   * 停止實驗計時器（委派給 experimentTimerManager）
   */
  stopExperimentTimer() {
    window.experimentTimerManager.stopExperimentTimer();
    Logger.debug("實驗計時器已停止");
  }

  /**
   * 取得計時器目前時間（毫秒，委派給 experimentTimerManager）
   * @returns {number} 經過的毫秒數
   */
  getElapsedTime() {
    return window.experimentTimerManager.getExperimentElapsedMs();
  }

  /**
   * 初始化 Panel 頁面的 UI 組件
   * 只渲染系統管理器未處理的組件（如實驗日誌）
   */
  async initializePanelUI() {
    try {
      // 防止重複初始化
      if (this.state.panelUIInitialized) {
        Logger.debug("Panel UI 已經初始化，跳過重複初始化");
        return;
      }

      Logger.debug("開始初始化 Panel UI 組件");

      // 注意：組合選擇器、單元面板和實驗控制由 ExperimentSystemManager.initializeUI() 處理
      // 實驗日誌面板由 board-log-ui.js 的 ExperimentLogUI 負責初始化

      Logger.debug("Panel UI 組件初始化完成");

      // 標記為已初始化
      this.state.panelUIInitialized = true;
    } catch (error) {
      Logger.error("初始化 Panel UI 失敗:", error);
    }
  }

  /**
   * 載入場景數據
   * @private
   */
  async _loadScenariosData() {
    try {
      const response = await fetch("data/scenarios.json");
      if (!response.ok) throw new Error("Failed to load scenarios.json");
      return await response.json();
    } catch (error) {
      Logger.error("載入 scenarios.json 失敗:", error);
      return null;
    }
  }

  /**
   * 準備單元數據
   * @private
   */
  _prepareUnitsData(scriptData) {
    if (!scriptData.sections) return [];

    const units = [];
    scriptData.sections.forEach((section) => {
      if (section.units && Array.isArray(section.units)) {
        section.units.forEach((unit) => {
          units.push({
            id: unit.unit_id,
            title: unit.unit_name,
            stepCount: unit.steps ? unit.steps.length : 0,
            checked: true, // 預設全選
          });
        });
      }
    });

    return units;
  }

  /**
   * 處理組合選擇
   * @private
   */
  _handleCombinationSelect(combinationId) {
    Logger.debug("選擇組合:", combinationId);

    if (window.experimentCombinationManager) {
      const combination =
        window.experimentCombinationManager.getCombinationById(combinationId);
      if (combination) {
        const experimentId =
          window.experimentHubManager?.getExperimentId?.() || null;
        window.experimentCombinationManager.setCombination(
          combination,
          experimentId,
        );
      } else {
        Logger.error("找不到組合:", combinationId);
      }
    } else {
      Logger.error("experimentCombinationManager 不可用");
    }
  }

  /**
   * 處理單元切換
   * @private
   */
  _handleUnitToggle(unitId, checked) {
    Logger.debug("單元切換:", unitId, checked);
    // 未實作：單元切換邏輯（保留作為未完成提示）
  }

  /**
   * 處理單元重新排序
   * @private
   */
  _handleUnitReorder(newOrder) {
    Logger.debug("單元重新排序:", newOrder);
    // 未實作：單元排序邏輯
  }

  /**
   * 處理實驗開始
   * @private
   */
  _handleExperimentStart() {
    Logger.debug("開始實驗");

    // 關閉所有面板（實驗、日誌、設定）
    if (window.panelUIManager) {
      window.panelUIManager.closePanel("experiment");
      window.panelUIManager.closePanel("logger");
      window.panelUIManager.closePanel("settings");
      Logger.debug("實驗開始：已關閉所有面板");
    }

    // 如果視覺提示已啟用，確保高亮顯示
    if (this.isVisualHintsEnabled()) {
      this.updateHighlightVisibility();
      Logger.debug("實驗開始：視覺提示已啟用並更新高亮");
    }
  }

  /**
   * 處理實驗暫停
   * @private
   */
  _handleExperimentPause() {
    Logger.debug("暫停/繼續實驗");
    // 未實作：暫停處理（由 FlowManager 驅動為主要實現點）
  }

  /**
   * 處理實驗停止
   * @private
   */
  _handleExperimentStop() {
    Logger.debug("停止實驗");
    // 未實作：停止處理（由 FlowManager 驅動為主要實現點）
  }

  /**
   * 處理重新產生ID
   * @private
   */
  async _handleRegenerateId() {
    Logger.debug("重新產生實驗ID");

    try {
      // 檢查是否在同步模式，並選擇適當的產生方法
      const hubManager = window.experimentHubManager;
      let newId;
      // 即使 hubManager 不存在，也允許在本機產生 ID（離線模式）
      if (hubManager && hubManager.isInSyncMode && hubManager.isInSyncMode()) {
        // 同步模式：使用中樞註冊邏輯
        Logger.debug("同步模式：產生新ID並註冊到中樞");
        newId = await this._generateExperimentIdWithHub();
      } else {
        // 獨立模式：直接產生新ID
        Logger.debug("獨立/離線模式：直接產生新ID");
        newId = this._generateExperimentId();
      }

      // 檢查產生的ID是否有效
      if (!newId || typeof newId !== "string" || newId.trim().length === 0) {
        Logger.error("重新產生實驗ID失敗：產生的ID無效或為空", {
          generatedId: newId,
        });
        return;
      }

      Logger.debug("已成功重新產生實驗ID:", newId);

      // 更新UI中的輸入框
      const idInput = document.querySelector("#experimentIdInput");
      if (idInput) {
        idInput.value = newId;
        Logger.debug("已更新UI中的實驗ID輸入框為:", newId);
      } else {
        Logger.warn("找不到實驗ID輸入框元素");
      }

      // 廣播ID更新到其他連線裝置
      this._broadcastExperimentIdUpdate(newId);

      // 觸發組合管理器的同步（如果需要）
      if (window.experimentCombinationManager) {
        // 通知組合管理器實驗ID已更改，可能需要重新同步
        window.experimentCombinationManager.handleExperimentIdChanged(newId);
      }
    } catch (error) {
      Logger.error("重新產生實驗ID失敗:", error);
    }
  }

  /**
   * 產生新的實驗ID（獨立模式）
   * @private
   * @returns {string} 新產生的實驗ID
   */
  _generateExperimentId() {
    // 優先使用 ExperimentHubManager（若存在），否則使用 RandomUtils 或內建後備方法
    if (
      window.experimentHubManager &&
      typeof window.experimentHubManager.generateExperimentId === "function"
    ) {
      return window.experimentHubManager.generateExperimentId();
    }

    if (
      window.RandomUtils &&
      typeof window.RandomUtils.generateExperimentId === "function"
    ) {
      return window.RandomUtils.generateExperimentId();
    }

    // 後備簡單產生器（6 位大寫英數）
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * 產生新的實驗ID並在同步模式下註冊到中樞
   * @private
   * @returns {Promise<string>} 新產生的實驗ID
   */
  async _generateExperimentIdWithHub() {
    try {
      Logger.debug("產生新的實驗ID...");

      // 產生新的實驗ID
      const newId = this._generateExperimentId();

      // 檢查是否在同步模式
      const hubManager = window.experimentHubManager;
      if (hubManager?.isInSyncMode?.()) {
        Logger.debug(`同步模式: 註冊新ID到中樞: ${newId}`);
        // 在同步模式下，experimentHubManager.generateExperimentId() 應該已經處理了註冊
      } else {
        Logger.debug(`獨立模式: 新ID僅存本機: ${newId}`);
      }

      return newId;
    } catch (error) {
      Logger.error("產生新實驗ID失敗:", error);
      throw error;
    }
  }

  /**
   * 廣播實驗ID更新到其他連線裝置
   * @private
   * @param {string} experimentId - 新的實驗ID
   */
  _broadcastExperimentIdUpdate(experimentId) {
    // 檢查是否存在同步工作階段
    if (!window.syncManager?.core?.isConnected?.()) {
      return;
    }

    const updateData = {
      type: "experimentIdUpdate",
      client_id:
        window.syncManager?.core?.syncClient?.clientId || "experiment_panel",
      experimentId: experimentId,
      timestamp: new Date().toISOString(),
    };

    // 使用統一的同步機制
    window.syncManager.core.syncState(updateData).catch((error) => {
      Logger.warn("廣播實驗ID更新失敗:", error);
    });

    // 分派事件供本機同步管理器捕獲
    document.dispatchEvent(
      new CustomEvent("experimentStateChange", {
        detail: updateData,
      }),
    );

    Logger.debug("已廣播實驗ID更新:", experimentId);
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
