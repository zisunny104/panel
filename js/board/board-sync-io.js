/**
 * BoardSyncIO - board 端同步收發控制
 *
 * 集中處理同步訊息接收（receive*）與送出（send*），
 * 讓 page manager 專注在頁面協調。
 */

import { RECORD_SOURCES, SYNC_EVENTS, SYNC_DATA_TYPES } from "../constants/index.js";
import { dispatchSessionRestoreEvents } from "../core/session-restore-events.js";

class BoardSyncIO {
  constructor(pageManager) {
    this.pageManager = pageManager;
    this._started = false;
  }

  startReceive() {
    if (this._started) return;
    this._started = true;

    document.addEventListener(
      SYNC_EVENTS.EXPERIMENT_STATE_CHANGE_LOCAL,
      (event) => {
        const data = event.detail;
        if (!data || !data.type) return;

        switch (data.type) {
          case SYNC_DATA_TYPES.EXPERIMENT_INITIALIZE:
            this.receiveExperimentInit(data);
            break;
          case SYNC_DATA_TYPES.EXPERIMENT_ID_UPDATE:
            this.receiveExperimentIdUpdate(data);
            break;
          case SYNC_DATA_TYPES.PARTICIPANT_NAME_UPDATE:
            break;
          default:
            Logger.warn("未知的遠端事件類型:", data.type);
        }
      },
    );

    window.addEventListener(SYNC_EVENTS.SESSION_STATE, (event) => {
      dispatchSessionRestoreEvents(event.detail, { includePowerState: false });
    });

    window.addEventListener(SYNC_EVENTS.STATE_UPDATE, (event) => {
      const page = this.pageManager;
      const state = event.detail;
      if (!state) return;

      const myId = page.syncManager?.core?.syncClient?.clientId;
      if (myId && state.clientId === myId && !state._sessionRestore) return;

      if (state.type === SYNC_DATA_TYPES.EXPERIMENT_INITIALIZE) {
        this.receiveExperimentInit(state);
      } else if (state.type === SYNC_DATA_TYPES.BUTTON_ACTION) {
        this.receiveButtonAction(state);
      } else if (state.type === SYNC_DATA_TYPES.ACTION_COMPLETED) {
        this.receiveActionCompleted(state);
      } else if (state.type === SYNC_DATA_TYPES.ACTION_CANCELLED) {
        this.receiveActionCancelled(state);
      } else if (state.type === SYNC_DATA_TYPES.EXPERIMENT_ID_UPDATE) {
        this.receiveExperimentIdUpdate(state);
      } else if (state.type === SYNC_DATA_TYPES.PARTICIPANT_NAME_UPDATE) {
        this.receiveParticipantNameUpdate(state);
      }
    });

    window.addEventListener(SYNC_EVENTS.STATE_BROADCAST, (event) => {
      const detail = event.detail;
      if (!detail?.type) return;

      if (detail.type === SYNC_DATA_TYPES.EXPERIMENT_STARTED) {
        this.receiveExperimentStarted(detail);
      } else if (detail.type === SYNC_DATA_TYPES.EXPERIMENT_PAUSED) {
        this.receiveExperimentPaused(detail);
      } else if (detail.type === SYNC_DATA_TYPES.EXPERIMENT_RESUMED) {
        this.receiveExperimentResumed(detail);
      } else if (detail.type === SYNC_DATA_TYPES.EXPERIMENT_STOPPED) {
        this.receiveExperimentStopped(detail);
      }
    });

    window.addEventListener("experiment_id_broadcasted", (event) => {
      const { experimentId, client_id } = event.detail;
      const page = this.pageManager;
      const hubManager = page.experimentHubManager;

      if (client_id === hubManager.getClientId()) {
        return;
      }

      Logger.debug(`收到遠程實驗ID廣播: ${experimentId}`);

      const experimentIdInput = document.getElementById("experimentIdInput");
      if (experimentIdInput && experimentIdInput.value !== experimentId) {
        experimentIdInput.value = experimentId;
        Logger.info(`已同步實驗ID到UI: ${experimentId}`);
      }
    });
  }

  receiveActionCompleted(syncData) {
    const page = this.pageManager;
    const {
      actionId,
      source,
      clientId,
      timestamp,
      gestureIndex,
      experimentId,
    } = syncData;

    const currentExperimentId =
      document.getElementById("experimentIdInput")?.value?.trim() ||
      page.experimentId ||
      "";

    if (!page.experimentRunning) {
      Logger.debug("忽略遠端 ACTION_COMPLETED：實驗尚未開始", {
        actionId,
        experimentId,
        timestamp,
      });
      return;
    }

    if (experimentId && currentExperimentId && experimentId !== currentExperimentId) {
      Logger.debug("忽略遠端 ACTION_COMPLETED：experimentId 不一致", {
        actionId,
        remoteExperimentId: experimentId,
        currentExperimentId,
      });
      return;
    }

    const ts =
      typeof timestamp === "number"
        ? timestamp
        : typeof timestamp === "string"
          ? Date.parse(timestamp)
          : NaN;
    if (
      Number.isFinite(ts) &&
      page.experimentStartedAt > 0 &&
      ts < page.experimentStartedAt - 2000
    ) {
      Logger.debug("忽略過舊的遠端 ACTION_COMPLETED", {
        actionId,
        timestamp,
        experimentStartedAt: page.experimentStartedAt,
      });
      return;
    }

    page.logAction("sync_action_completed", {
      actionId: actionId,
      source: source,
      clientId: clientId,
      timestamp: timestamp,
    });

    const actionButton = document.querySelector(
      `.gesture-action-button[data-action-id="${actionId}"]`,
    );
    if (actionButton) {
      page._markActionCompleted(actionButton, actionId, gestureIndex, true);

      const resolvedGestureIndex =
        gestureIndex ?? actionButton.getAttribute("data-gesture-index");
      if (resolvedGestureIndex !== null && resolvedGestureIndex !== undefined) {
        const idx = parseInt(resolvedGestureIndex, 10);
        if (!Number.isNaN(idx)) {
          page.gestureUtils?.activateGestureStep(idx);
        }
      }

      actionButton.classList.add("sync-action-completed");
      setTimeout(() => {
        actionButton.classList.remove("sync-action-completed");
      }, 2000);
    }
  }

  receiveActionCancelled(syncData) {
    const page = this.pageManager;
    const { actionId, clientId, timestamp, gestureIndex } = syncData;

    page.logAction("sync_action_cancelled", {
      actionId: actionId,
      clientId: clientId,
      timestamp: timestamp,
    });

    const actionButton = document.querySelector(
      `.gesture-action-button[data-action-id="${actionId}"]`,
    );
    if (actionButton) {
      page._cancelActionCompletion(actionButton, actionId, gestureIndex);
    }
  }

  receiveButtonAction(data) {
    const page = this.pageManager;
    const {
      experimentId,
      button,
      actionId,
      function: buttonFunction,
      clientId,
    } = data;

    const currentExperimentId =
      document.getElementById("experimentIdInput")?.value || "";

    if (actionId) {
      const now = Date.now();
      const lastProcessTime = page.processedRemoteActions.get(actionId);

      if (
        lastProcessTime &&
        now - lastProcessTime < page.remoteActionDedupeWindow
      ) {
        return;
      }

      page.processedRemoteActions.set(actionId, now);
    }

    if (page.recordManager) {
      page.recordManager.logButtonAction(
        button,
        buttonFunction,
        clientId,
        actionId,
      );
    }

    if (experimentId === currentExperimentId && page.experimentRunning) {
      // action 完成標記由 ACTION_COMPLETED 事件驅動
    }
  }

  receiveExperimentInit(data) {
    const page = this.pageManager;
    const { experimentId, currentCombination, participantName, loadedUnits } = data;

    if (experimentId) {
      page.experimentId = experimentId;
      Logger.info(`從機台面板同步的實驗ID: ${experimentId}`);

      const experimentIdInput = document.getElementById("experimentIdInput");
      if (
        experimentIdInput &&
        experimentIdInput.value.trim() !== experimentId
      ) {
        experimentIdInput.value = experimentId;
      }
    }

    if (participantName) {
      const participantNameInput = document.getElementById("participantNameInput");
      if (participantNameInput && participantNameInput.value.trim() !== participantName) {
        participantNameInput.value = participantName;
        page.participantName = participantName;
        page.lastSavedParticipantName = participantName;
      }
    }

    if (currentCombination) {
      if (page.experimentRunning) {
        Logger.debug("實驗進行中，將組合更新請求加入佇列");
        page.pendingCombinationUpdate = { currentCombination, loadedUnits };
        return;
      }

      page.currentCombination = currentCombination;
      if (loadedUnits) {
        page.loadedUnits = loadedUnits;
      }
    }

    if (!page.experimentRunning) {
      if (currentCombination && !page.pendingCombinationUpdate) {
        page.currentCombination = currentCombination;
      }
      if (loadedUnits && !page.pendingCombinationUpdate) {
        page.loadedUnits = loadedUnits;
      }

      page.startExperiment();
    }
  }

  receiveParticipantNameUpdate(data) {
    const page = this.pageManager;
    if (page.experimentRunning) {
      page.pendingParticipantNameUpdate = data;
      return;
    }

    const { participantName } = data;

    const participantNameInput = document.getElementById("participantNameInput");
    if (participantNameInput && participantNameInput.value.trim() !== participantName) {
      participantNameInput.value = participantName;
      page.participantName = participantName;
      page.lastSavedParticipantName = participantName;
    }
  }

  receiveExperimentIdUpdate(data) {
    const page = this.pageManager;
    if (page.experimentRunning) {
      page.pendingExperimentIdUpdate = data;
      Logger.debug(
        `實驗進行中，等待實驗結束後套用ID更新: ${data.experimentId}`,
      );
      return;
    }

    const { experimentId } = data;
    Logger.debug(`套用遠端實驗ID更新: ${experimentId}`);

    const experimentIdInput = document.getElementById("experimentIdInput");
    if (experimentIdInput && experimentIdInput.value.trim() !== experimentId) {
      experimentIdInput.value = experimentId;
      page.experimentId = experimentId;

      if (page.experimentStateManager) {
        page.experimentStateManager.setExperimentId(
          experimentId,
          RECORD_SOURCES.SYNC_BROADCAST,
        );
      }

      if (page.experimentSystemManager?.setExperimentId) {
        page.experimentSystemManager.setExperimentId(experimentId, RECORD_SOURCES.SYNC_BROADCAST, {
          registerToHub: false,
          broadcast: false,
          reapplyCombination: true,
        });
      }

      Logger.info(`實驗ID已同步並儲存: ${experimentId}`);
    }
  }

  sendParticipantNameUpdate(participantName) {
    const page = this.pageManager;

    if (!page.syncManager?.core?.isConnected()) {
      return;
    }

    if (!participantName || !participantName.trim()) {
      Logger.debug("受試者名稱為空，跳過同步");
      return;
    }

    const updateData = {
      type: SYNC_DATA_TYPES.PARTICIPANT_NAME_UPDATE,
      clientId: page.syncManager?.core?.syncClient?.clientId || "experiment_panel",
      timestamp: Date.now(),
      experimentId: document.getElementById("experimentIdInput")?.value || "",
      participantName: participantName.trim(),
    };

    page.experimentSyncCore?.safeBroadcast?.(updateData).catch((error) => {
      Logger.warn("同步受試者名稱更新失敗:", error);
    });

    document.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.EXPERIMENT_STATE_CHANGE_LOCAL, {
        detail: updateData,
      }),
    );
  }

  async receiveExperimentStarted(detail) {
    const page = this.pageManager;
    const myId = page.syncManager?.core?.syncClient?.clientId;
    if (myId && detail.clientId === myId) {
      Logger.debug("Board: 收到本機實驗開始廣播，忽略");
      return;
    }

    if (page.experimentFlowManager?.isRunning) {
      Logger.debug("Board: Flow 已在進行中，忽略遠端啟動");
      return;
    }

    if (page.experimentRunning) {
      const currentId =
        document.getElementById("experimentIdInput")?.value?.trim() ||
        page.experimentId ||
        "";
      if (currentId === detail.experimentId) {
        Logger.debug("Board: 收到遠端實驗開始，但本機已在進行相同實驗，忽略");
        return;
      }
    }

    page.logAction("sync_experiment_started_received", {
      clientId: detail.clientId,
      experimentId: detail.experimentId,
    });

    const currentExperimentId =
      document.getElementById("experimentIdInput")?.value.trim() || "";
    if (currentExperimentId !== detail.experimentId) {
      const experimentIdInput = document.getElementById("experimentIdInput");
      if (experimentIdInput) {
        experimentIdInput.value = detail.experimentId;
      }
    }

    if (detail.participantName) {
      const participantNameInput = document.getElementById("participantNameInput");
      if (participantNameInput && !participantNameInput.value.trim()) {
        participantNameInput.value = detail.participantName;
      }
    }

    if (detail.combinationId) {
      const combinationSelect = document.getElementById(
        "unitCombinationSelect",
      );
      if (combinationSelect) {
        combinationSelect.value = detail.combinationId;
        combinationSelect.dispatchEvent(new Event("change"));
      }
    }

    page.logAction("sync_experiment_started", {
      clientId: detail.clientId,
      experimentId: detail.experimentId,
      combinationId: detail.combinationId,
      combinationName: detail.combinationName,
    });

    try {
      page.startExperiment();
      Logger.debug("Board: 遠端實驗開始已處理，已啟動本機實驗");
    } catch (error) {
      Logger.error("Board: 啟動遠端同步實驗失敗:", error);
    }
  }

  receiveExperimentPaused(detail) {
    const page = this.pageManager;
    if (!page.experimentRunning) {
      return;
    }

    const isPaused = page.timerManager?.experimentPaused ?? false;
    if (isPaused) {
      return;
    }

    if (page.timerManager) {
      page.timerManager.pauseExperimentTimer();
    }

    const pauseBtn = document.getElementById("pauseExperimentBtn");
    if (pauseBtn) {
      pauseBtn.textContent = "▶ 繼續";
    }

    Logger.info("遠端暫停實驗");

    page.logAction("sync_experiment_paused", {
      clientId: detail.clientId,
    });
  }

  receiveExperimentResumed(detail) {
    const page = this.pageManager;
    if (!page.experimentRunning) {
      return;
    }

    const isPaused = page.timerManager?.experimentPaused ?? false;
    if (!isPaused) {
      return;
    }

    if (page.timerManager) {
      page.timerManager.resumeExperimentTimer();
    }

    const pauseBtn = document.getElementById("pauseExperimentBtn");
    if (pauseBtn) {
      pauseBtn.textContent = "⏸ 暫停";
    }

    Logger.info("遠端繼續實驗");

    page.logAction("sync_experiment_resumed", {
      clientId: detail.clientId,
    });
  }

  receiveExperimentStopped(detail) {
    const page = this.pageManager;
    if (!page.experimentRunning) {
      return;
    }

    page.logAction("sync_experiment_stopped_started", {
      clientId: detail.clientId,
    });

    page.stopExperiment();

    page.logAction("sync_experiment_stopped_completed", {
      clientId: detail.clientId,
    });
  }
}

export { BoardSyncIO };
