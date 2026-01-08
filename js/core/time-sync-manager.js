/**
 * 時間同步管理器 - 處理客戶端與伺服器的時間偏差校正
 *
 * 確保多裝置間的時間戳一致性：
 * 1. 所有時間戳統一為毫秒級 Unix 時間戳
 * 2. 自動偵測客戶端與伺服器的時間偏差
 * 3. 提供校正後的伺服器時間供所有模組使用
 */

class TimeSyncManager {
  constructor() {
    // 時間偏差（毫秒）= 本地時間 - 伺服器時間
    // 初始值為 0，表示假設時鐘同步
    this.timeOffset = 0;

    // 時間同步狀態
    this.isSynced = false;
    this.lastSyncTime = null;
    this.syncCheckInterval = 5 * 60 * 1000; // 每 5 分鐘重新同步一次
    this.syncCheckTimer = null;

    // 時區設定（從配置檔案取得）
    this.timezone = window.CONFIG?.timezone?.default || "Asia/Taipei";

    // 多次同步結果用於計算平均偏差（降低網路延遲影響）
    this.syncSamples = [];
    this.maxSamples = 3;
  }

  /**
   * 初始化時間同步
   * 從伺服器取得參考時間，計算本地時間偏差
   */
  async initialize() {
    Logger.debug("[TimeSyncManager] 初始化時間同步...");

    try {
      await this.syncWithServer();
      this.startPeriodicSync();
      Logger.debug("[TimeSyncManager] 時間同步初始化完成");
    } catch (error) {
      Logger.warn("[TimeSyncManager] 時間同步初始化失敗:", error);
      // 初始化失敗不影響系統運作，使用本地時間
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
      window.CONFIG?.timezone?.default ||
      "Asia/Taipei"
    );
  }

  /**
   * 與伺服器同步時間
   * 測量網路往返延遲並計算時間偏差
   */
  async syncWithServer() {
    const clientTime1 = Date.now(); // 發送前的客戶端時間

    try {
      const response = await fetch("php/sync-api.php?action=getServerTime", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      const clientTime2 = Date.now(); // 接收後的客戶端時間

      if (!response.ok) {
        throw new Error(`伺服器回應異常: ${response.status}`);
      }

      const data = await response.json();

      if (!data.success || !data.serverTime) {
        throw new Error("伺服器未返回有效的時間資料");
      }

      // 計算網路往返延遲（毫秒）
      const roundTripDelay = clientTime2 - clientTime1;
      const estimatedNetworkDelay = Math.round(roundTripDelay / 2);

      // 估算伺服器回應時刻的客戶端時間
      const estimatedServerResponseTime = clientTime1 + estimatedNetworkDelay;

      // 計算時間偏差
      // timeOffset = 本地時間 - 伺服器時間
      const offset = estimatedServerResponseTime - data.serverTime;

      // 記錄同步樣本
      this.syncSamples.push({
        offset: offset,
        delay: roundTripDelay,
        timestamp: clientTime2,
      });

      if (this.syncSamples.length > this.maxSamples) {
        this.syncSamples.shift();
      }

      // 使用平均偏差降低單次測量誤差
      this.timeOffset = Math.round(
        this.syncSamples.reduce((sum, s) => sum + s.offset, 0) /
          this.syncSamples.length
      );

      // 從伺服器取得時區設定
      if (data.timezone) {
        this.timezone = data.timezone;
      }

      this.isSynced = true;
      this.lastSyncTime = Date.now();

      Logger.debug(
        `[TimeSyncManager] 時間同步成功: 偏差=${this.timeOffset}ms, ` +
          `網路延遲=${roundTripDelay}ms, 樣本數=${this.syncSamples.length}`
      );
    } catch (error) {
      Logger.warn("[TimeSyncManager] 時間同步失敗:", error.message);
      // 同步失敗時保持現有偏差或使用 0
      this.isSynced = false;
    }
  }

  /**
   * 啟動定期時間同步
   */
  startPeriodicSync() {
    // 清理舊的計時器
    if (this.syncCheckTimer) {
      clearInterval(this.syncCheckTimer);
    }

    // 定期重新同步
    this.syncCheckTimer = setInterval(async () => {
      Logger.debug("[TimeSyncManager] 執行定期時間重新同步...");
      await this.syncWithServer();
    }, this.syncCheckInterval);
  }

  /**
   * 停止定期同步
   */
  stopPeriodicSync() {
    if (this.syncCheckTimer) {
      clearInterval(this.syncCheckTimer);
      this.syncCheckTimer = null;
    }
  }

  /**
   * 取得校正後的伺服器時間（毫秒級）
   * 應該在所有需要參考時間的地方使用此方法
   */
  getServerTime() {
    // 伺服器時間 = 本地時間 - 時間偏差
    return Date.now() - this.timeOffset;
  }

  /**
   * 取得目前本地時間（毫秒級）
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
      samples: this.syncSamples,
    };
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
        hour12: false,
      });

      let result = formatter.format(date).replace(/\//g, "-");

      // 如果需要毫秒
      if (options.includeMilliseconds) {
        const ms = String(date.getMilliseconds()).padStart(3, "0");
        result += `.${ms}`;
      }

      return result;
    } catch (error) {
      console.error("[TimeSyncManager] 時間格式化失敗:", error);
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
      console.error("[TimeSyncManager] 時間格式化失敗:", error);
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
      console.error("[TimeSyncManager] 日期格式化失敗:", error);
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

export default TimeSyncManager;
