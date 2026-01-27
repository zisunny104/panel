/**
 * PanelManager - 面板管理器
 *
 * 確保只有一個面板同時開啟
 * 負責設定面板和實驗面板的管理
 */
class PanelManager {
  /**
   * 建構子 - 初始化面板管理器
   */
  constructor() {
    this.currentOpenPanel = null;
    this.panels = {
      settings: {
        element: null,
        button: null,
        closeButton: null,
      },
      experiment: {
        element: null,
        button: null,
        closeButton: null,
      },
    };

    this.initializePanels();
    this.setupEventListeners();

    // 視窗大小改變時重新定位設定面板，保持與切換按鈕對齊
    window.addEventListener("resize", () => {
      if (this.currentOpenPanel === "settings")
        this.alignPanelToButton("settings");
    });
  }

  /**
   * 將面板垂直對齊到其切換按鈕
   * @param {string} panelName - 面板名稱
   */
  alignPanelToButton(panelName) {
    const panel = this.panels[panelName];
    if (!panel || !panel.element || !panel.button) return;

    try {
      const btnRect = panel.button.getBoundingClientRect();
      // 計算底部位置（px），使面板底部與按鈕底部對齊並加上小偏移
      const offset = 8; // px
      let bottomPx = Math.max(
        8,
        Math.round(window.innerHeight - btnRect.bottom + offset),
      );
      panel.element.style.bottom = `${bottomPx}px`;
    } catch (e) {
      // 如果出現任何錯誤，優雅地忽略並保留 CSS 預設值
      Logger && Logger.warn && Logger.warn("alignPanelToButton failed:", e);
    }
  }

  /**
   * 初始化面板引用
   */
  initializePanels() {
    this.panels.settings.element = document.querySelector(".settings-panel");
    this.panels.settings.button = document.getElementById("toggleButton");
    this.panels.settings.closeButton =
      document.getElementById("closeSettingsPanel");

    this.panels.experiment.element = document.getElementById("experimentPanel");
    this.panels.experiment.button = document.getElementById(
      "experimentPanelButton",
    );
    this.panels.experiment.closeButton = document.getElementById(
      "closeExperimentPanel",
    );
  }

  /**
   * 設定事件監聽器
   */
  setupEventListeners() {
    if (this.panels.settings.button) {
      this.panels.settings.button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.togglePanel("settings");
      });
    }

    if (this.panels.settings.closeButton) {
      this.panels.settings.closeButton.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.closePanel("settings");
      });
    }

    if (this.panels.experiment.button) {
      this.panels.experiment.button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.togglePanel("experiment");
      });
    }

    if (this.panels.experiment.closeButton) {
      this.panels.experiment.closeButton.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.closePanel("experiment");
      });
    }

    // 點擊外部關閉面板
    this.setupOutsideClickListener();
  }

  /**
   * 設定點擊外部關閉面板的監聽器
   */
  setupOutsideClickListener() {
    document.addEventListener("click", (e) => {
      if (!this.hasOpenPanel()) {
        return;
      }

      const currentPanel = this.panels[this.currentOpenPanel];
      if (!currentPanel || !currentPanel.element) {
        return;
      }

      const isClickInsidePanel = currentPanel.element.contains(e.target);
      const isClickOnButton =
        currentPanel.button && currentPanel.button.contains(e.target);

      // 如果點擊在面板外部且不是開啟按鈕，關閉面板
      if (!isClickInsidePanel && !isClickOnButton) {
        this.closePanel(this.currentOpenPanel);
      }
    });
  }

  /**
   * 切換面板
   * @param {string} panelName - 面板名稱
   */
  togglePanel(panelName) {
    // 如果目前已經有面板開啟，且不是要切換的面板，先關閉它
    if (this.currentOpenPanel && this.currentOpenPanel !== panelName) {
      this.closePanel(this.currentOpenPanel);
    }

    if (this.currentOpenPanel === panelName) {
      this.closePanel(panelName);
    } else {
      this.openPanel(panelName);
    }
  }

  /**
   * 開啟面板
   * @param {string} panelName - 面板名稱
   */
  openPanel(panelName) {
    const panel = this.panels[panelName];
    if (!panel || !panel.element) {
      Logger.warn(`Panel not found: ${panelName}`);
      return;
    }

    // 關閉其他面板
    Object.keys(this.panels).forEach((name) => {
      if (name !== panelName) {
        this.closePanel(name);
      }
    });

    if (panelName === "settings") {
      if (panel.element.classList.contains("hidden")) {
        panel.element.classList.remove("hidden");
      }
      panel.element.style.display = "block";
      // 對齊到設定切換按鈕，避免 UI 縮放時垂直位置偏移
      this.alignPanelToButton("settings");
    } else if (panelName === window.SyncManager?.PAGE?.EXPERIMENT) {
      panel.element.style.display = "block";
    }

    this.currentOpenPanel = panelName;

    // 只記錄設定面板的操作，實驗面板不記錄
    if (window.logger && panelName === "settings") {
      window.logger.logAction("開啟設定面板");
    }
  }

  /**
   * 關閉面板
   * @param {string} panelName - 面板名稱
   */
  closePanel(panelName) {
    const panel = this.panels[panelName];
    if (!panel || !panel.element) {
      return;
    }

    if (panelName === "settings") {
      panel.element.classList.add("hidden");
      panel.element.style.display = "none";
    } else if (panelName === window.SyncManager?.PAGE?.EXPERIMENT) {
      panel.element.style.display = "none";
    }

    // 如果關閉的是目前開啟的面板，清除記錄
    if (this.currentOpenPanel === panelName) {
      this.currentOpenPanel = null;
    }

    // 只記錄設定面板的操作，實驗面板不記錄
    if (window.logger && panelName === "settings") {
      window.logger.logAction("關閉設定面板");
    }
  }

  /**
   * 檢查是否有面板開啟
   * @returns {boolean} 是否有面板開啟
   */
  hasOpenPanel() {
    return this.currentOpenPanel !== null;
  }
}

// 匯出單例
window.panelManager = new PanelManager();
