/**
 * ExperimentLogManager - 實驗日誌管理系統
 * 負責記錄實驗過程的所有事件
 * 支援 JSONL 格式，即時同步到伺服器
 */

class ExperimentLogManager {
  constructor() {
    this.logs = [];
    this.pendingLogs = []; // 初始化為空陣列，防止事件監聽器存取 undefined
    this.experimentId = null;
    this.subjectName = null;
    this.experimentStartTime = null;
    this.syncEnabled = false; // 關閉同步到伺服器
    this.bufferSize = 10; // 累積 10 條後批次發送（本機儲存）
    this.maxPendingLogs = 100; // 最大待發送日誌數量，防止記憶體溢出

    // 時間同步管理器引用
    this.timeSyncManager = window.timeSyncManager;

    // IndexedDB 設定
    this.dbName = "ExperimentLogsDB";
    this.dbVersion = 1;
    this.pendingLogsStore = "pendingLogs";
    this.db = null;

    // 多分頁同步
    this.broadcastChannel = null;
    this.tabId = Date.now() + "-" + Math.random().toString(36).substr(2, 9);

    // 初始化完成標記
    this.initialized = false;

    // 初始化 IndexedDB
    this._initIndexedDB();
    // 初始化多分頁同步
    this._initBroadcastChannel();

    // 監聽輸入框變化來同步實驗ID
    this._setupExperimentIdSync();

    // 記錄初始化狀態
    Logger.debug(
      `日誌管理器建立完成，分頁ID: ${this.tabId}, 本機 IndexedDB 存儲`,
    );

    // 標記初始化完成
    this.initialized = true;
  }

  /**
   * 設定實驗ID同步處理器
   * @private
   */
  _setupExperimentIdSync() {
    // 監聽狀態管理器的ID變化
    if (window.experimentStateManager) {
      window.experimentStateManager.on("experimentIdChanged", (data) => {
        this.experimentId = data.experimentId;
        Logger.debug(`日誌管理器同步實驗ID: ${data.experimentId}`);
      });

      // 初始化時從狀態管理器取得
      this.experimentId = window.experimentStateManager.experimentId;
    }

    // 備用：監聽輸入框變化（如果沒有狀態管理器）
    if (!window.experimentStateManager) {
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
    // 優先從狀態管理器取得
    if (window.experimentStateManager) {
      return window.experimentStateManager.experimentId;
    }
    return this.experimentId;
  }

  /**
   * 設定實驗ID
   * @param {string} experimentId - 新的實驗ID
   * @param {string} source - 更新來源 (用於記錄)
   * @public
   */
  setExperimentId(experimentId, source = "unknown") {
    // 優先通過狀態管理器設置
    if (window.experimentStateManager) {
      window.experimentStateManager.setExperimentId(experimentId, source);
      return;
    }

    // 備用：直接設置
    if (this.experimentId !== experimentId) {
      this.experimentId = experimentId;
      Logger.info(`日誌管理器實驗ID已更新 (${source}): ${experimentId}`);

      // 同步更新輸入框
      const experimentIdInput = document.getElementById("experimentIdInput");
      if (
        experimentIdInput &&
        experimentIdInput.value.trim() !== experimentId
      ) {
        experimentIdInput.value = experimentId;
      }

      // 分發事件供其他組件使用
      document.dispatchEvent(
        new CustomEvent("experiment_id_changed", {
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
      Logger.info(
        `日誌管理器已初始化: 實驗ID=${experimentId}, 受試者=${this.participantName}`,
      );

      // 初始化完成後，嘗試發送任何待發送的日誌
      if (this.pendingLogs.length > 0) {
        Logger.info(
          `初始化完成，發現 ${this.pendingLogs.length} 條待發送日誌，準備發送`,
        );
        // 延遲一小段時間，確保其他組件也初始化完成
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
   * 取得目前實驗ID
   * @private
   */
  _getCurrentExperimentId() {
    return this.experimentId;
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
    if (
      window.experimentPageManager &&
      !window.experimentPageManager.experimentRunning
    ) {
      // 檢查是否滿足啟動條件
      const experimentIdInput = document.getElementById("experimentIdInput");
      if (experimentIdInput && experimentIdInput.value.trim()) {
        Logger.info("偵測到實驗操作，自動啟動實驗");
        try {
          window.experimentPageManager.startExperiment();
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
    this.experimentStartTime = Date.now();

    // 取得裝置ID
    let deviceId = null;
    if (window.syncClient) {
      deviceId = window.syncClient.clientId;
    }

    // 取得實驗組合資訊
    let combinationId = null;
    let combinationName = null;
    if (window.app && window.app.currentCombination) {
      combinationId = window.app.currentCombination.combination_id;
      combinationName =
        window.app.currentCombination.combination_name ||
        window.app.currentCombination.name;
    }

    const logEntry = {
      ts: this.experimentStartTime,
      type: "exp_start",
      exp_id: experimentId,
      participant: this.participantName || `受試者_${experimentId}`,
    };

    // 新增裝置ID（如果有）
    if (deviceId) {
      logEntry.d_id = deviceId;
    }

    // 新增實驗組合（如果有）
    if (combinationId) {
      logEntry.combo_id = combinationId;
    }
    if (combinationName) {
      logEntry.combo_name = combinationName;
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

    // 取得裝置ID
    let deviceId = null;
    if (window.syncClient) {
      deviceId = window.syncClient.clientId;
    }

    const logEntry = {
      ts: Date.now(),
      type: "exp_end",
      exp_id: experimentId,
      participant: this.participantName || `受試者_${experimentId}`,
    };

    // 新增裝置ID（如果有）
    if (deviceId) {
      logEntry.d_id = deviceId;
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

    let deviceId = null;
    if (window.syncClient) {
      deviceId = window.syncClient.clientId;
    }

    const logEntry = {
      ts: Date.now(),
      type: "exp_pause",
      exp_id: experimentId,
    };

    if (deviceId) {
      logEntry.d_id = deviceId;
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

    let deviceId = null;
    if (window.syncClient) {
      deviceId = window.syncClient.clientId;
    }

    const logEntry = {
      ts: Date.now(),
      type: "exp_resume",
      exp_id: experimentId,
    };

    if (deviceId) {
      logEntry.d_id = deviceId;
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
    // 自動啟動實驗（如果尚未執行）
    this._autoStartExperimentIfNeeded();

    const experimentId = this._getCurrentExperimentId();

    // 取得裝置ID
    let deviceId = null;
    if (window.syncClient) {
      deviceId = window.syncClient.clientId;
    }

    // 取得手勢名稱
    let gestureName = null;
    if (
      window.app &&
      window.app.currentCombination &&
      window.app.currentCombination.gestures &&
      window.app.currentCombination.gestures[gestureIndex]
    ) {
      gestureName =
        window.app.currentCombination.gestures[gestureIndex].gesture_name ||
        window.app.currentCombination.gestures[gestureIndex].name;
    }

    const logEntry = {
      ts: Date.now(),
      type: "gesture_step_start",
      exp_id: experimentId,
      g_idx: gestureIndex,
    };

    if (gestureName) {
      logEntry.g_name = gestureName;
    }
    if (stepId) {
      logEntry.s_id = stepId;
    }
    if (deviceId) {
      logEntry.d_id = deviceId;
    }
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

    // 取得裝置ID
    let deviceId = null;
    if (window.syncClient) {
      deviceId = window.syncClient.clientId;
    }

    // 取得手勢名稱
    let gestureName = null;
    if (
      window.app &&
      window.app.currentCombination &&
      window.app.currentCombination.gestures &&
      window.app.currentCombination.gestures[gestureIndex]
    ) {
      gestureName =
        window.app.currentCombination.gestures[gestureIndex].gesture_name ||
        window.app.currentCombination.gestures[gestureIndex].name;
    }

    const logEntry = {
      ts: Date.now(),
      type: "gesture_step_end",
      exp_id: experimentId,
      g_idx: gestureIndex,
    };

    if (gestureName) {
      logEntry.g_name = gestureName;
    }
    if (stepId) {
      logEntry.s_id = stepId;
    }
    if (deviceId) {
      logEntry.d_id = deviceId;
    }
    this._addLog(logEntry);
    Logger.debug("記錄: 手勢步驟結束", logEntry);
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
    if (!["t", "f", "n"].includes(gestureType)) {
      Logger.warn(`無效的手勢類型: ${gestureType}，應為 t/f/n 之一`);
      return;
    }

    const logEntry = {
      ts: Date.now(),
      type: "gesture_attempt",
      exp_id: experimentId,
      g_idx: gestureIndex,
      g_type: gestureType,
    };
    if (stepId) {
      logEntry.s_id = stepId;
    }
    this._addLog(logEntry);

    const gestureNames = { t: "正確", f: "錯誤", n: "未分類" };
    Logger.debug(`記錄: 手勢嘗試 (${gestureNames[gestureType]})`, logEntry);
  }

  /**
   * 記錄按鈕動作
   * @param {string} actionId - 動作ID
   * @param {number} gestureIndex - 手勢索引 (可選)
   * @param {string} stepId - 步驟ID (可選)
   */
  logAction(actionId, gestureIndex = null, stepId = null, deviceId = null) {
    const experimentId = this._getCurrentExperimentId();

    // 如果未提供裝置 ID，嘗試從 SyncClient 取得
    if (!deviceId && window.syncClient) {
      deviceId = window.syncClient.clientId;
    }

    const logEntry = {
      ts: Date.now(),
      type: "action",
      exp_id: experimentId,
      a_id: actionId,
    };
    if (gestureIndex !== null) {
      logEntry.g_idx = gestureIndex;
    }
    if (stepId) {
      logEntry.s_id = stepId;
    }
    if (deviceId) {
      logEntry.d_id = deviceId;
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
   * 發送待發送的日誌到伺服器
   * @private
   */
  /**
   * 將待處理日誌寫入 IndexedDB
   * @private
   */
  async _flushLogs() {
    if (this.pendingLogs.length === 0) {
      Logger.debug("[ExperimentLogManager] 沒有待處理的日誌");
      return;
    }

    Logger.debug(
      `[ExperimentLogManager] 將 ${this.pendingLogs.length} 條日誌寫入 IndexedDB`,
    );

    try {
      await this._savePendingLogsToIndexedDB();
      this.pendingLogs = [];
      Logger.debug(`[ExperimentLogManager] 日誌已儲存到 IndexedDB`);
    } catch (error) {
      Logger.error("[ExperimentLogManager] 寫入 IndexedDB 失敗:", error);
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

      Logger.debug(
        `[ExperimentLogManager] 成功儲存 ${this.pendingLogs.length} 條日誌到 IndexedDB`,
      );

      // 廣播同步事件
      this._broadcastMessage("logsSynced", { count: this.pendingLogs.length });
    } catch (error) {
      Logger.error("[ExperimentLogManager] 批次儲存日誌失敗:", error);
      throw error;
    }
  }

  /**
   * 強制完成所有待處理的日誌 (實驗結束時呼叫)
   * 確保所有日誌寫入 IndexedDB 並儲存為 JSONL 檔案
   */
  async flushAll() {
    Logger.debug(
      `[ExperimentLogManager] 完成實驗，確保 ${this.pendingLogs.length} 條待處理日誌寫入 IndexedDB`,
    );

    try {
      // 直接將 pendingLogs 寫入 IndexedDB
      if (this.pendingLogs.length > 0) {
        await this._savePendingLogsToIndexedDB();
        this.pendingLogs = [];
        Logger.info(
          `[ExperimentLogManager] ${this.logs.length} 條日誌已全部儲存到 IndexedDB`,
        );
      } else {
        Logger.debug("[ExperimentLogManager] 沒有待處理的日誌");
      }

      // 同時儲存為 JSONL 檔案到 runtime 資料夾（使用 PHP API）
      await this._saveToRuntimeFolder();
    } catch (error) {
      Logger.error("[ExperimentLogManager] flushAll 發生錯誤:", error);
    }
  }

  /**
   * 儲存日誌到 runtime/experiment-data 資料夾
   * @private
   */
  async _saveToRuntimeFolder() {
    if (this.logs.length === 0) {
      Logger.debug("[ExperimentLogManager] 沒有日誌需要儲存");
      return;
    }

    try {
      // 產生 JSONL 格式
      const jsonlContent = this.logs
        .map((log) => JSON.stringify(log))
        .join("\n");

      // 使用「實驗 ID + 時間戳」作為檔案名稱
      const timestamp = Date.now();
      const filename = `${this.experimentId}_${timestamp}.jsonl`;

      // 取得 API URL
      const apiUrl = this._getApiUrl();

      // 使用 Node.js API 儲存檔案
      const response = await fetch(`${apiUrl}/api/experiment-logs/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filename: filename,
          content: jsonlContent,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          Logger.info(`[ExperimentLogManager] 日誌已儲存到 ${result.path}`);
        } else {
          Logger.warn(`[ExperimentLogManager] 儲存日誌失敗: ${result.error}`);
        }
      } else {
        Logger.warn(
          `[ExperimentLogManager] 無法連接到後端 API (${response.status})，日誌僅儲存於 IndexedDB`,
        );
      }
    } catch (error) {
      Logger.warn(
        `[ExperimentLogManager] 儲存到 runtime 資料夾失敗（僅儲存於 IndexedDB）:`,
        error.message,
      );
    }
  }

  /**
   * 取得 API URL
   * @private
   */
  _getApiUrl() {
    const protocol = window.location.protocol;
    const host = window.location.hostname;
    const port = "7645";
    return `${protocol}//${host}:${port}`;
  }

  /**
  /**
   * 更新 UI 中的日誌顯示
   * @private
   */
  _updateLogDisplay() {
    const logPanel = document.getElementById("experimentLogDisplay");
    if (!logPanel) {
      return;
    }

    // 只顯示最近 20 條
    const recentLogs = this.logs.slice(-20);
    let html = `<div style="font-size: 12px; max-height: 300px; overflow-y: auto; padding: 10px; background: #f5f5f5; border-radius: 4px;">`;

    recentLogs.forEach((log) => {
      const time = new Date(log.ts).toLocaleTimeString("zh-TW");
      const typeLabel = this._getTypeLabel(log.type);
      let details = "";

      if (log.g_idx !== undefined) {
        // 日誌記錄使用 0-based index，但顯示時 +1 以配對手勢卡片上的步驟編號
        details += `手勢#${log.g_idx + 1}`;
      }
      if (log.g_type) {
        const typeMap = { t: "正確", f: "錯誤", n: "未知" };
        details += ` ${typeMap[log.g_type]}`;
      }
      if (log.a_id) {
        details += `${log.a_id}`;
      }
      if (log.s_id) {
        details += ` (${log.s_id})`;
      }

      html += `<div style="padding: 4px; border-bottom: 1px solid #ddd; word-break: break-all;">
        <span style="color: #666;">[${time}]</span>
        <strong>${typeLabel}</strong>
        ${details ? `<span style="color: #333;">${details}</span>` : ""}
      </div>`;
    });

    html += `</div>`;
    html += `<div style="margin-top: 10px; font-size: 12px; color: #666;">
      共 ${this.logs.length} 條記錄 | 待發送: ${this.pendingLogs.length}
    </div>`;

    logPanel.innerHTML = html;
  }

  /**
   * 取得日誌類型的顯示標籤
   * @private
   */
  _getTypeLabel(type) {
    const labels = {
      exp_start: "實驗開始",
      exp_end: "實驗結束",
      exp_pause: "實驗暫停",
      exp_resume: "實驗繼續",
      gesture_step_start: "步驟開始",
      gesture_step_end: "步驟結束",
      gesture_attempt: "手勢",
      action: "動作",
    };
    return labels[type] || type;
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
   * 列出所有已儲存的實驗（從 IndexedDB）
   * @returns {Promise<Array>} 實驗列表
   */
  async listExperiments() {
    try {
      if (!this.db) {
        Logger.warn("[ExperimentLogManager] IndexedDB 尚未初始化");
        return [];
      }

      const transaction = this.db.transaction(
        [this.pendingLogsStore],
        "readonly",
      );
      const store = transaction.objectStore(this.pendingLogsStore);
      const request = store.getAll();

      return new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
          const allLogs = event.target.result || [];

          // 按實驗 ID 分組
          const experimentsMap = new Map();

          allLogs.forEach((log) => {
            const expId = log.exp_id || log.experimentId || "unknown";

            if (!experimentsMap.has(expId)) {
              experimentsMap.set(expId, {
                experimentId: expId,
                participantName:
                  log.participant || log.subject_name || `受試者_${expId}`,
                logs: [],
                startTime: null,
                endTime: null,
                logCount: 0,
              });
            }

            const experiment = experimentsMap.get(expId);
            experiment.logs.push(log);
            experiment.logCount++;

            // 更新參與者名稱（使用最新的非空值）
            if (
              log.participant &&
              !experiment.participantName.startsWith("受試者_")
            ) {
              experiment.participantName = log.participant;
            }

            // 記錄開始和結束時間
            if (log.type === "exp_start" && !experiment.startTime) {
              experiment.startTime = log.ts;
            }
            if (log.type === "exp_end") {
              experiment.endTime = log.ts;
            }
          });

          // 轉換為陣列並排序（最新的在前）
          const experiments = Array.from(experimentsMap.values());
          experiments.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));

          Logger.debug(
            `[ExperimentLogManager] 從 IndexedDB 載入 ${experiments.length} 個實驗`,
          );

          // 調試信息：列出所有實驗ID
          if (experiments.length > 0) {
            Logger.debug(
              `[ExperimentLogManager] 實驗ID列表: ${experiments
                .map((e) => `${e.experimentId}(${e.logCount}條)`)
                .join(", ")}`,
            );
          }

          resolve(experiments);
        };

        request.onerror = (event) => {
          Logger.error(
            "[ExperimentLogManager] 列出實驗失敗:",
            event.target.error,
          );
          reject(event.target.error);
        };
      });
    } catch (error) {
      Logger.error("[ExperimentLogManager] listExperiments 發生錯誤:", error);
      return [];
    }
  }

  /**
   * 取得所有日誌（包含記憶體和 IndexedDB 的）
   * @returns {Promise<Array>} 所有日誌
   */
  async getAllLogs() {
    try {
      if (!this.db) {
        Logger.warn(
          "[ExperimentLogManager] IndexedDB 尚未初始化，僅回傳記憶體中的日誌",
        );
        return [...this.logs, ...this.pendingLogs];
      }

      const transaction = this.db.transaction(
        [this.pendingLogsStore],
        "readonly",
      );
      const store = transaction.objectStore(this.pendingLogsStore);
      const request = store.getAll();

      return new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
          const storedLogs = event.target.result || [];
          // 合併記憶體和儲存的日誌
          const allLogs = [...this.logs, ...this.pendingLogs, ...storedLogs];
          // 按時間戳排序
          allLogs.sort((a, b) => a.ts - b.ts);
          resolve(allLogs);
        };

        request.onerror = (event) => {
          Logger.error(
            "[ExperimentLogManager] 讀取所有日誌失敗:",
            event.target.error,
          );
          // 發生錯誤時至少回傳記憶體中的日誌
          resolve([...this.logs, ...this.pendingLogs]);
        };
      });
    } catch (error) {
      Logger.error("[ExperimentLogManager] getAllLogs 發生錯誤:", error);
      return [...this.logs, ...this.pendingLogs];
    }
  }

  /**
   * 根據實驗 ID 取得日誌
   * @param {string} experimentId - 實驗 ID
   * @returns {Promise<Array>} 該實驗的所有日誌
   */
  async getLogsByExperimentId(experimentId) {
    try {
      const allLogs = await this.getAllLogs();
      const filtered = allLogs.filter(
        (log) =>
          log.exp_id === experimentId || log.experimentId === experimentId,
      );

      Logger.debug(
        `[ExperimentLogManager] 取得實驗 ${experimentId} 的日誌: 找到 ${filtered.length} 條（總共 ${allLogs.length} 條）`,
      );

      // 如果沒找到，輸出調試信息
      if (filtered.length === 0 && allLogs.length > 0) {
        const uniqueExpIds = [
          ...new Set(allLogs.map((log) => log.exp_id || log.experimentId)),
        ];
        Logger.warn(
          `[ExperimentLogManager] 未找到匹配的實驗ID。查找: "${experimentId}", 資料庫中的ID: ${uniqueExpIds.join(
            ", ",
          )}`,
        );
      }

      return filtered;
    } catch (error) {
      Logger.error(
        `[ExperimentLogManager] 取得實驗 ${experimentId} 的日誌失敗:`,
        error,
      );
      return [];
    }
  }

  /**
   * 根據實驗 ID 取得日誌（別名，供 UI 使用）
   * @param {string} experimentId - 實驗 ID
   * @returns {Promise<Array>} 該實驗的所有日誌
   */
  async getLogsByExperiment(experimentId) {
    return this.getLogsByExperimentId(experimentId);
  }

  /**
   * 刪除指定實驗的所有日誌（從 IndexedDB）
   * @param {string} experimentId - 實驗 ID
   * @returns {Promise<boolean>} 是否成功
   */
  async deleteExperiment(experimentId) {
    try {
      if (!this.db) {
        Logger.warn("[ExperimentLogManager] IndexedDB 尚未初始化");
        return false;
      }

      const transaction = this.db.transaction(
        [this.pendingLogsStore],
        "readwrite",
      );
      const store = transaction.objectStore(this.pendingLogsStore);

      // 先取得所有日誌
      const getAllRequest = store.getAll();

      return new Promise((resolve, reject) => {
        getAllRequest.onsuccess = (event) => {
          const allLogs = event.target.result || [];

          // 過濾出要刪除的日誌
          const logsToDelete = allLogs.filter(
            (log) =>
              log.exp_id === experimentId || log.experimentId === experimentId,
          );

          if (logsToDelete.length === 0) {
            Logger.warn(
              `[ExperimentLogManager] 沒有找到實驗 ${experimentId} 的日誌`,
            );
            resolve(true);
            return;
          }

          // 刪除每一條日誌
          let deletedCount = 0;
          logsToDelete.forEach((log, index) => {
            const deleteRequest = store.delete(log.id || index);

            deleteRequest.onsuccess = () => {
              deletedCount++;
              if (deletedCount === logsToDelete.length) {
                Logger.info(
                  `[ExperimentLogManager] 已刪除實驗 ${experimentId} 的 ${deletedCount} 條日誌`,
                );
                // 廣播刪除事件
                this._broadcastMessage("experimentDeleted", { experimentId });
                resolve(true);
              }
            };

            deleteRequest.onerror = (e) => {
              Logger.error(
                `[ExperimentLogManager] 刪除日誌失敗:`,
                e.target.error,
              );
              reject(e.target.error);
            };
          });
        };

        getAllRequest.onerror = (event) => {
          Logger.error(
            "[ExperimentLogManager] 讀取日誌失敗:",
            event.target.error,
          );
          reject(event.target.error);
        };
      });
    } catch (error) {
      Logger.error(
        `[ExperimentLogManager] 刪除實驗 ${experimentId} 失敗:`,
        error,
      );
      return false;
    }
  }

  /**
   * 記錄遠端按鈕動作
   * @param {string} button - 按鈕ID (如 B5, B7 等)
   * @param {string} buttonFunction - 按鈕功能 (如 7, 9 等)
   * @param {string} remoteDeviceId - 遠端裝置ID
   */
  logRemoteButtonAction(button, buttonFunction, remoteDeviceId) {
    const experimentId = this._getCurrentExperimentId();

    const logEntry = {
      ts: Date.now(),
      type: "remote_button_action",
      exp_id: experimentId,
      participant: this.participantName || `受試者_${experimentId}`,
      button: button,
      function: buttonFunction,
      remote_device_id: remoteDeviceId,
    };

    this._addLog(logEntry);
    Logger.debug("記錄: 遠端按鈕動作", logEntry);
  }

  /**
   * 檢查日誌時間戳一致性
   * @private
   */
  _checkLogTimeConsistency(logs) {
    const issues = {
      hasIssues: false,
      duplicateTimestamps: [],
      timeGaps: [],
      futureTimestamps: [],
      totalLogs: logs.length,
    };

    if (logs.length < 2) return issues;

    const now = Date.now();
    const timestampCounts = new Map();

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      const timestamp = log.ts || log.timestamp || 0;

      // 檢查重複時間戳
      if (!timestampCounts.has(timestamp)) {
        timestampCounts.set(timestamp, 0);
      }
      timestampCounts.set(timestamp, timestampCounts.get(timestamp) + 1);

      if (timestampCounts.get(timestamp) > 1) {
        issues.duplicateTimestamps.push({
          timestamp,
          count: timestampCounts.get(timestamp),
          types: [log.type],
        });
        issues.hasIssues = true;
      }

      // 檢查未來時間戳（超過目前時間1分鐘）
      if (timestamp > now + 60000) {
        issues.futureTimestamps.push({
          index: i,
          timestamp,
          type: log.type,
          offset: timestamp - now,
        });
        issues.hasIssues = true;
      }

      // 檢查時間間隔（與前一條日誌比較）
      if (i > 0) {
        const prevLog = logs[i - 1];
        const prevTimestamp = prevLog.ts || prevLog.timestamp || 0;
        const gap = timestamp - prevTimestamp;

        // 如果時間間隔為負數或過大（超過1小時），記錄下來
        if (gap < 0 || gap > 3600000) {
          issues.timeGaps.push({
            index: i,
            from: prevTimestamp,
            to: timestamp,
            gap: gap,
            type: log.type,
          });
          issues.hasIssues = true;
        }
      }
    }

    return issues;
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
   * 初始化 IndexedDB
   * @private
   */
  _initIndexedDB() {
    try {
      // 檢查瀏覽器是否支援 IndexedDB
      if (!window.indexedDB) {
        Logger.warn("IndexedDB 不支援，日誌將只存在記憶體中 (離線時可能遺失)");
        this.db = null;
        return;
      }

      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = (event) => {
        Logger.error("IndexedDB 初始化失敗:", event.target.error);
        this.db = null;
        // 降級方案：繼續使用記憶體存儲
        Logger.warn("將使用記憶體存儲日誌，離線時可能遺失");
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        Logger.debug("IndexedDB 初始化成功");
        // 從 IndexedDB 還原待發送日誌
        this._restorePendingLogsFromIndexedDB();
      };

      request.onupgradeneeded = (event) => {
        try {
          const db = event.target.result;
          // 建立 pendingLogs 存儲對象
          if (!db.objectStoreNames.contains(this.pendingLogsStore)) {
            const store = db.createObjectStore(this.pendingLogsStore, {
              keyPath: "id",
              autoIncrement: true,
            });
            store.createIndex("timestamp", "timestamp", { unique: false });
            Logger.info("建立 IndexedDB 存儲對象:", this.pendingLogsStore);
          }
        } catch (error) {
          Logger.error("IndexedDB upgrade 失敗:", error);
        }
      };
    } catch (error) {
      Logger.error("IndexedDB 初始化異常:", error);
      this.db = null;
      Logger.warn("將使用記憶體存儲日誌，離線時可能遺失");
    }
  }

  /**
   * 從 IndexedDB 還原待發送日誌
   * @private
   */
  _restorePendingLogsFromIndexedDB() {
    try {
      if (!this.db) {
        Logger.debug("IndexedDB 未初始化，跳過還原");
        return;
      }

      const transaction = this.db.transaction(
        [this.pendingLogsStore],
        "readonly",
      );
      const store = transaction.objectStore(this.pendingLogsStore);
      const request = store.getAll();

      request.onsuccess = (event) => {
        try {
          const storedLogs = event.target.result;
          if (storedLogs && storedLogs.length > 0) {
            // 按時間戳排序
            storedLogs.sort((a, b) => a.timestamp - b.timestamp);
            this.pendingLogs = storedLogs;
            Logger.debug(`從 IndexedDB 還原 ${storedLogs.length} 條待發送日誌`);
          }
        } catch (error) {
          Logger.error("還原日誌時發生錯誤:", error);
        }
      };

      request.onerror = (event) => {
        Logger.error("從 IndexedDB 還原日誌失敗:", event.target.error);
        // 降級方案：繼續使用記憶體存儲
      };
    } catch (error) {
      Logger.error("IndexedDB 還原異常:", error);
    }
  }

  /**
   * 儲存日誌到 IndexedDB
   * @param {Object} logEntry - 日誌條目
   * @private
   */
  _saveLogToIndexedDB(logEntry) {
    try {
      if (!this.db) return;

      const transaction = this.db.transaction(
        [this.pendingLogsStore],
        "readwrite",
      );
      const store = transaction.objectStore(this.pendingLogsStore);
      const request = store.add(logEntry);

      request.onsuccess = () => {
        Logger.debug("日誌儲存到 IndexedDB 成功");
      };

      request.onerror = (event) => {
        Logger.error("儲存日誌到 IndexedDB 失敗:", event.target.error);
        // 降級方案：繼續使用記憶體存儲
      };
    } catch (error) {
      Logger.error("存儲日誌到 IndexedDB 異常:", error);
    }
  }

  /**
   * 從 IndexedDB 刪除已發送的日誌
   * @param {Array} sentLogs - 已發送的日誌數組
   * @private
   */
  _removeLogsFromIndexedDB(sentLogs) {
    try {
      if (!this.db || !sentLogs || sentLogs.length === 0) return;

      const transaction = this.db.transaction(
        [this.pendingLogsStore],
        "readwrite",
      );
      const store = transaction.objectStore(this.pendingLogsStore);

      sentLogs.forEach((log) => {
        if (log.id) {
          const request = store.delete(log.id);
          request.onerror = (event) => {
            Logger.error("從 IndexedDB 刪除日誌失敗:", event.target.error);
          };
        }
      });

      Logger.debug(`從 IndexedDB 刪除 ${sentLogs.length} 條已發送日誌`);
    } catch (error) {
      Logger.error("刪除日誌異常:", error);
    }
  }

  /**
   * 清空 IndexedDB 中的所有待發送日誌
   * @private
   */
  _clearIndexedDB() {
    if (!this.db) return;

    const transaction = this.db.transaction(
      [this.pendingLogsStore],
      "readwrite",
    );
    const store = transaction.objectStore(this.pendingLogsStore);
    const request = store.clear();

    request.onsuccess = () => {
      Logger.debug("IndexedDB 已清空");
      // 通知其他分頁
      this._broadcastMessage("logsCleared", {});
    };

    request.onerror = (event) => {
      Logger.error("清空 IndexedDB 失敗:", event.target.error);
    };
  }

  /**
   * 初始化 BroadcastChannel 用於多分頁同步
   * @private
   */
  _initBroadcastChannel() {
    try {
      this.broadcastChannel = new BroadcastChannel("ExperimentLogsChannel");

      this.broadcastChannel.onmessage = (event) => {
        const { type, data, senderTabId } = event.data;

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

// 全域暴露 - 立即建立實例
(function () {
  window.ExperimentLogManager = ExperimentLogManager;
  window.experimentLogManager = new ExperimentLogManager();

  // 全域函數：取得目前實驗ID (從狀態管理器取得)
  window.getCurrentExperimentId = function () {
    if (window.experimentStateManager) {
      return window.experimentStateManager.experimentId || "";
    }
    return window.experimentLogManager.getExperimentId() || "";
  };
})();

// 如果作為 ES6 模塊導入，也提供匯出
if (typeof module !== "undefined" && module.exports) {
  module.exports = ExperimentLogManager;
}
