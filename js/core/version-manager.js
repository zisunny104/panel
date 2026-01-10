/**
 * 版本管理器
 * 已棄用：版本管理功能已移至 ConfigManager (config.js)
 * 此檔案保留僅供參考，實際功能不再使用
 */
class VersionManager {
  constructor() {
    this.configUrl = "./data/config.json";
    // this.apiUrl = "./php/api.php"; // 已棄用：PHP API 不再存在
  }

  /**
   * 將時間戳轉換為5位短代碼
   */
  timestampToShortCode(timestamp) {
    // 取時間戳的後8位，轉為36進制，取前5位
    return timestamp.toString(36).slice(-5);
  }

  /**
   * 產生新的版本號
   */
  generateNewVersion(currentVersion = "1.5.gv0tm") {
    const versionParts = currentVersion.split(".");
    const major = parseInt(versionParts[0]) || 1;
    const minor = parseInt(versionParts[1]) || 1;

    // 產生基於時間戳的短代碼 (5位字符)
    const timestamp = Date.now();
    const shortCode = this.timestampToShortCode(timestamp);

    return `${major}.${minor}.${shortCode}`;
  }

  /**
   * 取得目前版本資訊
   */
  async getCurrentVersion() {
    try {
      const response = await fetch(this.configUrl);
      if (!response.ok) {
        throw new Error("無法讀取設定檔案");
      }
      return await response.json();
    } catch (error) {
      Logger.error("讀取版本資訊失敗:", error.message);
      throw error;
    }
  }

  /**
   * 更新版本號
   */
  async updateVersion() {
    try {
      // 讀取現有的設定
      const configData = await this.getCurrentVersion();

      const currentVersion = configData.version || "1.5.0";
      const newVersion = this.generateNewVersion(currentVersion);
      const updateTime = new Date().toISOString();

      // 更新版本號和時間戳
      configData.version = newVersion;
      configData.updated_at = updateTime;

      // 已棄用：PHP API 不再存在，版本更新功能已移至 ConfigManager
      // 實際應用中請使用 window.configManager.updateVersion()
      /*
      const response = await fetch("api.php?action=update_config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(configData),
      });

      if (!response.ok) {
        throw new Error("儲存設定失敗");
      }
      */

      Logger.info(`版本更新成功（僅供參考，請使用 ConfigManager）:`);
      Logger.info(`   舊版本: ${currentVersion}`);
      Logger.info(`   新版本: ${newVersion}`);
      Logger.info(`   更新時間: ${updateTime}`);

      return {
        oldVersion: currentVersion,
        newVersion: newVersion,
        updateTime: updateTime,
      };
    } catch (error) {
      Logger.error("版本更新失敗:", error.message);
      throw error;
    }
  }

  /**
   * 顯示目前版本資訊
   */
  async showCurrentVersion() {
    try {
      const configData = await this.getCurrentVersion();
      Logger.info(`目前版本資訊:`);
      Logger.info(`   版本號: ${configData.version}`);
      Logger.info(`   作者: ${configData.author}`);
      Logger.info(`   建立時間: ${configData.created_at}`);
      Logger.info(`   更新時間: ${configData.updated_at || "未設定"}`);
      Logger.info(`   描述: ${configData.description}`);
      return configData;
    } catch (error) {
      Logger.error("讀取版本資訊失敗:", error.message);
      throw error;
    }
  }
}

// 建立全域實例
window.versionManager = new VersionManager();
