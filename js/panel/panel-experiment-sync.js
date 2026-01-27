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
   * 處理實驗進行中時的遠端更新請求
   * @param {string} updateType - 更新類型 ('participantName', 'experimentId', 'combination')
   * @param {Object} data - 更新資料
   * @param {Function} applyCallback - 套用更新的回調函數
   */
  handleRemoteUpdateDuringExperiment(updateType, data, applyCallback) {
    if (this.manager.isExperimentRunning) {
      Logger.debug(`實驗進行中，將${updateType}更新請求加入佇列`);
      this.manager[
        `pending${updateType.charAt(0).toUpperCase() + updateType.slice(1)}Update`
      ] = data;
      this.showPendingUpdateIndicator(updateType);
      return true;
    }

    applyCallback(data);
    return false;
  }

  /**
   * 發送同步狀態到遠端裝置
   * @param {Object} data - 要同步的資料
   * @param {string} errorMessage - 錯誤時的訊息
   */
  syncStateToRemote(data, errorMessage = "同步失敗") {
    if (window.syncManager?.core?.syncState) {
      window.syncManager.core.syncState(data).catch((error) => {
        Logger.warn(`${errorMessage}:`, error);
      });
    }
  }

  /**
   * 處理同步實驗狀態
   */
  handleSyncExperimentState(data) {
    if (this.manager.isViewerMode) return;

    Object.assign(this.manager, {
      isExperimentRunning:
        data.isExperimentRunning ?? this.manager.isExperimentRunning,
      currentUnitIndex: data.currentUnitIndex ?? this.manager.currentUnitIndex,
      currentStepIndex: data.currentStepIndex ?? this.manager.currentStepIndex,
    });

    if (data.experimentPaused !== undefined) {
      this.manager.timer.setPaused(data.experimentPaused);
    }

    if (data.currentExperimentId) {
      this.manager.setExperimentId(data.currentExperimentId, "sync");
      this.manager.currentExperimentId = data.currentExperimentId;
      this.manager.updateExperimentIdDisplay();
    }

    if (data.currentCombination) {
      this.manager.currentCombination = data.currentCombination;
      this.manager.loadedUnits = data.loadedUnits || [];
    }

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
      participantNameUpdate: () => this.handleRemoteParticipantNameUpdate(data),
      experimentIdUpdate: () => this.handleRemoteExperimentIdUpdate(data),
      experimentPaused: () => this.handleRemoteExperimentPaused(data),
      experimentResumed: () => this.handleRemoteExperimentResumed(data),
      experimentStopped: () => this.handleRemoteExperimentStopped(data),
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

    if (data.participantName) {
      const participantNameInput = this.manager.getCachedElement(
        "participantNameInput",
      );
      if (participantNameInput) {
        participantNameInput.value = data.participantName;
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

    if (data.buttonData.button) {
      window.dispatchEvent(
        new CustomEvent("remote_button_pressed", {
          detail: {
            button: data.buttonData.button,
            experimentId: data.experimentId,
          },
        }),
      );
    }
  }

  /**
   * 處理遠端受試者名稱更新
   */
  handleRemoteParticipantNameUpdate(data) {
    try {
      const wasQueued = this.handleRemoteUpdateDuringExperiment(
        "participantName",
        data,
        (updateData) => this.manager.applyParticipantNameUpdate(updateData),
      );

      if (!wasQueued) {
        Logger.debug(
          "直接套用遠端受試者名稱更新:",
          data.participantName || data.participant_name,
        );
      }
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
  applyParticipantNameUpdate(data) {
    const participantName = data.participantName || data.participant_name || "";
    const participantNameInput = this.manager.getCachedElement(
      "participantNameInput",
    );

    if (participantNameInput) {
      participantNameInput.value = participantName;
      this.hidePendingUpdateIndicator("participantName");
    }
  }

  /**
   * 處理遠端實驗ID更新
   */
  handleRemoteExperimentIdUpdate(data) {
    try {
      Logger.debug(
        `開始處理遠端實驗ID更新: ${data?.experimentId} (來源: ${data?.source || "unknown"})`,
      );

      const wasQueued = this.handleRemoteUpdateDuringExperiment(
        "experimentId",
        data,
        (updateData) => this.manager.applyExperimentIdUpdate(updateData),
      );

      if (!wasQueued) {
        Logger.debug("直接套用遠端實驗ID更新");
      }
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
        `收到遠端組合選擇: ${data?.combination?.combination_name || "unknown"}`,
      );

      const wasQueued = this.handleRemoteUpdateDuringExperiment(
        "combination",
        {
          combination: data.combination,
          clientId: data.clientId,
          timestamp: data.timestamp,
        },
        (updateData) =>
          this.manager.applyCombinationSelection(updateData.combination),
      );

      if (!wasQueued) {
        Logger.debug("直接套用遠端組合選擇");
      }
    } catch (error) {
      Logger.error("套用遠端組合選擇時發生錯誤:", error);
    }
  }

  /**
   * 廣播實驗初始化
   */
  broadcastExperimentInitialization() {
    const participantNameInput = this.manager.getCachedElement(
      "participantNameInput",
    );
    const participantName = participantNameInput
      ? participantNameInput.value.trim()
      : "";

    const baseInitData = {
      experimentId: this.manager.getCurrentExperimentId(),
      currentCombination: this.manager.currentCombination,
      loadedUnits: this.manager.loadedUnits,
      participantName: participantName,
      isExperimentRunning: true,
    };

    Logger.debug(
      `廣播實驗初始化 - 單元數量: ${this.manager.loadedUnits.length}, ID: ${baseInitData.experimentId}`,
    );

    // 本機事件（用於本頁面內部通訊）
    document.dispatchEvent(
      new CustomEvent("experimentStateChange", {
        detail: {
          type: window.SyncDataTypes.EXPERIMENT_INITIALIZE,
          timestamp: Date.now(),
          ...baseInitData,
        },
      }),
    );

    // 透過同步系統發送到其他裝置
    const syncInitData = {
      type: window.SyncDataTypes.EXPERIMENT_INITIALIZE,
      source: window.SyncManager?.PAGE?.PANEL,
      clientId: this.manager.clientId,
      timestamp: new Date().toISOString(),
      ...baseInitData,
    };

    if (this.manager.syncState) {
      this.manager.syncState(syncInitData).catch((error) => {
        Logger.warn("同步實驗初始化失敗:", error);
      });

      // 同時發送 experiment_started 事件給 viewer
      const experimentStartedData = {
        type: window.SyncDataTypes.EXPERIMENT_STARTED,
        source: "panel",
        clientId: this.manager.clientId,
        experimentId: baseInitData.experimentId,
        participantName: participantName,
        combinationId: this.manager.currentCombination?.combination_id || null,
        combinationName:
          this.manager.currentCombination?.combination_name || "未知組合",
        gestureSequence: this.manager.currentCombination?.gestures || [],
        unitCount: this.manager.loadedUnits?.length || 0,
        gestureCount: this.manager.currentCombination?.gestures?.length || 0,
        timestamp: new Date().toISOString(),
      };

      Logger.debug("發送 experiment_started 事件給 viewer");
      window.syncManager.core
        .syncState(experimentStartedData)
        .catch((error) => {
          Logger.warn("同步 experiment_started 失敗:", error);
        });
    } else {
      Logger.warn("同步系統不可用");
    }
  }

  /**
   * 廣播按鈕按下事件 - 通知其他裝置按下了哪個按鈕
   */
  broadcastButtonPressed(buttonData) {
    const clientId = window.syncClient?.clientId || null;

    const buttonEvent = {
      type: window.SyncDataTypes.BUTTON_PRESSED,
      experimentId: this.manager.getCurrentExperimentId(),
      actionId: buttonData.actionId,
      button: buttonData.button_id || buttonData.button,
      timestamp: Date.now(),
      clientId: clientId,
    };

    // 透過同步系統發送到遠端裝置
    if (this.manager.syncState) {
      this.manager.syncState(buttonEvent).catch((error) => {
        Logger.warn("同步按鈕按下事件失敗:", error);
      });
    }
  }

  /**
   * 廣播暫停狀態到其他裝置
   */
  broadcastExperimentPaused() {
    const syncPauseData = {
      type: window.SyncDataTypes.EXPERIMENT_PAUSED,
      source: "panel",
      clientId: this.manager.clientId,
      experimentId: this.manager.getCurrentExperimentId(),
      isPaused: true,
      timestamp: new Date().toISOString(),
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
      type: window.SyncDataTypes.EXPERIMENT_RESUMED,
      source: "panel",
      clientId: this.manager.clientId,
      experimentId: this.manager.getCurrentExperimentId(),
      isPaused: false,
      timestamp: new Date().toISOString(),
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
      type: window.SyncDataTypes.EXPERIMENT_STOPPED,
      source: "panel",
      clientId:
        window.syncManager?.core?.syncClient?.clientId || "panel_device",
      experimentId: this.manager.getCurrentExperimentId(),
      timestamp: new Date().toISOString(),
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
        type: window.SyncDataTypes.EXPERIMENT_ID_UPDATE,
        source: "panel",
        clientId:
          window.syncManager?.core?.syncClient?.clientId || "panel_device",
        experimentId: experimentId,
        timestamp: new Date().toISOString(),
      };

      Logger.debug("廣播資料:", syncIdData);

      this.syncStateToRemote(syncIdData, "同步實驗ID更新失敗");
    } catch (error) {
      Logger.error(`廣播實驗ID更新時發生錯誤: ${error.message}`, error);
    }
  }

  handleRemoteExperimentPaused(data) {
    const pauseIndicator = this.manager.getCachedElement("pauseIndicator");
    if (pauseIndicator) {
      pauseIndicator.style.display = "block";
      pauseIndicator.textContent = "⏸ 暫停中";
    }
  }

  handleRemoteExperimentResumed(data) {
    const pauseIndicator = this.manager.getCachedElement("pauseIndicator");
    if (pauseIndicator) {
      pauseIndicator.style.display = "none";
    }
  }

  handleRemoteExperimentStopped(data) {
    // 使用統一的日誌導出函數（來自 PanelExperimentFlow）
    if (this.manager?.flow?.exportExperimentLog) {
      this.manager.flow.exportExperimentLog("remote");
    }
  }

  /**
   * 套用遠端組合選擇
   */
  applyCombinationSelection(combination) {
    if (!combination) return;

    Logger.debug(`套用組合選擇: ${combination.combination_name}`);

    if (window.combinationSelector) {
      window.combinationSelector.currentCombination = combination;
      window.combinationSelector.updateCombinationCardSelection(combination);
      window.combinationSelector.updateUnitListForCombination(combination);
    }

    this.manager.logAction("remote_combination_selected", {
      combination_name: combination.combination_name,
      combination_id: combination.combination_id,
      timestamp: new Date().toISOString(),
    });

    Logger.debug("遠端組合選擇已套用");
  }

  showPendingUpdateIndicator(type) {
    const inputId =
      type === "experimentId" ? "experimentIdInput" : "participantName";
    const input = document.getElementById(inputId);
    if (input) {
      input.classList.add("pending-update");
      input.title = input.title
        ? input.title + " (有待同步更新)"
        : "有待同步更新";
    }
  }

  hidePendingUpdateIndicator(type) {
    const inputId =
      type === "experimentId" ? "experimentIdInput" : "participantName";
    const input = document.getElementById(inputId);
    if (input) {
      input.classList.remove("pending-update");
      input.title = input.title
        ? input.title.replace(" (有待同步更新)", "")
        : "";
    }
  }

  /**
   * 觸發實驗狀態變化事件（用於多客戶端同步）
   */
  dispatchExperimentStateChanged() {
    const stateData = {
      type: "experimentStateChanged",
      isExperimentRunning: this.manager.isExperimentRunning,
      currentStepIndex: this.manager.currentStepIndex,
      currentUnitIndex: this.manager.currentUnitIndex,
      currentExperimentId: this.manager.currentExperimentId,
      currentCombination: this.manager.currentCombination,
    };
    this.syncStateToRemote(stateData, "同步實驗狀態變化失敗");
  }
}

// 匯出同步管理器類別（實例化時需要傳入manager）
window.PanelExperimentSync = PanelExperimentSync;
