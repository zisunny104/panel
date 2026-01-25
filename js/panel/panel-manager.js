// panel-manager.js - 面板管理器，確保只有一個面板同時開啟

class PanelManager {
  constructor() {
    this.currentOpenPanel = null;
    this.panels = {
      settings: {
        element: null,
        button: null,
        closeButton: null
      },
      experiment: {
        element: null,
        button: null,
        closeButton: null
      }
    };

    this.initializePanels();
    this.setupEventListeners();

    // reposition settings panel on resize to keep it aligned with the toggle button
    window.addEventListener("resize", () => {
      if (this.currentOpenPanel === "settings")
        this.alignPanelToButton("settings");
    });
  }

  // Align a panel (settings) vertically to its toggle button to avoid misplacement when scale/zoom changes
  alignPanelToButton(panelName) {
    const panel = this.panels[panelName];
    if (!panel || !panel.element || !panel.button) return;

    try {
      const btnRect = panel.button.getBoundingClientRect();
      // compute bottom in px so panel bottom aligns to the button's bottom + small offset
      const offset = 8; // px
      let bottomPx = Math.max(
        8,
        Math.round(window.innerHeight - btnRect.bottom + offset)
      );
      panel.element.style.bottom = `${bottomPx}px`;
      // keep right offset as defined in CSS; if button moves horizontally due to scale, optionally align right
      // const rightPx = Math.round(window.innerWidth - btnRect.right + offset);
      // panel.element.style.right = `${rightPx}px`;
    } catch (e) {
      // if anything goes wrong, gracefully ignore and leave CSS defaults
      Logger && Logger.warn && Logger.warn("alignPanelToButton failed:", e);
    }
  }

  // 初始化面板引用
  initializePanels() {
    // 設定面板
    this.panels.settings.element = document.querySelector(".settings-panel");
    this.panels.settings.button = document.getElementById("toggleButton");
    this.panels.settings.closeButton =
      document.getElementById("closeSettingsPanel");

    // 實驗面板
    this.panels.experiment.element = document.getElementById("experimentPanel");
    this.panels.experiment.button = document.getElementById(
      "experimentPanelButton"
    );
    this.panels.experiment.closeButton = document.getElementById(
      "closeExperimentPanel"
    );
  }

  // 設定事件監聽器
  setupEventListeners() {
    // 設定面板按鈕
    if (this.panels.settings.button) {
      this.panels.settings.button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.togglePanel("settings");
      });
    }

    // 設定面板關閉按鈕
    if (this.panels.settings.closeButton) {
      this.panels.settings.closeButton.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.closePanel("settings");
      });
    }

    // 實驗面板按鈕
    if (this.panels.experiment.button) {
      this.panels.experiment.button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.togglePanel("experiment");
      });
    }

    // 實驗面板關閉按鈕
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

  // 設定點擊外部關閉面板的監聽器
  setupOutsideClickListener() {
    document.addEventListener("click", (e) => {
      // 如果沒有面板開啟，不處理
      if (!this.hasOpenPanel()) {
        return;
      }

      // 取得目前開啟的面板
      const currentPanel = this.panels[this.currentOpenPanel];
      if (!currentPanel || !currentPanel.element) {
        return;
      }

      // 檢查點擊是否在面板內部
      const isClickInsidePanel = currentPanel.element.contains(e.target);

      // 檢查點擊是否在開啟按鈕上
      const isClickOnButton =
        currentPanel.button && currentPanel.button.contains(e.target);

      // 如果點擊在面板外部且不是開啟按鈕，關閉面板
      if (!isClickInsidePanel && !isClickOnButton) {
        this.closePanel(this.currentOpenPanel);
      }
    });
  }

  // 切換面板
  togglePanel(panelName) {
    // 如果目前已經有面板開啟，且不是要切換的面板，先關閉它
    if (this.currentOpenPanel && this.currentOpenPanel !== panelName) {
      this.closePanel(this.currentOpenPanel);
    }

    // 切換目標面板
    if (this.currentOpenPanel === panelName) {
      this.closePanel(panelName);
    } else {
      this.openPanel(panelName);
    }
  }

  // 開啟面板
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

    // 開啟目標面板
    if (panelName === "settings") {
      if (panel.element.classList.contains("hidden")) {
        panel.element.classList.remove("hidden");
      }
      panel.element.style.display = "block";
      // align to the settings toggle button to prevent vertical misplacement when UI scale changes
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

  // 關閉面板
  closePanel(panelName) {
    const panel = this.panels[panelName];
    if (!panel || !panel.element) {
      return;
    }

    // 關閉面板
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

  // 關閉所有面板
  closeAllPanels() {
    Object.keys(this.panels).forEach((panelName) => {
      this.closePanel(panelName);
    });

    this.currentOpenPanel = null;
  }

  // 取得目前開啟的面板
  getCurrentOpenPanel() {
    return this.currentOpenPanel;
  }

  // 檢查面板是否開啟
  isPanelOpen(panelName) {
    return this.currentOpenPanel === panelName;
  }

  // 檢查是否有面板開啟
  hasOpenPanel() {
    return this.currentOpenPanel !== null;
  }
}

// 匯出單例
window.panelManager = new PanelManager();





