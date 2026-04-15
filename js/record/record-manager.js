/**
 * RecordManager - 實驗紀錄管理系統
 *
 * 負責記錄實驗過程的所有事件，支援 JSONL 格式與 IndexedDB 本機儲存。
 *
 * 依賴（透過 updateDependencies 注入）：
 *   syncClient      → SyncClient 實例
 *   view            → RecordView 實例（用於更新即時日誌顯示）
 *   getGestures     → (index: number) => Object  取得指定手勢資料
 *   getGesturesData → () => Object               手勢資料字典
 *   getCombination  → () => Object               目前實驗組合
 */

import {
  RECORD_TYPES,
  RECORD_TYPE_LABELS,
  GESTURE_ATTEMPT_TYPES,
  GESTURE_ATTEMPT_TYPE_LABELS,
  RECORD_SOURCES,
  SYNC_EVENTS,
} from "../constants/index.js";
import { recordStore } from "./record-store.js";
import { recordRuntime } from "./record-runtime.js";
import { Logger } from "../core/console-manager.js";

class RecordManager {
  /**
   * @param {Object} [options]
   * @param {Object} [options.timeSyncManager] - 時間同步管理器（用於取得伺服器時間戳）
   * @param {Object} [options.stateManager]   - 實驗狀態管理器（用於監聽實驗 ID 變更）
   */
  constructor({ timeSyncManager = null, stateManager = null } = {}) {
    // 日誌狀態
    this.logs = [];
    this.pendingLogs = [];
    this.experimentId = null;
    this.participantName = null;
    this.experimentStartTime = null;
    this._flushAllInProgress = false;
    this._lastFlushAllExperimentId = null;

    // 設定
    this.syncEnabled = false;
    this.bufferSize = 10;
    this.maxPendingLogs = 100;

    // 注入的依賴
    this.timeSyncManager = timeSyncManager;
    this.stateManager = stateManager;
    this.syncClient = null;
    this.view = null;
    this.getGestures = null;
    this.getGesturesData = null;
    this.getCombination = null;

    // IndexedDB
    this.db = null;
    this.dbName = "ExperimentLogsDB";
    this.dbVersion = 1;
    this.pendingLogsStore = "pendingLogs";

    // 多分頁同步
    this.broadcastChannel = null;
    this.tabId = crypto.randomUUID?.() ?? `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    this._initIndexedDB();
    this._initBroadcastChannel();
    this._setupExperimentIdSync();

    this.initialized = true;
    Logger.debug(`RecordManager 初始化完成，分頁 ID: ${this.tabId}`);
  }

  /**
   * 注入或更新執行期依賴
   * @param {Object}   [deps]
   * @param {Object}   [deps.syncClient]      - SyncClient 實例
   * @param {Object}   [deps.view]            - RecordView 實例
   * @param {Function} [deps.getGestures]     - `(index) => gesture` 取得指定索引的手勢物件
   * @param {Function} [deps.getGesturesData] - `() => Object` 取得手勢資料字典
   * @param {Function} [deps.getCombination]  - `() => Object` 取得目前實驗組合
   */
  updateDependencies({ syncClient, view, getGestures, getGesturesData, getCombination } = {}) {
    if (syncClient !== undefined) this.syncClient = syncClient;
    if (view !== undefined) this.view = view;
    if (getGestures !== undefined) this.getGestures = getGestures;
    if (getGesturesData !== undefined) this.getGesturesData = getGesturesData;
    if (getCombination !== undefined) this.getCombination = getCombination;
  }

  // ─── 實驗 ID 同步 ──────────────────────────────────────────────────────────

  _setupExperimentIdSync() {
    if (this.stateManager) {
      this.stateManager.on?.("experimentIdChanged", (data) => {
        this.experimentId = data.experimentId;
      });
      this.experimentId = this.stateManager.experimentId;
      return;
    }

    // 備用：監聽輸入框
    const experimentIdInput = document.getElementById("experimentIdInput");
    if (experimentIdInput) {
      const syncId = (e) => {
        const newId = e.target.value.trim();
        if (newId !== this.experimentId) this.experimentId = newId;
      };
      experimentIdInput.addEventListener("input", syncId);
      experimentIdInput.addEventListener("change", syncId);
      if (experimentIdInput.value.trim()) this.experimentId = experimentIdInput.value.trim();
    }

    document.addEventListener("experiment_id_updated", (event) => {
      this.experimentId = event.detail.experimentId;
    });
  }

  getExperimentId() { return this.experimentId; }
  _getCurrentExperimentId() { return this.experimentId; }
  _getClientId() { return this.syncClient?.clientId || null; }

  /**
   * 取得指定索引的手勢 ID
   */
  _getGestureId(gestureIndex) {
    const gesture = this.getGestures?.(gestureIndex);
    return gesture?.gesture_id || gesture?.gestureId || gesture?.gesture || gesture?.id || null;
  }

  /**
   * 取得指定索引的手勢名稱
   */
  _getGestureName(gestureIndex) {
    const gesture = this.getGestures?.(gestureIndex);
    return gesture?.gesture_name || gesture?.name || null;
  }

  // ─── 公開 API：初始化 ──────────────────────────────────────────────────────

  /**
   * 初始化日誌管理器（實驗開始時呼叫，重置所有日誌狀態）
   * @param {string} experimentId    - 實驗 ID
   * @param {string} participantName - 受試者名稱
   * @returns {boolean} 是否初始化成功
   */
  initialize(experimentId, participantName) {
    try {
      this.setExperimentId(experimentId, "initialize");
      this.participantName = participantName || `受試者_${experimentId}`;
      this.logs = [];
      this.pendingLogs = [];
      this.experimentStartTime = null;
      this._lastFlushAllExperimentId = null;
      this._flushAllInProgress = false;
      Logger.info(`RecordManager 初始化: ID=${experimentId}, 受試者=${this.participantName}`);
      return true;
    } catch (error) {
      Logger.error("初始化失敗:", error);
      return false;
    }
  }

  /**
   * 設定實驗 ID，並同步更新 input 元素與發送自訂事件
   * @param {string} experimentId
   * @param {string} [source] - 更新來源（預設為 LOCAL_INPUT）
   */
  setExperimentId(experimentId, source = RECORD_SOURCES.LOCAL_INPUT) {
    if (this.stateManager) {
      this.stateManager.setExperimentId(experimentId, source);
      return;
    }
    if (this.experimentId === experimentId) return;

    this.experimentId = experimentId;
    const experimentIdInput = document.getElementById("experimentIdInput");
    if (experimentIdInput && experimentIdInput.value.trim() !== experimentId) {
      experimentIdInput.value = experimentId;
    }

    document.dispatchEvent(new CustomEvent(SYNC_EVENTS.EXPERIMENT_ID_CHANGED, {
      detail: { experimentId, source },
    }));
  }

  setInternalExperimentId(experimentId) { this.experimentId = experimentId; }

  // ─── 公開 API：日誌記錄 ────────────────────────────────────────────────────

  logExperimentStart() {
    const experimentId = this._getCurrentExperimentId();
    if (!experimentId) { Logger.warn("實驗ID未設定"); return; }

    this.experimentStartTime = this._getTimestamp();
    const combinationInfo = this.getCombination?.() ?? {};
    const unitOrder = this.stateManager?.currentUnitIds?.join?.("->") ?? "";

    const logEntry = {
      ts: this.experimentStartTime,
      type: RECORD_TYPES.EXP_START,
      exp_id: experimentId,
      participant: this.participantName || "",
    };

    const clientId = this._getClientId();
    if (clientId) logEntry.c_id = clientId;
    if (combinationInfo.combinationId) logEntry.combo_id = combinationInfo.combinationId;
    if (combinationInfo.combinationName) logEntry.combo_name = combinationInfo.combinationName;
    if (unitOrder) logEntry.unit_order = unitOrder;

    this._addLog(logEntry);
    Logger.debug("記錄: 實驗開始", logEntry);
  }

  logExperimentEnd() {
    const experimentId = this._getCurrentExperimentId();
    if (!experimentId) { Logger.warn("實驗ID未設定"); return; }

    const logEntry = {
      ts: this._getTimestamp(),
      type: RECORD_TYPES.EXP_END,
      exp_id: experimentId,
      participant: this.participantName || "",
    };
    const clientId = this._getClientId();
    if (clientId) logEntry.c_id = clientId;

    this._addLog(logEntry);
    Logger.debug("記錄: 實驗結束", logEntry);
  }

  logExperimentPause() {
    const experimentId = this._getCurrentExperimentId();
    if (!experimentId) return;
    const logEntry = { ts: this._getTimestamp(), type: RECORD_TYPES.EXP_PAUSE, exp_id: experimentId };
    const clientId = this._getClientId();
    if (clientId) logEntry.c_id = clientId;
    this._addLog(logEntry);
  }

  logExperimentResume() {
    const experimentId = this._getCurrentExperimentId();
    if (!experimentId) return;
    const logEntry = { ts: this._getTimestamp(), type: RECORD_TYPES.EXP_RESUME, exp_id: experimentId };
    const clientId = this._getClientId();
    if (clientId) logEntry.c_id = clientId;
    this._addLog(logEntry);
  }

  /**
   * 記錄手勢步驟開始
   * @param {number}      gestureIndex - 手勢在組合中的索引
   * @param {string|null} [stepId]     - 步驟 ID（可選）
   */
  logGestureStepStart(gestureIndex, stepId = null) {
    const experimentId = this._getCurrentExperimentId();
    const gestureId = this._getGestureId(gestureIndex);
    const clientId = this._getClientId();

    const logEntry = {
      ts: this._getTimestamp(),
      type: RECORD_TYPES.GESTURE_STEP_START,
      exp_id: experimentId,
      g_idx: gestureIndex,
    };
    if (gestureId) logEntry.g_id = gestureId;
    if (stepId) logEntry.s_id = stepId;
    if (clientId) logEntry.c_id = clientId;
    this._addLog(logEntry);
  }

  /**
   * 記錄手勢步驟結束
   * @param {number}      gestureIndex - 手勢在組合中的索引
   * @param {string|null} [stepId]     - 步驟 ID（可選）
   */
  logGestureStepEnd(gestureIndex, stepId = null) {
    const experimentId = this._getCurrentExperimentId();
    const gestureId = this._getGestureId(gestureIndex);
    const clientId = this._getClientId();

    const logEntry = {
      ts: this._getTimestamp(),
      type: RECORD_TYPES.GESTURE_STEP_END,
      exp_id: experimentId,
      g_idx: gestureIndex,
    };
    if (gestureId) logEntry.g_id = gestureId;
    if (stepId) logEntry.s_id = stepId;
    if (clientId) logEntry.c_id = clientId;
    this._addLog(logEntry);
  }

  /**
   * 記錄手勢步驟暫停
   * @param {number}      gestureIndex - 手勢在組合中的索引
   * @param {string|null} [stepId]     - 步驟 ID（可選）
   */
  logGestureStepPause(gestureIndex, stepId = null) {
    const experimentId = this._getCurrentExperimentId();
    const gestureId = this._getGestureId(gestureIndex);
    const clientId = this._getClientId();

    const logEntry = {
      ts: this._getTimestamp(),
      type: RECORD_TYPES.GESTURE_STEP_PAUSE,
      exp_id: experimentId,
      g_idx: gestureIndex,
    };
    if (gestureId) logEntry.g_id = gestureId;
    if (stepId) logEntry.s_id = stepId;
    if (clientId) logEntry.c_id = clientId;
    this._addLog(logEntry);
  }

  /**
   * 記錄手勢嘗試結果
   * @param {number}      gestureIndex - 手勢在組合中的索引
   * @param {string}      gestureType  - 嘗試類型，必須是 GESTURE_ATTEMPT_TYPES 的值（t/f/n）
   * @param {string|null} [stepId]     - 步驟 ID（可選）
   */
  logGestureAttempt(gestureIndex, gestureType, stepId = null) {
    const experimentId = this._getCurrentExperimentId();

    if (!Object.values(GESTURE_ATTEMPT_TYPES).includes(gestureType)) {
      Logger.warn(`無效的手勢類型: ${gestureType}`);
      return;
    }

    const gestureId = this._getGestureId(gestureIndex);
    const logEntry = {
      ts: this._getTimestamp(),
      type: RECORD_TYPES.GESTURE_ATTEMPT,
      exp_id: experimentId,
      g_idx: gestureIndex,
      g_type: gestureType,
    };
    if (gestureId) logEntry.g_id = gestureId;
    if (stepId) logEntry.s_id = stepId;

    this._addLog(logEntry);
    Logger.debug(`記錄: 手勢嘗試 (${GESTURE_ATTEMPT_TYPE_LABELS[gestureType]})`, logEntry);
  }

  /**
   * 記錄一般操作事件
   * @param {string}      actionId         - 操作識別碼
   * @param {number|null} [gestureIndex]   - 相關手勢索引（可選）
   * @param {string|null} [stepId]         - 相關步驟 ID（可選）
   */
  logAction(actionId, gestureIndex = null, stepId = null) {
    const experimentId = this._getCurrentExperimentId();
    const clientId = this._getClientId();
    const gestureId = gestureIndex !== null ? this._getGestureId(gestureIndex) : null;

    const logEntry = {
      ts: this._getTimestamp(),
      type: RECORD_TYPES.ACTION,
      exp_id: experimentId,
      a_id: actionId,
    };
    if (gestureIndex !== null) logEntry.g_idx = gestureIndex;
    if (gestureId) logEntry.g_id = gestureId;
    if (stepId) logEntry.s_id = stepId;
    if (clientId) logEntry.c_id = clientId;
    this._addLog(logEntry);
  }

  /**
   * 記錄 MR 端按鈕操作事件
   * @param {string} button         - 按鈕名稱
   * @param {string} buttonFunction - 按鈕功能描述
   * @param {string} clientId       - 觸發操作的客戶端 ID
   * @param {string} [actionId]     - 對應的操作 ID（可選）
   */
  logButtonAction(button, buttonFunction, clientId, actionId = "") {
    const experimentId = this._getCurrentExperimentId();
    const logEntry = {
      ts: this._getTimestamp(),
      type: "button_action",
      exp_id: experimentId,
      participant: this.participantName || `受試者_${experimentId}`,
      button,
      function: buttonFunction,
      c_id: clientId,
    };
    if (actionId) logEntry.action_id = actionId;
    this._addLog(logEntry);
  }

  getLogs() { return [...this.logs]; }

  getLogsAsJSONL() {
    return this.logs.map((log) => JSON.stringify(log)).join("\n");
  }

  // ─── 儲存 ──────────────────────────────────────────────────────────────────

  /**
   * 立即將緩衝區日誌寫入 IndexedDB
   * @returns {Promise<boolean>} 是否有日誌被寫入
   */
  async flushPendingLogs() {
    if (this.pendingLogs.length === 0) return false;
    Logger.info(`立即 flush ${this.pendingLogs.length} 條日誌到 IndexedDB`);
    try {
      await this._savePendingLogsToIndexedDB();
      this.pendingLogs = [];
      this._broadcastMessage("logsFlushed", { count: this.logs.length, timestamp: Date.now() });
      return true;
    } catch (error) {
      Logger.error("flush 日誌失敗:", error);
      return false;
    }
  }

  /**
   * 完整儲存流程：flush 緩衝 → 寫入 JSONL → 清除 IndexedDB → 通知 View 顯示完成畫面
   * 每個實驗 ID 只會執行一次，重複呼叫會被忽略
   * @returns {Promise<void>}
   */
  async flushAll() {
    const currentExperimentId = this._getCurrentExperimentId();
    if (this._flushAllInProgress) return;
    if (currentExperimentId && this._lastFlushAllExperimentId === currentExperimentId) return;

    this._flushAllInProgress = true;
    try {
      if (this.pendingLogs.length > 0) {
        await this._savePendingLogsToIndexedDB();
        this.pendingLogs = [];
      }

      const savedToRuntime = await this._saveToRuntimeFolder();
      if (savedToRuntime) {
        await this._removeLogsByExperimentIdFromIndexedDB(this._getCurrentExperimentId());
      }

      this.view?.showCompletionDisplay(this.logs.length);

      if (currentExperimentId) this._lastFlushAllExperimentId = currentExperimentId;
    } catch (error) {
      Logger.error("flushAll 發生錯誤:", error);
    } finally {
      this._flushAllInProgress = false;
    }
  }

  /** 清空記憶體日誌與 IndexedDB（用於實驗重置） */
  clear() {
    this.logs = [];
    this.pendingLogs = [];
    this._clearIndexedDB();
    Logger.info("日誌已清空");
  }

  /**
   * 刪除整個 IndexedDB 資料庫並清除相關 localStorage（用於完整重置）
   * @returns {Promise<boolean>}
   */
  async clearLocalCache() {
    return new Promise((resolve, reject) => {
      try {
        const req = indexedDB.deleteDatabase(this.dbName);
        req.onsuccess = () => {
          this.logs = [];
          this.pendingLogs = [];
          this.db = null;
          const keys = [
            "loggerMinimized", "sync_session_backup", "sync_session_id",
            "sync_client_id", "sync_preferred_role",
            "preferredCameraId", "preferredCameraLabel",
          ];
          keys.forEach((k) => localStorage.removeItem(k));
          resolve(true);
        };
        req.onerror = (e) => reject(e);
        req.onblocked = () => Logger.warn("IndexedDB 刪除被阻塞");
      } catch (err) {
        reject(err);
      }
    });
  }

  destroy() {
    this._closeBroadcastChannel();
  }

  // ─── 私有方法 ──────────────────────────────────────────────────────────────

  _getTimestamp() {
    if (this.timeSyncManager?.isSynchronized?.()) {
      return this.timeSyncManager.getServerTime();
    }
    return Date.now();
  }

  _getTypeLabel(type) {
    return RECORD_TYPE_LABELS[type] || type;
  }

  _addLog(logEntry) {
    this.logs.push(logEntry);
    this.pendingLogs.push(logEntry);
    this._saveLogToIndexedDB(logEntry);
    this._broadcastMessage("logAdded", { logCount: this.pendingLogs.length });

    // 防止記憶體溢出
    if (this.pendingLogs.length > this.maxPendingLogs) {
      this.pendingLogs.shift();
    }

    // 達到緩衝上限時批次寫入
    if (this.pendingLogs.length >= this.bufferSize) {
      this._flushLogs();
    }

    // 通知 View 更新即時顯示
    this.view?.updateLiveDisplay(this.logs);
  }

  async _flushLogs() {
    if (this.pendingLogs.length === 0) return;
    try {
      await this._savePendingLogsToIndexedDB();
      this.pendingLogs = [];
    } catch (error) {
      Logger.error("寫入 IndexedDB 失敗:", error);
    }
  }

  async _savePendingLogsToIndexedDB() {
    if (!this.db || this.pendingLogs.length === 0) return;

    const transaction = this.db.transaction([this.pendingLogsStore], "readwrite");
    const store = transaction.objectStore(this.pendingLogsStore);

    await Promise.all(
      this.pendingLogs.map((log) => new Promise((resolve) => {
        const req = store.add({ ...log, savedAt: Date.now() });
        req.onsuccess = () => resolve();
        req.onerror = () => resolve(); // 不中斷其他日誌的儲存
      })),
    );

    this._broadcastMessage("logsSynced", {
      count: this.pendingLogs.length,
      source: "buffer_flush",
    });
  }

  // ─── BroadcastChannel ──────────────────────────────────────────────────────

  _initBroadcastChannel() {
    try {
      this.broadcastChannel = new BroadcastChannel("ExperimentLogsChannel");
      this.broadcastChannel.onmessage = (event) => {
        const { type, senderTabId } = event.data;
        if (senderTabId === this.tabId) return;

        if (type === "logsSynced" || type === "logAdded") {
          this._restorePendingLogsFromIndexedDB();
        } else if (type === "logsCleared") {
          this.pendingLogs = [];
        }
      };
    } catch (error) {
      Logger.warn("BroadcastChannel 不支援:", error);
    }
  }

  _closeBroadcastChannel() {
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
  }

  _broadcastMessage(type, data) {
    this.broadcastChannel?.postMessage({ type, data, senderTabId: this.tabId, timestamp: Date.now() });
  }
}

// 混入儲存層 mixin
Object.assign(RecordManager.prototype, recordStore, recordRuntime);

export default RecordManager;
export { RecordManager };
// 向後相容別名
export { RecordManager as ExperimentLogManager };
