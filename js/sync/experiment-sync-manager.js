/**
 * ExperimentSyncCore - 實驗狀態同步核心
 *
 * 負責實驗狀態廣播和遠端事件轉發，不直接操作 DOM。
 * 由呼叫端負責建立與注入實例。
 * 佇列管理由 SyncManagerCore 統一負責。
 */

import { SYNC_EVENTS, SYNC_DATA_TYPES } from "../constants/index.js";

class ExperimentSyncCore {
  constructor(config = {}) {
    this.syncManager = config.syncManager || null;
    this.syncClient = config.syncClient || null;
    this._initSyncEvents();
    Logger.debug("ExperimentSyncCore 已建立");
  }

  updateDependencies(deps = {}) {
    Object.assign(this, deps);
  }

  _initSyncEvents() {
    window.addEventListener(SYNC_EVENTS.STATE_UPDATE, (e) =>
      this._onRemoteStateUpdate(e.detail),
    );
  }

  async _onRemoteStateUpdate(detail) {
    if (!detail) return;
    window.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.REMOTE_STATE, { detail }),
    );
  }

  /**
   * 委派給 SyncManagerCore 進行同步（包括佇列管理）
   */
  async syncState(payload) {
    if (!this.syncManager?.core) {
      Logger.warn("ExperimentSyncCore: syncManager 未設定，無法同步狀態");
      return false;
    }
    return await this.syncManager.core.syncState(payload);
  }

  /**
   * 檢查是否可以廣播（連線狀態檢查）
   */
  canBroadcast() {
    return this.syncManager?.core?.isConnected?.() || false;
  }

  /**
   * 安全廣播：檢查連線後進行同步
   * @param {Object} payload - 廣播資料
   * @returns {Promise<boolean>} 廣播是否成功
   */
  async safeBroadcast(payload) {
    if (!this.canBroadcast()) return false;
    return await this.syncState(payload);
  }

  // 廣播方法（純封裝，不操作 DOM）
  async broadcastExperimentStart(details) {
    const payload = Object.assign(
      {
        type: SYNC_DATA_TYPES.EXPERIMENT_STARTED,
        clientId: this.syncClient?.clientId,
        timestamp: Date.now(),
      },
      details || {},
    );
    await this.syncState(payload);
  }

  async broadcastExperimentPause(details) {
    const payload = Object.assign(
      {
        type: SYNC_DATA_TYPES.EXPERIMENT_PAUSED,
        clientId: this.syncClient?.clientId,
        timestamp: Date.now(),
      },
      details || {},
    );
    await this.syncState(payload);
  }

  async broadcastExperimentResume(details) {
    const payload = Object.assign(
      {
        type: SYNC_DATA_TYPES.EXPERIMENT_RESUMED,
        clientId: this.syncClient?.clientId,
        timestamp: Date.now(),
      },
      details || {},
    );
    await this.syncState(payload);
  }

  async broadcastExperimentStop(details) {
    const payload = Object.assign(
      {
        type: SYNC_DATA_TYPES.EXPERIMENT_STOPPED,
        clientId: this.syncClient?.clientId,
        timestamp: Date.now(),
      },
      details || {},
    );
    await this.syncState(payload);
  }

  async broadcastExperimentAction(actionData) {
    const payload = Object.assign(
      {
        type: SYNC_DATA_TYPES.EXPERIMENT_ACTION,
        clientId: this.syncClient?.clientId,
        timestamp: Date.now(),
      },
      actionData || {},
    );
    await this.syncState(payload);
  }
}

// ES6 模組匯出
export default ExperimentSyncCore;
export { ExperimentSyncCore };

