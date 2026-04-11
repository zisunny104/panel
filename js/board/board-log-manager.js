/**
 * ExperimentLogManager - 實驗日誌管理系統
 *
 * 負責記錄實驗過程的所有事件
 * 支援 JSONL 格式，即時同步到伺服器
 */

import {
  LOG_TYPES,
  LOG_TYPE_LABELS,
  GESTURE_ATTEMPT_TYPES,
  GESTURE_ATTEMPT_TYPE_LABELS,
  LOG_SOURCES,
  SYNC_EVENTS,
} from "../constants/index.js";
import { logDbStore } from "./board-log-manager-db.js";
import { logRuntimeWriter } from "./board-log-manager-runtime.js";
import { boardPageManager } from "./board-page-manager.js";
import { experimentLogUI } from "./board-log-ui.js";
import { Logger } from "../core/console-manager.js";

class ExperimentLogManager {
  constructor({ timeSyncManager = null, stateManager = null } = {}) {
    this.logs = [];
    this.pendingLogs = []; // 初始化為空陣列，防止事件監聽器存取 undefined
    this.experimentId = null;
    this.participantName = null;
    this.experimentStartTime = null;
    this._flushAllInProgress = false;
    this._lastFlushAllExperimentId = null;
    this.syncEnabled = false; // 關閉同步到伺服器
    this.bufferSize = 10; // 累積 10 條後批次發送（本機儲存）
    this.maxPendingLogs = 100; // 最大待發送日誌數量，防止記憶體溢出

    Logger.debug(
      `日誌管理器建立完成，分頁ID: ${this.tabId}, 本機 IndexedDB 儲存`,
    );

    // 標記初始化完成
    this.initialized = true;

    Logger.debug(`✓ 日誌管理器初始化完成，分頁 ID: ${this.tabId}`);

    // 通知 experimentLogUI 日誌管理器已就緒（若它已先載入）
    if (experimentLogUI) {
      Logger.debug("觸發 experimentLogUI 初始化");
      experimentLogUI.updateDependencies?.({
        logManager: this,
        timeSyncManager: this.timeSyncManager,
      });
      experimentLogUI.initialize();
    }
  }

  updateDependencies({ syncClient } = {}) {
    if (syncClient) {
      this.syncClient = syncClient;
    }
  }

  /**
   * 設定實驗ID同步處理器
   * @private
   */
  _setupExperimentIdSync() {
    // 監聽狀態管理器的ID變化
    if (this.stateManager) {
      this.stateManager.on("experimentIdChanged", (data) => {
        this.experimentId = data.experimentId;
        Logger.debug(`日誌管理器同步實驗ID: ${data.experimentId}`);
      });

      // 初始化時從狀態管理器取得
      this.experimentId = this.stateManager.experimentId;
    }

    // 備用：監聽輸入框變化（如果沒有狀態管理器）
    if (!this.stateManager) {
      const experimentIdInput = document.getElementById("experimentIdInput");
      if (experimentIdInput) {
        experimentIdInput.addEventListener("input", (e) => {
          const newId = e.target.value.trim();
          if (newId !== this.experimentId) {
            this.experimentId = newId;
            Logger.debug(`日誌管理器同步實驗ID: ${newId}`);
          }
        });

        experimentIdInput.addEventListener("change", (e) => {
          const newId = e.target.value.trim();
          if (newId !== this.experimentId) {
            this.experimentId = newId;
            Logger.debug(`日誌管理器同步實驗ID: ${newId}`);
          }
        });

        // 初始化時從輸入框讀取
        if (experimentIdInput.value.trim() && !this.experimentId) {
          this.experimentId = experimentIdInput.value.trim();
        }
      }
    }

    // 監聽同步伺服器的ID更新事件（備用）
    document.addEventListener("experiment_id_updated", (event) => {
      const { experimentId } = event.detail;
      this.experimentId = experimentId;
      Logger.debug(`日誌管理器從同步更新實驗ID: ${experimentId}`);
    });
  }

  /**
   * 取得目前實驗ID
   * @public
   */
  getExperimentId() {
    return this.experimentId;
  }

  /**
   * 內部方法：取得目前實驗ID
   * @private
   */
  _getCurrentExperimentId() {
    return this.experimentId;
  }

  /**
   * 內部方法：取得裝置ID
   * @private
   */
  _getClientId() {
    return this.syncClient?.clientId || null;
  }

  /**
   * 內部方法：取得手勢 ID
   * @private
   */
  _getGestureId(gestureIndex) {
    const gesture =
      window.app?.currentCombination?.gestures?.[gestureIndex] ||
      boardPageManager?.currentCombination?.gestures?.[gestureIndex] ||
      boardPageManager?.experimentSystemManager?.state?.gestures?.[gestureIndex];

    return (
      gesture?.gesture_id ||
      gesture?.gestureId ||
      gesture?.gesture ||
      gesture?.id ||
      null
    );
  }

  /**
   * 內部方法：取得手勢名稱
   * @private
   */
  _getGestureName(gestureIndex) {
    return (
      window.app?.currentCombination?.gestures?.[gestureIndex]?.gesture_name ||
      window.app?.currentCombination?.gestures?.[gestureIndex]?.name ||
      null
    );
  }

  /**
   * 清理本機快取：刪除 IndexedDB（ExperimentLogsDB）與常見 localStorage 鍵
  * 使用方式：
  *   await logManager.clearLocalCache();
   * @returns {Promise<boolean>} 成功回傳 true
   */
  async clearLocalCache() {
    return new Promise((resolve, reject) => {
      try {
        // 刪除 IndexedDB
        const req = indexedDB.deleteDatabase(this.dbName);
        req.onsuccess = () => {
          Logger.info("IndexedDB 已刪除");
          // 重設狀態
          this.logs = [];
          this.pendingLogs = [];
          this.db = null;

          // 清除常見的 localStorage 鍵
          const keys = [
            "loggerMinimized",
            "sync_session_backup",
            "sync_session_id",
            "sync_client_id",
            "sync_preferred_role",
            "preferredCameraId",
            "preferredCameraLabel",
          ];
          keys.forEach((k) => localStorage.removeItem(k));

          resolve(true);
        };
        req.onerror = (e) => {
          Logger.error("刪除 IndexedDB 失敗:", e);
          reject(e);
        };
        req.onblocked = () => {
          Logger.warn("IndexedDB 刪除被阻塞");
        };
      } catch (err) {
        Logger.error("clearLocalCache 例外:", err);
        reject(err);
      }
    });
  }

  /**
   * 設定實驗ID
   * @param {string} experimentId - 新的實驗ID
   * @param {string} source - 更新來源 (用於記錄)
   * @public
   */
  setExperimentId(experimentId, source = LOG_SOURCES.LOCAL_INPUT) {
    // 優先通過狀態管理器設置
    if (this.stateManager) {
      this.stateManager.setExperimentId(experimentId, source);
      return;
    }

    // 備用：直接設置
    if (this.experimentId !== experimentId) {
      this.experimentId = experimentId;
      const sourceLabel =
        typeof source === "string"
          ? source
          : source && typeof source === "object"
            ? JSON.stringify(source)
            : "unknown";
      Logger.info(`日誌管理器實驗ID已更新 (${sourceLabel}): ${experimentId}`);

      // 同步更新輸入框
      const experimentIdInput = document.getElementById("experimentIdInput");
      if (
        experimentIdInput &&
        experimentIdInput.value.trim() !== experimentId
      ) {
        experimentIdInput.value = experimentId;
      }

      // 分發事件供其他元件使用
      document.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.EXPERIMENT_ID_CHANGED, {
          detail: { experimentId, source },
        }),
      );
    }
  }

  /**
   * 初始化日誌管理器
   * @param {string} experimentId - 實驗ID
   * @param {string} participantName - 受試者名稱
   */
  initialize(experimentId, participantName) {
    try {
      this.setExperimentId(experimentId, "initialize");
      // 如果沒有提供受試者名稱，使用「受試者_實驗ID」作為預設值
      this.participantName = participantName || `受試者_${experimentId}`;
      this.logs = [];
      this.pendingLogs = [];
      this.experimentStartTime = null;
      this._lastFlushAllExperimentId = null;
      this._flushAllInProgress = false;
      Logger.info(
        `日誌管理器已初始化: 實驗ID=${experimentId}, 受試者=${this.participantName}`,
      );

      // 初始化完成後，嘗試發送任何待發送的日誌
      if (this.pendingLogs.length > 0) {
        Logger.info(
          `初始化完成，發現 ${this.pendingLogs.length} 條待發送日誌，準備發送`,
        );
        // 延遲一小段時間，確保其他元件也初始化完成
        setTimeout(() => {
          this._flushLogs();
        }, 1000);
      }

      return true;
    } catch (error) {
      Logger.error("初始化失敗:", error);
      return false;
    }
  }

  /**
   * 設定增驗日誌管理器的實驗ID
   * @private
   */
  setInternalExperimentId(experimentId) {
    this.experimentId = experimentId;
  }

  /**
   * 取得同步的時間戳（毫秒級）
   * 優先使用同步的伺服器時間，確保多裝置時序一致
   * @private
   */
  _getTimestamp() {
    if (this.timeSyncManager && this.timeSyncManager.isSynchronized()) {
      return this.timeSyncManager.getServerTime();
    }
    return Date.now();
  }

  /**
   * 自動啟動實驗（如果尚未執行）
   * 當檢測到任何實驗操作時調用此方法
   * @private
   */
  _autoStartExperimentIfNeeded() {
    // 檢查實驗是否已在執行
    if (boardPageManager && !boardPageManager.experimentRunning) {
      // 檢查是否滿足啟動條件
      const experimentIdInput = document.getElementById("experimentIdInput");
      if (experimentIdInput && experimentIdInput.value.trim()) {
        Logger.info("偵測到實驗操作，自動啟動實驗");
        try {
          boardPageManager.startExperiment();
        } catch (error) {
          Logger.warn("自動啟動實驗失敗:", error);
        }
      }
    }
  }

  /**
   * 記錄實驗開始
   */
  logExperimentStart() {
    const experimentId = this._getCurrentExperimentId();
    if (!experimentId) {
      Logger.warn("實驗ID未設定，請先調用 initialize()");
      return;
    }
    this.experimentStartTime = this._getTimestamp();

    const combinationInfo =
      boardPageManager?.currentCombination ||
      window.app?.currentCombination ||
      {};
    const unitOrder =
      boardPageManager?.experimentSystemManager?.state?.currentUnitIds?.join("->") ||
      boardPageManager?.loadedUnits?.join("->") ||
      "";

    const logEntry = {
      ts: this.experimentStartTime,
      type: LOG_TYPES.EXP_START,
      exp_id: experimentId,
      participant: this.participantName || "",
    };

    const clientId = this._getClientId();
    if (clientId) {
      logEntry.d_id = clientId;
    }

    if (combinationInfo.combinationId) {
      logEntry.combo_id = combinationInfo.combinationId;
    }
    if (combinationInfo.combinationName) {
      logEntry.combo_name = combinationInfo.combinationName;
    }
    if (unitOrder) {
      logEntry.unit_order = unitOrder;
    }

    this._addLog(logEntry);
    Logger.debug("記錄: 實驗開始", logEntry);
  }

  /**
   * 記錄實驗結束
   */
  logExperimentEnd() {
    const experimentId = this._getCurrentExperimentId();
    if (!experimentId) {
      Logger.warn("實驗ID未設定，請先調用 initialize()");
      return;
    }

    const logEntry = {
      ts: this._getTimestamp(),
      type: LOG_TYPES.EXP_END,
      exp_id: experimentId,
      participant: this.participantName || "",
    };

    const clientId = this._getClientId();
    if (clientId) {
      logEntry.d_id = clientId;
    }

    this._addLog(logEntry);
    Logger.debug("記錄: 實驗結束", logEntry);
  }

  /**
   * 記錄實驗暫停
   */
  logExperimentPause() {
    const experimentId = this._getCurrentExperimentId();
    if (!experimentId) {
      Logger.warn("實驗ID未設定，請先調用 initialize()");
      return;
    }

    const logEntry = {
      ts: this._getTimestamp(),
      type: LOG_TYPES.EXP_PAUSE,
      exp_id: experimentId,
    };

    const clientId = this._getClientId();
    if (clientId) {
      logEntry.d_id = clientId;
    }

    this._addLog(logEntry);
    Logger.debug("記錄: 實驗暫停", logEntry);
  }

  /**
   * 記錄實驗還原
   */
  logExperimentResume() {
    const experimentId = this._getCurrentExperimentId();
    if (!experimentId) {
      Logger.warn("實驗ID未設定，請先調用 initialize()");
      return;
    }

    const logEntry = {
      ts: this._getTimestamp(),
      type: LOG_TYPES.EXP_RESUME,
      exp_id: experimentId,
    };

    const clientId = this._getClientId();
    if (clientId) {
      logEntry.d_id = clientId;
    }

    this._addLog(logEntry);
    Logger.debug("記錄: 實驗還原", logEntry);
  }

  /**
   * 記錄手勢步驟開始
   * @param {number} gestureIndex - 手勢索引
   * @param {string} stepId - 步驟ID (可選)
   */
  logGestureStepStart(gestureIndex, stepId = null) {
    this._autoStartExperimentIfNeeded();

    const experimentId = this._getCurrentExperimentId();
    const gestureId = this._getGestureId(gestureIndex);
    const clientId = this._getClientId();

    const logEntry = {
      ts: this._getTimestamp(),
      type: LOG_TYPES.GESTURE_STEP_START,
      exp_id: experimentId,
      g_idx: gestureIndex,
    };

    if (gestureId) logEntry.g_id = gestureId;
    if (stepId) logEntry.s_id = stepId;
    if (clientId) logEntry.d_id = clientId;

    this._addLog(logEntry);
    Logger.debug("記錄: 手勢步驟開始", logEntry);
  }

  /**
   * 記錄手勢步驟結束
   * @param {number} gestureIndex - 手勢索引
   * @param {string} stepId - 步驟ID (可選)
   */
  logGestureStepEnd(gestureIndex, stepId = null) {
    const experimentId = this._getCurrentExperimentId();
    const gestureId = this._getGestureId(gestureIndex);
    const clientId = this._getClientId();

    const logEntry = {
      ts: this._getTimestamp(),
      type: LOG_TYPES.GESTURE_STEP_END,
      exp_id: experimentId,
      g_idx: gestureIndex,
    };

    if (gestureId) logEntry.g_id = gestureId;
    if (stepId) logEntry.s_id = stepId;
    if (clientId) logEntry.d_id = clientId;

    this._addLog(logEntry);
    Logger.debug("記錄: 手勢步驟結束", logEntry);
  }

  /**
   * 記錄手勢步驟暫停
   * @param {number} gestureIndex - 手勢索引
   * @param {string} stepId - 步驟ID (可選)
   */
  logGestureStepPause(gestureIndex, stepId = null) {
    const experimentId = this._getCurrentExperimentId();
    const gestureId = this._getGestureId(gestureIndex);
    const clientId = this._getClientId();

    const logEntry = {
      ts: this._getTimestamp(),
      type: LOG_TYPES.GESTURE_STEP_PAUSE,
      exp_id: experimentId,
      g_idx: gestureIndex,
    };

    if (gestureId) logEntry.g_id = gestureId;
    if (stepId) logEntry.s_id = stepId;
    if (clientId) logEntry.d_id = clientId;

    this._addLog(logEntry);
    Logger.debug("記錄: 手勢步驟暫停", logEntry);
  }

  /**
   * 記錄手勢嘗試 (比出手勢)
   * @param {number} gestureIndex - 手勢索引
   * @param {string} gestureType - 手勢類型: t(true/正確), f(false/錯誤), n(none/未分類)
   * @param {string} stepId - 步驟ID (可選)
   */
  logGestureAttempt(gestureIndex, gestureType, stepId = null) {
    // 自動啟動實驗（如果尚未執行）
    this._autoStartExperimentIfNeeded();

    const experimentId = this._getCurrentExperimentId();

    // 驗證手勢類型
    if (!Object.values(GESTURE_ATTEMPT_TYPES).includes(gestureType)) {
      Logger.warn(
        `無效的手勢類型: ${gestureType}，應為 ${Object.values(GESTURE_ATTEMPT_TYPES).join("/")} 之一`,
      );
      return;
    }

    const gestureId = this._getGestureId(gestureIndex);
    const logEntry = {
      ts: this._getTimestamp(),
      type: LOG_TYPES.GESTURE_ATTEMPT,
      exp_id: experimentId,
      g_idx: gestureIndex,
      g_type: gestureType,
    };
    if (gestureId) {
      logEntry.g_id = gestureId;
    }
    if (stepId) {
      logEntry.s_id = stepId;
    }
    this._addLog(logEntry);

    Logger.debug(
      `記錄: 手勢嘗試 (${GESTURE_ATTEMPT_TYPE_LABELS[gestureType]})`,
      logEntry,
    );
  }

  /**
   * 記錄按鈕動作
   * @param {string} actionId - 動作ID
   * @param {number} gestureIndex - 手勢索引 (可選)
   * @param {string} stepId - 步驟ID (可選)
   */
  logAction(actionId, gestureIndex = null, stepId = null) {
    const experimentId = this._getCurrentExperimentId();
    const clientId = this._getClientId();
    const gestureId =
      gestureIndex !== null ? this._getGestureId(gestureIndex) : null;

    const logEntry = {
      ts: this._getTimestamp(),
      type: LOG_TYPES.ACTION,
      exp_id: experimentId,
      a_id: actionId,
    };
    if (gestureIndex !== null) {
      logEntry.g_idx = gestureIndex;
    }
    if (gestureId) {
      logEntry.g_id = gestureId;
    }
    if (stepId) {
      logEntry.s_id = stepId;
    }
    if (clientId) {
      logEntry.d_id = clientId;
    }
    this._addLog(logEntry);
    Logger.debug("記錄: 按鈕動作", logEntry);
  }

  /**
   * 內部方法：新增日誌並處理同步
   * @private
   */
  _addLog(logEntry) {
    this.logs.push(logEntry);
    this.pendingLogs.push(logEntry);

    // 儲存到 IndexedDB 以實現持久性
    this._saveLogToIndexedDB(logEntry);

    // 通知其他分頁
    this._broadcastMessage("logAdded", { logCount: this.pendingLogs.length });

    // 檢查是否超過最大待發送日誌數量
    if (this.pendingLogs.length > this.maxPendingLogs) {
      // 移除最舊的日誌以釋放記憶體
      const removedLog = this.pendingLogs.shift();
      Logger.warn(
        `待發送日誌數量超過限制 (${this.maxPendingLogs})，移除最舊日誌:`,
        removedLog,
      );
    }

    // 當累積達到 bufferSize 時，批次發送
    if (this.pendingLogs.length >= this.bufferSize) {
      this._flushLogs();
    }

    // 同時更新 UI
    this._updateLogDisplay();
  }

  /**
   * 將待處理日誌寫入 IndexedDB
   * @private
   */
  async _flushLogs() {
    if (this.pendingLogs.length === 0) {
      Logger.debug("沒有待處理的日誌");
      return;
    }

    Logger.debug(`將 ${this.pendingLogs.length} 條日誌寫入 IndexedDB`);

    try {
      await this._savePendingLogsToIndexedDB();
      this.pendingLogs = [];
      Logger.debug("日誌已儲存到 IndexedDB");
    } catch (error) {
      Logger.error("寫入 IndexedDB 失敗:", error);
    }
  }

  /**
   * 批次儲存待發送的日誌到 IndexedDB
   * @private
   */
  async _savePendingLogsToIndexedDB() {
    if (!this.db || this.pendingLogs.length === 0) {
      return;
    }

    try {
      const transaction = this.db.transaction(
        [this.pendingLogsStore],
        "readwrite",
      );
      const store = transaction.objectStore(this.pendingLogsStore);

      // 批次新增所有待發送的日誌
      const addPromises = this.pendingLogs.map((log) => {
        return new Promise((resolve, reject) => {
          // 確保日誌有必要的欄位
          const logToSave = {
            ...log,
            // id 由 autoIncrement 自動產生
            savedAt: Date.now(), // 記錄儲存時間
          };

          const request = store.add(logToSave);

          request.onsuccess = () => resolve();
          request.onerror = (event) => {
            Logger.error("儲存單條日誌失敗:", event.target.error, log);
            // 不要 reject，讓其他日誌繼續儲存
            resolve();
          };
        });
      });

      await Promise.all(addPromises);

      Logger.debug(`成功儲存 ${this.pendingLogs.length} 條日誌到 IndexedDB`);

      // 廣播同步事件
      this._broadcastMessage("logsSynced", {
        count: this.pendingLogs.length,
        source: "buffer_flush",
      });
    } catch (error) {
      Logger.error("批次儲存日誌失敗:", error);
      throw error;
    }
  }

  /**
   * 立即 flush 待處理的日誌到 IndexedDB（不等緩衝滿）
   * @public - 供"立即同步"按鈕調用
   */
  async flushPendingLogs() {
    if (this.pendingLogs.length === 0) {
      Logger.debug("沒有待處理的日誌");
      return false;
    }

    Logger.info(
      `立即 flush ${this.pendingLogs.length} 條日誌到 IndexedDB（未達緩衝上限）`,
    );

    try {
      await this._savePendingLogsToIndexedDB();
      this.pendingLogs = [];
      Logger.info("待處理日誌已 flush 完成");

      // 觸發UI更新
      this._broadcastMessage("logsFlushed", {
        count: this.logs.length,
        timestamp: Date.now(),
      });

      return true;
    } catch (error) {
      Logger.error("flush 日誌失敗:", error);
      return false;
    }
  }

  /**
   * 強制完成所有待處理的日誌 (實驗結束時呼叫)
   * 確保所有日誌寫入 IndexedDB 並儲存為 JSONL 檔案
   */
  async flushAll() {
    const currentExperimentId = this._getCurrentExperimentId();
    if (this._flushAllInProgress) {
      Logger.debug("flushAll 已在執行中，略過重複呼叫");
      return;
    }
    if (currentExperimentId && this._lastFlushAllExperimentId === currentExperimentId) {
      Logger.debug("flushAll 已完成，略過重複呼叫");
      return;
    }

    this._flushAllInProgress = true;
    Logger.debug(
      `完成實驗，確保 ${this.pendingLogs.length} 條待處理日誌寫入 IndexedDB`,
    );

    try {
      // 直接將 pendingLogs 寫入 IndexedDB
      if (this.pendingLogs.length > 0) {
        await this._savePendingLogsToIndexedDB();
        this.pendingLogs = [];
        Logger.info(`${this.logs.length} 條日誌已全部儲存到 IndexedDB`);
      } else {
        Logger.debug("沒有待處理的日誌");
      }

      // 同時儲存為 JSONL 檔案到 runtime 資料夾（使用 PHP API）
      const savedToRuntime = await this._saveToRuntimeFolder();
      if (savedToRuntime) {
        await this._removeLogsByExperimentIdFromIndexedDB(
          this._getCurrentExperimentId(),
        );
      }

      // 更新 UI 狀態為已完成
      this._updateLogDisplayAfterSave();
      if (currentExperimentId) {
        this._lastFlushAllExperimentId = currentExperimentId;
      }
    } catch (error) {
      Logger.error("flushAll 發生錯誤:", error);
    } finally {
      this._flushAllInProgress = false;
    }
  }

  /**
   * 更新 UI 中的日誌顯示
   * @private
   */
  _updateLogDisplay() {
    const logsContent = document.querySelector(
      "#experimentLogContainer .logs-content",
    );

    if (!logsContent) {
      return;
    }

    // 只顯示最近 20 條
    const recentLogs = this.logs.slice(-20);

    if (recentLogs.length === 0) return;

    // 建立每條日誌的 HTML
    let entriesHtml = "";
    recentLogs.forEach((log) => {
      // 使用統一的時間格式 HH:MM:SS.mmm
      const date = new Date(log.ts);
      const time =
        [
          String(date.getHours()).padStart(2, "0"),
          String(date.getMinutes()).padStart(2, "0"),
          String(date.getSeconds()).padStart(2, "0"),
        ].join(":") +
        "." +
        String(date.getMilliseconds()).padStart(3, "0");

      const typeLabel = this._getTypeLabel(log.type);
      const detailParts = [];
      let gestureMeta = "";
      if (log.g_id) {
        const gestureName = window.app?.gesturesData?.[log.g_id]?.zh;
        gestureMeta = gestureName ? `${gestureName} (${log.g_id})` : log.g_id;
      }
      if (log.g_idx !== undefined) {
        const gestureIndexLabel = `手勢#${log.g_idx + 1}`;
        detailParts.push(
          gestureMeta ? `${gestureIndexLabel} (${gestureMeta})` : gestureIndexLabel,
        );
      }
      if (log.g_type) {
        detailParts.push(
          GESTURE_ATTEMPT_TYPE_LABELS[log.g_type] ?? log.g_type,
        );
      }
      if (log.s_id) {
        detailParts.push(`(${log.s_id})`);
      }
      if (log.a_id) {
        detailParts.push(`[${log.a_id}]`);
      }
      const details = detailParts.join(" ");
      entriesHtml += `<div class="current-log-entry">
        <span class="log-time">[${time}]</span>
        <span class="log-type">${typeLabel}</span>
        ${details ? `<span class="log-details">${details}</span>` : ""}
      </div>`;
    });

    logsContent.innerHTML = `<div class="current-log-entries">${entriesHtml}</div>
      <div class="logs-summary">共 ${this.logs.length} 筆記錄</div>`;

    // 自動滾動到最新內容
    logsContent.scrollTop = logsContent.scrollHeight;

    // 更新狀態指示器 - 根據實驗是否暫停動態更新
    const statusIndicator = logsContent
      .closest("#experimentLogContainer")
      ?.querySelector(".status-indicator");
    if (statusIndicator) {
      // 檢查實驗是否暫停
      const pauseBtn = document.querySelector("#pauseExperimentBtn");
      const isPaused = pauseBtn?.dataset.isPaused === "true";

      if (isPaused) {
        statusIndicator.className = "status-indicator paused";
        statusIndicator.textContent = `已暫停 · ${this.logs.length} 筆`;
      } else {
        statusIndicator.className = "status-indicator running";
        statusIndicator.textContent = `進行中 · ${this.logs.length} 筆`;
      }
    }

    // 更新同步按鈕狀態（顯示並根據日誌數量決定 disabled）
    if (experimentLogUI) {
      experimentLogUI.updateSyncButtonState("show", this.logs.length);
    }
  }


  /**
   * 實驗結束後更新日誌顯示
   * @private
   */
  _updateLogDisplayAfterSave() {
    const logsContent = document.querySelector(
      "#experimentLogContainer .logs-content",
    );

    if (!logsContent) {
      return;
    }

    const totalLogs = this.logs.length;

    // 顯示存檔完成訊息（不使用 emoji）
    const completionHtml = `
      <div class="current-log-entries">
        <div class="current-log-entry log-completion">
          <span class="log-type">完成</span>
          <span class="log-details">實驗已結束，日誌已儲存 (共 ${totalLogs} 筆記錄)</span>
        </div>
      </div>
    `;

    logsContent.innerHTML = completionHtml;

    // 更新狀態指示器為已完成
    const statusIndicator = logsContent
      .closest("#experimentLogContainer")
      ?.querySelector(".status-indicator");
    if (statusIndicator) {
      statusIndicator.className = "status-indicator completed";
      statusIndicator.textContent = `已完成 · ${totalLogs} 筆`;
    }

    // 隱藏同步按鈕
    if (experimentLogUI) {
      experimentLogUI.updateSyncButtonState("hide");
    }

    // 廣播消息以通知其他分頁和日誌 UI 列表需要更新
    this._broadcastMessage("logsSynced", {
      count: totalLogs,
      source: "experiment_completion",
    });
    Logger.debug("[ExperimentLogManager] 廣播 logsSynced 訊息通知日誌列表更新");

    // 3 秒後恢復到初始等待狀態並清除快取
    setTimeout(() => {
      this._resetLogDisplayToIdle();
    }, 3000);
  }

  /**
   * 重置日誌顯示為等待狀態
   * @private
   */
  _resetLogDisplayToIdle() {
    const logsContent = document.querySelector(
      "#experimentLogContainer .logs-content",
    );

    if (!logsContent) {
      return;
    }

    // 清除日誌快取，避免下次實驗時出現重複或混砸記錄
    this.logs = [];
    this.pendingLogs = [];
    Logger.debug("日誌快取已清除");

    // 恢復到初始的等待狀態
    const idleHtml = `
      <div class="no-current-logs">
        <div class="no-logs-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 11H5a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2h-4"></path>
            <path d="M9 11V9a3 3 0 0 1 6 0v2"></path>
            <circle cx="12" cy="16" r="1"></circle>
          </svg>
        </div>
        <div class="no-logs-text">尚未開始實驗</div>
        <div class="no-logs-hint">實驗開始後，此處將顯示即時日誌</div>
      </div>
    `;

    logsContent.innerHTML = idleHtml;

    // 更新狀態指示器為等待狀態
    const statusIndicator = logsContent
      .closest("#experimentLogContainer")
      ?.querySelector(".status-indicator");
    if (statusIndicator) {
      statusIndicator.className = "status-indicator idle";
      statusIndicator.textContent = "等待開始";
    }

    // 隱藏同步按鈕
    if (experimentLogUI) {
      experimentLogUI.updateSyncButtonState("hide");
    }
  }

  /**
   * 取得日誌類型的顯示標籤
   * @private
   */
  _getTypeLabel(type) {
    return LOG_TYPE_LABELS[type] || type;
  }

  /**
   * 取得目前日誌陣列
   */
  getLogs() {
    return [...this.logs];
  }

  /**
   * 以 JSONL 格式取得日誌
   */
  getLogsAsJSONL() {
    return this.logs.map((log) => JSON.stringify(log)).join("\n");
  }

  /**
   * 記錄按鈕動作
   * @param {string} button - 按鈕ID (如 B5, B7 等)
   * @param {string} buttonFunction - 按鈕功能 (如 7, 9 等)
   * @param {string} clientId - 客戶端ID
   */
  logButtonAction(button, buttonFunction, clientId) {
    const experimentId = this._getCurrentExperimentId();

    const logEntry = {
      ts: this._getTimestamp(),
      type: "button_action",
      exp_id: experimentId,
      participant: this.participantName || `受試者_${experimentId}`,
      button: button,
      function: buttonFunction,
      client_id: clientId,
    };

    this._addLog(logEntry);
    Logger.debug("記錄: 按鈕動作", logEntry);
  }

  /**
   * 清空日誌 (用於測試或重新開始)
   */
  clear() {
    this.logs = [];
    this.pendingLogs = [];
    this._clearIndexedDB();
    Logger.info("日誌已清空");
  }

  /**
   * 初始化 BroadcastChannel 用於多分頁同步
   * @private
   */
  _initBroadcastChannel() {
    try {
      this.broadcastChannel = new BroadcastChannel("ExperimentLogsChannel");

      this.broadcastChannel.onmessage = (event) => {
        const { type, data: _data, senderTabId } = event.data;

        // 忽略自己發送的訊息
        if (senderTabId === this.tabId) return;

        switch (type) {
          case "logsSynced":
            Logger.debug(`分頁 ${senderTabId} 已同步日誌，重新載入本機資料`);
            this._restorePendingLogsFromIndexedDB();
            break;
          case "logsCleared":
            Logger.debug(`分頁 ${senderTabId} 已清空日誌，重新載入本機資料`);
            this.pendingLogs = [];
            break;
          case "logAdded":
            Logger.debug(`分頁 ${senderTabId} 新增了新日誌，重新載入本機資料`);
            this._restorePendingLogsFromIndexedDB();
            break;
        }
      };

      Logger.debug(`多分頁同步已啟用，分頁ID: ${this.tabId}`);
    } catch (error) {
      Logger.warn("BroadcastChannel 不支援，無法進行多分頁同步:", error);
    }
  }

  _closeBroadcastChannel() {
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
  }

  destroy() {
    this._closeBroadcastChannel();
  }

  /**
   * 發送廣播訊息到其他分頁
   * @param {string} type - 訊息類型
   * @param {Object} data - 訊息資料
   * @private
   */
  _broadcastMessage(type, data) {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({
        type,
        data,
        senderTabId: this.tabId,
        timestamp: Date.now(),
      });
    }
  }
}

Object.assign(
  ExperimentLogManager.prototype,
  logDbStore,
  logRuntimeWriter,
);

// ES6 模組匯出
export default ExperimentLogManager;
export { ExperimentLogManager };