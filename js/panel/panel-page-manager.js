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
      if (typeof Logger !== "undefined") {
        Logger.info("PanelPageManager 開始初始化");
      } else {
        console.log("[PanelPageManager] 開始初始化");
      }

      // 1. 載入核心腳本
      const coreStart = performance.now();
      if (typeof Logger !== "undefined") {
        Logger.debug("開始載入核心腳本");
      }
      await this.loadCoreScripts();
      if (typeof Logger !== "undefined") {
        Logger.debug(
          `核心腳本載入完成 (耗時: ${(performance.now() - coreStart).toFixed(0)}ms)`,
        );
      }

      // 2. 載入 UI 控制腳本
      const uiStart = performance.now();
      if (typeof Logger !== "undefined") {
        Logger.debug("開始載入 UI 腳本");
      }
      await this.loadUIScripts();
      if (typeof Logger !== "undefined") {
        Logger.debug(
          `UI 腳本載入完成 (耗時: ${(performance.now() - uiStart).toFixed(0)}ms)`,
        );
      }

      // 3. 載入實驗管理腳本
      const expStart = performance.now();
      if (typeof Logger !== "undefined") {
        Logger.debug("開始載入實驗管理腳本");
      }
      await this.loadExperimentScripts();
      if (typeof Logger !== "undefined") {
        Logger.debug(
          `實驗管理腳本載入完成 (耗時: ${(performance.now() - expStart).toFixed(0)}ms)`,
        );
      }

      // 4. 載入同步相關腳本
      const syncStart = performance.now();
      if (typeof Logger !== "undefined") {
        Logger.debug("開始載入同步腳本");
      }
      await this.loadSyncScripts();
      if (typeof Logger !== "undefined") {
        Logger.debug(
          `同步腳本載入完成 (耗時: ${(performance.now() - syncStart).toFixed(0)}ms)`,
        );
        Logger.info(
          `所有腳本載入完成 (總耗時: ${(performance.now() - startTime).toFixed(0)}ms)`,
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
        console.error(`初始化失敗:`, error);
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
    ];

    for (const script of coreScripts) {
      if (typeof Logger !== "undefined") {
        Logger.debug(`載入核心腳本: ${script}`);
      }
      await this.loadScript(script);
    }
    this.coreScriptsLoaded = true;
  }

  /**
   * 載入 UI 控制腳本
   */
  async loadUIScripts() {
    const uiScripts = [
      "js/panel/panel-ui-controls.js",
      "js/panel/panel-button-manager.js",
    ];

    for (const script of uiScripts) {
      if (typeof Logger !== "undefined") {
        Logger.debug(`載入 UI 腳本: ${script}`);
      }
      await this.loadScript(script);
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
      "js/panel/panel-experiment-media.js",
      "js/panel/panel-experiment-power.js",
      "js/panel/panel-experiment-timer.js",
      "js/panel/panel-experiment-ui.js",
      "js/panel/panel-experiment-manager.js", // module
    ];

    for (const script of experimentScripts) {
      if (typeof Logger !== "undefined") {
        Logger.debug(`載入實驗腳本: ${script}`);
      }
      const isModule = script.includes("panel-experiment-manager.js");
      await this.loadScript(script, isModule);
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

    for (const script of syncScripts) {
      if (typeof Logger !== "undefined") {
        Logger.debug(`載入同步腳本: ${script}`);
      }
      const isModule =
        script.includes(".mjs") || script.includes("sync-manager.js");
      await this.loadScript(script, isModule);
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
        if (typeof Logger !== "undefined") {
          Logger.debug(`腳本已快取: ${src}`);
        }
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      if (isModule) {
        script.type = "module";
      }
      script.onload = () => {
        if (typeof Logger !== "undefined") {
          Logger.debug(
            `腳本載入成功: ${src} (耗時: ${(performance.now() - loadStart).toFixed(0)}ms)`,
          );
        }
        resolve();
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
      Logger.info("所有腳本載入完成，開始載入應用啟動腳本");
    }

    // 載入應用啟動腳本
    const mainStart = performance.now();
    this.loadScript("js/core/main.js")
      .then(() => {
        if (typeof Logger !== "undefined") {
          Logger.info(
            `應用啟動完成 (耗時: ${(performance.now() - mainStart).toFixed(0)}ms)`,
          );
        }
      })
      .catch((error) => {
        if (typeof Logger !== "undefined") {
          Logger.error(
            `載入主應用程式失敗 (耗時: ${(performance.now() - mainStart).toFixed(0)}ms)`,
            error,
          );
        } else {
          console.error(`載入主應用程式失敗:`, error);
        }
      });
  }
}

// 建立全域實例
window.panelPageManager = new PanelPageManager();
