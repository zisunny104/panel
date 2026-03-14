/**
 * PanelLogger - 操作日誌記錄功能模塊
 *
 * 負責操作日誌記錄、顯示和管理
 * 提供日誌記錄、面板控制、匯出等功能
 */
class PanelLogger {
  // ==================== 建構子與初始化 ====================

  /**
   * 建構子 - 初始化日誌面板
   */
  constructor() {
    this.logEntries = [];

    // DOM 元素引用 - 延遲初始化
    this.loggerOutput = null;
    this.logContent = null;
    this.loggerFabButton = null;

    // FAB click is handled by PanelUIManager to keep panel open/close logic consistent

    // 延遲初始化，等待 DOM 載入完成
    this.initializeDOMElements();
  }

  /**
   * 初始化 DOM 元素引用
   */
  initializeDOMElements() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        this.setupDOMElements();
        this.setupEventListeners();
      });
    } else {
      this.setupDOMElements();
      this.setupEventListeners();
    }
  }

  /**
   * 設置 DOM 元素引用
   */
  setupDOMElements() {
    this.loggerOutput = document.getElementById("loggerOutput");
    this.logContent = document.getElementById("logContent");
    this.loggerFabButton = document.getElementById("loggerFabButton");
  }

  /**
   * 偵測是否在實驗模式
   */
  isExperimentMode() {
    return (
      (window.experimentFlowManager &&
        window.experimentFlowManager.isExperimentRunning()) ||
      false
    );
  }

  /**
   * 格式化日期時間為 YYYY-MM-DD HH:MM:SS 格式（東八區）
   * @param {Date|number} date - 要格式化的日期物件或毫秒級時間戳
   * @param {Object} options - 選項
   * @returns {string} 格式化後的時間字串
   */
  formatDateTime(date, options = {}) {
    return window.timeSyncManager
      ? window.timeSyncManager.formatDateTime(date, options)
      : (() => {
          const d = typeof date === "number" ? new Date(date) : date;
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, "0");
          const day = String(d.getDate()).padStart(2, "0");
          const hours = String(d.getHours()).padStart(2, "0");
          const minutes = String(d.getMinutes()).padStart(2, "0");
          const seconds = String(d.getSeconds()).padStart(2, "0");
          return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        })();
  }

  /**
   * 取得目前實驗狀態資訊
   * @returns {Object} 實驗狀態資訊
   */
  getExperimentInfo() {
    const defaultInfo = {
      is_running: false,
      action_progress: null,
      current_step: null,
    };

    const isRunning =
      window.experimentFlowManager?.isRunning ||
      (window.experiment && window.experiment.isExperimentRunning) ||
      false;

    if (!isRunning) {
      return defaultInfo;
    }

    const experimentInfo = {
      is_running: true,
      action_progress: null,
      current_step: null,
    };

    if (
      window.experimentActionHandler &&
      window.experimentActionHandler.getProgress
    ) {
      try {
        const progress = window.experimentActionHandler.getProgress();
        if (progress) {
          experimentInfo.action_progress = progress;
        }
      } catch (error) {
        Logger.warn("取得動作進度時發生錯誤:", error);
      }
    }

    return experimentInfo;
  }

  // ==================== 核心日誌功能 ====================

  /**
   * 記錄動作
   * @param {string} actionMessage - 動作訊息
   * @param {string|null} buttonId - 按鈕ID
   * @param {string|null} functionName - 函數名稱
   * @param {boolean} isKeyboard - 是否鍵盤觸發
   * @param {boolean} isTouch - 是否觸控觸發
   * @param {boolean} isCombo - 是否組合按鈕操作
   * @param {Object} comboDetails - 組合按鈕詳情
   * @param {Object} additionalData - 額外資料
   */
  logAction(
    actionMessage,
    buttonId = null,
    functionName = null,
    isKeyboard = false,
    isTouch = false,
    isCombo = false,
    comboDetails = null,
    additionalData = {},
  ) {
    const now = new Date();
    const timestamp = now.toISOString();
    const formattedTime = this.formatDateTime(now);

    // 取得實驗狀態資訊
    const experimentInfo = this.getExperimentInfo();

    // 判斷動作類型和重要性
    const actionType = this.classifyAction(
      actionMessage,
      buttonId,
      functionName,
    );

    // 取得裝置ID
    const clientId =
      window.syncManager?.core?.syncClient?.clientId ||
      window.syncClient?.clientId ||
      "panel_device";

    const logEntry = {
      timestamp,
      formatted_time: formattedTime,
      client_id: clientId,
      action: actionMessage,
      action_type: actionType.type,
      is_experiment_relevant: actionType.isExperimentRelevant,
      button_id: buttonId,
      function_name: functionName,
      is_keyboard_triggered: isKeyboard,
      is_touch_triggered: isTouch,
      is_combo_operation: isCombo,
      combo_details: comboDetails,
      experiment_info: experimentInfo,
      additional_data: additionalData,
    };

    this.logEntries.push(logEntry);

    // 顯示在日誌面板
    this.displayLogEntry(logEntry);
  }

  /**
   * 顯示日誌條目在面板中
   */
  displayLogEntry(logEntry) {
    if (!this.logContent) return;

    const logElement = document.createElement("div");
    logElement.className = `log-entry ${logEntry.action_type}`;

    // 根據重要性調整顯示樣式
    if (logEntry.is_experiment_relevant) {
      logElement.classList.add("experiment-relevant");
    }

    let displayText = `[${logEntry.formatted_time}] ${logEntry.action}`;

    // 如果是實驗模式，新增簡潔的進度資訊
    if (logEntry.experiment_info.is_running) {
      if (logEntry.experiment_info.action_progress) {
        const progress = logEntry.experiment_info.action_progress;
        displayText += ` [${progress.current}/${progress.total}]`;
      }
    }

    logElement.textContent = displayText;
    this.logContent.appendChild(logElement);
    this.logContent.scrollTop = this.logContent.scrollHeight;
  }

  /**
   * 分類動作類型和重要性
   * @param {string} actionMessage - 動作訊息
   * @param {string|null} buttonId - 按鈕 ID
   * @param {string|null} functionName - 功能名稱
   * @returns {Object} 包含 type 和 isExperimentRelevant 的物件
   */
  classifyAction(actionMessage, buttonId, functionName) {
    let type = "general";
    let isExperimentRelevant = false;

    // 根據按鈕 ID 或功能名稱判斷類型
    if (buttonId) {
      if (buttonId.startsWith("power-")) {
        type = "power-control";
      } else if (buttonId.includes("experiment") || buttonId.includes("sync")) {
        type = "experiment-control";
        isExperimentRelevant = true;
      } else if (
        buttonId.includes("unit-") ||
        buttonId.includes("combination")
      ) {
        type = "unit-operation";
        isExperimentRelevant = true;
      } else {
        type = "button-action";
      }
    } else if (functionName) {
      if (
        functionName.includes("experiment") ||
        functionName.includes("sync")
      ) {
        type = "experiment-control";
        isExperimentRelevant = true;
      } else {
        type = "function-call";
      }
    }

    // 根據動作訊息進一步調整
    if (
      actionMessage.includes("開始") ||
      actionMessage.includes("結束") ||
      actionMessage.includes("啟動") ||
      actionMessage.includes("停止")
    ) {
      isExperimentRelevant = true;
    }

    if (
      actionMessage.includes("清空") ||
      actionMessage.includes("匯出") ||
      actionMessage.includes("複製")
    ) {
      type = "system-action";
    }

    return { type, isExperimentRelevant };
  }

  /**
   * 清空日誌
   */
  clearLog() {
    this.logEntries = [];
    if (this.logContent) {
      this.logContent.innerHTML = "";
    }
    this.logAction("日誌已清空");

    // 重設媒體
    if (window.mediaManager) {
      window.mediaManager.reset();
    }

    // 重設按鈕功能
    if (window.buttonManager) {
      window.buttonManager.buttonFunctionsMap = {};
      window.buttonManager.loadButtonFunctions();
    }
  }

  /**
   * 匯出日誌為 JSON
   */
  exportLog() {
    const logData = JSON.stringify(this.logEntries, null, 2);
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, "0");
    const fileName = `log_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate(),
    )}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(
      now.getSeconds(),
    )}.json`;

    const blob = new Blob([logData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.logAction("日誌已匯出為 JSON 檔案");
  }

  /**
   * 複製日誌到剪貼簿
   */
  copyLog() {
    // 檢查是否有日誌內容
    if (this.logEntries.length === 0) {
      Logger.warn("沒有日誌內容可複製");
      return;
    }

    // 將日誌格式化為可讀的文字
    const logText = this.logEntries
      .map((entry) => {
        const time = this.formatDateTime(new Date(entry.timestamp));
        return `[${time}] ${entry.action} (${entry.action_type || "unknown"})`;
      })
      .join("\n");

    // 優先使用現代 Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(logText)
        .then(() => {
          if (typeof Logger !== "undefined") {
            Logger.debug("日誌已複製到剪貼簿");
          }
          this.logAction("日誌已複製到剪貼簿");
          this.showCopySuccess();
        })
        .catch((err) => {
          this.handleCopyError("複製失敗");
        });
    } else {
      this.handleCopyError(
        "瀏覽器不支援自動複製功能，請手動選取並複製日誌內容",
      );
    }
  }

  /**
   * 處理複製錯誤
   */
  handleCopyError(errorMessage) {
    Logger.error("複製功能錯誤:", errorMessage);
    this.showCopyError();
  }

  /**
   * 顯示複製成功的視覺回饋
   */
  showCopySuccess() {
    const copyButton = document.getElementById("copyLogButton");
    if (copyButton) {
      copyButton.classList.add("copy-success");

      setTimeout(() => {
        copyButton.classList.remove("copy-success");
      }, 1500);
    }
  }

  /**
   * 顯示複製失敗的錯誤提示
   */
  showCopyError() {
    const copyButton = document.getElementById("copyLogButton");
    if (copyButton) {
      copyButton.classList.add("copy-error");

      setTimeout(() => {
        copyButton.classList.remove("copy-error");
      }, 3000);
    }
  }

  // showLoggerPanel / hideLoggerPanel / minimizeLogger 已移除
  // 所有面板開關統一透過 PanelUIManager.openPanel / closePanel 處理

  /**
   * 切換日誌面板，加入短暫去抖動以避免多重輸入事件造成重複切換
   */
  // toggleLogger removed; PanelUIManager handles panel toggling centrally

  /**
   * 設定事件監聽器
   */
  setupEventListeners() {
    // 清空日誌按鈕
    const clearLogButton = document.getElementById("clearLogButton");
    if (clearLogButton) {
      clearLogButton.addEventListener("click", () => this.clearLog());
    }

    // 匯出日誌按鈕
    const exportLogButton = document.getElementById("exportLogButton");
    if (exportLogButton) {
      exportLogButton.addEventListener("click", () => this.exportLog());
    }

    // 複製日誌按鈕
    const copyLogButton = document.getElementById("copyLogButton");
    if (copyLogButton) {
      copyLogButton.addEventListener("click", () => this.copyLog());
    }

    // 關閉按鈕 / FAB 按鈕 / 點擊外部關閉 — 統一由 PanelUIManager 處理
  }
}

// 匯出單例
window.logger = new PanelLogger();
