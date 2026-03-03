/**
 * ExperimentSyncCore - 實驗狀態同步核心
 *
 * 負責多裝置同步邏輯、訊息佇列與廣播，不直接操作 DOM。
 * 通過 window.experimentSyncCore 暴露單一實例供各模組使用。
 */

class ExperimentSyncCore {
  constructor() {
    this.clientId = null;
    this.isConnected = false;
    this._pendingQueue = []; // 離線時的訊息佇列
    this._initSyncEvents();
    this._setupConnectionListeners();
    Logger.debug("ExperimentSyncCore 已建立");
  }

  _initSyncEvents() {
    this.SYNC_EVENTS = window.SYNC_EVENTS;

    window.addEventListener(this.SYNC_EVENTS.STATE_UPDATE, (e) =>
      this._onRemoteStateUpdate(e.detail),
    );
  }

  _setupConnectionListeners() {
    window.addEventListener(this.SYNC_EVENTS.SESSION_JOINED, (e) => {
      this.isConnected = true;
      this.clientId =
        window.syncManager?.core?.syncClient?.clientId ||
        e?.detail?.clientId ||
        null;
      Logger.debug("ExperimentSyncCore: SESSION_JOINED", {
        clientId: this.clientId,
      });
      this._flushQueue();
    });

    window.addEventListener(this.SYNC_EVENTS.CONNECTED, (e) => {
      this.isConnected = true;
      this.clientId =
        e?.detail?.clientId ||
        window.syncManager?.core?.syncClient?.clientId ||
        this.clientId;
      Logger.debug("ExperimentSyncCore: CONNECTED", {
        clientId: this.clientId,
      });
      this._flushQueue();
    });

    window.addEventListener(this.SYNC_EVENTS.DISCONNECTED, () => {
      this.isConnected = false;
      Logger.debug("ExperimentSyncCore: DISCONNECTED");
    });
  }

  async _onRemoteStateUpdate(detail) {
    // 將遠端狀態標準化後重新派發，供 Board 端的 Adapter 接收
    try {
      if (!detail) return;
      window.dispatchEvent(
        new CustomEvent(this.SYNC_EVENTS.REMOTE_STATE, { detail }),
      );
    } catch (err) {
      Logger.warn("ExperimentSyncCore: 處理遠端狀態失敗", err);
    }
  }

  async syncState(payload) {
    if (!window.syncManager?.core?.syncState) {
      this._enqueue(payload);
      return;
    }
    try {
      await window.syncManager.core.syncState(payload);
    } catch (err) {
      Logger.warn("ExperimentSyncCore: syncState 失敗，加入佇列", err);
      this._enqueue(payload);
    }
  }

  _enqueue(payload) {
    this._pendingQueue.push(payload);
    if (this._pendingQueue.length > 50) {
      // 防止佇列無限展長，保留最新 50 筆
      this._pendingQueue.splice(0, this._pendingQueue.length - 50);
    }
  }

  async _flushQueue() {
    if (!this._pendingQueue.length) return;
    const pending = this._pendingQueue.splice(0);
    Logger.debug(`ExperimentSyncCore: 清空佇列，發送 ${pending.length} 筆`);
    for (const p of pending) {
      await this.syncState(p);
    }
  }

  // 廣播方法（純封裝，不操作 DOM）
  async broadcastExperimentStart(details) {
    const payload = Object.assign(
      {
        type: window.SYNC_DATA_TYPES.EXPERIMENT_STARTED,
        timestamp: new Date().toISOString(),
      },
      details || {},
    );
    await this.syncState(payload);
  }

  async broadcastExperimentPause(details) {
    const payload = Object.assign(
      {
        type: window.SYNC_DATA_TYPES.EXPERIMENT_STATE_CHANGE,
        event: window.SYNC_DATA_TYPES.EXPERIMENT_PAUSED,
        timestamp: new Date().toISOString(),
      },
      details || {},
    );
    await this.syncState(payload);
  }

  async broadcastExperimentResume(details) {
    const payload = Object.assign(
      {
        type: window.SYNC_DATA_TYPES.EXPERIMENT_STATE_CHANGE,
        event: window.SYNC_DATA_TYPES.EXPERIMENT_RESUMED,
        timestamp: new Date().toISOString(),
      },
      details || {},
    );
    await this.syncState(payload);
  }

  async broadcastExperimentStop(details) {
    const payload = Object.assign(
      {
        type: window.SYNC_DATA_TYPES.EXPERIMENT_STATE_CHANGE,
        event: window.SYNC_DATA_TYPES.EXPERIMENT_STOPPED,
        timestamp: new Date().toISOString(),
      },
      details || {},
    );
    await this.syncState(payload);
  }

  async broadcastExperimentAction(actionData) {
    const payload = Object.assign(
      {
        type: window.SYNC_DATA_TYPES.EXPERIMENT_ACTION,
        timestamp: new Date().toISOString(),
      },
      actionData || {},
    );
    await this.syncState(payload);
  }

  async broadcastButtonAction(buttonData) {
    const payload = Object.assign(
      {
        type: window.SYNC_DATA_TYPES.BUTTON_ACTION,
        timestamp: new Date().toISOString(),
      },
      buttonData || {},
    );
    await this.syncState(payload);
  }
}

// 實例化並暴露到 window
window.experimentSyncCore = new ExperimentSyncCore();
