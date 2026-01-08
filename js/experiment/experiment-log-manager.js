/**
 * ExperimentLogManager - 實驗日誌管理系統
 * 負責記錄實驗過程的所有事件
 * 支援 JSONL 格式，即時同步到伺服器
 */

class ExperimentLogManager {
  constructor() {
    this.logs = [];
    this.pendingLogs = []; // 初始化為空陣列，防止事件監聽器訪問 undefined
    this.experimentId = null;
    this.participantName = null;
    this.experimentStartTime = null;
    this.apiUrl = "php/experiment-log-api.php";
    this.syncEnabled = true; // 開關：是否即時同步到伺服器
    this.bufferSize = 10; // 累積 10 條後批量發送
    this.maxPendingLogs = 100; // 最大待發送日誌數量，防止記憶體溢出
    this.networkRecoveryAttempts = 0; // 網路恢復嘗試次數
    this.maxRecoveryAttempts = 5; // 最大重試次數
    this.baseRecoveryDelay = 1000; // 基礎延遲1秒
    this.isRecoveringLogs = false; // 正在還原日誌中，防止重複發送

    // 時間同步管理器引用
    this.timeSyncManager = window.timeSyncManager;

    // IndexedDB 配置
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

    // 設定網路恢復處理器
    this._setupNetworkRecoveryHandler();

    // 記錄初始化狀態
    Logger.debug(
      `日誌管理器建立完成，分頁ID: ${this.tabId}, 目前伺服器狀態: ${
        window.syncClient?.serverOnline ?? "unknown"
      }, IndexedDB 已初始化`
    );

    // 標記初始化完成
    this.initialized = true;
  }

  /**
   * 設定網路恢復處理器
   * @private
   */
  _setupNetworkRecoveryHandler() {
    // 監聽同步服務器狀態變化
    window.addEventListener("sync_server_status_changed", (event) => {
      // 防守檢查：確保 pendingLogs 存在
      if (!this.pendingLogs) {
        Logger.debug(`pendingLogs 還未初始化，忽略伺服器狀態變化事件`);
        return;
      }

      const { online, previousOnline } = event.detail;
      Logger.debug(
        `伺服器狀態變化: ${previousOnline} → ${online}, 待發送日誌數量: ${this.pendingLogs.length}, 初始化完成: ${this.initialized}`
      );

      // 只有在初始化完成後，從離線變為線上時，才自動重新整理待發送的日誌
      // 避免在應用程式啟動時的狀態變化觸發網路恢復
      if (
        this.initialized &&
        online &&
        !previousOnline &&
        this.pendingLogs.length > 0
      ) {
        Logger.info(
          `偵測到網路恢復，準備重新發送 ${this.pendingLogs.length} 條待發送日誌`
        );
        this.networkRecoveryAttempts = 0; // 重置嘗試次數
        this._attemptNetworkRecovery();
      } else if (!online && previousOnline) {
        Logger.warn("偵測到伺服器離線，日誌將保留在本機");
      }
    });

    // 也監聽原生網路事件作為備用
    window.addEventListener("online", () => {
      Logger.debug(`瀏覽器網路恢復事件觸發, 初始化完成: ${this.initialized}`);
      if (this.initialized && this.pendingLogs.length > 0) {
        this.networkRecoveryAttempts = 0; // 重置嘗試次數
        this._attemptNetworkRecovery();
      }
    });

    // 監聽 syncClient 初始化完成，此時可以開始發送日誌
    window.addEventListener("sync_client_initialized", (event) => {
      // 防守檢查：確保 pendingLogs 存在
      if (!this.pendingLogs) {
        Logger.debug(`pendingLogs 還未初始化，忽略 syncClient 初始化事件`);
        return;
      }

      const { serverOnline } = event.detail;
      Logger.debug(
        `syncClient 已初始化完成，伺服器狀態: ${serverOnline}, 待發送日誌: ${this.pendingLogs.length}`
      );

      // 如果伺服器線上且有待發送的日誌，立即嘗試發送
      if (
        serverOnline &&
        this.pendingLogs.length > 0 &&
        !this.isRecoveringLogs
      ) {
        this.isRecoveringLogs = true; // 標記正在還原日誌
        Logger.info(
          `syncClient 就緒且伺服器線上，準備發送 ${this.pendingLogs.length} 條待發送日誌`
        );
        // 延遲一小段時間，確保其他初始化完成
        setTimeout(() => {
          this._flushLogs().finally(() => {
            this.isRecoveringLogs = false; // 還原完成
          });
        }, 500);
      }
    });
  }

  /**
   * 使用指數退避嘗試網路恢復
   * @private
   */
  _attemptNetworkRecovery() {
    if (this.networkRecoveryAttempts >= this.maxRecoveryAttempts) {
      Logger.warn(
        `網路恢復嘗試已達最大次數 (${this.maxRecoveryAttempts})，放棄自動同步`
      );
      return;
    }

    // 如果正在通過初始化事件還原日誌，跳過網路恢復機制
    if (this.isRecoveringLogs) {
      Logger.debug(`正在透過 syncClient 初始化事件還原日誌，跳過網路恢復機制`);
      return;
    }

    this.networkRecoveryAttempts++;
    const delay =
      this.baseRecoveryDelay * Math.pow(2, this.networkRecoveryAttempts - 1); // 指數退避

    Logger.info(
      `網路恢復嘗試 ${this.networkRecoveryAttempts}/${this.maxRecoveryAttempts}，` +
        `${this.pendingLogs.length} 條待發送日誌，延遲 ${delay}ms`
    );

    setTimeout(() => {
      // 簡化狀態檢查：優先使用伺服器健康檢查結果
      // 避免 navigator.onLine 的不準確和三態邏輯
      const navigatorOnline = navigator.onLine;
      const syncClientExists = !!window.syncClient;
      const serverOnline = window.syncClient?.serverOnline ?? null; // 明確三態：true/false/null

      Logger.debug(
        `網路狀態檢查: navigator.onLine=${navigatorOnline}, syncClient存在=${syncClientExists}, serverOnline=${serverOnline}`
      );

      // 如果 syncClient 還沒準備好，延遲重試而不是放棄
      if (!syncClientExists) {
        Logger.debug(`syncClient 還未初始化，延遲 500ms 後重試`);
        this.networkRecoveryAttempts--; // 不計入失敗次數
        setTimeout(() => this._attemptNetworkRecovery(), 500);
        return;
      }

      // 簡化邏輯：只有 serverOnline === true 才發送
      if (serverOnline === true) {
        Logger.info(
          `網路恢復成功，開始發送 ${this.pendingLogs.length} 條待發送日誌`
        );
        this._flushLogs();
        this.networkRecoveryAttempts = 0; // 成功後重置
      } else if (serverOnline === false) {
        // 明確的離線狀態
        Logger.warn(
          `網路仍不穩定: 嘗試 ${this.networkRecoveryAttempts} 次 (navigator.onLine=${navigatorOnline}, serverOnline=${serverOnline})`
        );
        this._attemptNetworkRecovery(); // 繼續嘗試
      } else {
        // serverOnline === null：未知狀態，嘗試健康檢查
        Logger.debug(`伺服器狀態未知，嘗試執行健康檢查`);
        this.networkRecoveryAttempts--; // 不計入失敗次數
        setTimeout(() => this._attemptNetworkRecovery(), 500);
      }
    }, delay);
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

    // 監聽同步服務器的ID更新事件（備用）
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
        })
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
        `日誌管理器已初始化: 實驗ID=${experimentId}, 受試者=${this.participantName}`
      );

      // 初始化完成後，嘗試發送任何待發送的日誌
      if (this.pendingLogs.length > 0) {
        Logger.info(
          `初始化完成，發現 ${this.pendingLogs.length} 條待發送日誌，準備發送`
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
    Logger.info("記錄: 實驗開始", logEntry);
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
    Logger.info("記錄: 實驗結束", logEntry);
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
    Logger.info("記錄: 實驗暫停", logEntry);
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
    Logger.info("記錄: 實驗還原", logEntry);
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
    Logger.info("記錄: 手勢步驟開始", logEntry);
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
    Logger.info("記錄: 手勢步驟結束", logEntry);
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
    Logger.info(`記錄: 手勢嘗試 (${gestureNames[gestureType]})`, logEntry);
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
    Logger.info("記錄: 按鈕動作", logEntry);
  }

  /**
   * 內部方法：新增日誌並處理同步
   * @private
   */
  _addLog(logEntry) {
    this.logs.push(logEntry);
    this.pendingLogs.push(logEntry);

    // 儲存到 IndexedDB 以實現持久化
    this._saveLogToIndexedDB(logEntry);

    // 通知其他分頁
    this._broadcastMessage("logAdded", { logCount: this.pendingLogs.length });

    // 檢查是否超過最大待發送日誌數量
    if (this.pendingLogs.length > this.maxPendingLogs) {
      // 移除最舊的日誌以釋放記憶體
      const removedLog = this.pendingLogs.shift();
      Logger.warn(
        `待發送日誌數量超過限制 (${this.maxPendingLogs})，移除最舊日誌:`,
        removedLog
      );
    }

    // 當累積達到 bufferSize 時，批量發送
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
  async _flushLogs() {
    if (this.pendingLogs.length === 0 || !this.syncEnabled) {
      Logger.debug(
        `跳過發送日誌: pendingLogs=${this.pendingLogs.length}, syncEnabled=${this.syncEnabled}`
      );
      return;
    }

    // 🔧 檢查伺服器連線狀態：只要伺服器線上就可以發送日誌
    // 不需要檢查同步工作階段連線狀態
    // 如果 serverOnline 是 null（未檢查），先執行健康檢查
    if (!window.syncClient) {
      Logger.debug("syncClient不存在，跳過發送日誌");
      return;
    }

    if (window.syncClient.serverOnline === null) {
      Logger.debug("伺服器狀態未檢查，先執行健康檢查");
      try {
        await window.syncClient.checkServerHealth();
      } catch (error) {
        Logger.warn("健康檢查失敗:", error);
        window.syncClient.serverOnline = false;
      }
    }

    if (window.syncClient.serverOnline !== true) {
      Logger.debug(
        `伺服器離線，跳過發送日誌 (serverOnline: ${
          window.syncClient.serverOnline
        }, isConnected: ${window.syncClient.isConnected?.()})`
      );
      return;
    }

    // 確保實驗ID存在
    const experimentId = this._getCurrentExperimentId();
    if (!experimentId) {
      Logger.warn("實驗ID未設定，日誌將保留在本機");
      return;
    }

    const logsToSend = [...this.pendingLogs];
    this.pendingLogs = [];

    Logger.debug(
      `準備發送 ${logsToSend.length} 條日誌到伺服器，實驗ID: ${experimentId}`
    );
    logsToSend.sort((a, b) => {
      const timeA = a.ts || a.timestamp || 0;
      const timeB = b.ts || b.timestamp || 0;
      return timeA - timeB; // 較舊的在前
    });

    // 檢查時間戳一致性
    const timeIssues = this._checkLogTimeConsistency(logsToSend);
    if (timeIssues.hasIssues) {
      Logger.warn("日誌時間戳偵測到問題:", timeIssues);
    }

    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "log_batch",
          exp_id: experimentId,
          logs: logsToSend,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        Logger.info(
          `已同步 ${logsToSend.length} 條日誌到伺服器 (按時間戳排序)`,
          result
        );
        // 成功後從 IndexedDB 刪除已發送的日誌
        this._removeLogsFromIndexedDB(logsToSend);
        // 通知其他分頁
        this._broadcastMessage("logsSynced", {
          syncedCount: logsToSend.length,
        });
      } else {
        const errorText = await response.text().catch(() => "無法讀取錯誤回應");
        Logger.warn(`日誌同步失敗 (HTTP ${response.status}): ${errorText}`);
        Logger.debug(
          `請求URL: ${this.apiUrl}, 請求大小: ${
            JSON.stringify(logsToSend).length
          } bytes`
        );
        // 發送失敗時，將伺服器狀態設置為離線
        if (window.syncClient) {
          window.syncClient.serverOnline = false;
        }
        // 失敗時不需要放回 pendingLogs，因為它們仍然在 IndexedDB 中
        // 重新從 IndexedDB 還原到記憶體
        this._restorePendingLogsFromIndexedDB();
      }
    } catch (error) {
      Logger.error("日誌同步網路錯誤:", error);
      Logger.debug(`網路錯誤詳情: ${error.message}, 請求URL: ${this.apiUrl}`);
      // 網路錯誤時，將伺服器狀態設置為離線
      if (window.syncClient) {
        window.syncClient.serverOnline = false;
      }
      // 錯誤時不需要放回 pendingLogs，因為它們仍然在 IndexedDB 中
      // 重新從 IndexedDB 還原到記憶體
      this._restorePendingLogsFromIndexedDB();
    }
  }

  /**
   * 強制重新整理所有待發送的日誌 (實驗結束時呼叫)
   * 注意：有 5 秒超時保護，確保不會無限期阻斷
   */
  async flushAll() {
    const FLUSH_TIMEOUT = 5000; // 5 秒超時
    Logger.debug(`正在發送最後的 ${this.pendingLogs.length} 條日誌...`);

    // 檢查伺服器連線狀態：只要伺服器線上就可以發送最後的日誌
    // 不需要檢查同步工作階段連線狀態
    // 如果 serverOnline 是 null（未檢查），先執行健康檢查
    if (!window.syncClient) {
      Logger.info("syncClient不存在，跳過發送最後的日誌");
      return;
    }

    if (window.syncClient.serverOnline === null) {
      Logger.debug("伺服器狀態未檢查，先執行健康檢查");
      try {
        await window.syncClient.checkServerHealth();
      } catch (error) {
        Logger.warn("健康檢查失敗:", error);
        window.syncClient.serverOnline = false;
      }
    }

    if (window.syncClient.serverOnline !== true) {
      Logger.debug("伺服器離線，跳過發送最後的日誌");
      Logger.debug(
        `serverOnline狀態: ${
          window.syncClient.serverOnline
        }, isConnected: ${window.syncClient.isConnected?.()}`
      );
      return;
    }

    // 新增超時保護，確保不會無限期阻斷實驗結束
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("flushAll 超時 (5秒)")), FLUSH_TIMEOUT)
    );

    const experimentId = this._getCurrentExperimentId();
    if (!experimentId) {
      Logger.warn("實驗ID未設定，無法完成日誌同步");
      return;
    }

    Logger.debug(
      `開始發送 ${this.pendingLogs.length} 條待發送日誌，實驗ID: ${experimentId}`
    );

    try {
      // 包裹在超時承諾中
      await Promise.race([this._flushLogsWithRetry(), timeoutPromise]);

      Logger.debug("所有待發送日誌已處理完畢，發送終點標記");

      // 最後發送一條終點標記
      try {
        const response = await fetch(this.apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "finalize_experiment",
            exp_id: experimentId,
            total_logs: this.logs.length,
          }),
        });

        if (response.ok) {
          Logger.info("實驗日誌已完整儲存到伺服器");
        } else {
          Logger.warn(
            `實驗日誌最終化回應異常: ${response.status} ${response.statusText}`
          );
        }
      } catch (error) {
        Logger.error("實驗日誌最終化失敗:", error);
      }
    } catch (error) {
      if (error.message.includes("超時")) {
        Logger.warn("flushAll 已超時，放棄發送剩餘日誌，實驗繼續進行");
      } else {
        Logger.error("flushAll 發生錯誤:", error);
      }
    }
  }

  /**
   * 內部方法：帶重試的日誌發送
   * @private
   */
  async _flushLogsWithRetry() {
    while (this.pendingLogs.length > 0) {
      Logger.debug(`剩餘 ${this.pendingLogs.length} 條日誌待發送`);
      await this._flushLogs();
      // 短暫延遲確保完成
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

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
        const typeMap = { t: "✓", f: "✗", n: "?" };
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
    Logger.info("記錄: 遠端按鈕動作", logEntry);
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
          // 創建 pendingLogs 存儲對象
          if (!db.objectStoreNames.contains(this.pendingLogsStore)) {
            const store = db.createObjectStore(this.pendingLogsStore, {
              keyPath: "id",
              autoIncrement: true,
            });
            store.createIndex("timestamp", "timestamp", { unique: false });
            Logger.info("創建 IndexedDB 存儲對象:", this.pendingLogsStore);
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
        "readonly"
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
        "readwrite"
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
        "readwrite"
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
      "readwrite"
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
