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
  SYNC_SESSION_STORAGE_LEGACY_KEYS,
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
    // 記錄狀態
    this.records = [];
    this.pendingRecords = [];
    this._persistedRecordRefs = new WeakSet();
    this.experimentId = null;
    this.participantName = null;
    this.experimentStartTime = null;
    this._flushAllInProgress = false;
    this._lastFlushAllExperimentId = null;
    this._logSequence = 0;
    this._lastFlushAllLogSequence = -1;

    // 設定
    this.syncEnabled = false;
    this.bufferSize = 10;
    this.maxPendingRecords = 100;

    // 注入的依賴
    this.timeSyncManager = timeSyncManager;
    this.stateManager = stateManager;
    this.syncClient = null;
    this.view = null;
    this.getGestures = null;
    this.getGesturesData = null;
    this.getCombination = null;
    this.getUnitOrder = null;

    // IndexedDB
    this.db = null;
    this.dbName = "ExperimentRecordsDB";
    this.dbVersion = 1;
    this.pendingRecordsStore = "pendingRecords";

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
  * @param {Function} [deps.getUnitOrder]     - `() => Array|string` 取得目前單元排序
   */
  updateDependencies({ syncClient, view, getGestures, getGesturesData, getCombination, getUnitOrder } = {}) {
    if (syncClient !== undefined) this.syncClient = syncClient;
    if (view !== undefined) this.view = view;
    if (getGestures !== undefined) this.getGestures = getGestures;
    if (getGesturesData !== undefined) this.getGesturesData = getGesturesData;
    if (getCombination !== undefined) this.getCombination = getCombination;
    if (getUnitOrder !== undefined) this.getUnitOrder = getUnitOrder;
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

  getExperimentId() {
    return this.experimentId || this.stateManager?.getExperimentId?.() || this.stateManager?.experimentId || null;
  }
  _getCurrentExperimentId() { return this.getExperimentId(); }
  _getClientId() { return this.syncClient?.clientId || null; }
  _getClientRole() {
    return this.syncClient?.getRole?.() || this.syncClient?.role || null;
  }

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

  _resolveUnitOrder() {
    const unitOrder = this.getUnitOrder?.();
    if (Array.isArray(unitOrder)) {
      return unitOrder
        .map((unit) => unit?.unit_id || unit?.unitId || unit?.id || unit)
        .filter((unitId) => unitId !== null && unitId !== undefined && unitId !== "")
        .join("->");
    }
    if (typeof unitOrder === "string") {
      return unitOrder;
    }

    const currentUnits = this.stateManager?.loadedUnits;
    if (Array.isArray(currentUnits) && currentUnits.length > 0) {
      return currentUnits
        .map((unit) => unit?.unit_id || unit?.unitId || unit?.id || unit)
        .filter((unitId) => unitId !== null && unitId !== undefined && unitId !== "")
        .join("->");
    }

    return "";
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
      this.records = [];
      this.pendingRecords = [];
      this._persistedRecordRefs = new WeakSet();
      this.experimentStartTime = null;
      this._lastFlushAllExperimentId = null;
      this._flushAllInProgress = false;
      this._lastFlushAllLogSequence = -1;
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
      this.experimentId = experimentId;
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

  // ─── 公開 API：日誌記錄 ────────────────────────────────────────────────────

  logExperimentStart() {
    const experimentId = this._getCurrentExperimentId();
    if (!experimentId) { Logger.warn("實驗ID未設定"); return; }

    this.experimentStartTime = this._getTimestamp();
    const combinationInfo = this.getCombination?.() ?? this.stateManager?.currentCombination ?? {};
    const unitOrder = this._resolveUnitOrder();

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
  * @param {Object|null} [extraData]      - 額外欄位（例如實驗狀態快照）
   */
  logAction(actionId, gestureIndex = null, stepId = null, extraData = null) {
    if (gestureIndex && typeof gestureIndex === "object" && !Array.isArray(gestureIndex)) {
      extraData = gestureIndex;
      gestureIndex = null;
      stepId = null;
    } else if (stepId && typeof stepId === "object" && !Array.isArray(stepId)) {
      extraData = stepId;
      stepId = null;
    }

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
    if (extraData && typeof extraData === "object") {
      Object.assign(logEntry, extraData);
    }
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

  // ─── 儲存 ──────────────────────────────────────────────────────────────────

  /**
   * 清空記憶體中的 pendingRecords 緩衝區並廣播同步通知。
   * 注意：實際寫入 IndexedDB 是在 _addLog() → _saveLogToIndexedDB() 時即時完成的，
   * 此方法僅清除緩衝區引用，不需再重複寫入。
   * @returns {Promise<boolean>} 緩衝區是否有資料被清除
   */
  async flushPendingLogs() {
    if (this.pendingRecords.length === 0) return false;
    const flushedCount = this.pendingRecords.length;
    Logger.info(`立即 flush ${flushedCount} 筆快取記錄`);
    try {
      this.pendingRecords = [];
      this._broadcastMessage("recordsFlushed", { count: flushedCount, timestamp: Date.now() });
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
    if (
      currentExperimentId &&
      this._lastFlushAllExperimentId === currentExperimentId &&
      this._lastFlushAllLogSequence === this._logSequence
    ) {
      return;
    }

    this._flushAllInProgress = true;
    try {
      await this.flushPendingLogs();

      const savedRecordCount = this.records.length;
      const savedToRuntime = await this._saveToRuntimeFolder();
      if (savedToRuntime) {
        await this._removeLogsByExperimentIdFromIndexedDB(this._getCurrentExperimentId());
        if (currentExperimentId) {
          this.records = this.records.filter(
            (record) => record.exp_id !== currentExperimentId && record.experimentId !== currentExperimentId,
          );
          this.pendingRecords = this.pendingRecords.filter(
            (record) => record.exp_id !== currentExperimentId && record.experimentId !== currentExperimentId,
          );
        } else {
          this.records = [];
          this.pendingRecords = [];
        }
        this._broadcastMessage("recordsSynced", {
          count: savedRecordCount,
          source: "runtime_saved",
        });
      }

      this.view?.showCompletionDisplay(savedRecordCount);

      if (currentExperimentId) {
        this._lastFlushAllExperimentId = currentExperimentId;
      }
      this._lastFlushAllLogSequence = this._logSequence;
    } catch (error) {
      Logger.error("flushAll 發生錯誤:", error);
    } finally {
      this._flushAllInProgress = false;
    }
  }

  /** 清空記憶體日誌與 IndexedDB（用於實驗重置） */
  clear() {
    this.records = [];
    this.pendingRecords = [];
    this._persistedRecordRefs = new WeakSet();
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
          this.records = [];
          this.pendingRecords = [];
          this._persistedRecordRefs = new WeakSet();
          this.db = null;
          const keys = [
            "loggerMinimized",
            SYNC_SESSION_STORAGE_LEGACY_KEYS.BACKUP,
            SYNC_SESSION_STORAGE_LEGACY_KEYS.SESSION_ID,
            SYNC_SESSION_STORAGE_LEGACY_KEYS.CLIENT_ID,
            SYNC_SESSION_STORAGE_LEGACY_KEYS.ROLE,
            "preferredCameraId",
            "preferredCameraLabel",
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

  _resolveCurrentExperimentId() {
    if (this.experimentId) return this.experimentId;

    const stateManagerExperimentId =
      this.stateManager?.getExperimentId?.() || this.stateManager?.experimentId;
    if (stateManagerExperimentId) {
      this.experimentId = stateManagerExperimentId;
      return this.experimentId;
    }

    const experimentIdInput = document.getElementById("experimentIdInput");
    const inputExperimentId = experimentIdInput?.value?.trim();
    if (inputExperimentId) {
      this.experimentId = inputExperimentId;
      return this.experimentId;
    }

    // 實驗進行中（含暫停）不允許任何設定補值，避免執行中發生隱性變更。
    if (this.stateManager?.isExperimentRunning) {
      return null;
    }

    // 僅在非實驗狀態下，才允許沿用既有紀錄的實驗ID。
    const lastRecordedId = [...this.records]
      .reverse()
      .find((record) => record?.exp_id)?.exp_id;
    if (lastRecordedId) {
      this.experimentId = lastRecordedId;
      return lastRecordedId;
    }

    return null;
  }

  _getTypeLabel(type) {
    return RECORD_TYPE_LABELS[type] || type;
  }

  _addLog(logEntry) {
    if (!logEntry || typeof logEntry !== "object") return;

    const resolvedExperimentId =
      logEntry.exp_id ||
      logEntry.experimentId ||
      this._resolveCurrentExperimentId();

    if (!resolvedExperimentId) {
      Logger.warn("略過未帶實驗ID的日誌", {
        type: logEntry.type,
        actionId: logEntry.a_id,
      });
      return;
    }

    logEntry.exp_id = resolvedExperimentId;

    // 同步模式下補齊來源資訊，避免跨裝置日誌對不上
    const clientId = this._getClientId();
    if (clientId && !logEntry.c_id) {
      logEntry.c_id = clientId;
    }

    const role = this._getClientRole();
    if (role && !logEntry.role) {
      logEntry.role = role;
    }

    if (!logEntry.mode) {
      logEntry.mode = this.syncClient?.isConnected?.() ? "sync" : "local";
    }

    this.records.push(logEntry);
    this.pendingRecords.push(logEntry);
    this._logSequence += 1;
    this._saveLogToIndexedDB(logEntry);
    this._broadcastMessage("recordAdded", { recordCount: this.pendingRecords.length });

    // 防止記憶體溢出
    if (this.pendingRecords.length > this.maxPendingRecords) {
      this.pendingRecords.shift();
    }

    // 達到緩衝上限時批次寫入
    if (this.pendingRecords.length >= this.bufferSize) {
      this._flushLogs();
    }

    // 通知 View 更新即時顯示
    this.view?.updateLiveDisplay(this.records);
  }

  async _flushLogs() {
    if (this.pendingRecords.length === 0) return;
    try {
      await this.flushPendingLogs();
    } catch (error) {
      Logger.error("寫入 IndexedDB 失敗:", error);
    }
  }

  // ─── BroadcastChannel ──────────────────────────────────────────────────────

  _initBroadcastChannel() {
    try {
      this.broadcastChannel = new BroadcastChannel("ExperimentRecordsChannel");
      this.broadcastChannel.onmessage = (event) => {
        const { type, senderTabId } = event.data;
        if (senderTabId === this.tabId) return;

        if (type === "recordsCleared") {
          this.records = [];
          this.pendingRecords = [];
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
