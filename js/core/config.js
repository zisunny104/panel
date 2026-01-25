// config.js - 設定與設定管理模塊

// ========== 全域除錯開關 ==========
// 注意：DEBUG_MODE、debugLog、toggleDebugMode 現在由 ConsoleManager 管理
// 為了向後相容性，這些函數仍然可用，但建議直接使用 ConsoleManager

/**
 * ConfigManager 負責管理設定的載入、套用、儲存與事件監聽。
 */
class ConfigManager {
  constructor() {
    this.defaultSettings = {};
    this.userSettings = {};
    this.resetLanguageOnLoad = true;
    this.configData = {}; // 儲存完整的 config.json 資料
  }

  /**
   * 載入設定檔設定，優先使用 localStorage，否則載入 config.json。
   */
  async loadConfigSettings() {
    try {
      // 先載入 config.json 來取得預設設定
      const response = await fetch("./data/config.json", {
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache"
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const config = await response.json();
      this.configData = config; // 儲存完整的 config 資料
      window.CONFIG = config; // 暴露到全域作用域供其他模塊使用
      this.defaultSettings = config.settings || {};

      // 嘗試載入本機存儲的設定
      const saved = localStorage.getItem("userSettings");
      if (saved) {
        try {
          this.userSettings = JSON.parse(saved);
          // 合併預設設定和使用者設定
          this.userSettings = { ...this.defaultSettings, ...this.userSettings };
        } catch (e) {
          Logger.warn("本機設定解析失敗，使用預設設定");
          this.userSettings = { ...this.defaultSettings };
        }
      } else {
        this.userSettings = { ...this.defaultSettings };
      }

      // 立即套用設定
      await this.applySettings(this.userSettings);

      // 載入版本資訊到 UI
      this.loadVersionInfo();
    } catch (error) {
      Logger.warn("載入設定失敗:", error.message);
      // 設定預設版本資訊
      this.configData = {
        version: "1.1.dev",
        author: "開發版本",
        description: "虛擬操作面板"
      };
      // 仍然嘗試載入版本資訊
      if (window.Logger) {
        this.loadVersionInfo();
      }
    }
  }

  /**
   * 重設使用者設定到預設值（會清除 localStorage 的 userSettings）
   */
  async resetUserSettingsToDefaults() {
    // silently reset to defaults without additional browser confirmation
    try {
      localStorage.removeItem("userSettings");
      this.userSettings = { ...this.defaultSettings };
      await this.applySettings(this.userSettings);
      // 一旦應用到 DOM，上面的 saveUserSettings() 監聽器會儲存新的值
      this.saveUserSettings();
      if (window.Logger) Logger.info("使用者設定已還原為預設值");
      // 通知 UI
      document.dispatchEvent(new CustomEvent("userSettingsReset", {}));
    } catch (e) {
      Logger.error("重設設定失敗:", e);
    }
  }

  /**
   * 將設定值套用到 UI 元素。
   * @param {Object} settings 設定物件
   */
  async applySettings(settings) {
    // 等待 DOM 完全載入
    if (document.readyState !== "complete") {
      await new Promise((resolve) =>
        window.addEventListener("load", resolve, { once: true })
      );
    }

    // 取得所有相關 DOM 元素
    const scaleRange = document.getElementById("scaleRange");
    const scaleNumberInput = document.getElementById("scaleNumberInput");
    const topSpacerRange = document.getElementById("topSpacerRange");
    const topSpacerNumberInput = document.getElementById(
      "topSpacerNumberInput"
    );
    const bottomSpacerRange = document.getElementById("bottomSpacerRange");
    const bottomSpacerNumberInput = document.getElementById(
      "bottomSpacerNumberInput"
    );
    const powerScaleRange = document.getElementById("powerScaleRange");
    const powerScaleNumberInput = document.getElementById(
      "powerScaleNumberInput"
    );
    const toggleButtonLabels = document.getElementById("toggleButtonLabels");
    const toggleButtonColors = document.getElementById("toggleButtonColors");
    const toggleTouchVisuals = document.getElementById("toggleTouchVisuals");
    const toggleMediaAreaMarker = document.getElementById(
      "toggleMediaAreaMarker"
    );
    const toggleMediaContent = document.getElementById("toggleMediaContent");
    const toggleBeepSound = document.getElementById("toggleBeepSound");

    // 主縮放設定
    if (settings.mainScale !== undefined && scaleRange) {
      scaleRange.value = settings.mainScale;
      if (scaleNumberInput) scaleNumberInput.value = settings.mainScale;
      // 套用縮放
      if (window.uiControls) {
        window.uiControls.updateScale(settings.mainScale);
      }
    }
    // 上方間距設定
    if (settings.topSpacerHeight !== undefined && topSpacerRange) {
      topSpacerRange.value = settings.topSpacerHeight;
      if (topSpacerNumberInput)
        topSpacerNumberInput.value = settings.topSpacerHeight;
      // 套用頂部間距
      if (window.uiControls) {
        window.uiControls.updateTopSpacer(settings.topSpacerHeight);
      }
    }

    // 底部間距設定
    if (settings.bottomSpacerHeight !== undefined && bottomSpacerRange) {
      bottomSpacerRange.value = settings.bottomSpacerHeight;
      if (bottomSpacerNumberInput)
        bottomSpacerNumberInput.value = settings.bottomSpacerHeight;
      if (window.uiControls) {
        window.uiControls.updateBottomSpacer(settings.bottomSpacerHeight);
      }
    }

    // 電源按鈕縮放
    if (settings.powerSwitchScale !== undefined && powerScaleRange) {
      powerScaleRange.value = settings.powerSwitchScale;
      if (powerScaleNumberInput)
        powerScaleNumberInput.value = settings.powerSwitchScale;
      if (window.uiControls) {
        window.uiControls.updatePowerScale(settings.powerSwitchScale);
      }
    }
    // 按鈕標籤顯示
    if (settings.showButtonLabels !== undefined && toggleButtonLabels)
      toggleButtonLabels.checked = settings.showButtonLabels;
    // 按鈕顏色顯示
    if (settings.showButtonColors !== undefined && toggleButtonColors)
      toggleButtonColors.checked = settings.showButtonColors;
    // 觸控視覺顯示
    if (settings.showTouchVisuals !== undefined && toggleTouchVisuals)
      toggleTouchVisuals.checked = settings.showTouchVisuals;
    // 媒體區域標記顯示
    if (settings.showMediaAreaMarker !== undefined && toggleMediaAreaMarker)
      toggleMediaAreaMarker.checked = settings.showMediaAreaMarker;
    // 媒體內容顯示
    if (settings.showMediaContent !== undefined && toggleMediaContent)
      toggleMediaContent.checked = settings.showMediaContent;
    // 蜂鳴聲播放
    if (settings.playBeepSound !== undefined && toggleBeepSound)
      toggleBeepSound.checked = settings.playBeepSound;
  }

  /**
   * 儲存使用者設定到 localStorage。
   */
  saveUserSettings() {
    const scaleRange = document.getElementById("scaleRange");
    const topSpacerRange = document.getElementById("topSpacerRange");
    const bottomSpacerRange = document.getElementById("bottomSpacerRange");
    const powerScaleRange = document.getElementById("powerScaleRange");
    const toggleButtonLabels = document.getElementById("toggleButtonLabels");
    const toggleButtonColors = document.getElementById("toggleButtonColors");
    const toggleTouchVisuals = document.getElementById("toggleTouchVisuals");
    const toggleMediaAreaMarker = document.getElementById(
      "toggleMediaAreaMarker"
    );
    const toggleMediaContent = document.getElementById("toggleMediaContent");
    const toggleBeepSound = document.getElementById("toggleBeepSound");

    this.userSettings = {
      mainScale: scaleRange ? Number(scaleRange.value) : 1.29,
      topSpacerHeight: topSpacerRange ? Number(topSpacerRange.value) : 5,
      bottomSpacerHeight: bottomSpacerRange
        ? Number(bottomSpacerRange.value)
        : 3,
      powerSwitchScale: powerScaleRange ? Number(powerScaleRange.value) : 0.9,
      showButtonLabels: toggleButtonLabels ? toggleButtonLabels.checked : true,
      showButtonColors: toggleButtonColors ? toggleButtonColors.checked : true,
      showTouchVisuals: toggleTouchVisuals ? toggleTouchVisuals.checked : true,
      showMediaAreaMarker: toggleMediaAreaMarker
        ? toggleMediaAreaMarker.checked
        : true,
      showMediaContent: toggleMediaContent ? toggleMediaContent.checked : true,
      playBeepSound: toggleBeepSound ? toggleBeepSound.checked : true
    };
    localStorage.setItem("userSettings", JSON.stringify(this.userSettings));
  }

  /**
   * 設定 UI 元素的事件監聽器，變更時自動儲存設定。
   */
  setupEventListeners() {
    const scaleRange = document.getElementById("scaleRange");
    const scaleNumberInput = document.getElementById("scaleNumberInput");
    const topSpacerRange = document.getElementById("topSpacerRange");
    const topSpacerNumberInput = document.getElementById(
      "topSpacerNumberInput"
    );
    const toggleButtonLabels = document.getElementById("toggleButtonLabels");
    const toggleButtonColors = document.getElementById("toggleButtonColors");
    const toggleTouchVisuals = document.getElementById("toggleTouchVisuals");
    const toggleMediaAreaMarker = document.getElementById(
      "toggleMediaAreaMarker"
    );
    const toggleMediaContent = document.getElementById("toggleMediaContent");
    const toggleBeepSound = document.getElementById("toggleBeepSound");

    // 監聽所有設定相關元素的 input 事件
    [
      scaleRange,
      scaleNumberInput,
      topSpacerRange,
      topSpacerNumberInput,
      bottomSpacerRange,
      bottomSpacerNumberInput,
      powerScaleRange,
      powerScaleNumberInput,
      toggleButtonLabels,
      toggleButtonColors,
      toggleTouchVisuals,
      toggleMediaAreaMarker,
      toggleMediaContent
    ].forEach((el) => {
      if (el) el.addEventListener("input", () => this.saveUserSettings());
    });

    // 蜂鳴聲獨立監聽
    if (toggleBeepSound) {
      toggleBeepSound.addEventListener("input", () => this.saveUserSettings());
    }
  }

  /**
   * 載入版本資訊到 UI (精簡版，只顯示版本號)
   */
  loadVersionInfo() {
    const versionElement = document.getElementById("appVersion");
    if (window.Logger) {
      Logger.debug("載入版本資訊:", {
        element: !!versionElement,
        version: this.configData.version,
        configData: this.configData
      });
    }

    if (versionElement && this.configData.version) {
      versionElement.textContent = this.configData.version;
      if (window.Logger) {
        Logger.debug("版本號已更新到 UI:", this.configData.version);
      }
    }
    // 版本元素在某些頁面（如 experiment.html）上可能不存在，這是正常的
  }

  /**
   * 產生新的版本號 (格式: major.minor.patch)
   * patch 部分會使用時間戳轉換的短代碼
   */
  generateNewVersion(currentVersion = "1.1.0") {
    const versionParts = currentVersion.split(".");
    const major = parseInt(versionParts[0]) || 1;
    const minor = parseInt(versionParts[1]) || 1;

    // 產生基於時間戳的短代碼 (7位字符)
    const timestamp = Date.now();
    const shortCode = this.timestampToShortCode(timestamp);

    return `${major}.${minor}.${shortCode}`;
  }

  /**
   * 將時間戳轉換為7位短代碼
   * 優先使用 git commit hash，如果無法取得則使用時間戳
   */
  timestampToShortCode(timestamp) {
    try {
      // 嘗試取得 git commit hash
      const gitHash = this.getGitCommitHash();
      if (gitHash && gitHash.length >= 7) {
        return gitHash.substring(0, 7);
      }
    } catch (error) {
      // git 不可用時記錄但不中斷
      if (window.Logger) {
        Logger.debug("無法取得 git commit hash，使用時間戳:", error.message);
      }
    }

    // 回退到時間戳轉換（原邏輯）
    const shortened = timestamp.toString(36).slice(-7);
    return shortened;
  }

  /**
   * 取得 git commit hash
   */
  getGitCommitHash() {
    // 從 config 中讀取 git commit hash
    if (this.configData && this.configData.git_commit_hash) {
      return this.configData.git_commit_hash;
    }
    return null;
  }

  /**
   * 更新版本號
   */
  async updateVersion() {
    try {
      const currentVersion = this.configData.version || "1.1.0";
      const newVersion = this.generateNewVersion(currentVersion);
      const updateTime = new Date().toISOString();

      if (window.Logger) {
        Logger.debug(`版本更新: ${currentVersion} → ${newVersion}`);
        Logger.debug(`更新時間: ${updateTime}`);
      }

      // 在生產環境中，這裡需要向後端發送請求來更新 config.json
      // 這裡我們先更新本機資料
      this.configData.version = newVersion;
      this.configData.updated_at = updateTime;

      // 更新 UI 顯示
      this.loadVersionInfo();

      return {
        oldVersion: currentVersion,
        newVersion: newVersion,
        updateTime: updateTime
      };
    } catch (error) {
      Logger.error("版本更新失敗:", error);
      throw error;
    }
  }

  /**
   * 取得版本資訊
   */
  getVersionInfo() {
    return {
      version: this.configData.version,
      author: this.configData.author,
      created_at: this.configData.created_at,
      updated_at: this.configData.updated_at,
      description: this.configData.description
    };
  }
}

// 匯出單例
window.configManager = new ConfigManager();

// 立即載入設定
window.configManager.loadConfigSettings().catch((err) => {
  Logger.error("設定載入失敗:", err);
});

// 全域版本管理函數
window.updateAppVersion = function () {
  if (window.configManager) {
    return window.configManager.updateVersion();
  } else {
    Logger.error("ConfigManager 尚未初始化");
  }
};

window.getAppVersionInfo = function () {
  if (window.configManager) {
    return window.configManager.getVersionInfo();
  } else {
    Logger.error("ConfigManager 尚未初始化");
    return null;
  }
};

// 測試版本功能
window.testVersionSystem = function () {
  if (window.Logger) {
    Logger.debug("測試版本系統...");
    const versionElement = document.getElementById("appVersion");
    Logger.debug("版本元素:", versionElement);
    Logger.debug(
      "目前顯示:",
      versionElement ? versionElement.textContent : "元素不存在"
    );
    Logger.debug("ConfigManager:", window.configManager);
    Logger.debug("版本資訊:", window.getAppVersionInfo());
  }
  if (window.configManager) {
    window.configManager.loadVersionInfo();
  }
};





