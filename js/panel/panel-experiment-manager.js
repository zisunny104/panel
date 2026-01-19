// panel-experiment-manager.js - 主面板實驗管理器
// 負責主面板的實驗流程控制，專注於步驟為基礎的邏輯

import { RandomUtils } from "../core/random-utils.js";

/**
 * 主面板實驗管理器
 * 管理主面板的實驗流程、單元選擇、步驟切換、UI互動等
 * 專門用於 index.html，與 ActionManager 協作支援 action-based 邏輯
 */
class PanelExperimentManager {
  // 常數定義
  static HOME_PAGE_VIDEO_PATH = "assets/units/SYSTEM/home_page.mp4";

  constructor() {
    // 效能優化：快取常用 DOM 元素
    this.cachedElements = new Map();

    // 狀態屬性
    this.isExperimentRunning = false;
    this.currentUnitIndex = 0;
    this.currentStepIndex = 0;
    this.loadedUnits = [];
    this.experimentInterval = null;
    this.experimentStartTime = null;
    this.experimentElapsed = 0;
    this.experimentPaused = false;
    this.currentExperimentId = null;
    this.currentCombination = null; // 追蹤目前選中的單元組合
    this.pendingExperimentIdUpdate = null; // 等待實驗結束後同步的實驗ID更新
    this.pendingSubjectNameUpdate = null; // 等待實驗結束後同步的受試者名稱更新

    // 電源流程控制
    this.includeStartup = true;
    this.includeShutdown = true;
    this.waitingForPowerOn = false;
    this.waitingForPowerOff = false;

    // 初始化順序：先設定ID，再初始化UI（包括設定組合）
    this.setupEventListeners();
    this.initializeExperimentId(); // 初始化實驗ID
    this.initializePowerOptions();
    this.initializeExperimentUI(); // 最後初始化UI和設定預設組合（此時ID已準備好）
  }

  /**
   * 效能優化：快取 DOM 元素，避免重複查詢
   */
  getCachedElement(id) {
    if (!this.cachedElements.has(id)) {
      const element = document.getElementById(id);
      if (element) {
        this.cachedElements.set(id, element);
      }
    }
    return this.cachedElements.get(id);
  }

  /** 初始化電源選項狀態 */
  initializePowerOptions() {
    const includeStartup = this.getCachedElement("includeStartup");
    const includeShutdown = this.getCachedElement("includeShutdown");

    if (includeStartup) {
      this.includeStartup = includeStartup.checked;
    }
    if (includeShutdown) {
      this.includeShutdown = includeShutdown.checked;
    }
  }

  /** 設定事件監聽器 */
  setupEventListeners() {
    this.setupExperimentControls();
    this.setupSyncEventListeners();
  }

  /** 設定同步事件監聽器 */
  setupSyncEventListeners() {
    // 監聽來自其他裝置的實驗狀態同步
    document.addEventListener("syncExperimentState", (e) => {
      this.handleSyncExperimentState(e.detail);
    });

    // 監聽來自同步客戶端的狀態更新（來自 sync-client.js 的輪詢機制）
    window.addEventListener("sync_state_update", (e) => {
      if (e.detail && e.detail.type === "experimentStateUpdate") {
        this.applyRemoteExperimentState(e.detail);
      }
      // 受試者名稱更新
      if (e.detail && e.detail.type === "subjectNameUpdate") {
        this.handleRemoteSubjectNameUpdate(e.detail);
      }
      // 實驗ID更新
      if (e.detail && e.detail.type === "experimentIdUpdate") {
        this.handleRemoteExperimentIdUpdate(e.detail);
      }
      // 手勢標記
      if (e.detail && e.detail.type === "gesture_marked") {
        this.handleRemoteGestureMarked(e.detail);
      }
      // 手勢步驟完成
      if (e.detail && e.detail.type === "gesture_step_completed") {
        this.handleRemoteGestureStepCompleted(e.detail);
      }
      // 動作按鈕點擊
      if (e.detail && e.detail.type === "action_button_clicked") {
        this.handleRemoteActionButtonClicked(e.detail);
      }
    });

    // 監聽從實驗同步管理器來的遠端事件
    // 監聽裝置模式變更
    document.addEventListener("deviceModeChanged", (e) => {
      this.handleDeviceModeChanged(e.detail);
    });

    // 監聽來自新實驗中樞的廣播事件
    window.addEventListener("experiment_id_broadcasted", (e) => {
      Logger.debug(
        `[PanelExperimentManager] 收到 experiment_id_broadcasted 事件:`,
        e.detail
      );
      if (e.detail && e.detail.experimentId) {
        Logger.debug(
          `[PanelExperimentManager] 處理廣播的實驗ID更新: ${e.detail.experimentId}`
        );
        this.handleRemoteExperimentIdUpdate({
          experimentId: e.detail.experimentId,
          source: "hub_broadcast",
          device_id: e.detail.device_id,
          timestamp: e.detail.timestamp,
        });
      }
    });
  }

  /** 處理實驗狀態同步 */
  handleSyncExperimentState(data) {
    // 只有在觀看模式下才接受同步
    if (window.syncManager && !window.syncManager.isInteractiveMode) {
      return;
    }

    try {
      // 同步實驗基本狀態
      if (data.isExperimentRunning !== undefined) {
        this.isExperimentRunning = data.isExperimentRunning;
      }

      if (data.currentUnitIndex !== undefined) {
        this.currentUnitIndex = data.currentUnitIndex;
      }

      if (data.currentStepIndex !== undefined) {
        this.currentStepIndex = data.currentStepIndex;
      }

      if (data.experimentPaused !== undefined) {
        this.experimentPaused = data.experimentPaused;
      }

      // 同步實驗ID和組合
      if (data.currentExperimentId) {
        if (window.experimentStateManager) {
          window.experimentStateManager.setExperimentId(
            data.currentExperimentId,
            "sync"
          );
        } else if (window.experimentLogManager) {
          window.experimentLogManager.setExperimentId(
            data.currentExperimentId,
            "sync"
          );
        }
        this.currentExperimentId = data.currentExperimentId;
        this.updateExperimentIdDisplay();
      }

      if (data.currentCombination) {
        this.currentCombination = data.currentCombination;
        this.loadedUnits = [...data.loadedUnits] || [];
      }

      // 同步媒體顯示
      if (data.currentMedia) {
        this.displayMedia(data.currentMedia);
      }

      // 更新UI狀態
      this.updateExperimentUI();
    } catch (error) {
      Logger.error("處理實驗狀態同步時發生錯誤:", error);
    }
  }

  /** 套用遠端實驗狀態（來自同步客戶端的輪詢） */
  applyRemoteExperimentState(data) {
    const role = window.syncManager?.core?.syncClient?.role;

    // 根據訊息類型和角色處理
    if (data.type === "experimentInitialize") {
      // 所有角色都應接收實驗初始化資訊
      this.handleRemoteExperimentInit(data);
    } else if (data.type === "button_action") {
      // 只有 Viewer 角色接收並套用按鈕動作
      if (role === "viewer") {
        this.handleRemoteButtonAction(data);
      }
    } else if (data.type === "subjectNameUpdate") {
      // 所有角色都應接收受試者名稱更新
      this.handleRemoteSubjectNameUpdate(data);
    } else if (data.type === "experimentIdUpdate") {
      // 所有角色都應接收實驗ID更新
      this.handleRemoteExperimentIdUpdate(data);
    } else if (data.type === "experimentPaused") {
      // 所有角色都應接收暫停狀態
      this.handleRemoteExperimentPaused(data);
    } else if (data.type === "experimentResumed") {
      // 所有角色都應接收還原狀態
      this.handleRemoteExperimentResumed(data);
    } else if (data.type === "experimentStopped") {
      // 所有角色都應接收停止狀態
      this.handleRemoteExperimentStopped(data);
    }
  }

  /** 處理遠端實驗初始化 */
  handleRemoteExperimentInit(data) {
    try {
      if (window.experimentStateManager && data.experimentId) {
        window.experimentStateManager.setExperimentId(
          data.experimentId,
          "sync_init"
        );
      }
      this.currentExperimentId = data.experimentId;
      this.currentCombination = data.currentCombination;
      this.loadedUnits = [...data.loadedUnits];
      this.isExperimentRunning = data.isExperimentRunning;

      // 處理受試者名稱
      if (data.subjectName) {
        const subjectNameInput = document.getElementById("subjectNameInput");
        if (subjectNameInput) {
          subjectNameInput.value = data.subjectName;
        }
      }

      this.updateExperimentIdDisplay();
      this.updateExperimentUI();
    } catch (error) {
      Logger.error("套用遠端實驗初始化時發生錯誤:", error);
    }
  }

  /** 處理遠端按鈕動作 */
  handleRemoteButtonAction(data) {
    try {
      if (!data.buttonData) return;

      // 模擬按鈕被按下：更新實驗進度
      const buttonData = data.buttonData;

      if (buttonData.button) {
        // 通知實驗進度管理器更新進度
        window.dispatchEvent(
          new CustomEvent("remoteButtonPressed", {
            detail: {
              button: buttonData.button,
              experimentId: data.experimentId,
            },
          })
        );
      }
    } catch (error) {
      Logger.error("套用遠端按鈕動作時發生錯誤:", error);
    }
  }

  /** 處理遠端受試者名稱更新 */
  handleRemoteSubjectNameUpdate(data) {
    try {
      // 如果目前實驗正在進行中，等待實驗結束後再同步新的受試者名稱
      if (this.isExperimentRunning) {
        Logger.debug(
          "目前實驗正在進行中，等待結束後再同步新的受試者名稱:",
          data.subjectName || data.subject_name
        );
        // 將更新請求加入佇列，等待實驗結束
        this.pendingSubjectNameUpdate = data;
        this.showPendingUpdateIndicator("subjectName");
        return;
      }

      this.applySubjectNameUpdate(data);
    } catch (error) {
      Logger.error("套用遠端受試者名稱更新時發生錯誤:", error);
    }
  }

  /** 處理遠端實驗ID更新 */
  handleRemoteExperimentIdUpdate(data) {
    try {
      Logger.debug(
        `[PanelExperimentManager] 開始處理遠端實驗ID更新: ${
          data?.experimentId
        } (來源: ${data?.source || "unknown"})`
      );
      Logger.debug(
        `[PanelExperimentManager] 收到遠端實驗ID更新事件詳情:`,
        data
      );

      // 如果目前實驗正在進行中，等待實驗結束後再同步新的實驗ID
      if (this.isExperimentRunning) {
        Logger.debug(
          `[PanelExperimentManager] ⏳ 實驗進行中，將ID更新請求加入佇列`
        );
        // 將更新請求加入佇列，等待實驗結束
        this.pendingExperimentIdUpdate = data;
        this.showPendingUpdateIndicator("experimentId");
        return;
      }

      this.applyExperimentIdUpdate(data);
    } catch (error) {
      Logger.error(
        `[PanelExperimentManager] 套用遠端實驗ID更新時發生錯誤:`,
        error
      );
    }
  }

  /** 處理遠端實驗暫停訊號 */
  handleRemoteExperimentPaused(data) {
    try {
      // 在控制面板上顯示暫停指示
      const pauseIndicator = document.getElementById("pauseIndicator");
      if (pauseIndicator) {
        pauseIndicator.style.display = "block";
        pauseIndicator.textContent = "⏸ 暫停中";
      }
    } catch (error) {
      Logger.error("套用遠端暫停訊號時發生錯誤:", error);
    }
  }

  /** 處理遠端實驗還原訊號 */
  handleRemoteExperimentResumed(data) {
    try {
      // 移除暫停指示
      const pauseIndicator = document.getElementById("pauseIndicator");
      if (pauseIndicator) {
        pauseIndicator.style.display = "none";
      }
    } catch (error) {
      Logger.error("套用遠端還原訊號時發生錯誤:", error);
    }
  }

  /** 處理遠端實驗停止訊號 */
  handleRemoteExperimentStopped(data) {
    try {
      // 重置實驗狀態
      const pauseIndicator = document.getElementById("pauseIndicator");
      if (pauseIndicator) {
        pauseIndicator.style.display = "none";
      }
    } catch (error) {
      Logger.error("套用遠端停止訊號時發生錯誤:", error);
    }
  }

  /** 套用實驗ID更新 */
  applyExperimentIdUpdate(data) {
    Logger.debug(
      `[PanelExperimentManager] 開始套用實驗ID更新: ${
        data?.experimentId || data?.experiment_id
      }`
    );
    Logger.debug(`[PanelExperimentManager] 套用詳情:`, data);

    const experimentIdInput = document.getElementById("experimentIdInput");
    if (experimentIdInput) {
      // 支援多種欄位名稱
      const experimentId = data.experimentId || data.experiment_id || "";
      Logger.debug(
        `[PanelExperimentManager] 套用實驗ID更新: 新ID = ${experimentId}`
      );

      if (window.experimentStateManager) {
        window.experimentStateManager.setExperimentId(
          experimentId,
          "sync_update"
        );
      } else if (window.experimentLogManager) {
        window.experimentLogManager.setExperimentId(
          experimentId,
          "sync_update"
        );
      }
      experimentIdInput.value = experimentId;
      this.currentExperimentId = experimentId;
      this.updateExperimentIdDisplay();
      this.hidePendingUpdateIndicator("experimentId");

      Logger.debug(
        `[PanelExperimentManager] 實驗ID已成功更新: ${experimentId}`
      );
    }
  }

  /** 套用受試者名稱更新 */
  applySubjectNameUpdate(data) {
    const subjectNameInput = document.getElementById("subjectName");
    if (subjectNameInput) {
      // 支援多種欄位名稱
      const subjectName = data.subjectName || data.subject_name || "";
      subjectNameInput.value = subjectName;
      this.hidePendingUpdateIndicator("subjectName");
    }
  }

  /** 顯示待處理更新指示器 */
  showPendingUpdateIndicator(type) {
    const inputId =
      type === "experimentId" ? "experimentIdInput" : "subjectName";
    const input = document.getElementById(inputId);
    if (input) {
      input.classList.add("pending-update");
      input.title = input.title
        ? input.title + " (有待同步更新)"
        : "有待同步更新";
    }
  }

  /** 隱藏待處理更新指示器 */
  hidePendingUpdateIndicator(type) {
    const inputId =
      type === "experimentId" ? "experimentIdInput" : "subjectName";
    const input = document.getElementById(inputId);
    if (input) {
      input.classList.remove("pending-update");
      input.title = input.title
        ? input.title.replace(" (有待同步更新)", "")
        : "";
    }
  }

  /** 處理遠端手勢標記 */
  handleRemoteGestureMarked(data) {
    try {
      const { step_index, gesture_name, mark_status } = data;
      Logger.debug(
        `遠端手勢標記: 步驟${step_index} - ${gesture_name} 標記為 ${mark_status}`
      );

      // 在卡片上顯示標記指示（可選：在對應卡片上顯示標記顏色）
      const card = document.getElementById(`gesture-card-${step_index}`);
      if (card && mark_status) {
        let borderColor = "#e0e0e0";
        if (mark_status === "correct") {
          borderColor = "#4caf50";
        } else if (mark_status === "uncertain") {
          borderColor = "#ff9800";
        } else if (mark_status === "incorrect") {
          borderColor = "#f44336";
        }
        // 在卡片旁邊顯示遠端標記指示
        const indicator = document.createElement("div");
        indicator.style.cssText = `
          position: absolute;
          top: 10px;
          left: 10px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: ${borderColor};
          box-shadow: 0 0 0 2px white, 0 0 0 3px ${borderColor};
        `;
        card.appendChild(indicator);
        setTimeout(() => indicator.remove(), 2000);
      }
    } catch (error) {
      Logger.error("套用遠端手勢標記時發生錯誤:", error);
    }
  }

  /** 處理遠端手勢步驟完成 */
  handleRemoteGestureStepCompleted(data) {
    try {
      const { step_index, gesture_name, timer_value } = data;
      Logger.debug(
        `遠端手勢步驟完成: 步驟${step_index} - ${gesture_name} (${timer_value})`
      );

      // 在控制面板上顯示遠端進度
      const progressDisplay = document.getElementById("remoteProgressDisplay");
      if (progressDisplay) {
        progressDisplay.innerHTML = `遠端進度：${gesture_name} 已完成 (${timer_value})`;
        progressDisplay.style.display = "block";
        setTimeout(() => {
          progressDisplay.style.display = "none";
        }, 3000);
      }
    } catch (error) {
      Logger.error("套用遠端手勢步驟完成時發生錯誤:", error);
    }
  }

  /** 處理遠端動作按鈕點擊 */
  handleRemoteActionButtonClicked(data) {
    try {
      const { action_id, gesture_index } = data;
      Logger.debug(`遠端動作按鈕點擊: ${action_id} (手勢索引${gesture_index})`);

      // 在控制面板上顯示遠端動作回饋
      const actionDisplay = document.getElementById("remoteActionDisplay");
      if (actionDisplay) {
        actionDisplay.innerHTML = `遠端動作: ${action_id}`;
        actionDisplay.style.display = "block";
        setTimeout(() => {
          actionDisplay.style.display = "none";
        }, 2000);
      }
    } catch (error) {
      Logger.error("套用遠端動作按鈕點擊時發生錯誤:", error);
    }
  }

  /** 處理裝置模式變更 */
  handleDeviceModeChanged(data) {
    const isInteractive = data.isInteractive;

    // 根據模式顯示/隱藏實驗控制按鈕
    const controlButtons = document.querySelectorAll(
      "#startExperimentBtn, #pauseExperimentBtn, #stopExperimentBtn"
    );
    controlButtons.forEach((button) => {
      if (button) {
        button.style.display = isInteractive ? "block" : "none";
      }
    });
  }

  /** 廣播實驗初始化 - 實驗開始時同步ID和單元組合 */
  broadcastExperimentInitialization() {
    const subjectNameInput = this.getCachedElement("subjectNameInput");
    const subjectName = subjectNameInput ? subjectNameInput.value.trim() : "";

    const initData = {
      type: "experimentInitialize",
      experimentId: this.getCurrentExperimentId(),
      currentCombination: this.currentCombination,
      loadedUnits: this.loadedUnits,
      subjectName: subjectName,
      isExperimentRunning: true,
      timestamp: Date.now(),
    };

    Logger.debug(
      "廣播實驗初始化 - loadedUnits 數量:",
      this.loadedUnits.length,
      "ID:",
      this.getCurrentExperimentId()
    );
    Logger.debug("   詳細資料:", initData);

    //本機事件（用於本頁面內部通訊）
    document.dispatchEvent(
      new CustomEvent("experimentStateChange", {
        detail: initData,
      })
    );

    //透過同步系統發送到其他裝置（experiment.html）
    const syncInitData = {
      type: "experimentInitialize",
      source: "panel",
      device_id:
        window.syncManager?.core?.syncClient?.clientId || "panel_device",
      experimentId: this.getCurrentExperimentId(),
      currentCombination: this.currentCombination,
      loadedUnits: this.loadedUnits,
      subjectName: subjectName,
      isExperimentRunning: true,
      timestamp: new Date().toISOString(),
    };

    Logger.debug("透過同步系統廣播實驗初始化到其他裝置");

    // 檢查 syncManager 是否存在
    if (!window.syncManager) {
      Logger.warn("window.syncManager 尚未初始化，無法同步");
      return;
    }

    if (window.syncManager?.core?.syncState) {
      Logger.debug("  正在發送同步訊號...");
      window.syncManager.core.syncState(syncInitData).catch((error) => {
        Logger.warn("同步實驗初始化失敗:", error);
      });

      //同時發送 experiment_started 事件給 viewer
      const experimentStartedData = {
        type: "experiment_started",
        source: "panel",
        device_id:
          window.syncManager?.core?.syncClient?.clientId || "panel_device",
        experiment_id: this.getCurrentExperimentId(),
        subject_name: subjectName,
        combination_id: this.currentCombination?.combination_id || null,
        combination_name:
          this.currentCombination?.combination_name || "未知組合",
        gesture_sequence: this.currentCombination?.gestures || [],
        unit_count: this.loadedUnits?.length || 0,
        gesture_count: this.currentCombination?.gestures?.length || 0,
        timestamp: new Date().toISOString(),
      };

      Logger.debug("  正在發送 experiment_started 事件給 viewer");
      Logger.debug("   實驗資料:", {
        experimentId: experimentStartedData.experimentId,
        subjectName: experimentStartedData.subjectName,
        combinationName: experimentStartedData.combinationName,
        gestureCount: experimentStartedData.gestureCount,
        hasCurrentCombination: !!this.currentCombination,
        hasGestures: !!this.currentCombination?.gestures,
        gesturesLength: this.currentCombination?.gestures?.length || 0,
      });

      window.syncManager.core
        .syncState(experimentStartedData)
        .catch((error) => {
          Logger.warn("同步 experiment_started 失敗:", error);
        });
    } else {
      Logger.warn("window.syncManager.core.syncState 不存在");
    }
  }

  /** 廣播按鈕動作 - 實驗進行中推播按下的按鈕 */
  broadcastButtonAction(buttonData) {
    // 取得本機裝置 ID
    let deviceId = null;
    if (window.syncClient) {
      deviceId = window.syncClient.clientId;
    }

    const actionData = {
      type: "button_action",
      experimentId: this.getCurrentExperimentId(),
      action_id: buttonData.action_id, // 傳遞 action_id 給實驗頁面
      buttonData: buttonData,
      timestamp: new Date().toISOString(),
      device_id: deviceId,
    };

    document.dispatchEvent(
      new CustomEvent("experimentStateChange", {
        detail: actionData,
      })
    );
  }

  /** 廣播暫停狀態到其他裝置 */
  broadcastExperimentPaused() {
    const syncPauseData = {
      type: "experiment_paused",
      source: "panel",
      device_id:
        window.syncManager?.core?.syncClient?.clientId || "panel_device",
      experimentId: this.getCurrentExperimentId(),
      isPaused: true,
      timestamp: new Date().toISOString(),
    };

    Logger.debug("廣播實驗暫停:", syncPauseData);
    if (window.syncManager?.core?.syncState) {
      window.syncManager.core.syncState(syncPauseData).catch((error) => {
        Logger.warn("同步暫停狀態失敗:", error);
      });
    } else {
      Logger.warn("window.syncManager.core.syncState 不存在");
    }
  }

  /** 廣播還原狀態到其他裝置 */
  broadcastExperimentResumed() {
    const syncResumeData = {
      type: "experiment_resumed",
      source: "panel",
      device_id:
        window.syncManager?.core?.syncClient?.clientId || "panel_device",
      experimentId: this.getCurrentExperimentId(),
      isPaused: false,
      timestamp: new Date().toISOString(),
    };

    Logger.debug("廣播實驗還原:", syncResumeData);
    if (window.syncManager?.core?.syncState) {
      window.syncManager.core.syncState(syncResumeData).catch((error) => {
        Logger.warn("同步還原狀態失敗:", error);
      });
    } else {
      Logger.warn("window.syncManager.core.syncState 不存在");
    }
  }

  /** 廣播停止狀態到其他裝置 */
  broadcastExperimentStopped() {
    const syncStopData = {
      type: "experiment_stopped",
      source: "panel",
      device_id:
        window.syncManager?.core?.syncClient?.clientId || "panel_device",
      experimentId: this.getCurrentExperimentId(),
      timestamp: new Date().toISOString(),
    };

    Logger.debug("廣播實驗停止:", syncStopData);
    if (window.syncManager?.core?.syncState) {
      window.syncManager.core.syncState(syncStopData).catch((error) => {
        Logger.warn("同步停止狀態失敗:", error);
      });
    } else {
      Logger.warn("window.syncManager.core.syncState 不存在");
    }
  }

  /** 廣播實驗ID更新到其他裝置 */
  broadcastExperimentIdUpdate(experimentId) {
    try {
      Logger.debug(
        `[PanelExperimentManager] 開始廣播實驗ID更新: ${experimentId}`
      );

      const syncIdData = {
        type: "experimentIdUpdate",
        source: "panel",
        device_id:
          window.syncManager?.core?.syncClient?.clientId || "panel_device",
        experimentId: experimentId,
        timestamp: new Date().toISOString(),
      };

      Logger.debug(`[PanelExperimentManager] 廣播資料:`, syncIdData);

      if (window.syncManager?.core?.syncState) {
        window.syncManager.core.syncState(syncIdData).catch((error) => {
          Logger.debug(
            `[PanelExperimentManager] 同步實驗ID更新失敗: ${error.message}`
          );
        });
        Logger.debug(
          `[PanelExperimentManager] 實驗ID廣播請求已發送: ${experimentId}`
        );
      } else {
        Logger.warn(
          "[PanelExperimentManager] window.syncManager.core.syncState 不存在"
        );
      }
    } catch (error) {
      Logger.error(
        `[PanelExperimentManager] 廣播實驗ID更新時發生錯誤: ${error.message}`,
        error
      );
    }
  }

  /** 設定實驗控制按鈕 */
  setupExperimentControls() {
    const startExperimentButton = document.getElementById("startExperimentBtn");
    const pauseExperimentButton = document.getElementById("pauseExperimentBtn");
    const stopExperimentButton = document.getElementById("stopExperimentBtn");
    const selectAllUnits = document.getElementById("selectAllUnits");
    const includeStartup = document.getElementById("includeStartup");
    const includeShutdown = document.getElementById("includeShutdown");

    if (startExperimentButton) {
      startExperimentButton.addEventListener("click", () => {
        // 立即關閉實驗面板
        this.closeExperimentPanel();
        // 然後開始實驗
        this.startExperiment();
      });
    }
    if (pauseExperimentButton) {
      pauseExperimentButton.addEventListener("click", () =>
        this.togglePauseExperiment()
      );
    }
    if (stopExperimentButton) {
      stopExperimentButton.addEventListener("click", () =>
        this.stopExperiment()
      );
    }

    if (selectAllUnits) {
      selectAllUnits.addEventListener("change", (e) =>
        this.toggleSelectAllUnits(e.target.checked)
      );
    }

    // 電源選項事件監聽器
    if (includeStartup) {
      includeStartup.addEventListener("change", (e) => {
        this.includeStartup = e.target.checked;
      });
    }
    if (includeShutdown) {
      includeShutdown.addEventListener("change", (e) => {
        this.includeShutdown = e.target.checked;
      });
    }

    // 實驗ID輸入框事件
    const experimentIdInput = document.getElementById("experimentIdInput");
    if (experimentIdInput) {
      experimentIdInput.addEventListener("input", (e) => {
        // 限制輸入為字母和數字
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");

        // 如果目前選中的是指定隨機組合，自動重新排序
        this.autoReapplyRandomCombination();
      });

      // 監聽 change 事件同步到中樞
      experimentIdInput.addEventListener("change", (e) => {
        const newId = e.target.value.trim();
        if (newId) {
          this.broadcastExperimentIdUpdate(newId);
        } else {
          // 如果清空，產生新ID
          this.generateNewExperimentId();
        }
      });
    }

    // 重新產生ID按鈕事件
    const regenerateIdButton = document.getElementById("regenerateIdButton");
    if (regenerateIdButton) {
      regenerateIdButton.addEventListener("click", () => {
        this.generateNewExperimentId();
        // 自動重新套用指定隨機組合（如果目前選中的是）
        this.autoReapplyRandomCombination();
      });
    } else {
      Logger.warn("regenerateIdButton 未找到");
    }

    // 初始化按鈕狀態
    this.updateButtonStates();

    // 監聽角色變化事件
    document.addEventListener("sync_session_restored", () => {
      this.updateButtonStates();
    });
    document.addEventListener("sync_session_joined", () => {
      this.updateButtonStates();
    });
  }

  /**
   * 更新按鈕狀態：根據角色禁用/啟用按鈕
   */
  updateButtonStates() {
    const isViewer = window.syncManager?.core?.syncClient?.role === "viewer";
    const buttonsToDisable = [
      "startExperimentBtn",
      "pauseExperimentBtn",
      "stopExperimentBtn",
      "regenerateIdButton",
    ];

    buttonsToDisable.forEach((buttonId) => {
      const button = document.getElementById(buttonId);
      if (button) {
        if (isViewer) {
          button.disabled = true;
          button.classList.add("disabled");
          button.title = "檢視模式下無法操作";
        } else {
          button.disabled = false;
          button.classList.remove("disabled");
          button.title = "";
        }
      }
    });
  }

  /** 產生新的實驗ID */
  generateNewExperimentId() {
    if (window.experimentStateManager) {
      const result = window.experimentStateManager.generateNewExperimentId();
      this.currentExperimentId = result;
      this.updateExperimentIdDisplay();
      return result;
    } else {
      const result = RandomUtils.generateNewExperimentId();
      if (window.experimentLogManager) {
        window.experimentLogManager.setExperimentId(result, "generate");
      }
      this.currentExperimentId = result;
      this.updateExperimentIdDisplay();
      this.broadcastExperimentIdUpdate(result); // 廣播到中樞
      return result;
    }
  }

  /**
   * 初始化連線時取得實驗ID
   * 使用新的 ExperimentHubClient 系統
   */
  async initializeExperimentId() {
    try {
      // 等待 ExperimentHubManager 初始化（最多等 5 秒）
      let attempts = 0;
      const maxAttempts = 50;

      while (!window.experimentHubManager && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }

      if (!window.experimentHubManager) {
        Logger.warn(
          "[PanelExperimentManager] ExperimentHubManager 初始化超時，產生新ID"
        );
        this.generateNewExperimentId();
        return;
      }

      // 檢查是否處於同步模式且有客戶端
      if (window.experimentHubManager.hubClient) {
        const experimentId =
          await window.experimentHubManager.hubClient.getExperimentId();
        if (experimentId) {
          this.currentExperimentId = experimentId;
          this.updateExperimentIdDisplay();
          if (window.experimentStateManager) {
            window.experimentStateManager.setExperimentId(experimentId, "hub");
          }
          Logger.debug(
            `[PanelExperimentManager] 從中樞讀取實驗ID: ${experimentId}`
          );
          return;
        }
      }

      // 本機模式或無法從中樞取得 ID，產生新 ID
      Logger.debug(
        "[PanelExperimentManager] 本機模式或無法從中樞取得ID，產生新ID"
      );
      this.generateNewExperimentId();
    } catch (e) {
      Logger.warn("無法從中樞讀取ID，產生新ID:", e);
      this.generateNewExperimentId();
    }
  }

  // 移除重複的方法：createSeededRandom 和 shuffleArray
  // 這些方法已統一在 js/core/random-utils.js 中
  // panel-experiment-manager 現在透過 CombinationSelector 使用統一邏輯

  /** 自動重新套用指定隨機組合（如果目前選中的是隨機組合） */
  autoReapplyRandomCombination() {
    if (this.currentCombination && this.currentCombination.is_randomizable) {
      // 延遲執行，讓輸入框的值先更新完成
      setTimeout(() => {
        this.applyUnitCombination(this.currentCombination);
        if (window.logger) {
          const experimentId = this.getCurrentExperimentId();
          window.logger.logAction(`ID變更(${experimentId})，重新隨機排列`);
        }
      }, 50);
    }
  }

  /** 更新實驗ID顯示 */
  updateExperimentIdDisplay() {
    const experimentIdInput = document.getElementById("experimentIdInput");
    if (experimentIdInput) {
      experimentIdInput.value = this.currentExperimentId;
    }
  }

  /** 取得目前實驗ID（從狀態管理器讀取） */
  getCurrentExperimentId() {
    if (window.experimentStateManager) {
      return window.experimentStateManager.experimentId || "";
    }
    return window.getCurrentExperimentId() || this.currentExperimentId;
  }

  /** 開始實驗 */
  startExperiment() {
    // 確保從輸入框讀取最新的實驗ID，優先度：輸入框 > 狀態管理器 > 本機
    const experimentIdInput = document.getElementById("experimentIdInput");
    const inputValue = experimentIdInput?.value?.trim() || "";

    if (inputValue) {
      // 輸入框有值，使用輸入框的值，並同步到狀態管理器
      this.currentExperimentId = inputValue;
      if (window.experimentStateManager) {
        window.experimentStateManager.setExperimentId(
          inputValue,
          "panel_start"
        );
      }
    } else {
      // 輸入框沒有值，使用狀態管理器的值
      const currentId = this.getCurrentExperimentId();
      if (currentId) {
        this.currentExperimentId = currentId;
      } else {
        // 只有在沒有ID時才產生新的
        this.generateNewExperimentId();
      }
    }

    //開始 JSONL 實驗日誌記錄
    const experimentId = this.getCurrentExperimentId();
    const subjectName =
      document.getElementById("subjectNameInput")?.value || "";
    const combinationName = this.currentCombination?.combination_name || "";

    if (window.panelExperimentLog) {
      window.panelExperimentLog.startRecording(
        experimentId,
        subjectName,
        combinationName
      );
    }

    if (window.logger) {
      window.logger.clearLog();
      window.logger.logAction(
        `開始實驗 - ID: ${experimentId}`,
        null,
        null,
        false,
        false
      );

      // 自動最小化 logger 在實驗模式
      setTimeout(() => {
        window.logger.handleExperimentMode();
      }, 100);
    }

    const startExperimentButton = document.getElementById("startExperimentBtn");
    const experimentControlButtons = document.getElementById(
      "experimentControlButtons"
    );

    if (startExperimentButton) startExperimentButton.style.display = "none";
    if (experimentControlButtons)
      experimentControlButtons.style.display = "flex";

    this.isExperimentRunning = true;
    this.lockUnitList(true);
    this.lockExperimentId(true);

    // 立即開始計時器，不管是否等待開機
    this.startTimer();

    //先讀取選擇的單元 ID
    this.loadSelectedUnits();
    this.currentUnitIndex = 0;
    this.currentStepIndex = 0;

    //立即廣播實驗開始訊號到其他裝置（不管是否需要開機）
    Logger.debug("廣播實驗開始訊號到其他裝置（experiment.html 自動開始）");

    // 只在同步模式下註冊實驗ID到中樞系統
    const finalExperimentId = this.getCurrentExperimentId();
    if (window.experimentHubManager?.isInSyncMode?.() && finalExperimentId) {
      Logger.debug(`[同步模式] 註冊實驗ID到中樞: ${finalExperimentId}`);
      window.experimentHubManager.registerExperimentId(
        finalExperimentId,
        "panel_start"
      );
    } else if (finalExperimentId) {
      Logger.debug(`[獨立模式] 實驗ID僅存本機: ${finalExperimentId}`);
    }

    this.broadcastExperimentInitialization();

    // 檢查開機設定
    if (this.includeStartup) {
      // 如果包含開機且機器目前是關閉的，等待使用者開機
      if (window.powerControl && !window.powerControl.isPowerOn) {
        Logger.debug("等待開機：呼叫 highlightPowerSwitch(true)");
        this.waitingForPowerOn = true;
        this.highlightPowerSwitch(true);
        if (window.logger) {
          window.logger.logAction("等待使用者開機", null, null, false, false);
        }
        // 設定按鈕顏色為執行中（等待開機也算執行中）
        if (window.mainApp?.setExperimentPanelButtonColor) {
          window.mainApp.setExperimentPanelButtonColor("running");
        } else {
          Logger.error(
            "無法呼叫 setExperimentPanelButtonColor - window.mainApp 不存在或函數未定義"
          );
        }
        //不在此呼叫 loadUnitsAndStart()，等待打開電源後再呼叫
        // 計時已開始，但等待開機後才繼續

        //先載入單元資料（但不執行）
        this.loadUnitsAndStart();

        Logger.debug("等待開機中，等待使用者按下電源按鈕");

        this.dispatchExperimentStateChanged();
        return;
      }
    } else if (window.powerControl && !window.powerControl.isPowerOn) {
      // 不包含開機但機器是關閉的，自動開機
      window.powerControl.setPowerState(true, "實驗自動開機");
    }

    //電源已打開或不需要檢查電源，載入單元資料並初始化動作序列
    this.loadUnitsAndStart();

    if (window.buttonManager) {
      window.buttonManager.updateExperimentButtonStyles();
    }

    //分發實驗開始事件給同步管理器使用
    document.dispatchEvent(
      new CustomEvent("experiment_started", {
        detail: {
          experimentId: this.getCurrentExperimentId(),
          subjectName: document.getElementById("subjectNameInput")?.value || "",
          combinationId: this.currentCombination?.combination_id || "",
          combinationName: this.currentCombination?.combination_name || "",
        },
      })
    );

    if (window.mainApp?.setExperimentPanelButtonColor) {
      window.mainApp.setExperimentPanelButtonColor("running");
    } else {
      Logger.error(
        "無法呼叫 setExperimentPanelButtonColor - window.mainApp 不存在或函數未定義"
      );
    }
    window.dispatchExperimentStatusChanged &&
      window.dispatchExperimentStatusChanged();

    //發送實驗開始的同步訊號到其他連線的裝置（experiment.html）
    if (window.syncManager?.core?.isConnected?.()) {
      const syncStartData = {
        type: "experiment_started",
        source: "panel",
        device_id:
          window.syncManager?.core?.syncClient?.clientId || "panel_device",
        experiment_id: this.getCurrentExperimentId(),
        subject_name: document.getElementById("subjectNameInput")?.value || "",
        combination_id: this.currentCombination?.combination_id || "",
        combination_name: this.currentCombination?.combination_name || "",
        timestamp: new Date().toISOString(),
      };
      Logger.debug(
        "[PanelExperiment] 廣播實驗開始訊號到其他裝置:",
        syncStartData
      );
      window.syncManager.core.syncState(syncStartData).catch((error) => {
        Logger.warn("[PanelExperiment] 同步實驗開始失敗:", error);
      });
    }
  }

  /** 高亮電源開關 */
  highlightPowerSwitch(enable) {
    const powerSwitchArea = document.getElementById("powerSwitchArea");
    Logger.debug(
      `highlightPowerSwitch(${enable}): powerSwitchArea=${
        powerSwitchArea ? "找到" : "未找到"
      }`
    );

    if (powerSwitchArea) {
      Logger.debug(
        `   目前 display=${powerSwitchArea.style.display}, visibility=${powerSwitchArea.style.visibility}`
      );

      if (enable) {
        //實驗進行中，無條件高亮電源按鈕
        powerSwitchArea.classList.add("next-step-highlight");
        Logger.debug("電源按鈕已高亮 (added class)");
        Logger.debug(`   classList=${powerSwitchArea.classList.toString()}`);
      } else {
        powerSwitchArea.classList.remove("next-step-highlight");
        Logger.debug("電源按鈕高亮已移除");
      }
    } else {
      Logger.debug("無法找到 powerSwitchArea 元素！");
    }
  }

  /** 更新所有綠色高亮提示的可見性 */
  updateHighlightVisibility() {
    const toggleTouchVisuals = document.getElementById("toggleTouchVisuals");
    const showHighlight = toggleTouchVisuals && toggleTouchVisuals.checked;

    // 如果視覺提示被關閉，清除所有高亮
    if (!showHighlight) {
      const powerSwitchArea = document.getElementById("powerSwitchArea");
      if (powerSwitchArea) {
        powerSwitchArea.classList.remove("next-step-highlight");
      }
      document.querySelectorAll(".button-overlay").forEach((btn) => {
        btn.classList.remove("next-step-highlight");
      });
      return;
    }

    // 視覺提示開啟時，才檢查實驗狀態並顯示高亮
    // 實驗進行中時，需要檢查：
    // 1. 如果是第一步（開機步驟），顯示高亮
    // 2. 如果不是第一步但機器未開機，清除高亮
    if (this.isExperimentRunning) {
      const isFirstStep =
        this.currentStepIndex === 0 &&
        this.currentScenario?.steps?.[0]?.step_id?.includes("_1");

      if (
        !isFirstStep &&
        window.powerControl &&
        !window.powerControl.isPowerOn
      ) {
        // 機器未開機且不是開機步驟，清除高亮
        const powerSwitchArea = document.getElementById("powerSwitchArea");
        if (powerSwitchArea) {
          powerSwitchArea.classList.remove("next-step-highlight");
        }
        document.querySelectorAll(".button-overlay").forEach((btn) => {
          btn.classList.remove("next-step-highlight");
        });
        return;
      }

      // 實驗進行中且視覺提示開啟，保持高亮（由其他方法控制具體哪些按鈕高亮）
      return;
    }

    // 實驗未進行時，清除所有高亮
    const powerSwitchArea = document.getElementById("powerSwitchArea");
    if (powerSwitchArea) {
      powerSwitchArea.classList.remove("next-step-highlight");
    }
    document.querySelectorAll(".button-overlay").forEach((btn) => {
      btn.classList.remove("next-step-highlight");
    });
  }

  /** 關閉實驗面板 */
  closeExperimentPanel() {
    // 檢查是否有實驗面板關閉按鈕，如果有就觸發關閉
    const experimentPanel = document.getElementById("experimentPanel");
    const closeBtn = document.getElementById("closeExperimentPanel");

    if (experimentPanel && experimentPanel.style.display !== "none") {
      if (window.logger) {
        window.logger.logAction("自動關閉實驗面板");
      }

      if (closeBtn) {
        // 使用面板管理器的關閉方法
        if (window.panelManager) {
          window.panelManager.closePanel("experiment");
        } else {
          // 回退方案：直接觸發關閉按鈕
          closeBtn.click();
        }
      } else {
        // 如果沒有關閉按鈕，直接隱藏面板
        experimentPanel.style.display = "none";
        experimentPanel.classList.add("hidden");
      }
    }
  }

  /** 處理電源狀態變化 */
  onPowerStateChanged(isPowerOn) {
    if (this.waitingForPowerOn && isPowerOn) {
      // 等待開機完成
      Logger.debug("電源打開，開始實驗");
      this.waitingForPowerOn = false;
      this.highlightPowerSwitch(false);
      if (window.logger) {
        window.logger.logAction("開機完成", null, null, false, false);
      }
      // 設定按鈕顏色為執行中
      if (window.mainApp?.setExperimentPanelButtonColor) {
        window.mainApp.setExperimentPanelButtonColor("running");
      } else {
        Logger.error(
          "無法呼叫 setExperimentPanelButtonColor - window.mainApp 不存在或函數未定義"
        );
      }

      //打開電源時，先高亮電源按鈕作為確認
      Logger.debug("電源已打開，高亮電源按鈕");
      this.highlightPowerSwitch(true);

      //延遲後清除電源按鈕高亮，載入資料並顯示第一個動作的按鈕高亮
      setTimeout(() => {
        this.highlightPowerSwitch(false);

        //此時才初始化動作序列和顯示第一個按鈕高亮
        if (!window.actionManager?.isInitialized) {
          Logger.debug("打開電源後，開始載入單元資料和初始化動作序列");
          this.loadUnitsAndStart();
        } else {
          // 已經初始化過，只更新按鈕高亮
          if (window.buttonManager) {
            Logger.debug("更新按鈕高亮");
            window.buttonManager.updateMediaForCurrentAction();
          }
        }

        //多螢幕同步：電源打開後廣播實驗狀態到其他裝置
        Logger.debug("電源打開後，廣播實驗初始化到其他裝置");

        //現在才廣播實驗初始化，此時按鈕高亮已準備好，experiment.html 也可以自動啟動
        this.broadcastExperimentInitialization();

        this.dispatchExperimentStateChanged();
      }, 500);

      // 實驗開始後自動關閉實驗面板（延遲確保所有初始化完成）
      setTimeout(() => {
        this.closeExperimentPanel();
      }, 1000);
    } else if (this.waitingForPowerOff && !isPowerOn) {
      // 等待關機完成
      this.waitingForPowerOff = false;
      this.highlightPowerSwitch(false);
      if (window.logger) {
        window.logger.logAction("關機完成，實驗結束", null, null, false, false);
      }
      // 結束實驗
      this.finishExperiment();
    } else if (
      this.isExperimentRunning &&
      !isPowerOn &&
      !this.waitingForPowerOff
    ) {
      //實驗進行中，電源關閉 → 立即結束實驗
      Logger.debug("實驗進行中偵測到電源關閉，立即結束實驗");
      if (window.logger) {
        window.logger.logAction(
          "異常關機，實驗被迫結束",
          null,
          null,
          false,
          false
        );
      }
      this.finishExperiment();
    } else if (
      this.isExperimentRunning &&
      isPowerOn &&
      !this.waitingForPowerOn &&
      !this.waitingForPowerOff
    ) {
      // 實驗進行中，電源重新開啟，還原目前步驟的媒體播放
      this.showCurrentStepMedia();
      // 確保按鈕高亮效果被更新
      if (window.buttonManager) {
        window.buttonManager.updateExperimentButtonStyles();
      }
    }
  }

  /** 載入選擇的單元 */
  loadSelectedUnits() {
    const unitList = document.querySelector(".experiment-units-list");
    this.loadedUnits = [];
    if (unitList) {
      // 只考慮普通單元項目，排除電源卡片
      Array.from(unitList.children).forEach((li) => {
        if (li.classList.contains("power-option-card")) return;

        const checkbox = li.querySelector('input[type="checkbox"]');
        if (checkbox && checkbox.checked) {
          this.loadedUnits.push(li.dataset.unitId);
        }
      });
    }
  }
  /** 載入單元資料並開始實驗 */
  async loadUnitsAndStart() {
    try {
      const data = await loadUnitsFromScenarios();
      window._allUnits = data.units;
      // 設定動作相關的全域變數
      window._allUnitsActionsMap = data.actions;
      window._allUnitsActionToStepMap = data.actionToStep;

      // 在資料載入完成後，初始化動作管理器
      if (window.actionManager && this.isExperimentRunning) {
        try {
          const initialized =
            await window.actionManager.initializeFromExperiment();
          if (initialized) {
            Logger.debug(
              "實驗資料載入後已初始化動作序列，共",
              window.actionManager.currentActionSequence.length,
              "個動作"
            );

            //記錄第一個單元到 JSONL 實驗日誌
            if (window.panelExperimentLog && this.loadedUnits.length > 0) {
              window.panelExperimentLog.logUnitChange(
                this.loadedUnits[0],
                0,
                this.loadedUnits.length
              );
            }

            //初始化完成後立即更新按鈕高亮和媒體
            // 顯示第一個教學動作的按鈕提示
            if (window.buttonManager) {
              window.buttonManager.updateMediaForCurrentAction();
            }
          }
        } catch (error) {
          Logger.error("資料載入後動作序列初始化失敗:", error);
        }
      }

      this.showExperimentWaitingState();
    } catch (error) {
      if (window.logger) {
        window.logger.logAction(`載入 scenarios.json 失敗: ${error.message}`);
      }
    }
  }

  /** 顯示實驗等待狀態 */
  showExperimentWaitingState() {
    if (!window._allUnits || this.loadedUnits.length === 0) return;
    const unitId = this.loadedUnits[this.currentUnitIndex];
    const unit = window._allUnits.find((u) => u.unit_id === unitId);
    if (!unit) return;
    const step = unit.steps[this.currentStepIndex];
    if (!step) return;

    // 顯示目前步驟的媒體內容和按鈕高亮
    this.showCurrentStepMediaOrHome();

    if (window.logger) {
      window.logger.logAction(
        `等待指令 - ${unit.unit_name || unitId}：${
          step.step_name || step.step_id
        }`
      );
    }

    // 更新綠色高亮提示
    this.updateHighlightVisibility();
  }

  /** 暫停/繼續實驗 */
  togglePauseExperiment() {
    const pauseExperimentButton = document.getElementById("pauseExperimentBtn");
    if (!this.experimentPaused) {
      this.experimentPaused = true;
      clearInterval(this.experimentInterval);
      if (pauseExperimentButton) pauseExperimentButton.textContent = "繼續實驗";
      if (window.logger)
        window.logger.logAction("暫停實驗", null, null, false, false);

      //記錄到 JSONL 實驗日誌
      if (window.panelExperimentLog) {
        window.panelExperimentLog.logPause();
      }

      //分發暫停事件
      document.dispatchEvent(
        new CustomEvent("experiment_paused", {
          detail: { isPaused: true },
        })
      );

      //廣播暫停狀態到其他裝置
      this.broadcastExperimentPaused();

      // 暫停時設定橘色
      if (window.mainApp?.setExperimentPanelButtonColor) {
        window.mainApp.setExperimentPanelButtonColor("paused");
      } else {
        Logger.error(
          "無法呼叫 setExperimentPanelButtonColor - window.mainApp 不存在或函數未定義"
        );
      }
    } else {
      this.experimentPaused = false;
      if (pauseExperimentButton) pauseExperimentButton.textContent = "暫停實驗";
      this.resumeTimer(); // 使用 resumeTimer 而不是 startTimer
      if (window.logger)
        window.logger.logAction("繼續實驗", null, null, false, false);

      //記錄到 JSONL 實驗日誌
      if (window.panelExperimentLog) {
        window.panelExperimentLog.logResume();
      }

      //分發還原事件
      document.dispatchEvent(
        new CustomEvent("experiment_resumed", {
          detail: { isPaused: false },
        })
      );

      //廣播還原狀態到其他裝置
      this.broadcastExperimentResumed();

      // 繼續實驗時自動關閉實驗面板
      this.closeExperimentPanel();
      window.dispatchExperimentStatusChanged &&
        window.dispatchExperimentStatusChanged();
      if (window.mainApp?.setExperimentPanelButtonColor) {
        window.mainApp.setExperimentPanelButtonColor("running");
      } else {
        Logger.error(
          "無法呼叫 setExperimentPanelButtonColor - window.mainApp 不存在或函數未定義"
        );
      }
    }
  }

  /** 停止實驗 */
  stopExperiment(isManualStop = true) {
    if (this.experimentInterval) {
      clearInterval(this.experimentInterval);
      this.experimentInterval = null;
    }

    // 記錄停止類型
    Logger.debug(
      `[PanelExperimentManager] ${isManualStop ? "人為停止" : "自動停止"} 實驗`
    );

    //先停止 JSONL 實驗日誌並下載（使用開始實驗時的 ID）
    if (window.panelExperimentLog) {
      window.panelExperimentLog.stopRecording(
        this.experimentElapsed,
        !isManualStop
      );
    }

    const experimentTimer = document.getElementById("experimentTimer");
    const experimentControlButtons = document.getElementById(
      "experimentControlButtons"
    );
    const startExperimentButton = document.getElementById(
      "startExperimentButton"
    );
    const pauseExperimentButton = document.getElementById(
      "pauseExperimentButton"
    );

    if (experimentTimer) experimentTimer.style.display = "none";
    if (experimentControlButtons)
      experimentControlButtons.style.display = "none";
    if (startExperimentButton) {
      startExperimentButton.style.display = "block";
      if (pauseExperimentButton) pauseExperimentButton.textContent = "暫停實驗";
    }

    this.isExperimentRunning = false;
    this.lockUnitList(false);
    this.lockExperimentId(false);

    // 處理等待中的更新
    if (this.pendingExperimentIdUpdate) {
      Logger.debug("套用等待中的實驗ID更新:", this.pendingExperimentIdUpdate);
      this.applyExperimentIdUpdate(this.pendingExperimentIdUpdate);
      this.pendingExperimentIdUpdate = null;
    }

    if (this.pendingSubjectNameUpdate) {
      Logger.debug(
        "套用等待中的受試者名稱更新:",
        this.pendingSubjectNameUpdate
      );
      this.applySubjectNameUpdate(this.pendingSubjectNameUpdate);
      this.pendingSubjectNameUpdate = null;
    }

    //分發實驗停止事件給同步管理器使用
    document.dispatchEvent(
      new CustomEvent("experiment_stopped", {
        detail: {
          experimentId: this.getCurrentExperimentId(),
          subjectName: document.getElementById("subjectName")?.value || "",
          combinationName: this.currentCombination?.combination_name || "",
        },
      })
    );

    //廣播停止狀態到其他裝置（僅人為停止時廣播）
    if (isManualStop) {
      this.broadcastExperimentStopped();
    } else {
      Logger.debug("[PanelExperimentManager] 自動停止，準備產生新的實驗ID...");

      //檢查是否需要等待同步裝置完成
      const canUpdateId = window.panelExperimentLog
        ? window.panelExperimentLog.canUpdateExperimentId()
        : true;

      if (canUpdateId) {
        // 自動停止時，產生新的實驗ID並廣播
        this.generateNewExperimentId();
        const newId = this.getCurrentExperimentId();
        Logger.debug("[PanelExperimentManager]已產生新的實驗ID:", newId);

        // 廣播新的實驗ID到同步工作階段
        Logger.debug(`[PanelExperimentManager] 廣播新的實驗ID: ${newId}`);
        this.broadcastExperimentIdUpdate(newId);

        // 只在同步模式下註冊到實驗中樞系統
        if (window.experimentHubManager?.isInSyncMode?.()) {
          Logger.debug(`[同步模式] 註冊實驗ID到中樞: ${newId}`);
          window.experimentHubManager.registerExperimentId(
            newId,
            "panel_auto_generate"
          );
        } else {
          Logger.debug(`[獨立模式] 實驗ID僅存本機: ${newId}`);
        }

        // 更新受試者名稱為新的預設值
        const subjectNameInput = document.getElementById("subjectNameInput");
        if (subjectNameInput) {
          subjectNameInput.value = `受試者_${newId}`;
        }
      } else {
        Logger.debug("[PanelExperimentManager] 等待同步裝置完成後再更新實驗ID");
        // 監聽同步裝置完成事件
        document.addEventListener(
          "panelExperimentLog:allDevicesCompleted",
          () => {
            this.generateNewExperimentId();
            const newId = this.getCurrentExperimentId();
            Logger.debug(
              "[PanelExperimentManager]同步完成，已產生新的實驗ID:",
              newId
            );
            Logger.debug(`[PanelExperimentManager] 廣播新的實驗ID: ${newId}`);
            this.broadcastExperimentIdUpdate(newId);

            // 只在同步模式下註冊到實驗中樞系統
            if (window.experimentHubManager?.isInSyncMode?.()) {
              Logger.debug(`[同步模式] 註冊實驗ID到中樞: ${newId}`);
              window.experimentHubManager.registerExperimentId(
                newId,
                "panel_sync_complete"
              );
            } else {
              Logger.debug(`[獨立模式] 實驗ID僅存本機: ${newId}`);
            }

            const subjectNameInput =
              document.getElementById("subjectNameInput");
            if (subjectNameInput) {
              subjectNameInput.value = `受試者_${newId}`;
            }
          },
          { once: true }
        );
      }
    }

    // 觸發實驗停止同步事件
    this.dispatchExperimentStateChanged();

    if (window.buttonManager) {
      window.buttonManager.updateExperimentButtonStyles();
    }

    const min = Math.floor(this.experimentElapsed / 60)
      .toString()
      .padStart(2, "0");
    const sec = (this.experimentElapsed % 60).toString().padStart(2, "0");

    if (window.logger) {
      window.logger.logAction(
        `結束實驗，總花費時間：${min}:${sec}`,
        null,
        null,
        false,
        false
      );
      //使用開始實驗時的 ID 作為檔案名稱
      const logExportId =
        window.panelExperimentLog?.getStartExperimentId() ||
        this.getCurrentExperimentId();
      window.logger.exportLogSilent(logExportId);
    }
    if (window.mainApp?.setExperimentPanelButtonColor) {
      window.mainApp.setExperimentPanelButtonColor("default");
    } else {
      Logger.error(
        "無法呼叫 setExperimentPanelButtonColor - window.mainApp 不存在或函數未定義"
      );
    }
    window.dispatchExperimentStatusChanged &&
      window.dispatchExperimentStatusChanged();
  }

  /** 開始計時器 */
  startTimer() {
    const experimentTimer = document.getElementById("experimentTimer");
    if (experimentTimer) {
      experimentTimer.style.display = "block";
      this.experimentStartTime = Date.now();
      this.experimentElapsed = 0;
      this.experimentPaused = false;
      experimentTimer.textContent = "花費時間：00:00";

      this.experimentInterval = setInterval(() => {
        if (!this.experimentPaused) {
          const now = Date.now();
          this.experimentElapsed = Math.floor(
            (now - this.experimentStartTime) / 1000
          );
          const min = Math.floor(this.experimentElapsed / 60)
            .toString()
            .padStart(2, "0");
          const sec = (this.experimentElapsed % 60).toString().padStart(2, "0");
          const timerValue = `${min}:${sec}`;
          experimentTimer.textContent = `花費時間：${timerValue}`;
        }
      }, 1000);
    }
  }

  /** 還原計時器（不重置時間） */
  resumeTimer() {
    const experimentTimer = document.getElementById("experimentTimer");
    if (experimentTimer) {
      // 調整開始時間，保持已經過的時間
      this.experimentStartTime = Date.now() - this.experimentElapsed * 1000;
      this.experimentPaused = false;

      this.experimentInterval = setInterval(() => {
        if (!this.experimentPaused) {
          const now = Date.now();
          this.experimentElapsed = Math.floor(
            (now - this.experimentStartTime) / 1000
          );
          const min = Math.floor(this.experimentElapsed / 60)
            .toString()
            .padStart(2, "0");
          const sec = (this.experimentElapsed % 60).toString().padStart(2, "0");
          const timerValue = `${min}:${sec}`;
          experimentTimer.textContent = `花費時間：${timerValue}`;
        }
      }, 1000);
    }
  }

  /** 顯示目前步驟的媒體內容 */
  showCurrentStepMedia() {
    this.showCurrentStepMediaOrHome();
  }

  /** 處理步驟轉換 */
  handleStepTransition(interaction, key) {
    if (!interaction) return;
    const unitId = this.loadedUnits[this.currentUnitIndex];
    const unit = window._allUnits
      ? window._allUnits.find((u) => u.unit_id === unitId)
      : null;
    if (!unit) return;
    const currentStep = unit.steps[this.currentStepIndex];
    const isFirstStep =
      this.currentStepIndex === 0 &&
      currentStep &&
      currentStep.step_id.includes("_1");

    if (
      window.buttonManager &&
      !window.buttonManager.isPowerOn() &&
      !isFirstStep
    ) {
      if (window.logger) {
        window.logger.logAction(
          `操作被阻止：機器未開機，請先開啟機器電源再進行操作 (${key})`
        );
      }
      return;
    }

    if (window.logger) {
      window.logger.logAction(
        `${key} → ${interaction.function_name || "下一步"}`
      );
    }

    if (interaction.next_step_id) {
      if (interaction.next_step_id === "END_UNIT") {
        this.handleUnitCompletion();
        return;
      }
      if (interaction.next_step_id === "") {
        // 空的 next_step_id，根據目前位置決定下一步
        this.handleEmptyNextStepId();
        return;
      }
      const nextIdx = unit.steps.findIndex(
        (s) => s.step_id === interaction.next_step_id
      );
      if (nextIdx !== -1) {
        this.currentStepIndex = nextIdx;
        this.showCurrentStepMediaOrHome();
        // 觸發同步事件
        this.dispatchExperimentStateChanged();
        // 立即更新綠色高亮
        this.updateHighlightVisibility();
        // 同時確保按鈕樣式也更新（用於 experiment-functional 標記）
        if (window.buttonManager) {
          window.buttonManager.updateExperimentButtonStyles();
        }
        return;
      }
    }
    this.handleAutoProgression();
  }

  /** 處理自動進展邏輯 */
  handleAutoProgression() {
    const unitId = this.loadedUnits[this.currentUnitIndex];
    const unit = window._allUnits
      ? window._allUnits.find((u) => u.unit_id === unitId)
      : null;
    if (!unit) return;

    if (this.currentStepIndex + 1 < unit.steps.length) {
      this.currentStepIndex++;
      this.showCurrentStepMediaOrHome();
      // 觸發同步事件
      this.dispatchExperimentStateChanged();
      // 立即更新綠色高亮
      this.updateHighlightVisibility();
      // 同時確保按鈕樣式也更新（用於 experiment-functional 標記）
      if (window.buttonManager) {
        window.buttonManager.updateExperimentButtonStyles();
      }
    } else {
      this.handleUnitCompletion();
    }
  }

  /** 處理單元完成 */
  handleUnitCompletion() {
    this.currentUnitIndex++;
    this.currentStepIndex = 0;
    if (this.currentUnitIndex < this.loadedUnits.length) {
      const nextUnitId = this.loadedUnits[this.currentUnitIndex];

      //記錄單元變更到 JSONL 實驗日誌
      if (window.panelExperimentLog) {
        window.panelExperimentLog.logUnitChange(
          nextUnitId,
          this.currentUnitIndex,
          this.loadedUnits.length
        );
      }

      this.showCurrentStepMediaOrHome();
      // 觸發同步事件
      this.dispatchExperimentStateChanged();
      // 立即更新綠色高亮
      this.updateHighlightVisibility();
      // 同時確保按鈕樣式也更新（用於 experiment-functional 標記）
      if (window.buttonManager) {
        window.buttonManager.updateExperimentButtonStyles();
      }
      if (window.logger) {
        window.logger.logAction(`進入單元：${nextUnitId}`);
      }
    } else {
      if (window.logger) {
        window.logger.logAction("所有單元已完成");
      }
      // 檢查是否需要關機流程
      this.handleExperimentEnd();
    }
  }

  /** 處理實驗結束流程 */
  handleExperimentEnd() {
    if (
      this.includeShutdown &&
      window.powerControl &&
      window.powerControl.isPowerOn
    ) {
      // 需要關機且機器目前是開啟的，等待使用者關機
      this.waitingForPowerOff = true;
      this.highlightPowerSwitch(true);
      if (window.logger) {
        window.logger.logAction("等待關機", null, null, false, false);
      }
    } else {
      // 不需要關機或機器已經關閉，直接結束實驗
      this.finishExperiment();
    }
  }

  /** 完成實驗（處理最終清理和日誌匯出） */
  finishExperiment() {
    if (window.logger) {
      window.logger.logAction("實驗結束");
    }

    // 清除預先載入的媒體
    if (window.mediaManager) {
      window.mediaManager.clearPreloadedMedia();
    }

    //自動停止（不廣播到其他裝置）
    this.stopExperiment(false);
  }

  /** 處理空的 next_step_id */
  handleEmptyNextStepId() {
    const unitId = this.loadedUnits[this.currentUnitIndex];
    const unit = window._allUnits
      ? window._allUnits.find((u) => u.unit_id === unitId)
      : null;
    if (!unit) return;

    // 檢查是否有下一個單元
    if (this.currentUnitIndex + 1 < this.loadedUnits.length) {
      // 有下一個單元，跳轉到下一個單元的第一個步驟
      const nextUnitId = this.loadedUnits[this.currentUnitIndex + 1];
      if (window.logger) {
        window.logger.logAction(`跳轉到下一個單元：${nextUnitId}`);
      }
      this.handleUnitCompletion();
    } else {
      // 這是最後一個單元，處理實驗結束
      if (window.logger) {
        window.logger.logAction("最後一個單元，準備關機");
      }
      this.handleExperimentEnd();
    }
  }

  /** 處理回到首頁 */
  handleReturnToHome() {
    if (window.mediaManager) {
      // 使用統一的首頁動畫路徑常數
      window.mediaManager.playMedia(
        PanelExperimentManager.HOME_PAGE_VIDEO_PATH,
        {
          controls: false,
          muted: true,
          loop: true,
          autoplay: true,
        }
      );
      if (window.logger) {
        window.logger.logAction("回到首頁");
      }
    }
  }

  /** 顯示目前步驟媒體或首頁循環 */
  showCurrentStepMediaOrHome() {
    if (!window._allUnits || this.loadedUnits.length === 0) return;
    const unitId = this.loadedUnits[this.currentUnitIndex];
    const unit = window._allUnits.find((u) => u.unit_id === unitId);
    if (!unit) return;
    const step = unit.steps[this.currentStepIndex];
    if (!step) return;

    const isFirstStep =
      this.currentStepIndex === 0 && step.step_id.includes("_1");
    const isPowerOn = window.buttonManager
      ? window.buttonManager.isPowerOn()
      : true;

    // 如果機器未開機，顯示等待開機提示（所有步驟都一樣）
    if (!isPowerOn) {
      if (window.mediaManager && window.mediaManager.mediaArea) {
        window.mediaManager.mediaArea.innerHTML = `
                    <div class="machine-status-message">
                        <div class="machine-status-icon">⚡</div>
                        <div class="machine-status-title">機器未開機</div>
                        <div class="machine-status-subtitle">請先開啟機器電源</div>
                        <div class="machine-status-waiting">等待中...</div>
                    </div>
                `;
      }
      // 清除按鈕高亮（因為機器未開機）
      if (window.buttonManager) {
        window.buttonManager.updateExperimentButtonStyles();
      }
      return;
    }

    // 處理媒體播放
    const mediaFile = step.media_file;
    if (mediaFile && window.mediaManager) {
      // 有媒體檔案，播放步驟媒體
      window.mediaManager.showStepMedia(mediaFile);
    } else if (window.mediaManager && isPowerOn) {
      // 沒有媒體檔案且機器已開機，播放首頁循環
      window.mediaManager.playMedia(
        PanelExperimentManager.HOME_PAGE_VIDEO_PATH,
        {
          controls: false,
          muted: true,
          loop: true,
          autoplay: true,
          onError: (e, errorInfo) => {
            Logger.warn("首頁影片載入失敗:", errorInfo);
            // 顯示無媒體內容的狀態
            if (window.mediaManager && window.mediaManager.mediaArea) {
              window.mediaManager.mediaArea.innerHTML = `
                            <div class="waiting-message">
                                <div class="waiting-icon">📺</div>
                                <div>此步驟無媒體內容</div>
                                <div class="waiting-text">等待操作指令...</div>
                            </div>
                        `;
            }
          },
        }
      );
      if (window.logger) {
        window.logger.logAction(`播放首頁 - ${step.step_name || step.step_id}`);
      }
    }

    // 預先載入下一個步驟的媒體（如果存在）
    this.preloadNextStepMedia(unit);

    // 更新按鈕高亮樣式
    if (window.buttonManager) {
      window.buttonManager.updateExperimentButtonStyles();
    }

    // 檢查是否需要自動進展（步驟沒有可用的交互操作）
    this.checkAutoProgressionForEmptyInteractions(step, unit);
  }

  /** 檢查並處理沒有交互操作的步驟自動進展 */
  checkAutoProgressionForEmptyInteractions(step, unit) {
    // Action-based 模式不需要自動進展邏輯
    // 所有進展都由 ActionManager 管理
    return;
  }

  /** 處理步驟自動進展邏輯 */
  handleStepAutoProgression(unit) {
    // 檢查是否還有下一個步驟
    if (this.currentStepIndex + 1 < unit.steps.length) {
      // 還有下一個步驟，正常進展
      this.currentStepIndex++;
      this.showCurrentStepMediaOrHome();
      if (window.buttonManager) {
        setTimeout(() => {
          window.buttonManager.updateExperimentButtonStyles();
        }, 10);
      }
    } else {
      // 這是最後一個步驟，檢查是否有下一個單元
      if (this.currentUnitIndex + 1 < this.loadedUnits.length) {
        // 有下一個單元，跳轉到下一個單元的第一個步驟
        const nextUnitId = this.loadedUnits[this.currentUnitIndex + 1];
        if (window.logger) {
          window.logger.logAction(
            `單元完成，自動進入下一個單元：${nextUnitId}`
          );
        }
        this.handleUnitCompletion();
      } else {
        // 這是最後一個單元，處理實驗結束
        if (window.logger) {
          window.logger.logAction("最後一個單元完成，準備結束實驗");
        }
        this.handleExperimentEnd();
      }
    }
  }

  /** 預先載入下一個步驟的媒體（減少黑畫面等待時間） */
  preloadNextStepMedia(currentUnit) {
    if (!window.mediaManager || !currentUnit) return;

    const nextStepIndex = this.currentStepIndex + 1;
    const mediaFilesToPreload = [];

    // 收集後續步驟的媒體檔案
    if (nextStepIndex < currentUnit.steps.length) {
      const nextStep = currentUnit.steps[nextStepIndex];
      if (nextStep?.media_file) {
        mediaFilesToPreload.push(nextStep.media_file);
      }

      // 也預先載入往後第二個步驟的媒體（如果存在）
      if (nextStepIndex + 1 < currentUnit.steps.length) {
        const stepAfterNext = currentUnit.steps[nextStepIndex + 1];
        if (stepAfterNext?.media_file) {
          mediaFilesToPreload.push(stepAfterNext.media_file);
        }
      }
    } else if (this.currentUnitIndex + 1 < this.loadedUnits.length) {
      // 如果目前單元已完成，預先載入下一個單元的媒體
      const nextUnitId = this.loadedUnits[this.currentUnitIndex + 1];
      const nextUnit = window._allUnits?.find((u) => u.unit_id === nextUnitId);
      if (nextUnit?.steps?.[0]?.media_file) {
        mediaFilesToPreload.push(nextUnit.steps[0].media_file);
      }
    }

    // 批次預先載入媒體檔案
    if (mediaFilesToPreload.length > 0) {
      window.mediaManager.preloadMediaBatch(mediaFilesToPreload);
    }
  }

  /** 處理鍵盤互動 */
  handleKeyboardInteraction(event) {
    //重點修正：如果任何輸入框有焦點，忽略鍵盤事件
    const activeElement = document.activeElement;
    if (
      activeElement &&
      (activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA" ||
        activeElement.classList.contains("editable"))
    ) {
      return false; // 輸入框有焦點，不處理
    }

    const unitId = this.loadedUnits[this.currentUnitIndex];
    const unit = window._allUnits
      ? window._allUnits.find((u) => u.unit_id === unitId)
      : null;
    const step = unit && unit.steps ? unit.steps[this.currentStepIndex] : null;

    if (step && step.interactions) {
      let key = event.key;
      if (event.shiftKey && !/^Shift/.test(key)) key = "Shift+" + key;
      let found = null;
      for (const k in step.interactions) {
        if (k.toLowerCase() === key.toLowerCase()) {
          found = step.interactions[k];
          break;
        }
      }
      if (found) {
        this.handleStepTransition(found, key);
        return true;
      }
    }
    return false;
  }

  /** 鎖定/解鎖單元列表 */
  lockUnitList(lock) {
    const unitList = document.querySelector(".experiment-units-list");
    if (!unitList) return;
    Array.from(unitList.children).forEach((li) => {
      const checkbox = li.querySelector('input[type="checkbox"]');
      if (checkbox) checkbox.disabled = lock;
      const upBtn = li.querySelector('.unit-sort-btn[title="上移"]');
      const downBtn = li.querySelector('.unit-sort-btn[title="下移"]');
      if (upBtn) upBtn.disabled = lock;
      if (downBtn) downBtn.disabled = lock;
      const dragHandle = li.querySelector(".unit-drag-handle");
      if (dragHandle) dragHandle.style.pointerEvents = lock ? "none" : "";
    });
  }

  /** 鎖定/解鎖實驗ID輸入框 */
  lockExperimentId(lock) {
    const experimentIdInput = document.getElementById("experimentIdInput");
    const regenerateIdButton = document.getElementById("regenerateIdButton");
    const experimentIdInputGroup = document.querySelector(
      ".experiment-id-input-group"
    );

    Logger.debug(
      `lockExperimentId(${lock}) - InputGroup found:`,
      !!experimentIdInputGroup
    );

    if (lock) {
      // 實驗開始時，將實驗ID轉換為徽章樣式
      const currentId = this.getCurrentExperimentId();
      if (experimentIdInputGroup) {
        Logger.debug("鎖定實驗ID - 轉換為徽章樣式");
        experimentIdInputGroup.innerHTML = `
                    <label>實驗ID</label>
                    <div class="experiment-id-badge">${currentId}</div>
                    <div id="experimentTimer" class="experiment-timer">花費時間：00:00</div>
                `;
      }
    } else {
      // 實驗結束時，還原輸入框
      if (experimentIdInputGroup) {
        experimentIdInputGroup.innerHTML = `
                    <label for="experimentIdInput">實驗ID</label>
                    <input type="text" id="experimentIdInput" class="experiment-id-input" maxlength="10" placeholder="載入中...">
                    <button id="regenerateIdButton" class="regenerate-id-btn" title="重新產生ID">重新產生</button>
                    <div id="experimentTimer" class="experiment-timer">花費時間：00:00</div>
                `;
        // 重新設定事件監聽器
        this.setupExperimentIdEvents();
        // 保持目前實驗ID，不要重新產生
        const newInput = document.getElementById("experimentIdInput");
        if (newInput && this.currentExperimentId) {
          newInput.value = this.currentExperimentId;
        }
      }
    }
  }

  /** 設定實驗ID相關事件 */
  setupExperimentIdEvents() {
    const experimentIdInput = document.getElementById("experimentIdInput");
    const regenerateIdButton = document.getElementById("regenerateIdButton");

    if (experimentIdInput) {
      experimentIdInput.addEventListener("input", (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");

        // 如果目前選中的是指定隨機組合，自動重新排序
        this.autoReapplyRandomCombination();
      });
    } else {
      Logger.warn("experimentIdInput 未找到");
    }

    if (regenerateIdButton) {
      regenerateIdButton.addEventListener("click", () => {
        Logger.debug("再產生ID按鈕被點擊");
        this.generateNewExperimentId();
        // 移除重複的ID產生日誌

        // 自動重新套用指定隨機組合（如果目前選中的是）
        this.autoReapplyRandomCombination();
      });
    } else {
      Logger.warn("regenerateIdButton 未找到");
    }
  } /** 初始化實驗UI */
  initializeExperimentUI() {
    this.renderDefaultSequences();
    this.renderUnitList();
  }

  /** 從 scenarios.json 渲染預設實驗序列 */
  async renderDefaultSequences() {
    try {
      const data = await loadUnitsFromScenarios();
      const list = document.querySelector(".experiment-default-list");
      if (!list) return;
      list.innerHTML = "";
      if (data && Array.isArray(data.unit_combinations)) {
        const defaultCombinationId =
          window.CONFIG?.experiment?.defaultCombinationId;

        data.unit_combinations.forEach((combination) => {
          const btn = document.createElement("button");
          btn.className = "default-combo-btn";
          btn.textContent = combination.combination_name;
          btn.dataset.combinationId = combination.combination_id;
          btn.addEventListener("click", () =>
            this.applyUnitCombination(combination)
          );

          // 如果是預設組合，自動選擇並點擊
          if (
            defaultCombinationId &&
            combination.combination_id === defaultCombinationId
          ) {
            btn.classList.add("active");
            // 延遲套用，確保 DOM 已完全更新
            setTimeout(() => {
              this.applyUnitCombination(combination);
            }, 0);
          }

          const li = document.createElement("li");
          li.appendChild(btn);
          list.appendChild(li);
        });
      }
    } catch (error) {
      Logger.error("載入 scenarios.json 組合失敗:", error);
      if (window.logger) {
        window.logger.logAction(`載入單元組合失敗: ${error.message}`);
      }
    }
  }

  /** 套用預設單元組合 */
  applyDefaultSequence(sequenceId, unitIds) {
    const unitList = document.querySelector(".experiment-units-list");
    if (!unitList) return;

    // 清除目前組合追蹤（因為這不是來自新的unit_combinations）
    this.currentCombination = null;

    const allBtns = document.querySelectorAll(".default-combo-btn");
    let clickedBtn = null;
    allBtns.forEach((btn) => {
      if (btn.dataset.sequenceId === sequenceId) clickedBtn = btn;
      btn.classList.remove("active");
    });
    if (clickedBtn) {
      clickedBtn.classList.add("active");
      clickedBtn.style.transform = "scale(0.95)";
      setTimeout(() => {
        clickedBtn.style.transform = "";
      }, 150);
    }

    if (unitIds && Array.isArray(unitIds)) {
      // 清空所有勾選
      Array.from(unitList.children).forEach((li) => {
        const checkbox = li.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = false;
      });

      // 取得所有項目
      const allItems = Array.from(unitList.children);
      const startupCard = allItems.find((item) =>
        item.classList.contains("startup-card")
      );
      const shutdownCard = allItems.find((item) =>
        item.classList.contains("shutdown-card")
      );
      const normalItems = allItems.filter(
        (item) => !item.classList.contains("power-option-card")
      );

      // 建立新的排序
      const orderedItems = [];

      // 1. 先放開機卡片（如果存在）並勾選
      if (startupCard) {
        const checkbox = startupCard.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = true;
        orderedItems.push(startupCard);
      }

      // 2. 按照指定順序放入選中的普通單元
      unitIds.forEach((unitId) => {
        const item = normalItems.find((li) => li.dataset.unitId === unitId);
        if (item) {
          const checkbox = item.querySelector('input[type="checkbox"]');
          if (checkbox) checkbox.checked = true;
          orderedItems.push(item);
        }
      });

      // 3. 放入未選中的普通單元
      normalItems.forEach((item) => {
        if (!unitIds.includes(item.dataset.unitId)) {
          orderedItems.push(item);
        }
      });

      // 4. 最後放關機卡片（如果存在）並勾選
      if (shutdownCard) {
        const checkbox = shutdownCard.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = true;
        orderedItems.push(shutdownCard);
      }

      // 重新排列列表
      unitList.innerHTML = "";
      orderedItems.forEach((item) => unitList.appendChild(item));

      // 更新開機關機選項的狀態
      this.includeStartup = true;
      this.includeShutdown = true;

      this.enableUnitDragSort(unitList);
      this.updateSelectAllState();
      this.updateAllUnitButtonStates();
      if (window.logger) {
        window.logger.logAction(
          `已套用預設組合：${sequenceId}，單元順序：開機 → ${unitIds.join(
            " → "
          )} → 關機`
        );
      }
    }
    this.enableUnitDragSort(unitList);
    this.updateAllUnitButtonStates();
  }

  /** 套用新的單元組合 */
  applyUnitCombination(combination) {
    this.applyCombinationAfterProcessing(combination);
  }

  applyCombinationAfterProcessing(combination) {
    // 儲存目前選中的組合
    this.currentCombination = combination;

    // 使用中央 CombinationSelector 進行選擇
    if (window.CombinationSelector) {
      // 取得目前實驗ID以便可隨機組合使用
      const experimentId = this.getCurrentExperimentId();
      window.CombinationSelector.selectCombination(combination, experimentId);
    }

    // 更新面板特定的狀態
    this.includeStartup = true;
    this.includeShutdown = true;

    // 記錄日誌
    if (window.logger) {
      const experimentId = this.getCurrentExperimentId();
      if (combination.is_randomizable) {
        window.logger.logAction(
          `套用組合：${combination.combination_name} (ID:${experimentId})`
        );
      } else {
        window.logger.logAction(`套用組合：${combination.combination_name}`);
      }
    }
  }

  /** 從 scenarios.json 載入單元並渲染排序功能 */
  async renderUnitList() {
    try {
      const data = await loadUnitsFromScenarios();
      const unitList = document.querySelector(".experiment-units-list");
      if (!unitList) return;

      // 清空列表
      unitList.innerHTML = "";

      // 首先新增開機卡片到最前面
      this.addStartupCard(unitList);

      if (data && Array.isArray(data.units)) {
        data.units.forEach((unit) => {
          const li = this.createUnitListItem(unit);
          unitList.appendChild(li);
        });

        // 新增關機卡片到底部
        this.addShutdownCard(unitList);

        this.enableUnitDragSort(unitList);
        this.updateSelectAllState();
        this.updateAllUnitButtonStates();
      } else {
        const errorLi = document.createElement("li");
        errorLi.style.color = "red";
        errorLi.textContent =
          "scenarios.json 格式錯誤，請確認內容為 { units: [...] }。";
        unitList.appendChild(errorLi);
      }
    } catch (err) {
      const unitList = document.querySelector(".experiment-units-list");
      if (unitList) {
        const errorLi = document.createElement("li");
        errorLi.style.color = "red";
        errorLi.textContent = err.message;
        unitList.appendChild(errorLi);
      }
    }
  }

  /** 新增開機卡片到列表頂部 */
  addStartupCard(unitList) {
    const startupCard = document.createElement("li");
    startupCard.className = "power-option-card startup-card";
    startupCard.innerHTML = `
            <label class="unit-checkbox">
                <input type="checkbox" id="includeStartup" checked>
            </label>
            <div class="unit-sort">
                <div class="power-option-title">機器開機</div>
                <div class="power-option-subtitle">POWER_ON • 開始實驗前先開機</div>
            </div>
        `;
    unitList.appendChild(startupCard);

    // 重新綁定開機選項事件
    const includeStartup = startupCard.querySelector("#includeStartup");
    if (includeStartup) {
      includeStartup.addEventListener("change", (e) => {
        this.includeStartup = e.target.checked;
      });
    }
  }

  /** 新增關機卡片到列表底部 */
  addShutdownCard(unitList) {
    const shutdownCard = document.createElement("li");
    shutdownCard.className = "power-option-card shutdown-card";
    shutdownCard.innerHTML = `
            <label class="unit-checkbox">
                <input type="checkbox" id="includeShutdown" checked>
            </label>
            <div class="unit-sort">
                <div class="power-option-title">機器關機</div>
                <div class="power-option-subtitle">POWER_OFF • 完成關機才結束實驗</div>
            </div>
        `;
    unitList.appendChild(shutdownCard);

    // 重新綁定關機選項事件
    const includeShutdown = shutdownCard.querySelector("#includeShutdown");
    if (includeShutdown) {
      includeShutdown.addEventListener("change", (e) => {
        this.includeShutdown = e.target.checked;
      });
    }
  }

  /** 建立單元列表項目 */
  createUnitListItem(unit) {
    const li = document.createElement("li");
    li.dataset.unitId = unit.unit_id;

    // 勾選框
    const label = document.createElement("label");
    label.className = "unit-checkbox";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.addEventListener("change", () => this.updateSelectAllState());
    label.appendChild(checkbox);
    li.appendChild(label);

    // 單元名稱
    const unitInfo = document.createElement("div");
    unitInfo.className = "unit-sort";
    unitInfo.innerHTML = `
            <div class="unit-info-title">${unit.unit_name || unit.unit_id}</div>
            <div class="unit-info-subtitle">${unit.unit_id} • ${
      unit.steps ? unit.steps.length : 0
    } 步驟</div>
        `;
    li.appendChild(unitInfo);

    // 控制按鈕組
    const controlsGroup = document.createElement("div");
    controlsGroup.style.cssText =
      "display: flex; align-items: center; gap: 4px; margin-left: auto;";

    // 上移按鈕
    const upBtn = document.createElement("button");
    upBtn.className = "unit-sort-btn unit-up-btn";
    upBtn.title = "上移";
    upBtn.innerHTML = "▲";
    upBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.moveUnit(li, -1);
    });
    controlsGroup.appendChild(upBtn);

    // 下移按鈕
    const downBtn = document.createElement("button");
    downBtn.className = "unit-sort-btn unit-down-btn";
    downBtn.title = "下移";
    downBtn.innerHTML = "▼";
    downBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.moveUnit(li, 1);
    });
    controlsGroup.appendChild(downBtn);

    // 拖曳排序
    const dragHandle = document.createElement("span");
    dragHandle.className = "unit-drag-handle";
    dragHandle.title = "拖曳排序";
    dragHandle.innerHTML = "⋮⋮";
    dragHandle.style.cursor = "grab";
    controlsGroup.appendChild(dragHandle);

    li.appendChild(controlsGroup);

    this.updateUnitButtonStates(li);

    return li;
  }

  /** 上下移動單元 */
  moveUnit(li, direction) {
    const list = li.parentElement;

    // 取得所有普通單元項目（排除電源卡片）
    const normalItems = Array.from(list.children).filter(
      (item) => !item.classList.contains("power-option-card")
    );

    const idx = normalItems.indexOf(li);
    if (idx === -1) return; // 如果不是普通單元項目，則不處理

    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= normalItems.length) return;

    const targetItem = normalItems[newIdx];

    if (direction === -1) {
      // 上移：插入到目標項目之前
      list.insertBefore(li, targetItem);
    } else {
      // 下移：插入到目標項目之後
      list.insertBefore(li, targetItem.nextSibling);
    }

    this.updateAllUnitButtonStates();
    // 移除重複的單元移動日誌
  }

  /** 啟用拖曳排序功能 */
  enableUnitDragSort(unitList) {
    let draggedLi = null;
    let placeholder = null;

    // 只對普通單元項目啟用拖曳，排除電源卡片
    const handles = unitList.querySelectorAll(
      "li:not(.power-option-card) .unit-drag-handle"
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
      handle.style.cursor = "grabbing";
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
        (item) => !item.classList.contains("power-option-card")
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
      if (handle) handle.style.cursor = "grab";
      // 移除拖曳排序日誌
      this.updateAllUnitButtonStates();
      draggedLi = null;
      placeholder = null;
    };
  }

  /** 全選/取消全選單元 */
  toggleSelectAllUnits(checked) {
    const unitList = document.querySelector(".experiment-units-list");
    if (!unitList) return;

    // 只對普通單元項目進行全選操作，排除電源卡片
    const normalItems = unitList.querySelectorAll("li:not(.power-option-card)");
    normalItems.forEach((li) => {
      const checkbox = li.querySelector('input[type="checkbox"]');
      if (checkbox) {
        checkbox.checked = checked;
      }
    });

    // 移除全選操作日誌，這個操作不重要
  }

  /** 更新全選狀態 */
  updateSelectAllState() {
    const unitList = document.querySelector(".experiment-units-list");
    const selectAllCheckbox = document.getElementById("selectAllUnits");
    if (!unitList || !selectAllCheckbox) return;

    // 只考慮普通單元項目的勾選狀態，排除電源卡片
    const normalItems = unitList.querySelectorAll("li:not(.power-option-card)");
    const checkboxes = Array.from(normalItems)
      .map((li) => li.querySelector('input[type="checkbox"]'))
      .filter((cb) => cb);
    const checkedBoxes = checkboxes.filter((cb) => cb.checked);

    if (checkboxes.length === 0) {
      selectAllCheckbox.indeterminate = false;
      selectAllCheckbox.checked = false;
    } else if (checkedBoxes.length === checkboxes.length) {
      selectAllCheckbox.indeterminate = false;
      selectAllCheckbox.checked = true;
    } else if (checkedBoxes.length > 0) {
      selectAllCheckbox.indeterminate = true;
      selectAllCheckbox.checked = false;
    } else {
      selectAllCheckbox.indeterminate = false;
      selectAllCheckbox.checked = false;
    }
  }

  /** 更新單個單元的按鈕狀態 */
  updateUnitButtonStates(li) {
    const list = li.parentElement;
    if (!list || li.classList.contains("power-option-card")) return;

    // 只考慮普通單元項目的位置
    const normalItems = Array.from(list.children).filter(
      (item) => !item.classList.contains("power-option-card")
    );

    const index = normalItems.indexOf(li);
    if (index === -1) return;

    const isFirst = index === 0;
    const isLast = index === normalItems.length - 1;
    const upBtn = li.querySelector(".unit-up-btn");
    const downBtn = li.querySelector(".unit-down-btn");
    if (upBtn) {
      upBtn.disabled = isFirst;
      upBtn.classList.toggle("disabled", isFirst);
    }
    if (downBtn) {
      downBtn.disabled = isLast;
      downBtn.classList.toggle("disabled", isLast);
    }
  }

  /** 更新所有單元的按鈕狀態 */
  updateAllUnitButtonStates() {
    const unitList = document.querySelector(".experiment-units-list");
    if (!unitList) return;

    // 只更新普通單元項目的按鈕狀態
    const normalItems = unitList.querySelectorAll("li:not(.power-option-card)");
    normalItems.forEach((li) => {
      this.updateUnitButtonStates(li);
    });
  }

  /** 觸發實驗狀態變化事件（用於多客戶端同步） */
  dispatchExperimentStateChanged() {
    const detail = {
      experimentId: this.getCurrentExperimentId(),
      currentUnitIndex: this.currentUnitIndex,
      currentStepIndex: this.currentStepIndex,
      experimentRunning: this.isExperimentRunning,
      experimentPaused: this.experimentPaused,
      totalUnits: this.loadedUnits.length,
      currentUnitId: this.loadedUnits[this.currentUnitIndex] || null,
      timestamp: Date.now(),
    };

    // 觸發自定義事件
    const event = new CustomEvent("experimentStateChanged", { detail });
    document.dispatchEvent(event);

    //通過同步系統發送到遠端裝置（experience.html）
    const syncData = {
      type: "panel_experiment_state_update",
      source: "panel",
      device_id:
        window.syncManager?.core?.syncClient?.clientId || "panel_device",
      timestamp: new Date().toISOString(),
      data: detail,
    };

    if (window.syncManager?.core?.syncState) {
      window.syncManager.core.syncState(syncData).catch((error) => {
        Logger.warn("同步面板實驗狀態失敗:", error);
      });
    }

    // 同時記錄到日誌
    if (window.logger) {
      window.logger.logAction(
        "實驗狀態變化",
        "state_change",
        null,
        false,
        false,
        false,
        null,
        detail
      );
    }

    // 注意：按鈕動作通過 broadcastButtonAction() 分別廣播，
    // 實驗初始化通過 broadcastExperimentInitialization() 廣播
  }

  /** 取得目前媒體路徑 */
  getCurrentMediaPath() {
    const mediaArea = document.getElementById("mediaArea");
    const video = mediaArea?.querySelector("video");
    const img = mediaArea?.querySelector("img");

    if (video && video.src) {
      return video.src;
    } else if (img && img.src) {
      return img.src;
    }

    return PanelExperimentManager.HOME_PAGE_VIDEO_PATH;
  }
}

// 匯出主面板實驗管理器單例
window.panelExperiment = new PanelExperimentManager();

// 向後相容性：也暴露為 experiment
window.experiment = window.panelExperiment;
