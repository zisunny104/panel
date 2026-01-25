/**
 * TimeSyncManager - 時間同步管理器
 *
 * 處理客戶端與伺服器的時間偏差校正
 * 確保多裝置間的時間戳一致性：
 * 1. 所有時間戳統一為毫秒級 Unix 時間戳
 * 2. 自動偵測客戶端與伺服器的時間偏差
 * 3. 提供校正後的伺服器時間供所有模組使用
 */

class TimeSyncManager {
  constructor() {
    // 時間偏差（毫秒）= 本機時間 - 伺服器時間
    // 初始值為 0，表示假設時鐘同步
    this.timeOffset = 0;

    // 時間同步狀態
    this.isSynced = false;
    this.lastSyncTime = null;
    this.syncCheckInterval = 5 * 60 * 1000; // 每 5 分鐘重新同步一次
    this.syncCheckTimer = null;

    // 時區設定（從設定檔案取得）
    this.timezone = window.CONFIG?.timezone || "Asia/Taipei";

    // 多次同步結果用於計算平均偏差（降低網路延遲影響）
    this.syncSamples = [];
    this.maxSamples = 3;
  }

  /**
   * 初始化時間同步
   * 從伺服器取得參考時間，計算本機時間偏差
   */
  async initialize() {
    Logger.debug("[TimeSyncManager] 初始化時間同步...");

    try {
      await this.syncWithServer();
      Logger.debug("[TimeSyncManager] 時間同步初始化完成");
    } catch (error) {
      Logger.warn("[TimeSyncManager] 時間同步初始化失敗:", error);
      // 初始化失敗不影響系統運作，使用本機時間
      this.isSynced = false;
    }
  }

  /**
   * 取得應用程式時區設定
   * @returns {string} 時區字串
   */
  static getTimezone() {
    return (
      window.timeSyncManager?.timezone ||
      window.CONFIG?.timezone ||
      "Asia/Taipei"
    );
  }

  /**
   * 與伺服器同步時間
   * 使用本機時間，時間偏差固定為 0
   */
  async syncWithServer() {
    try {
      // 不需要與伺服器同步
      // 所有裝置使用各自的本機時間，透過 WebSocket 進行事件同步
      this.timeOffset = 0;
      this.isSynced = true;
      this.lastSyncTime = Date.now();

      Logger.debug("[TimeSyncManager] 使用本機時間，時間偏差 = 0ms");
    } catch (error) {
      Logger.warn("[TimeSyncManager] 時間初始化失敗:", error.message);
      this.isSynced = false;
    }
  }

  /**
   * 取得校正後的伺服器時間（毫秒級）
   * 應該在所有需要參考時間的地方使用此方法
   */
  getServerTime() {
    // 伺服器時間 = 本機時間 - 時間偏差
    return Date.now() - this.timeOffset;
  }

  /**
   * 取得目前本機時間（毫秒級）
   */
  getLocalTime() {
    return Date.now();
  }

  /**
   * 取得目前時間偏差（毫秒）
   */
  getTimeOffset() {
    return this.timeOffset;
  }

  /**
   * 檢查時間同步狀態
   */
  isSynchronized() {
    return this.isSynced;
  }

  /**
   * 取得同步統計資訊（用於診斷）
   */
  getSyncStats() {
    return {
      isSynced: this.isSynced,
      timeOffset: this.timeOffset,
      lastSyncTime: this.lastSyncTime,
      samplesCount: this.syncSamples.length,
      samples: this.syncSamples
    };
  }

  /**
   * 透過 WebSocket 進行一次性校時
   * @param {number} serverTime - 伺服器時間戳（毫秒）
   */
  syncWithWebSocket(serverTime) {
    const clientTime = Date.now();
    const offset = clientTime - serverTime;

    // 記錄樣本
    this.syncSamples.push({
      offset: offset,
      delay: 0, // WebSocket 延遲忽略不計
      timestamp: clientTime
    });

    if (this.syncSamples.length > this.maxSamples) {
      this.syncSamples.shift();
    }

    // 計算平均偏差
    this.timeOffset = Math.round(
      this.syncSamples.reduce((sum, s) => sum + s.offset, 0) /
        this.syncSamples.length
    );

    this.isSynced = true;
    this.lastSyncTime = Date.now();

    Logger.debug(
      `[TimeSyncManager] WebSocket 校時完成: 偏差=${this.timeOffset}ms`
    );
  }

  // 由於 file 中先前含有兩組重複的簡易時間格式化實作，現已移除，並保留下方的 Intl-based 實作以統一時區、格式與行為。

  /**
   * 透過 WebSocket 進行一次性校時
   * @param {number} serverTime - 伺服器時間戳（毫秒）
   */
  syncWithWebSocket(serverTime) {
    const clientTime = Date.now();
    const offset = clientTime - serverTime;

    // 記錄樣本
    this.syncSamples.push({
      offset: offset,
      delay: 0, // WebSocket 延遲忽略不計
      timestamp: clientTime
    });

    if (this.syncSamples.length > this.maxSamples) {
      this.syncSamples.shift();
    }

    // 計算平均偏差
    this.timeOffset = Math.round(
      this.syncSamples.reduce((sum, s) => sum + s.offset, 0) /
        this.syncSamples.length
    );

    this.isSynced = true;
    this.lastSyncTime = Date.now();

    Logger.debug(
      `[TimeSyncManager] WebSocket 校時完成: 偏差=${this.timeOffset}ms`
    );
  }
  /**
   * 格式化為 ISO 8601 格式
   * @param {Date|number} dateInput - 日期物件或時間戳
   * @returns {string} ISO 格式字串
   */
  formatISO(dateInput) {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    return date.toISOString();
  }

  /**
   * 格式化時間長度（持續時間）
   * @param {number} milliseconds - 毫秒數
   * @returns {string} 格式化的時間長度 (HH:MM:SS)
   */
  formatDuration(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return [
      String(hours).padStart(2, "0"),
      String(minutes).padStart(2, "0"),
      String(seconds).padStart(2, "0")
    ].join(":");
  }

  /**
   * 格式化時間為東八區 YYYY-MM-DD HH:MM:SS 格式
   * @param {number|Date} timestamp - 毫秒級時間戳或 Date 物件
   * @param {Object} options - 選項
   * @param {boolean} options.includeMilliseconds - 是否包含毫秒（預設 false）
   * @returns {string} 格式化的時間字串
   */
  formatDateTime(timestamp, options = {}) {
    try {
      const date =
        typeof timestamp === "number"
          ? new Date(timestamp)
          : timestamp instanceof Date
            ? timestamp
            : new Date(timestamp);

      if (isNaN(date.getTime())) {
        return "無效時間";
      }

      // 使用更有效率的 Intl.DateTimeFormat 直接格式化
      const formatter = new Intl.DateTimeFormat("zh-TW", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: this.timezone,
        hour12: false
      });

      let result = formatter.format(date).replace(/\//g, "-");

      // 如果需要毫秒
      if (options.includeMilliseconds) {
        const ms = String(date.getMilliseconds()).padStart(3, "0");
        result += `.${ms}`;
      }

      return result;
    } catch (error) {
      Logger.error("[TimeSyncManager] 時間格式化失敗:", error);
      return "格式化錯誤";
    }
  }

  /**
   * 格式化時間為東八區 HH:MM:SS 格式（不含日期）
   * @param {number|Date} timestamp - 毫秒級時間戳或 Date 物件
   * @param {Object} options - 選項
   * @param {boolean} options.includeMilliseconds - 是否包含毫秒（預設 false）
   * @returns {string} 格式化的時間字串
   */
  formatTime(timestamp, options = {}) {
    try {
      const dateTime = this.formatDateTime(timestamp, options);
      // 取出時間部分（空格後的內容）
      const timeMatch = dateTime.match(/\s(.*)$/);
      return timeMatch ? timeMatch[1] : "無效時間";
    } catch (error) {
      Logger.error("[TimeSyncManager] 時間格式化失敗:", error);
      return "格式化錯誤";
    }
  }

  /**
   * 格式化日期為東八區 YYYY-MM-DD 格式（不含時間）
   * @param {number|Date} timestamp - 毫秒級時間戳或 Date 物件
   * @returns {string} 格式化的日期字串
   */
  formatDate(timestamp) {
    try {
      const dateTime = this.formatDateTime(timestamp);
      // 取出日期部分（空格前的內容）
      const dateMatch = dateTime.match(/^([^\s]+)/);
      return dateMatch ? dateMatch[1] : "無效日期";
    } catch (error) {
      Logger.error("[TimeSyncManager] 日期格式化失敗:", error);
      return "格式化錯誤";
    }
  }

  /**
   * 清理資源
   */
  cleanup() {
    this.stopPeriodicSync();
    this.syncSamples = [];
  }
}

// 建立全局時間同步管理器實例
window.timeSyncManager = window.timeSyncManager || new TimeSyncManager();

// UMD 模式：同時支援全域和 ES6 模組
if (typeof window !== "undefined") {
  window.TimeSyncManager = TimeSyncManager;
}

// 僅在模組環境中匯出（避免普通 script 語法錯誤）
if (typeof module !== "undefined" && module.exports) {
  module.exports = TimeSyncManager;
}





