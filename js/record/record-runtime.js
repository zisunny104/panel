/**
 * recordRuntime - JSONL 檔案輸出層
 *
 * 專責透過 API 儲存 JSONL 到 runtime 目錄。
 * 作為 mixin 混入 RecordManager。
 */

export const recordRuntime = {
  /**
   * 儲存日誌到 runtime/experiment-data 資料夾
   * @returns {Promise<boolean>}
   */
  async _saveToRuntimeFolder() {
    if (this.records.length === 0) {
      Logger.debug("沒有日誌需要儲存");
      return false;
    }

    try {
      const jsonlContent = this.records.map((record) => JSON.stringify(record)).join("\n");
      const filename = `${this.experimentId}_${Date.now()}.jsonl`;
      const apiUrl = this._getApiUrl();

      const response = await fetch(`${apiUrl}/record/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, content: jsonlContent }),
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

      Logger.warn(`無法連接到後端 API (${response.status})，日誌僅儲存於 IndexedDB`);
      return false;
    } catch (error) {
      Logger.warn("儲存到 runtime 資料夾失敗（僅儲存於 IndexedDB）:", error.message);
      return false;
    }
  },

  _getApiUrl() {
    return `${window.location.protocol}//${window.location.host}${this._getApiBasePath()}`;
  },

  _getApiBasePath() {
    let basePath = window.location.pathname;
    if (!basePath.endsWith("/")) {
      basePath = basePath.substring(0, basePath.lastIndexOf("/") + 1);
    }
    return basePath + "api";
  },
};
