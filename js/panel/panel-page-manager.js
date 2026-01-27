/**
 * PanelPageManager - 面板頁面管理器
 *
 * 負責整個面板頁面的腳本載入、初始化和管理
 * 作為面板頁面的主要入口點，協調各個模組
 */

class PanelPageManager {
  constructor() {
    // 頁面載入狀態
    this.coreScriptsLoaded = false;
    this.experimentManagerLoaded = false;

    // 初始化頁面
    this.initialize();
  }

  /**
   * 初始化面板頁面
   */
  async initialize() {
    const startTime = performance.now();
    try {
      Logger.debug("PanelPageManager 開始初始化");

      // 1. 載入核心腳本
      const coreStart = performance.now();
      await this.loadCoreScripts();

      // 2. 載入 UI 控制腳本
      const uiStart = performance.now();
      await this.loadUIScripts();

      // 3. 載入實驗管理腳本
      const expStart = performance.now();
      await this.loadExperimentScripts();

      // 4. 載入同步相關腳本
      const syncStart = performance.now();
      await this.loadSyncScripts();
      if (typeof Logger !== "undefined") {
        Logger.debug(
          `所有腳本載入完成 (<orange>${(performance.now() - startTime).toFixed(0)} ms</orange>)`,
        );
      }

      // 5. 初始化完成
      this.onInitializationComplete();
    } catch (error) {
      if (typeof Logger !== "undefined") {
        Logger.error(
          `PanelPageManager 初始化失敗 (耗時: ${(performance.now() - startTime).toFixed(0)}ms)`,
          error,
        );
      } else {
        console.error("初始化失敗:", error);
      }
    }
  }

  /**
   * 載入核心腳本
   */
  async loadCoreScripts() {
    const coreScripts = [
      "js/core/console-manager.js",
      "js/core/random-utils.js",
      "js/core/config.js",
      "js/core/data-loader.js",
      "js/core/time-sync-manager.js",
      "js/core/websocket-client.js",
      "js/sync/sync-client.js",
      "js/core/action-manager.js",
      "js/core/combination-selector.js", // module
    ];

    const startTime = performance.now();
    let loadedCount = 0;
    let cachedCount = 0;

    for (const script of coreScripts) {
      const isModule =
        script.includes("combination-selector.js") ||
        script.includes("random-utils.js") ||
        script.includes("data-loader.js");
      const wasCached = await this.loadScript(script, isModule);
      if (wasCached) {
        cachedCount++;
      } else {
        loadedCount++;
      }
    }

    if (typeof Logger !== "undefined") {
      const totalTime = performance.now() - startTime;
      Logger.debug(
        `核心腳本載入完成: <green>${loadedCount}</green> 個載入, <cyan>${cachedCount}</cyan> 個快取 (<orange>${totalTime.toFixed(0)} ms</orange>)`,
      );
    }

    this.coreScriptsLoaded = true;
  }

  /**
   * 載入 UI 控制腳本
   */
  async loadUIScripts() {
    const uiScripts = [
      "js/panel/panel-manager.js",
      "js/panel/panel-ui-controls.js",
      "js/panel/panel-button-manager.js",
      "js/panel/panel-logger.js",
      "js/panel/panel-power-control.js",
    ];

    const startTime = performance.now();
    let loadedCount = 0;
    let cachedCount = 0;

    for (const script of uiScripts) {
      const wasCached = await this.loadScript(script);
      if (wasCached) {
        cachedCount++;
      } else {
        loadedCount++;
      }
    }

    if (typeof Logger !== "undefined") {
      const totalTime = performance.now() - startTime;
      Logger.debug(
        `UI 腳本載入完成: <green>${loadedCount}</green> 個載入, <cyan>${cachedCount}</cyan> 個快取 (<orange>${totalTime.toFixed(0)} ms</orange>)`,
      );
    }
  }

  /**
   * 載入實驗管理腳本
   */
  async loadExperimentScripts() {
    const experimentScripts = [
      "js/panel/panel-experiment-sync.js",
      "js/panel/panel-experiment-flow.js",
      "js/panel/panel-experiment-units.js",
      "js/panel/panel-media-manager.js",
      "js/panel/panel-experiment-media.js",
      "js/panel/panel-experiment-power.js",
      "js/panel/panel-experiment-timer.js",
      "js/panel/panel-experiment-ui.js",
      "js/panel/panel-experiment-manager.js", // module
    ];

    const startTime = performance.now();
    let loadedCount = 0;
    let cachedCount = 0;

    for (const script of experimentScripts) {
      const isModule = script.includes("panel-experiment-manager.js");
      const wasCached = await this.loadScript(script, isModule);
      if (wasCached) {
        cachedCount++;
      } else {
        loadedCount++;
      }
    }

    if (typeof Logger !== "undefined") {
      const totalTime = performance.now() - startTime;
      Logger.debug(
        `實驗腳本載入完成: <green>${loadedCount}</green> 個載入, <cyan>${cachedCount}</cyan> 個快取 (<orange>${totalTime.toFixed(0)} ms</orange>)`,
      );
    }

    this.experimentManagerLoaded = true;
  }

  /**
   * 載入同步相關腳本
   */
  async loadSyncScripts() {
    const syncScripts = [
      "js/sync/sync-confirm-dialog.js",
      "js/sync/sync-manager.js", // module
    ];

    const startTime = performance.now();
    let loadedCount = 0;
    let cachedCount = 0;

    for (const script of syncScripts) {
      const isModule =
        script.includes(".mjs") || script.includes("sync-manager.js");
      const wasCached = await this.loadScript(script, isModule);
      if (wasCached) {
        cachedCount++;
      } else {
        loadedCount++;
      }
    }

    if (typeof Logger !== "undefined") {
      const totalTime = performance.now() - startTime;
      Logger.debug(
        `同步腳本載入完成: <green>${loadedCount}</green> 個載入, <cyan>${cachedCount}</cyan> 個快取 (<orange>${totalTime.toFixed(0)} ms</orange>)`,
      );
    }
  }

  /**
   * 通用腳本載入方法
   */
  loadScript(src, isModule = false) {
    return new Promise((resolve, reject) => {
      const loadStart = performance.now();
      // 檢查是否已經載入
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve(true); // 返回 true 表示已快取
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      if (isModule) {
        script.type = "module";
      }
      script.onload = () => {
        resolve(false); // 返回 false 表示新載入
      };
      script.onerror = () => {
        const error = `載入腳本失敗: ${src} (耗時: ${(performance.now() - loadStart).toFixed(0)}ms)`;
        if (typeof Logger !== "undefined") {
          Logger.error(error);
        } else {
          console.error(error);
        }
        reject(new Error(error));
      };
      document.head.appendChild(script);
    });
  }

  /**
   * 初始化完成後的處理
   */
  onInitializationComplete() {
    if (typeof Logger !== "undefined") {
      Logger.debug("所有腳本載入完成，開始載入應用啟動腳本");
    }

    // 載入應用啟動腳本
    const mainStart = performance.now();
    this.loadScript("js/core/main.js")
      .then(() => {
        if (typeof Logger !== "undefined") {
          Logger.debug(
            `應用啟動完成 (<orange>${(performance.now() - mainStart).toFixed(0)} ms</orange>)`,
          );
        }
      })
      .catch((error) => {
        if (typeof Logger !== "undefined") {
          Logger.error(
            `載入主應用程式失敗 (<orange>${(performance.now() - mainStart).toFixed(0)} ms</orange>)`,
            error,
          );
        } else {
          console.error("載入主應用程式失敗:", error);
        }
      });
  }
}

// 建立全域實例
window.panelPageManager = new PanelPageManager();
