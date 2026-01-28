/**
 * ExperimentHubManager - 實驗中樞管理器
 * Phase 2 - P0 核心模組
 *
 * 職責：
 * 1. 管理實驗 ID（板端、Hub端、組合ID）
 * 2. 同步模式管理（本地/Hub）
 * 3. Hub 通訊邏輯
 * 4. 事件通知機制
 *
 * 提取來源：
 * - panel-experiment-flow.js (ID 管理相關)
 * - panel-experiment-manager.js (同步模式相關)
 * - experiment-hub-client.js (Hub 通訊相關)
 */

class ExperimentHubManager {
  /**
   * 同步模式常數
   */
  static MODE = {
    LOCAL: 'local',      // 本地模式（獨立運行）
    HUB: 'hub',          // Hub 模式（連接到中樞）
    VIEWER: 'viewer'     // 檢視模式（只能觀看）
  };

  /**
   * 事件類型常數
   */
  static EVENT = {
    ID_CHANGED: 'hub:id_changed',
    MODE_CHANGED: 'hub:mode_changed',
    CONNECTED: 'hub:connected',
    DISCONNECTED: 'hub:disconnected',
    MESSAGE_RECEIVED: 'hub:message_received',
    SYNC_REQUIRED: 'hub:sync_required',
    ERROR: 'hub:error'
  };

  constructor(config = {}) {
    // 配置
    this.config = {
      apiBaseUrl: config.apiBaseUrl || this.getDefaultApiUrl(),
      autoReconnect: config.autoReconnect !== false,
      reconnectInterval: config.reconnectInterval || 5000,
      ...config
    };

    // ID 狀態
    this.ids = {
      board: null,           // 板端 ID（本機產生）
      hub: null,             // Hub ID（伺服器分配）
      experiment: null,      // 實驗 ID
      combination: null      // 組合 ID
    };

    // 連接狀態
    this.connection = {
      mode: ExperimentHubManager.MODE.LOCAL,
      connected: false,
      wsClient: null,
      role: null
    };

    // 事件監聽器
    this.eventListeners = new Map();

    // WebSocket 相關
    this.syncClientReady = false;
    this.reconnectTimer = null;

    // 初始化
    this.initialize();
  }

  /**
   * 初始化管理器
   */
  initialize() {
    // 從 localStorage 恢復 ID
    this.restoreIds();

    // 等待 SyncClient 就緒（如果需要 Hub 模式）
    if (window.syncManager) {
      this.waitForSyncClient();
    }

    Logger.debug('ExperimentHubManager 初始化完成', {
      mode: this.connection.mode,
      ids: this.ids
    });
  }

  /**
   * 取得預設 API URL
   */
  getDefaultApiUrl() {
    const protocol = window.location.protocol;
    const host = window.location.host;
    const basePath = this.getApiBasePath();
    return `${protocol}//${host}${basePath}`;
  }

  /**
   * 取得 API 路徑前綴
   */
  getApiBasePath() {
    const pathname = window.location.pathname;
    let basePath = pathname;
    
    if (!basePath.endsWith('/')) {
      basePath = basePath.substring(0, basePath.lastIndexOf('/') + 1);
    }
    
    if (!basePath.endsWith('/')) {
      basePath += '/';
    }
    
    return basePath + 'api';
  }

  // ==================== ID 管理 ====================

  /**
   * 設定板端 ID
   */
  setBoardId(id, options = {}) {
    const oldId = this.ids.board;
    this.ids.board = id;
    
    if (!options.silent) {
      this.saveIds();
      this.emit(ExperimentHubManager.EVENT.ID_CHANGED, {
        type: 'board',
        oldValue: oldId,
        newValue: id
      });
    }
    
    Logger.debug('板端 ID 已設定', id);
    return id;
  }

  /**
   * 取得板端 ID
   */
  getBoardId() {
    return this.ids.board;
  }

  /**
   * 設定 Hub ID
   */
  setHubId(id, options = {}) {
    const oldId = this.ids.hub;
    this.ids.hub = id;
    
    if (!options.silent) {
      this.saveIds();
      this.emit(ExperimentHubManager.EVENT.ID_CHANGED, {
        type: 'hub',
        oldValue: oldId,
        newValue: id
      });
    }
    
    Logger.debug('Hub ID 已設定', id);
    return id;
  }

  /**
   * 取得 Hub ID
   */
  getHubId() {
    return this.ids.hub;
  }

  /**
   * 設定實驗 ID
   */
  setExperimentId(id, source = 'local', options = {}) {
    const oldId = this.ids.experiment;
    this.ids.experiment = id;
    
    if (!options.silent) {
      this.saveIds();
      this.emit(ExperimentHubManager.EVENT.ID_CHANGED, {
        type: 'experiment',
        oldValue: oldId,
        newValue: id,
        source: source
      });

      // 如果在 Hub 模式下，同步到伺服器
      if (this.isHubMode() && this.connection.connected) {
        this.syncExperimentIdToHub(id, source);
      }
    }
    
    Logger.debug('實驗 ID 已設定', { id, source });
    return id;
  }

  /**
   * 取得實驗 ID
   */
  getExperimentId() {
    return this.ids.experiment;
  }

  /**
   * 設定組合 ID
   */
  setCombinationId(id, options = {}) {
    const oldId = this.ids.combination;
    this.ids.combination = id;
    
    if (!options.silent) {
      this.saveIds();
      this.emit(ExperimentHubManager.EVENT.ID_CHANGED, {
        type: 'combination',
        oldValue: oldId,
        newValue: id
      });
    }
    
    Logger.debug('組合 ID 已設定', id);
    return id;
  }

  /**
   * 取得組合 ID
   */
  getCombinationId() {
    return this.ids.combination;
  }

  /**
   * 產生新的實驗 ID
   */
  generateExperimentId() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    const id = `EXP-${timestamp}-${random}`;
    this.setExperimentId(id, 'generated');
    return id;
  }

  /**
   * 驗證 ID 有效性
   */
  validateId(id, type = 'experiment') {
    if (!id || typeof id !== 'string') {
      return { valid: false, error: 'ID 必須是字串' };
    }

    if (id.trim().length === 0) {
      return { valid: false, error: 'ID 不能為空' };
    }

    // 根據類型進行額外驗證
    switch (type) {
      case 'experiment':
        if (!/^EXP-\d+-\d{3}$/.test(id) && !/^[A-Za-z0-9_-]+$/.test(id)) {
          return { valid: false, error: '實驗 ID 格式不正確' };
        }
        break;
      // 其他類型可以加入更多驗證規則
    }

    return { valid: true };
  }

  /**
   * 重置所有 ID
   */
  resetIds(options = {}) {
    const oldIds = { ...this.ids };
    
    this.ids = {
      board: null,
      hub: null,
      experiment: null,
      combination: null
    };

    if (!options.silent) {
      this.saveIds();
      this.emit(ExperimentHubManager.EVENT.ID_CHANGED, {
        type: 'all',
        oldValue: oldIds,
        newValue: this.ids
      });
    }

    Logger.debug('所有 ID 已重置');
  }

  /**
   * 儲存 ID 到 localStorage
   */
  saveIds() {
    try {
      localStorage.setItem('experiment_hub_ids', JSON.stringify(this.ids));
    } catch (error) {
      Logger.error('儲存 ID 失敗', error);
    }
  }

  /**
   * 從 localStorage 恢復 ID
   */
  restoreIds() {
    try {
      const saved = localStorage.getItem('experiment_hub_ids');
      if (saved) {
        const ids = JSON.parse(saved);
        this.ids = { ...this.ids, ...ids };
        Logger.debug('已從 localStorage 恢復 ID', this.ids);
      }
    } catch (error) {
      Logger.error('恢復 ID 失敗', error);
    }
  }

  // ==================== 同步模式管理 ====================

  /**
   * 取得當前模式
   */
  getMode() {
    return this.connection.mode;
  }

  /**
   * 檢查是否為本地模式
   */
  isLocalMode() {
    return this.connection.mode === ExperimentHubManager.MODE.LOCAL;
  }

  /**
   * 檢查是否為 Hub 模式
   */
  isHubMode() {
    return this.connection.mode === ExperimentHubManager.MODE.HUB;
  }

  /**
   * 檢查是否為檢視模式
   */
  isViewerMode() {
    return this.connection.mode === ExperimentHubManager.MODE.VIEWER;
  }

  /**
   * 切換到 Hub 模式
   */
  async switchToHubMode() {
    if (this.isHubMode()) {
      Logger.debug('已經是 Hub 模式');
      return true;
    }

    const oldMode = this.connection.mode;
    this.connection.mode = ExperimentHubManager.MODE.HUB;

    this.emit(ExperimentHubManager.EVENT.MODE_CHANGED, {
      oldMode,
      newMode: this.connection.mode
    });

    Logger.info('已切換到 Hub 模式');

    // 嘗試連接到 Hub
    if (!this.connection.connected) {
      await this.connect();
    }

    return true;
  }

  /**
   * 切換到本地模式
   */
  switchToLocalMode() {
    if (this.isLocalMode()) {
      Logger.debug('已經是本地模式');
      return true;
    }

    const oldMode = this.connection.mode;
    this.connection.mode = ExperimentHubManager.MODE.LOCAL;

    this.emit(ExperimentHubManager.EVENT.MODE_CHANGED, {
      oldMode,
      newMode: this.connection.mode
    });

    Logger.info('已切換到本地模式');

    // 斷開 Hub 連接
    if (this.connection.connected) {
      this.disconnect();
    }

    return true;
  }

  /**
   * 設定檢視模式
   */
  setViewerMode(isViewer) {
    const oldMode = this.connection.mode;
    
    if (isViewer) {
      this.connection.mode = ExperimentHubManager.MODE.VIEWER;
    } else if (this.connection.connected) {
      this.connection.mode = ExperimentHubManager.MODE.HUB;
    } else {
      this.connection.mode = ExperimentHubManager.MODE.LOCAL;
    }

    if (oldMode !== this.connection.mode) {
      this.emit(ExperimentHubManager.EVENT.MODE_CHANGED, {
        oldMode,
        newMode: this.connection.mode
      });

      Logger.info('模式已變更', {
        from: oldMode,
        to: this.connection.mode
      });
    }
  }

  // ==================== Hub 通訊 ====================

  /**
   * 等待 SyncClient 就緒
   */
  waitForSyncClient() {
    if (this.syncClientReady) return;

    const checkInterval = setInterval(() => {
      if (window.syncManager?.core?.syncClient) {
        clearInterval(checkInterval);
        this.onSyncClientReady();
      }
    }, 100);

    // 30 秒後停止檢查
    setTimeout(() => {
      clearInterval(checkInterval);
      if (!this.syncClientReady) {
        Logger.warn('SyncClient 就緒超時');
      }
    }, 30000);
  }

  /**
   * SyncClient 就緒回調
   */
  onSyncClientReady() {
    Logger.info('SyncClient 就緒');
    this.syncClientReady = true;

    const syncClient = window.syncManager.core.syncClient;
    this.connection.wsClient = syncClient.wsClient;

    this.setupEventHandlers();

    if (syncClient.isConnected()) {
      this.connection.connected = true;
      this.connection.role = syncClient.getRole();
      this.updateModeFromRole();
    }
  }

  /**
   * 設定 WebSocket 事件處理器
   */
  setupEventHandlers() {
    if (!this.connection.wsClient) return;

    const ws = this.connection.wsClient;

    // 連接事件
    ws.on('authenticated', (data) => {
      this.connection.connected = true;
      this.connection.role = data.role;
      this.updateModeFromRole();
      this.emit(ExperimentHubManager.EVENT.CONNECTED, data);
      Logger.debug('WebSocket 已認證', data);
    });

    ws.on('disconnected', () => {
      this.connection.connected = false;
      this.emit(ExperimentHubManager.EVENT.DISCONNECTED);
      Logger.warn('WebSocket 已斷線');
      
      if (this.config.autoReconnect) {
        this.scheduleReconnect();
      }
    });

    ws.on('reconnected', (data) => {
      this.connection.connected = true;
      this.connection.role = data.role;
      this.updateModeFromRole();
      this.emit(ExperimentHubManager.EVENT.CONNECTED, data);
      Logger.info('WebSocket 已重新連線', data);
    });

    // 實驗 ID 更新事件
    ws.on('experiment_id_changed', (data) => {
      Logger.debug('收到實驗 ID 更新', data);
      if (data.clientId !== this.getClientId()) {
        this.setExperimentId(data.experimentId, 'remote', { silent: false });
        this.emit(ExperimentHubManager.EVENT.MESSAGE_RECEIVED, {
          type: 'experiment_id_changed',
          data
        });
      }
    });

    // 其他實驗狀態事件
    ['experiment_started', 'experiment_paused', 'experiment_resumed', 'experiment_stopped'].forEach(eventName => {
      ws.on(eventName, (data) => {
        Logger.debug(`收到 ${eventName}`, data);
        this.emit(ExperimentHubManager.EVENT.MESSAGE_RECEIVED, {
          type: eventName,
          data
        });
      });
    });
  }

  /**
   * 根據角色更新模式
   */
  updateModeFromRole() {
    const role = this.connection.role;
    const ROLE = window.SyncManager?.ROLE;

    if (!ROLE) return;

    if (role === ROLE.VIEWER) {
      this.setViewerMode(true);
    } else if (this.connection.connected) {
      this.connection.mode = ExperimentHubManager.MODE.HUB;
    }
  }

  /**
   * 連接到 Hub
   */
  async connect() {
    if (this.connection.connected) {
      Logger.debug('已經連接到 Hub');
      return true;
    }

    if (!this.syncClientReady) {
      Logger.warn('SyncClient 尚未就緒');
      return false;
    }

    // SyncClient 會自動處理連接
    // 我們只需要等待 authenticated 事件
    Logger.debug('等待 Hub 連接...');
    return true;
  }

  /**
   * 斷開與 Hub 的連接
   */
  disconnect() {
    if (!this.connection.connected) {
      Logger.debug('已經斷開連接');
      return;
    }

    // SyncClient 會處理實際的斷線邏輯
    this.connection.connected = false;
    this.emit(ExperimentHubManager.EVENT.DISCONNECTED);
    Logger.info('已斷開 Hub 連接');
  }

  /**
   * 發送訊息到 Hub
   */
  sendMessage(type, data) {
    if (!this.connection.connected) {
      Logger.warn('未連接到 Hub，無法發送訊息');
      return false;
    }

    if (!this.connection.wsClient) {
      Logger.error('WebSocket 客戶端不存在');
      return false;
    }

    try {
      this.connection.wsClient.emit(type, data);
      Logger.debug('已發送訊息到 Hub', { type, data });
      return true;
    } catch (error) {
      Logger.error('發送訊息失敗', error);
      this.emit(ExperimentHubManager.EVENT.ERROR, {
        type: 'send_failed',
        error
      });
      return false;
    }
  }

  /**
   * 同步實驗 ID 到 Hub
   */
  syncExperimentIdToHub(experimentId, source = 'local') {
    const data = {
      experimentId,
      source,
      clientId: this.getClientId(),
      timestamp: new Date().toISOString()
    };

    // 使用 SyncClient 的 syncState 方法
    if (window.syncClient && typeof window.syncClient.syncState === 'function') {
      const updateData = {
        type: window.SyncDataTypes?.EXPERIMENT_ID_UPDATE || 'experiment_id_update',
        ...data
      };

      window.syncClient.syncState(updateData);
      Logger.debug('實驗 ID 已透過 SyncClient 同步', experimentId);
    } else {
      // 備用方案：直接發送 WebSocket 訊息
      this.sendMessage('experiment_id_update', data);
    }
  }

  /**
   * 查詢連接狀態
   */
  isConnected() {
    return this.connection.connected;
  }

  /**
   * 取得客戶端 ID
   */
  getClientId() {
    return window.syncManager?.core?.syncClient?.clientId || 'panel_device';
  }

  /**
   * 排程重新連接
   */
  scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      Logger.info('嘗試重新連接到 Hub...');
      this.connect();
    }, this.config.reconnectInterval);
  }

  // ==================== 事件通知 ====================

  /**
   * 註冊事件監聽器
   */
  on(eventType, callback) {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType).push(callback);
    return () => this.off(eventType, callback);
  }

  /**
   * 移除事件監聽器
   */
  off(eventType, callback) {
    if (!this.eventListeners.has(eventType)) return;
    
    const listeners = this.eventListeners.get(eventType);
    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }

  /**
   * 觸發事件
   */
  emit(eventType, data) {
    if (!this.eventListeners.has(eventType)) return;
    
    const listeners = this.eventListeners.get(eventType);
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        Logger.error(`事件處理器錯誤 (${eventType})`, error);
      }
    });
  }

  /**
   * 清除所有事件監聽器
   */
  clearListeners(eventType = null) {
    if (eventType) {
      this.eventListeners.delete(eventType);
    } else {
      this.eventListeners.clear();
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 取得管理器狀態
   */
  getState() {
    return {
      ids: { ...this.ids },
      connection: {
        mode: this.connection.mode,
        connected: this.connection.connected,
        role: this.connection.role
      },
      config: { ...this.config }
    };
  }

  /**
   * 銷毀管理器
   */
  destroy() {
    this.disconnect();
    this.clearListeners();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    Logger.debug('ExperimentHubManager 已銷毀');
  }
}

// 導出到全域（用於向後相容）
if (typeof window !== 'undefined') {
  window.ExperimentHubManager = ExperimentHubManager;
}

// 支援模組導出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExperimentHubManager;
}
