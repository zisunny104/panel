/*
 * Experiment Sync Core - 純同步邏輯
 * - 不直接操作 DOM
 * - 負責廣播 syncState (via window.syncManager.core.syncState)
 * - 處理來自其他裝置的狀態更新，並以 normalized events 分派到 window
 */
(function () {
  class ExperimentSyncCore {
    constructor() {
      this.clientId = null;
      this.isConnected = false;
      this._initSyncEvents();
      this._setupConnectionListeners();
      Logger.debug("ExperimentSyncCore 已建立");
    }

    _initSyncEvents() {
      // 安全取得事件名稱
      this.SYNC_EVENTS =
        typeof window !== "undefined" && window.SyncEvents
          ? window.SyncEvents
          : {
              STATE_UPDATE: "sync_state_update",
              SESSION_JOINED: "sync_session_joined",
              SESSION_RESTORED: "sync_session_restored",
            };

      const stateEvent = this.SYNC_EVENTS.STATE_UPDATE || "sync_state_update";

      window.addEventListener(stateEvent, (e) =>
        this._onRemoteStateUpdate(e.detail),
      );
    }

    _setupConnectionListeners() {
      window.addEventListener(
        this.SYNC_EVENTS.SESSION_JOINED || "sync_session_joined",
        (e) => {
          this.isConnected = true;
          this.clientId =
            window.syncManager?.core?.syncClient?.clientId ||
            e?.detail?.clientId ||
            null;
          Logger.debug("ExperimentSyncCore: SESSION_JOINED", {
            clientId: this.clientId,
          });
        },
      );

      window.addEventListener("sync_connected", (e) => {
        this.isConnected = true;
        this.clientId =
          e?.detail?.clientId ||
          window.syncManager?.core?.syncClient?.clientId ||
          this.clientId;
        Logger.debug("ExperimentSyncCore: sync_connected", {
          clientId: this.clientId,
        });
      });

      window.addEventListener("sync_disconnected", () => {
        this.isConnected = false;
        Logger.debug("ExperimentSyncCore: sync_disconnected");
      });
    }

    async _onRemoteStateUpdate(detail) {
      // Normalize and re-dispatch as internal events for adapters
      try {
        if (!detail) return;
        window.dispatchEvent(
          new CustomEvent("experiment:sync:remote_state", { detail }),
        );
      } catch (err) {
        Logger.warn("ExperimentSyncCore: 處理遠端狀態失敗", err);
      }
    }

    async syncState(payload) {
      if (!window.syncManager?.core?.syncState) return;
      try {
        await window.syncManager.core.syncState(payload);
      } catch (err) {
        Logger.warn("ExperimentSyncCore: syncState 失敗", err);
      }
    }

    // Convenience broadcast methods (純封裝，不操作 DOM)
    async broadcastExperimentStart(details) {
      if (!this.isConnected && !window.syncManager?.core?.syncState) return;
      const payload = Object.assign(
        { type: "experiment_started", timestamp: new Date().toISOString() },
        details || {},
      );
      await this.syncState(payload);
    }

    async broadcastExperimentPause(details) {
      if (!this.isConnected) return;
      const payload = Object.assign(
        {
          type: "experiment_state_change",
          event: "experiment_paused",
          timestamp: new Date().toISOString(),
        },
        details || {},
      );
      await this.syncState(payload);
    }

    async broadcastExperimentResume(details) {
      if (!this.isConnected) return;
      const payload = Object.assign(
        {
          type: "experiment_state_change",
          event: "experiment_resumed",
          timestamp: new Date().toISOString(),
        },
        details || {},
      );
      await this.syncState(payload);
    }

    async broadcastExperimentStop(details) {
      if (!this.isConnected) return;
      const payload = Object.assign(
        {
          type: "experiment_state_change",
          event: "experiment_stopped",
          timestamp: new Date().toISOString(),
        },
        details || {},
      );
      await this.syncState(payload);
    }

    async broadcastExperimentAction(actionData) {
      if (!this.isConnected) return;
      const payload = Object.assign(
        { type: "experiment_action", timestamp: new Date().toISOString() },
        actionData || {},
      );
      await this.syncState(payload);
    }

    async broadcastButtonAction(buttonData) {
      if (!this.isConnected) return;
      const payload = Object.assign(
        { type: "button_action", timestamp: new Date().toISOString() },
        buttonData || {},
      );
      await this.syncState(payload);
    }
  }

  // 實例化並暴露到 window
  if (typeof window !== "undefined") {
    window.experimentSyncCore = new ExperimentSyncCore();
  }
})();
