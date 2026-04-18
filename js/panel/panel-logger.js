/**
 * PanelLogger - 操作日誌記錄功能模塊
 *
 * 負責操作日誌記錄、顯示和管理
 * 日誌格式與 Board 端 RecordManager 對齊：
 *   { ts, type, exp_id, a_id, src, msg, ... }
 * 無同步連線時，兩端日誌可依 ts 時間戳直接合併排序
 */
import { Logger } from "../core/console-manager.js";
import { RECORD_TYPES } from "../constants/index.js";
import ExperimentFlowManager from "../experiment/experiment-flow-manager.js";

class PanelLogger {
  // ==================== 建構子與初始化 ====================

  constructor({
    timeSyncManager,
    experimentFlowManager,
    experimentActionHandler,
    syncClient,
    syncManager,
    panelMediaManager,
    buttonManager,
  } = {}) {
    this.logEntries = [];
    this.logger = Logger;
    this.timeSyncManager = timeSyncManager;
    this.experimentFlowManager = experimentFlowManager;
    this.experimentActionHandler = experimentActionHandler;
    this.syncClient = syncClient;
    this.syncManager = syncManager;
    this.panelMediaManager = panelMediaManager;
    this.buttonManager = buttonManager;

    // DOM 元素引用 - 延遲初始化
    this.loggerOutput = null;
    this.logContent = null;
    this.loggerFabButton = null;
    this._flowEventsBound = false;
    this._flowEventUnsubscribers = [];

    this.initializeDOMElements();
  }

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

  setupDOMElements() {
    this.loggerOutput = document.getElementById("loggerOutput");
    this.logContent = document.getElementById("logContent");
    this.loggerFabButton = document.getElementById("loggerFabButton");
  }

  updateDependencies(deps = {}) {
    Object.assign(this, deps);
  }

  // ==================== 時間戳取得 ====================

  /**
   * 取得同步後的 Unix 毫秒時間戳（與 Board 端 ts 欄位相容）
   */
  _getTs() {
    const tsm = this.timeSyncManager;
    return tsm?.isSynchronized?.() ? tsm.getServerTime() : Date.now();
  }

  /**
   * 取得目前實驗 ID
   */
  _getExpId() {
    const systemId = this.experimentSystemManager?.getExperimentId?.();
    if (systemId) return systemId;

    const flowId = this.experimentFlowManager?.experimentId;
    if (flowId) return flowId;

    const input = document.getElementById("experimentIdInput");
    const inputId = input?.value?.trim();
    if (inputId) return inputId;

    return "";
  }

  /**
   * 取得裝置 ID
   */
  _getClientId() {
    return (
      this.syncClient?.clientId ||
      this.syncManager?.clientId ||
      "panel_device"
    );
  }

  // ==================== 核心日誌方法 ====================

  /**
   * 記錄按鈕/功能操作
   * 格式與 Board 端 ACTION 類型日誌對齊：{ ts, type, exp_id, a_id, src, msg, ... }
   *
   * @param {string} actionMessage - 人類可讀的動作描述
   * @param {string|null} buttonId - 按鈕 ID（B1-B16）
   * @param {string|null} functionName - 函數名稱
   * @param {boolean} isKeyboard - 是否鍵盤觸發
   * @param {boolean} isTouch - 是否觸控觸發
   * @param {boolean} isCombo - 是否組合操作
   * @param {Object|null} comboDetails - 組合操作詳情
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
    const ts = this._getTs();
    const expId = this._getExpId();

    const logEntry = {
      ts,
      type: RECORD_TYPES.ACTION,
      exp_id: expId,
      a_id: buttonId || functionName || null,
      src: "panel",
      msg: actionMessage,
    };

    if (isKeyboard) logEntry.kbd = true;
    if (isTouch) logEntry.touch = true;
    if (isCombo && comboDetails) logEntry.combo = comboDetails;
    if (Object.keys(additionalData).length > 0) logEntry.extra = additionalData;

    this.logEntries.push(logEntry);
    this.displayLogEntry(logEntry);
  }

  // ==================== 實驗生命週期日誌 ====================

  /**
   * 記錄實驗開始（對應 Board 的 EXP_START）
   */
  logExperimentStart(experimentId, participantName) {
    const expId = experimentId || this._getExpId();
    const logEntry = {
      ts: this._getTs(),
      type: RECORD_TYPES.EXP_START,
      exp_id: expId,
      src: "panel",
    };
    if (participantName) logEntry.participant = participantName;

    this.logEntries.push(logEntry);
    this.displayLogEntry(logEntry);
  }

  /**
   * 記錄實驗結束（對應 Board 的 EXP_END）
   */
  logExperimentEnd(experimentId) {
    const logEntry = {
      ts: this._getTs(),
      type: RECORD_TYPES.EXP_END,
      exp_id: experimentId || this._getExpId(),
      src: "panel",
    };
    this.logEntries.push(logEntry);
    this.displayLogEntry(logEntry);
  }

  /**
   * 記錄實驗暫停（對應 Board 的 EXP_PAUSE）
   */
  logExperimentPause() {
    const logEntry = {
      ts: this._getTs(),
      type: RECORD_TYPES.EXP_PAUSE,
      exp_id: this._getExpId(),
      src: "panel",
    };
    this.logEntries.push(logEntry);
    this.displayLogEntry(logEntry);
  }

  /**
   * 記錄實驗繼續（對應 Board 的 EXP_RESUME）
   */
  logExperimentResume() {
    const logEntry = {
      ts: this._getTs(),
      type: RECORD_TYPES.EXP_RESUME,
      exp_id: this._getExpId(),
      src: "panel",
    };
    this.logEntries.push(logEntry);
    this.displayLogEntry(logEntry);
  }

  // ==================== 事件綁定 ====================

  /**
   * 綁定 ExperimentFlowManager 事件，自動記錄實驗生命週期日誌
   * 在 PanelPageManager 初始化完成後呼叫
   * @param {ExperimentFlowManager} flowManager
   */
  bindExperimentEvents(flowManager) {
    if (!flowManager) return () => {};

    if (this._flowEventsBound) {
      Logger.debug("PanelLogger: 實驗生命週期事件已綁定，略過重複綁定");
      return () => this.unbindExperimentEvents();
    }

    this._flowEventsBound = true;
    const unsubscribers = [];

    unsubscribers.push(flowManager.on(ExperimentFlowManager.EVENT.STARTED, () => {
      const expId = this._getExpId();
      const participantName =
        document.getElementById("participantNameInput")?.value?.trim() || "";
      this.logExperimentStart(expId, participantName);
    }));

    unsubscribers.push(flowManager.on(ExperimentFlowManager.EVENT.PAUSED, () => {
      this.logExperimentPause();
    }));

    unsubscribers.push(flowManager.on(ExperimentFlowManager.EVENT.RESUMED, () => {
      this.logExperimentResume();
    }));

    unsubscribers.push(flowManager.on(ExperimentFlowManager.EVENT.STOPPED, () => {
      this.logExperimentEnd();
    }));

    unsubscribers.push(flowManager.on(ExperimentFlowManager.EVENT.COMPLETED, () => {
      this.logExperimentEnd();
    }));

    this._flowEventUnsubscribers = unsubscribers;

    Logger.debug("PanelLogger: 已綁定實驗生命週期事件");
    return () => this.unbindExperimentEvents();
  }

  unbindExperimentEvents() {
    this._flowEventUnsubscribers.forEach((unsubscribe) => {
      try {
        unsubscribe?.();
      } catch (error) {
        Logger.warn("PanelLogger: 解除實驗生命週期事件失敗", error);
      }
    });
    this._flowEventUnsubscribers = [];
    this._flowEventsBound = false;
  }

  // ==================== 顯示層 ====================

  /**
   * 在日誌面板中顯示一筆日誌條目
   */
  displayLogEntry(logEntry) {
    if (!this.logContent) return;

    const logElement = document.createElement("div");
    logElement.className = `log-entry ${logEntry.type}`;

    const tsm = this.timeSyncManager;
    const time = tsm?.formatDateTime
      ? tsm.formatDateTime(new Date(logEntry.ts))
      : new Date(logEntry.ts).toISOString();

    const label = logEntry.msg || logEntry.type;
    const actionId = logEntry.a_id ? ` [${logEntry.a_id}]` : "";
    logElement.textContent = `[${time}]${actionId} ${label}`;

    this.logContent.appendChild(logElement);
    this.logContent.scrollTop = this.logContent.scrollHeight;
  }

  // ==================== 管理操作 ====================

  clearLog() {
    this.logEntries = [];
    if (this.logContent) {
      this.logContent.innerHTML = "";
    }
    this.logAction("日誌已清空");

    const mediaManager = this.panelMediaManager;
    if (mediaManager) {
      mediaManager.reset();
    }

    const buttonManager = this.buttonManager;
    if (buttonManager) {
      buttonManager.buttonFunctionsMap = {};
      buttonManager.loadButtonFunctions();
    }
  }

  exportLog() {
    if (this.logEntries.length === 0) {
      this.logger.warn("沒有日誌內容可匯出");
      return;
    }

    const allLogsJsonl = this._toJsonl(this.logEntries);
    const experimentOnlyLogs = this._getExperimentOnlyLogs(this.logEntries);
    const experimentOnlyJsonl = this._toJsonl(experimentOnlyLogs);

    const now = new Date();
    const pad = (n) => n.toString().padStart(2, "0");
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate(),
    )}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(
      now.getSeconds(),
    )}`;

    const rawExperimentId =
      this._getExpId() ||
      [...this.logEntries]
        .reverse()
        .find((entry) => entry?.exp_id)?.exp_id ||
      "unknown_experiment";
    const safeExperimentId = String(rawExperimentId)
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "-") || "unknown_experiment";

    const allLogFileName = `panel_log_${safeExperimentId}_${timestamp}.jsonl`;
    const experimentOnlyFileName =
      `panel_record_${safeExperimentId}_${timestamp}.jsonl`;

    this._downloadJsonl(allLogsJsonl, allLogFileName);

    if (experimentOnlyLogs.length > 0) {
      this._downloadJsonl(experimentOnlyJsonl, experimentOnlyFileName);
    }

    this.logAction("日誌已匯出為 JSONL", null, "export_log", false, false, false, null, {
      exported_all_count: this.logEntries.length,
      exported_experiment_only_count: experimentOnlyLogs.length,
      exported_files: experimentOnlyLogs.length > 0
        ? [allLogFileName, experimentOnlyFileName]
        : [allLogFileName],
    });
  }

  _downloadJsonl(content, fileName) {
    const blob = new Blob([content], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  _toJsonl(entries = []) {
    return entries
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => JSON.stringify(entry))
      .join("\n");
  }

  _getExperimentOnlyLogs(entries = []) {
    return entries.filter((entry) => {
      const type = entry?.type;
      const actionId = entry?.a_id;

      return (
        type === RECORD_TYPES.EXP_START ||
        type === RECORD_TYPES.EXP_END ||
        type === RECORD_TYPES.EXP_PAUSE ||
        type === RECORD_TYPES.EXP_RESUME ||
        (
          type === RECORD_TYPES.ACTION &&
          Boolean(actionId) &&
          actionId !== "export_log"
        )
      );
    });
  }

  copyLog() {
    if (this.logEntries.length === 0) {
      this.logger.warn("沒有日誌內容可複製");
      return;
    }

    const tsm = this.timeSyncManager;
    const logText = this.logEntries
      .map((entry) => {
        const time = tsm?.formatDateTime
          ? tsm.formatDateTime(new Date(entry.ts))
          : new Date(entry.ts).toISOString();
        const label = entry.msg || entry.type;
        const actionId = entry.a_id ? ` [${entry.a_id}]` : "";
        return `[${time}]${actionId} ${label}`;
      })
      .join("\n");

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(logText)
        .then(() => {
          this.logger.debug("日誌已複製到剪貼簿");
          this.logAction("日誌已複製到剪貼簿");
          this.showCopySuccess();
        })
        .catch(() => {
          this.handleCopyError("複製失敗");
        });
    } else {
      this.handleCopyError(
        "瀏覽器不支援自動複製功能，請手動選取並複製日誌內容",
      );
    }
  }

  handleCopyError(errorMessage) {
    this.logger.error("複製功能錯誤:", errorMessage);
    this.showCopyError();
  }

  showCopySuccess() {
    const copyButton = document.getElementById("copyLogButton");
    if (copyButton) {
      copyButton.classList.add("copy-success");
      setTimeout(() => copyButton.classList.remove("copy-success"), 1500);
    }
  }

  showCopyError() {
    const copyButton = document.getElementById("copyLogButton");
    if (copyButton) {
      copyButton.classList.add("copy-error");
      setTimeout(() => copyButton.classList.remove("copy-error"), 3000);
    }
  }

  setupEventListeners() {
    const clearLogButton = document.getElementById("clearLogButton");
    if (clearLogButton) {
      clearLogButton.addEventListener("click", () => this.clearLog());
    }

    const exportLogButton = document.getElementById("exportLogButton");
    if (exportLogButton) {
      exportLogButton.addEventListener("click", () => this.exportLog());
    }

    const copyLogButton = document.getElementById("copyLogButton");
    if (copyLogButton) {
      copyLogButton.addEventListener("click", () => this.copyLog());
    }
  }
}

// ES6 模組匯出
export default PanelLogger;
export { PanelLogger };
