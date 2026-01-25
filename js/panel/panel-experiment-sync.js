/**
 * PanelExperimentSync - 面板實驗同步管理器
 *
 * 負責處理多裝置同步、遠端事件處理和狀態廣播
 * 專門處理與其他裝置的通訊和狀態同步
 */
class PanelExperimentSync {
  constructor(manager) {
    this.manager = manager; // 引用到主管理器
  }

  /**
   * 處理同步實驗狀態
   */
  handleSyncExperimentState(data) {
    // 只有觀看模式才接受同步
    if (this.manager.isViewerMode) return;

    // 同步基本狀態
    Object.assign(this.manager, {
      isExperimentRunning:
        data.isExperimentRunning ?? this.manager.isExperimentRunning,
      currentUnitIndex: data.currentUnitIndex ?? this.manager.currentUnitIndex,
      currentStepIndex: data.currentStepIndex ?? this.manager.currentStepIndex
    });

    // 同步計時器狀態
    if (data.experimentPaused !== undefined) {
      this.manager.timer.setPaused(data.experimentPaused);
    }

    // 同步ID和組合
    if (data.currentExperimentId) {
      this.manager.setExperimentId(data.currentExperimentId, "sync");
      this.manager.currentExperimentId = data.currentExperimentId;
      this.manager.updateExperimentIdDisplay();
    }

    if (data.currentCombination) {
      this.manager.currentCombination = data.currentCombination;
      this.manager.loadedUnits = data.loadedUnits || [];
    }

    // 同步媒體
    if (data.currentMedia) {
      this.manager.displayMedia(data.currentMedia);
    }

    this.manager.ui.updateExperimentUI();
  }

  /**
   * 套用遠端實驗狀態
   */
  applyRemoteExperimentState(data) {
    const handlers = {
      experimentInitialize: () => this.handleRemoteExperimentInit(data),
      button_action: () =>
        this.manager.syncRole === window.SyncManager?.ROLE?.VIEWER &&
        this.handleRemoteButtonAction(data),
      subjectNameUpdate: () => this.handleRemoteSubjectNameUpdate(data),
      experimentIdUpdate: () => this.handleRemoteExperimentIdUpdate(data),
      experimentPaused: () => this.handleRemoteExperimentPaused(data),
      experimentResumed: () => this.handleRemoteExperimentResumed(data),
      experimentStopped: () => this.handleRemoteExperimentStopped(data)
    };

    handlers[data.type]?.();
  }

  /**
   * 處理遠端實驗初始化
   */
  handleRemoteExperimentInit(data) {
    this.manager.setExperimentId(data.experimentId, "sync_init");
    this.manager.currentExperimentId = data.experimentId;
    this.manager.currentCombination = data.currentCombination;
    this.manager.loadedUnits = data.loadedUnits || [];
    this.manager.isExperimentRunning = data.isExperimentRunning;

    // 處理受試者名稱
    if (data.subjectName) {
      const subjectNameInput =
        this.manager.getCachedElement("subjectNameInput");
      if (subjectNameInput) {
        subjectNameInput.value = data.subjectName;
      }
    }

    this.manager.updateExperimentIdDisplay();
    this.manager.ui.updateExperimentUI();
  }

  /**
   * 處理遠端按鈕動作
   */
  handleRemoteButtonAction(data) {
    if (!data.buttonData) return;

    // 模擬按鈕被按下
    if (data.buttonData.button) {
      window.dispatchEvent(
        new CustomEvent("remoteButtonPressed", {
          detail: {
            button: data.buttonData.button,
            experimentId: data.experimentId
          }
        })
      );
    }
  }

  /**
   * 處理遠端受試者名稱更新
   */
  handleRemoteSubjectNameUpdate(data) {
    try {
      // 如果目前實驗正在進行中，等待實驗結束後再同步新的受試者名稱
      if (this.manager.isExperimentRunning) {
        Logger.debug(
          "目前實驗正在進行中，等待結束後再同步新的受試者名稱:",
          data.subjectName || data.subject_name
        );
        // 將更新請求加入佇列，等待實驗結束
        this.manager.pendingSubjectNameUpdate = data;
        this.showPendingUpdateIndicator("subjectName");
        return;
      }

      this.manager.applySubjectNameUpdate(data);
    } catch (error) {
      Logger.error("套用遠端受試者名稱更新時發生錯誤:", error);
    }
  }

  /**
   * 套用實驗ID更新
   */
  applyExperimentIdUpdate(data) {
    const experimentId = data.experimentId || data.experiment_id || "";
    const experimentIdInput =
      this.manager.getCachedElement("experimentIdInput");

    if (experimentIdInput) {
      this.manager.setExperimentId(experimentId, "sync_update");
      experimentIdInput.value = experimentId;
      this.manager.currentExperimentId = experimentId;
      this.manager.updateExperimentIdDisplay();
      this.hidePendingUpdateIndicator("experimentId");
    }
  }

  /**
   * 套用受試者名稱更新
   */
  applySubjectNameUpdate(data) {
    const subjectName = data.subjectName || data.subject_name || "";
    const subjectNameInput = this.manager.getCachedElement("subjectNameInput");

    if (subjectNameInput) {
      subjectNameInput.value = subjectName;
      this.hidePendingUpdateIndicator("subjectName");
    }
  }

  /**
   * 處理遠端實驗ID更新
   */
  handleRemoteExperimentIdUpdate(data) {
    try {
      Logger.debug(
        `開始處理遠端實驗ID更新: ${
          data?.experimentId
        } (來源: ${data?.source || "unknown"})`
      );
      Logger.debug("收到遠端實驗ID更新事件詳情:", data);

      // 如果目前實驗正在進行中，等待實驗結束後再同步新的實驗ID
      if (this.manager.isExperimentRunning) {
        Logger.debug("實驗進行中，將ID更新請求加入佇列");
        // 將更新請求加入佇列，等待實驗結束
        this.manager.pendingExperimentIdUpdate = data;
        this.showPendingUpdateIndicator("experimentId");
        return;
      }

      this.manager.applyExperimentIdUpdate(data);
    } catch (error) {
      Logger.error("套用遠端實驗ID更新時發生錯誤:", error);
    }
  }

  /**
   * 處理遠端組合選擇
   */
  handleRemoteCombinationSelected(data) {
    try {
      Logger.debug(
        `收到遠端組合選擇: ${data?.combination?.combination_name || "unknown"}`
      );

      // 如果目前實驗正在進行中，等待實驗結束後再同步組合
      if (this.manager.isExperimentRunning) {
        Logger.debug("實驗進行中，將組合更新請求加入佇列");
        this.manager.pendingCombinationUpdate = {
          combination: data.combination,
          device_id: data.device_id,
          timestamp: data.timestamp
        };
        this.manager.showPendingUpdateIndicator("combination");
        return;
      }

      // 應用遠端組合選擇
      this.manager.applyCombinationSelection(data.combination);
    } catch (error) {
      Logger.error("套用遠端組合選擇時發生錯誤:", error);
    }
  }

  /**
   * 廣播實驗初始化
   */
  broadcastExperimentInitialization() {
    const subjectNameInput = this.manager.getCachedElement("subjectNameInput");
    const subjectName = subjectNameInput ? subjectNameInput.value.trim() : "";

    const initData = {
      type: "experimentInitialize",
      experimentId: this.manager.getCurrentExperimentId(),
      currentCombination: this.manager.currentCombination,
      loadedUnits: this.manager.loadedUnits,
      subjectName: subjectName,
      isExperimentRunning: true,
      timestamp: Date.now()
    };

    Logger.debug(
      "廣播實驗初始化 - loadedUnits 數量:",
      this.manager.loadedUnits.length,
      "ID:",
      this.manager.getCurrentExperimentId()
    );
    Logger.debug("   詳細資料:", initData);

    //本機事件（用於本頁面內部通訊）
    document.dispatchEvent(
      new CustomEvent("experimentStateChange", {
        detail: initData
      })
    );

    //透過同步系統發送到其他裝置（experiment.html）
    const syncInitData = {
      type: "experimentInitialize",
      source: window.SyncManager?.PAGE?.PANEL,
      device_id: this.manager.clientId,
      experimentId: this.manager.getCurrentExperimentId(),
      currentCombination: this.manager.currentCombination,
      loadedUnits: this.manager.loadedUnits,
      subjectName: subjectName,
      isExperimentRunning: true,
      timestamp: new Date().toISOString()
    };

    Logger.debug("透過同步系統廣播實驗初始化到其他裝置");

    if (this.manager.syncState) {
      this.manager.syncState(syncInitData).catch((error) => {
        Logger.warn("同步實驗初始化失敗:", error);
      });

      //同時發送 experiment_started 事件給 viewer
      const experimentStartedData = {
        type: "experiment_started",
        source: "panel",
        device_id: this.manager.clientId,
        experiment_id: this.manager.getCurrentExperimentId(),
        subject_name: subjectName,
        combination_id: this.manager.currentCombination?.combination_id || null,
        combination_name:
          this.manager.currentCombination?.combination_name || "未知組合",
        gesture_sequence: this.manager.currentCombination?.gestures || [],
        unit_count: this.manager.loadedUnits?.length || 0,
        gesture_count: this.manager.currentCombination?.gestures?.length || 0,
        timestamp: new Date().toISOString()
      };

      Logger.debug("  正在發送 experiment_started 事件給 viewer");
      Logger.debug("   實驗資料:", {
        experimentId: experimentStartedData.experimentId,
        subjectName: experimentStartedData.subjectName,
        combinationName: experimentStartedData.combinationName,
        gestureCount: experimentStartedData.gestureCount,
        hasCurrentCombination: !!this.manager.currentCombination,
        hasGestures: !!this.manager.currentCombination?.gestures,
        gesturesLength: this.manager.currentCombination?.gestures?.length || 0
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

  /**
   * 廣播按鈕動作 - 實驗進行中推播按下的按鈕
   */
  broadcastButtonAction(buttonData) {
    // 取得本機裝置 ID
    let deviceId = null;
    if (window.syncClient) {
      deviceId = window.syncClient.clientId;
    }

    const actionData = {
      type: "button_action",
      experimentId: this.manager.getCurrentExperimentId(),
      action_id: buttonData.action_id, // 傳遞 action_id 給實驗頁面
      buttonData: buttonData,
      timestamp: new Date().toISOString(),
      device_id: deviceId
    };

    document.dispatchEvent(
      new CustomEvent("experimentStateChange", {
        detail: actionData
      })
    );

    // 透過同步系統發送到遠端裝置
    if (this.manager.syncState) {
      this.manager.syncState(actionData).catch((error) => {
        Logger.warn("同步按鈕動作失敗:", error);
      });
    }
  }

  /**
   * 廣播暫停狀態到其他裝置
   */
  broadcastExperimentPaused() {
    const syncPauseData = {
      type: "experiment_paused",
      source: "panel",
      device_id: this.manager.clientId,
      experimentId: this.manager.getCurrentExperimentId(),
      isPaused: true,
      timestamp: new Date().toISOString()
    };

    if (this.manager.syncState) {
      this.manager.syncState(syncPauseData).catch((error) => {
        Logger.warn("同步暫停狀態失敗:", error);
      });
    }
  }

  /**
   * 廣播還原狀態到其他裝置
   */
  broadcastExperimentResumed() {
    const syncResumeData = {
      type: "experiment_resumed",
      source: "panel",
      device_id: this.manager.clientId,
      experimentId: this.manager.getCurrentExperimentId(),
      isPaused: false,
      timestamp: new Date().toISOString()
    };

    if (this.manager.syncState) {
      this.manager.syncState(syncResumeData).catch((error) => {
        Logger.warn("同步還原狀態失敗:", error);
      });
    }
  }

  /**
   * 廣播停止狀態到其他裝置
   */
  broadcastExperimentStopped() {
    const syncStopData = {
      type: "experiment_stopped",
      source: "panel",
      device_id:
        window.syncManager?.core?.syncClient?.clientId || "panel_device",
      experimentId: this.manager.getCurrentExperimentId(),
      timestamp: new Date().toISOString()
    };

    if (this.manager.syncState) {
      this.manager.syncState(syncStopData).catch((error) => {
        Logger.warn("同步停止狀態失敗:", error);
      });
    }
  }

  /**
   * 從中樞取得目前工作階段的狀態
   */
  async getHubState(sessionId) {
    try {
      if (!window.syncManager?.core?.syncClient?.getState) {
        Logger.warn("SyncClient 未初始化");
        return null;
      }

      const state =
        await window.syncManager.core.syncClient.getState(sessionId);
      Logger.debug("取得中樞狀態:", state);
      return state;
    } catch (error) {
      Logger.error("讀取中樞狀態失敗:", error);
      return null;
    }
  }

  /**
   * 廣播實驗ID更新到其他裝置
   */
  async broadcastExperimentIdUpdate(experimentId) {
    try {
      Logger.debug(`開始廣播實驗ID更新: ${experimentId}`);

      const syncIdData = {
        type: "experimentIdUpdate",
        source: "panel",
        device_id:
          window.syncManager?.core?.syncClient?.clientId || "panel_device",
        experimentId: experimentId,
        timestamp: new Date().toISOString()
      };

      Logger.debug("廣播資料:", syncIdData);

      if (window.syncManager?.core?.syncState) {
        try {
          const result = await window.syncManager.core.syncState(syncIdData);
          Logger.info(`實驗ID廣播成功: ${experimentId} (結果: ${result})`);
        } catch (error) {
          Logger.warn(`同步實驗ID更新失敗: ${error.message}`);
        }
      } else {
        Logger.warn("window.syncManager.core.syncState 不存在，本機模式");
      }
    } catch (error) {
      Logger.error(`廣播實驗ID更新時發生錯誤: ${error.message}`, error);
    }
  }

  /**
   * 廣播實驗狀態更新
   */
  broadcastExperimentStateUpdate() {
    const detail = {
      experimentId: this.manager.getCurrentExperimentId(),
      currentUnitIndex: this.manager.currentUnitIndex,
      currentStepIndex: this.manager.currentStepIndex,
      experimentRunning: this.manager.isExperimentRunning,
      experimentPaused: this.manager.timer.isPaused(),
      totalUnits: this.manager.loadedUnits.length,
      currentUnitId:
        this.manager.loadedUnits[this.manager.currentUnitIndex] || null,
      timestamp: Date.now()
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
      data: detail
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
  }

  /**
   * 處理遠端實驗暫停
   */
  handleRemoteExperimentPaused(data) {
    const pauseIndicator = this.manager.getCachedElement("pauseIndicator");
    if (pauseIndicator) {
      pauseIndicator.style.display = "block";
      pauseIndicator.textContent = "⏸ 暫停中";
    }
  }

  /**
   * 處理遠端實驗還原
   */
  handleRemoteExperimentResumed(data) {
    const pauseIndicator = this.manager.getCachedElement("pauseIndicator");
    if (pauseIndicator) {
      pauseIndicator.style.display = "none";
    }
  }

  /**
   * 處理遠端組合選擇
   */
  handleRemoteCombinationSelected(data) {
    try {
      Logger.debug(
        `收到遠端組合選擇: ${data?.combination?.combination_name || "unknown"}`
      );

      // 如果目前實驗正在進行中，等待實驗結束後再同步組合
      if (this.manager.isExperimentRunning) {
        Logger.debug("實驗進行中，將組合更新請求加入佇列");
        this.manager.pendingCombinationUpdate = {
          combination: data.combination,
          device_id: data.device_id,
          timestamp: data.timestamp
        };
        this.showPendingUpdateIndicator("combination");
        return;
      }

      // 應用遠端組合選擇
      this.applyCombinationSelection(data.combination);
    } catch (error) {
      Logger.error("套用遠端組合選擇時發生錯誤:", error);
    }
  }

  /**
   * 應用遠端組合選擇
   */
  applyCombinationSelection(combination) {
    try {
      if (!combination) return;

      Logger.debug(`應用組合選擇: ${combination.combination_name}`);

      // 更新組合選擇器的內部狀態
      if (window.combinationSelector) {
        window.combinationSelector.currentCombination = combination;

        // 更新 UI 顯示（組合卡片選中狀態）
        window.combinationSelector.updateCombinationCardSelection(combination);

        // 更新單元列表以反映組合內容
        window.combinationSelector.updateUnitListForCombination(combination);
      }

      // 記錄日誌
      this.manager.logAction("remote_combination_selected", {
        combination_name: combination.combination_name,
        combination_id: combination.combination_id,
        timestamp: new Date().toISOString()
      });

      Logger.debug("遠端組合選擇已套用");
    } catch (error) {
      Logger.error("應用遠端組合選擇失敗:", error);
    }
  }

  /**
   * 顯示待處理更新指示器
   */
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

  /**
   * 隱藏待處理更新指示器
   */
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

  /**
   * 處理遠端手勢步驟完成
   */
  handleRemoteGestureStepCompleted(data) {
    try {
      const { step_index, gesture_name, timer_value } = data;
      Logger.debug(
        `遠端手勢步驟完成: 步驟${step_index} - ${gesture_name} (${timer_value})`
      );

      // 在控制面板上顯示遠端進度
      const progressDisplay = this.manager.getCachedElement(
        "remoteProgressDisplay"
      );
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

  /**
   * 處理遠端動作按鈕點擊
   */
  handleRemoteActionButtonClicked(data) {
    try {
      const { action_id, gesture_index } = data;
      Logger.debug(`遠端動作按鈕點擊: ${action_id} (手勢索引${gesture_index})`);

      // 在控制面板上顯示遠端動作回饋
      const actionDisplay = this.manager.getCachedElement(
        "remoteActionDisplay"
      );
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

  /**
   * 應用遠端組合選擇
   */
  applyCombinationSelection(combination) {
    try {
      if (!combination) return;

      Logger.debug(`應用組合選擇: ${combination.combination_name}`);

      // 更新組合選擇器的內部狀態
      if (window.combinationSelector) {
        window.combinationSelector.currentCombination = combination;

        // 更新 UI 顯示（組合卡片選中狀態）
        window.combinationSelector.updateCombinationCardSelection(combination);

        // 更新單元列表以反映組合內容
        window.combinationSelector.updateUnitListForCombination(combination);
      }

      // 記錄日誌
      this.manager.logAction("remote_combination_selected", {
        combination_name: combination.combination_name,
        combination_id: combination.combination_id,
        timestamp: new Date().toISOString()
      });

      Logger.debug("遠端組合選擇已套用");
    } catch (error) {
      Logger.error("應用遠端組合選擇失敗:", error);
    }
  }

  /**
   * 處理遠端按鈕動作
   */
  handleRemoteButtonAction(data) {
    if (!data.buttonData) return;

    // 模擬按鈕被按下
    if (data.buttonData.button) {
      window.dispatchEvent(
        new CustomEvent("remoteButtonPressed", {
          detail: {
            button: data.buttonData.button,
            experimentId: data.experimentId
          }
        })
      );
    }
  }

  /**
   * 處理遠端實驗開始事件
   */
  handleRemoteExperimentStarted(data) {
    try {
      Logger.debug("收到遠端實驗開始事件，即將關閉面板", data);

      // 遠端開始實驗時，關閉面板以便操作者專注於實驗進行
      // 延遲 500ms 以確保所有事件都已處理完畢
      setTimeout(() => {
        this.manager.closeExperimentPanel();
        if (window.logger) {
          window.logger.logAction("遠端實驗開始_面板自動關閉");
        }
      }, 500);
    } catch (error) {
      Logger.error("處理遠端實驗開始事件時發生錯誤:", error);
    }
  }
}

// 匯出同步管理器類別（實例化時需要傳入manager）
window.PanelExperimentSync = PanelExperimentSync;
