/**
 * LogManagerRuntimeWriter - runtime 寫檔與 API 路徑
 *
 * 專責保存 JSONL 檔案到 runtime 目錄。
 */

export const logRuntimeWriter = {
  /**
   * 儲存日誌到 runtime/experiment-data 資料夾
   * @private
   */
  async _saveToRuntimeFolder() {
    if (this.logs.length === 0) {
      Logger.debug("沒有日誌需要儲存");
      return false;
    }

    try {
      const jsonlContent = this.logs
        .map((log) => JSON.stringify(log))
        .join("\n");

      const timestamp = Date.now();
      const filename = `${this.experimentId}_${timestamp}.jsonl`;

      const apiUrl = this._getApiUrl();

      const response = await fetch(`${apiUrl}/experiment-logs/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filename: filename,
          content: jsonlContent,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          Logger.info(`日誌已儲存到 ${result.path}`);
          return true;
        }
        Logger.warn(`儲存日誌失敗: ${result.error}`);
        return false;
      }

      Logger.warn(
        `無法連接到後端 API (${response.status})，日誌僅儲存於 IndexedDB`,
      );
      return false;
    } catch (error) {
      Logger.warn(
        "儲存到 runtime 資料夾失敗（僅儲存於 IndexedDB）:",
        error.message,
      );
      return false;
    }
  },

  /**
   * 取得 API URL（支援 Nginx 反向代理）
   * @private
   */
  _getApiUrl() {
    const protocol = window.location.protocol;
    const host = window.location.host;

    const basePath = this._getApiBasePath();

    return `${protocol}//${host}${basePath}`;
  },

  /**
   * 取得 API 路徑前綴（參考 QR Code 的動態路徑邏輯，完全避免硬編碼）
   * @private
   */
  _getApiBasePath() {
    const pathname = window.location.pathname;

    let basePath = pathname;
    if (!basePath.endsWith("/")) {
      basePath = basePath.substring(0, basePath.lastIndexOf("/") + 1);
    }

    if (!basePath.endsWith("/")) {
      basePath += "/";
    }

    return basePath + "api";
  },
};
