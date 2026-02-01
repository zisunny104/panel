/**
 * PanelUIManager - 面板UI管理器
 *
 * 整合面板管理、UI控制項管理和初始設定載入功能
 * 負責所有UI相關的操作和狀態管理
 */
class PanelUIManager {
  /**
   * 預設設定值
   */
  static DEFAULTS = {
    mainScale: 1.29,
    topSpacerHeight: 5,
    bottomSpacerHeight: 3,
    powerSwitchScale: 0.9,
    beepVolume: 50,
    mediaVolume: 70,
  };

  /**
   * 建構子 - 初始化面板UI管理器
   */
  constructor() {
    // 面板管理相關屬性
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
      logger: {
        element: null,
        button: null,
        closeButton: null,
      },
    };

    // UI控制項相關屬性
    this.settingsPanel = null;
    this.scalable = null;
    this.mediaArea = null;
    this.topSpacerPlaceholder = null;
    this.refCard = null;
    this.powerSwitchArea = null;
    this.powerLightArea = null;
    this.panelBottomRow = null;

    // 初始化所有功能
    this.initialize();
  }

  /**
   * 初始化所有功能
   */
  initialize() {
    // 初始化 DOM 元素引用
    this.initializeDOMReferences();

    // 初始化面板引用
    this.initializePanels();

    // 設定事件監聽器
    this.setupEventListeners();

    // 初始化 UI 控制項狀態
    this.initializeUIState();

    // 載入初始設定
    this.loadInitialSettings();

    // 視窗大小改變時重新定位設定面板
    window.addEventListener("resize", () => {
      if (this.currentOpenPanel === "settings")
        this.alignPanelToButton("settings");
    });
  }

  // ============ 面板管理功能 (來自 PanelManager) ============

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

    this.panels.logger.element = document.getElementById("loggerOutput");
    this.panels.logger.button = document.getElementById("loggerFabButton");
    this.panels.logger.closeButton =
      document.getElementById("closeLoggerPanel");
  }

  /**
   * 顯示元素（使用 class-based 隱藏控制）
   * @param {HTMLElement} element
   */
  showElement(element) {
    if (!element) return;
    element.classList.remove("is-hidden");
  }

  /**
   * 隱藏元素（使用 class-based 隱藏控制）
   * @param {HTMLElement} element
   */
  hideElement(element) {
    if (!element) return;
    element.classList.add("is-hidden");
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
      if (panel.element.classList.contains("is-hidden"))
        panel.element.classList.remove("is-hidden");
      this.showElement(panel.element);
      // 對齊到設定切換按鈕，避免 UI 縮放時垂直位置偏移
      this.alignPanelToButton("settings");
    } else if (panelName === "experiment") {
      if (panel.element.classList.contains("is-hidden")) {
        panel.element.classList.remove("is-hidden");
      }
      this.showElement(panel.element);
      // 初始化實驗面板UI組件
      if (
        window.uiManager &&
        typeof window.uiManager.initializePanelUI === "function"
      ) {
        window.uiManager.initializePanelUI().catch((error) => {
          Logger.error("初始化實驗面板UI失敗:", error);
        });
      }
    } else if (panelName === "logger") {
      if (panel.element.classList.contains("is-hidden"))
        panel.element.classList.remove("is-hidden");
      this.showElement(panel.element);
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
      panel.element.classList.add("is-hidden");
      this.hideElement(panel.element);

      // 關閉設定面板後，保留視覺提示狀態
      const showTouchVisuals =
        localStorage.getItem("showTouchVisuals") !== "false";
      if (showTouchVisuals) {
        document.body.classList.add("visual-hints-enabled");
      }
    } else if (panelName === "experiment") {
      panel.element.classList.add("is-hidden");
      this.hideElement(panel.element);
    } else if (panelName === "logger") {
      panel.element.classList.add("is-hidden");
      this.hideElement(panel.element);
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

  /**
   * 關閉所有打開的面板
   */
  closeAllPanels() {
    if (this.currentOpenPanel) {
      this.closePanel(this.currentOpenPanel);
    }
  }

  // ============ UI控制項功能 (來自 UIControlsManager) ============

  /**
   * 初始化 DOM 元素引用
   */
  initializeDOMReferences() {
    this.settingsPanel = document.getElementById("settingsPanel");
    this.scalable = document.getElementById("scalableArea");
    this.mediaArea = document.getElementById("mediaArea");
    this.topSpacerPlaceholder = document.getElementById("topSpacerPlaceholder");
    this.refCard = document.getElementById("refCard");
    this.powerSwitchArea = document.getElementById("powerSwitchArea");
    this.powerLightArea = document.getElementById("powerLightArea");
    this.panelBottomRow = document.getElementById("panelBottomRow");

    // 設定初始顯示狀態
    if (this.powerSwitchArea) {
      this.showElement(this.powerSwitchArea);
    }
    if (this.powerLightArea) {
      this.showElement(this.powerLightArea);
      Logger.debug("電源燈號區域已顯示 (initializeDOMReferences)");
    }
    if (this.settingsPanel) this.settingsPanel.classList.add("hidden");

    // 初始化媒體區塊視覺提示
    this.initializeMediaAreaVisuals();
  }

  /**
   * 初始化媒體區塊的視覺提示外框
   */
  initializeMediaAreaVisuals() {
    if (!this.mediaArea) return;

    this.mediaArea.classList.add("step-complete-indicator", "power-off");

    const showTouchVisuals =
      localStorage.getItem("showTouchVisuals") !== "false";
    if (!showTouchVisuals) {
      this.mediaArea.classList.add("hidden-indicator");
    } else {
      document.body.classList.add("visual-hints-enabled");
    }
  }

  /**
   * 更新縮放
   * @param {number} value - 縮放比例 (0.5-2.0)
   */
  updateScale(value) {
    const scaleRange = document.getElementById("scaleRange");
    const scaleNumberInput = document.getElementById("scaleNumberInput");

    value = Math.max(0.5, Math.min(2, parseFloat(value)));
    if (this.scalable) this.scalable.style.transform = `scale(${value})`;
    if (scaleRange) scaleRange.value = value;
    if (scaleNumberInput) scaleNumberInput.value = value.toFixed(2);
    localStorage.setItem("mainScale", value);
    if (window.configManager?.updateUserSetting) {
      window.configManager.updateUserSetting("mainScale", value);
    }
    this.alignPanelToButton("settings");
  }

  /**
   * 更新上方間隔高度
   * @param {number} value - 間隔高度 vh 值 (0-50)
   */
  updateTopSpacer(value) {
    const topSpacerRange = document.getElementById("topSpacerRange");
    const topSpacerNumberInput = document.getElementById(
      "topSpacerNumberInput",
    );

    value = Math.max(0, Math.min(50, parseFloat(value)));
    if (this.topSpacerPlaceholder)
      this.topSpacerPlaceholder.style.height = `${value}vh`;
    if (topSpacerRange) topSpacerRange.value = value;
    if (topSpacerNumberInput) topSpacerNumberInput.value = value;
    localStorage.setItem("topSpacerHeight", value);
    if (window.configManager?.updateUserSetting) {
      window.configManager.updateUserSetting("topSpacerHeight", value);
    }
    this.alignPanelToButton("settings");
  }

  /**
   * 更新底部間距高度
   * @param {number} value - 間距高度 vh 值 (0-50)
   */
  updateBottomSpacer(value) {
    const bottomSpacerRange = document.getElementById("bottomSpacerRange");
    const bottomSpacerNumberInput = document.getElementById(
      "bottomSpacerNumberInput",
    );

    value = Math.max(0, Math.min(50, parseFloat(value)));
    if (this.panelBottomRow) this.panelBottomRow.style.marginTop = `${value}vh`;
    if (bottomSpacerRange) bottomSpacerRange.value = value;
    if (bottomSpacerNumberInput) bottomSpacerNumberInput.value = value;
    localStorage.setItem("bottomSpacerHeight", value);
    if (window.configManager?.updateUserSetting) {
      window.configManager.updateUserSetting("bottomSpacerHeight", value);
    }
    this.alignPanelToButton("settings");
  }

  /**
   * 更新電源按鈕縮放
   * @param {number} value - 縮放比例 (0.5-2.0)
   */
  updatePowerScale(value) {
    const powerScaleRange = document.getElementById("powerScaleRange");
    const powerScaleNumberInput = document.getElementById(
      "powerScaleNumberInput",
    );

    value = Math.max(0.5, Math.min(2, parseFloat(value)));
    // apply transform on container so all internal images scale uniformly
    if (this.powerSwitchArea)
      this.powerSwitchArea.style.transform = `scale(${value})`;
    if (powerScaleRange) powerScaleRange.value = value;
    if (powerScaleNumberInput) powerScaleNumberInput.value = value.toFixed(2);
    localStorage.setItem("powerSwitchScale", value);
    if (window.configManager?.updateUserSetting) {
      window.configManager.updateUserSetting("powerSwitchScale", value);
    }
  }

  /**
   * 切換按鈕標籤顯示
   * @param {boolean} visible - 是否顯示按鈕標籤
   */
  updateButtonLabelVisibility(visible) {
    document.querySelectorAll(".button-label-text").forEach((label) => {
      label.classList.toggle("hidden", !visible);
    });
    localStorage.setItem("showButtonLabels", visible ? "true" : "false");
    if (window.configManager?.updateUserSetting) {
      window.configManager.updateUserSetting("showButtonLabels", visible);
    }
  }

  /**
   * 切換按鈕顏色顯示
   * @param {boolean} visible - 是否顯示按鈕顏色
   */
  updateButtonColorVisibility(visible) {
    document.querySelectorAll(".button-overlay").forEach((button) => {
      button.classList.toggle("no-color", !visible);
    });
    localStorage.setItem("showButtonColors", visible ? "true" : "false");
    if (window.configManager?.updateUserSetting) {
      window.configManager.updateUserSetting("showButtonColors", visible);
    }
    if (window.buttonManager)
      window.buttonManager.updateExperimentButtonStyles();
  }

  /**
   * 切換視覺提示回饋
   * @param {boolean} visible - 是否顯示視覺提示
   */
  updateTouchVisuals(visible) {
    const buttonOverlays = document.querySelectorAll(".button-overlay");
    const shiftButtonOverlay = document.querySelector(
      '.button-overlay[data-label="B1"]',
    );
    const mediaArea = document.getElementById("mediaArea");
    localStorage.setItem("showTouchVisuals", visible ? "true" : "false");
    if (window.configManager?.updateUserSetting) {
      window.configManager.updateUserSetting("showTouchVisuals", visible);
    }

    // 控制 body 上的視覺提示類別
    if (visible) {
      document.body.classList.add("visual-hints-enabled");
    } else {
      document.body.classList.remove("visual-hints-enabled");
    }

    if (!visible) {
      buttonOverlays.forEach((button) =>
        button.classList.remove("touch-active"),
      );
      if (shiftButtonOverlay)
        shiftButtonOverlay.classList.remove("shift-active");
      const powerSwitchArea = document.getElementById("powerSwitchArea");
      if (powerSwitchArea) {
        powerSwitchArea.classList.remove("next-step-highlight");
      }
      document.querySelectorAll(".button-overlay").forEach((btn) => {
        btn.classList.remove("next-step-highlight");
      });
      // 隱藏媒體區塊的提示外框
      if (mediaArea) {
        mediaArea.classList.add("hidden-indicator");
      }
    } else {
      // 顯示媒體區塊的提示外框
      if (mediaArea) {
        mediaArea.classList.remove("hidden-indicator");
      }
      if (window.experiment) {
        window.experiment.updateHighlightVisibility();
      }
    }
  }

  /**
   * 切換媒體區域標記顯示
   * @param {boolean} visible - 是否顯示媒體區域標記
   */
  updateMediaAreaMarkerVisibility(visible) {
    if (this.mediaArea)
      this.mediaArea.classList.toggle("hide-area-marker", !visible);
    localStorage.setItem("showMediaAreaMarker", visible ? "true" : "false");
    if (window.configManager?.updateUserSetting) {
      window.configManager.updateUserSetting("showMediaAreaMarker", visible);
    }
  }

  /**
   * 切換媒體內容顯示
   * @param {boolean} visible - 是否顯示媒體內容
   */
  updateMediaContentVisibility(visible) {
    const mediaFiles = window.mediaManager?.mediaFiles || [];
    if (this.mediaArea)
      this.mediaArea.classList.toggle(
        "hide-media-content",
        !(visible && mediaFiles.length > 0),
      );
    localStorage.setItem("showMediaContent", visible ? "true" : "false");
    if (window.configManager?.updateUserSetting) {
      window.configManager.updateUserSetting("showMediaContent", visible);
    }
  }

  /**
   * 更新音效音量
   * @param {string|number} volume - 音量值 (0-100)
   */
  updateBeepVolume(volume) {
    const beepAudio = document.getElementById("beepSound");
    if (beepAudio) {
      const normalizedVolume = parseInt(volume) / 100;
      beepAudio.volume = normalizedVolume;
      Logger.debug(`Beep音量已設定為: ${normalizedVolume} (${volume})`);
    } else {
      Logger.warn("beepSound 元素不存在，無法設定音量");
    }
  }

  /**
   * 更新媒體音量
   * @param {string|number} volume - 音量值 (0-100)
   */
  updateMediaVolume(volume) {
    // 將音量設定儲存到 window.mediaManager 或全域變數
    if (
      window.mediaManager &&
      typeof window.mediaManager.setMediaVolume === "function"
    ) {
      const normalizedVolume = parseInt(volume) / 100;
      window.mediaManager.setMediaVolume(normalizedVolume);
      Logger.debug(`媒體音量已設定為: ${normalizedVolume} (${volume})`);
    } else {
      Logger.warn(
        "mediaManager 或 setMediaVolume 方法不存在，無法設定媒體音量",
      );
    }
  }

  /**
   * 顯示設定面板
   */
  showSettingsPanel() {
    if (this.settingsPanel) this.settingsPanel.classList.remove("hidden");
    if (this.refCard) {
      this.showElement(this.refCard);
    }
    // keep power switch visible so user can preview scaling
  }

  /**
   * 隱藏設定面板
   */
  hideSettingsPanel() {
    if (this.settingsPanel) this.settingsPanel.classList.add("hidden");
    if (this.refCard) {
      this.hideElement(this.refCard);
    }
    if (this.powerSwitchArea) {
      this.showElement(this.powerSwitchArea);
    }
    if (this.powerLightArea) {
      this.showElement(this.powerLightArea);
    }
  }

  /**
   * 更新全螢幕按鈕圖標
   */
  updateFullscreenButtonIcon() {
    const fullscreenButton = document.getElementById("fullscreenButton");
    if (!fullscreenButton) return;

    const enterSvg = fullscreenButton.querySelector(".fullscreen-enter");
    const exitSvg = fullscreenButton.querySelector(".fullscreen-exit");

    if (!enterSvg || !exitSvg) return;

    if (document.fullscreenElement) {
      // 全螢幕狀態：顯示退出圖標
      enterSvg.classList.add("is-hidden");
      exitSvg.classList.remove("is-hidden");
      this.hideElement(enterSvg);
      this.showElement(exitSvg);
      fullscreenButton.title = "退出全螢幕";
    } else {
      // 正常狀態：顯示進入圖標
      enterSvg.classList.remove("is-hidden");
      exitSvg.classList.add("is-hidden");
      this.showElement(enterSvg);
      this.hideElement(exitSvg);
      fullscreenButton.title = "切換全螢幕";
    }
  }

  /**
   * 切換全螢幕
   */
  toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      if (window.logger) window.logger.logAction("退出全螢幕模式");
    } else {
      try {
        document.documentElement.requestFullscreen().catch((err) => {
          alert(`無法啟用全螢幕模式: ${err.message}`);
          if (window.logger)
            window.logger.logAction(`無法啟用全螢幕模式: ${err.message}`);
        });
        if (window.logger) window.logger.logAction("進入全螢幕模式");
      } catch (err) {
        Logger.warn("requestFullscreen failed synchronously:", err);
        if (window.logger)
          window.logger.logAction(`同步啟用全螢幕失敗: ${err && err.message}`);
      }
    }
  }

  // ============ 事件監聽器設定 ============

  /**
   * 設定事件監聽器
   */
  setupEventListeners() {
    // 面板相關事件監聽器
    this.setupPanelEventListeners();

    // UI控制項相關事件監聽器
    this.setupUIControlEventListeners();
  }

  /**
   * 設定面板相關事件監聽器
   */
  setupPanelEventListeners() {
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

    if (this.panels.logger.button) {
      this.panels.logger.button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.togglePanel("logger");
      });
    }

    if (this.panels.logger.closeButton) {
      this.panels.logger.closeButton.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.closePanel("logger");
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
   * 設定UI控制項相關事件監聽器
   */
  setupUIControlEventListeners() {
    // 縮放控制
    const scaleRange = document.getElementById("scaleRange");
    const scaleNumberInput = document.getElementById("scaleNumberInput");
    if (scaleRange)
      scaleRange.addEventListener("input", (e) =>
        this.updateScale(e.target.value),
      );
    if (scaleNumberInput)
      scaleNumberInput.addEventListener("change", (e) =>
        this.updateScale(e.target.value),
      );

    // 頂部間隔控制
    const topSpacerRange = document.getElementById("topSpacerRange");
    const topSpacerNumberInput = document.getElementById(
      "topSpacerNumberInput",
    );
    if (topSpacerRange)
      topSpacerRange.addEventListener("input", (e) =>
        this.updateTopSpacer(e.target.value),
      );
    if (topSpacerNumberInput)
      topSpacerNumberInput.addEventListener("change", (e) =>
        this.updateTopSpacer(e.target.value),
      );

    // 底部間距控制
    const bottomSpacerRange = document.getElementById("bottomSpacerRange");
    const bottomSpacerNumberInput = document.getElementById(
      "bottomSpacerNumberInput",
    );
    if (bottomSpacerRange)
      bottomSpacerRange.addEventListener("input", (e) =>
        this.updateBottomSpacer(e.target.value),
      );
    if (bottomSpacerNumberInput)
      bottomSpacerNumberInput.addEventListener("change", (e) =>
        this.updateBottomSpacer(e.target.value),
      );

    // 電源按鈕縮放控制
    const powerScaleRange = document.getElementById("powerScaleRange");
    const powerScaleNumberInput = document.getElementById(
      "powerScaleNumberInput",
    );
    if (powerScaleRange)
      powerScaleRange.addEventListener("input", (e) =>
        this.updatePowerScale(e.target.value),
      );
    if (powerScaleNumberInput)
      powerScaleNumberInput.addEventListener("change", (e) =>
        this.updatePowerScale(e.target.value),
      );

    // 關閉設定面板按鈕
    const closeSettingsPanel = document.getElementById("closeSettingsPanel");
    if (closeSettingsPanel)
      closeSettingsPanel.addEventListener("click", () =>
        this.hideSettingsPanel(),
      );

    // 顯示/隱藏控制項
    const toggleButtonLabels = document.getElementById("toggleButtonLabels");
    const toggleButtonColors = document.getElementById("toggleButtonColors");
    const toggleTouchVisuals = document.getElementById("toggleTouchVisuals");
    const toggleMediaAreaMarker = document.getElementById(
      "toggleMediaAreaMarker",
    );
    const toggleMediaContent = document.getElementById("toggleMediaContent");
    const toggleBeepSound = document.getElementById("toggleBeepSound");

    if (toggleButtonLabels)
      toggleButtonLabels.addEventListener("change", (e) =>
        this.updateButtonLabelVisibility(e.target.checked),
      );
    if (toggleButtonColors)
      toggleButtonColors.addEventListener("change", (e) =>
        this.updateButtonColorVisibility(e.target.checked),
      );
    if (toggleTouchVisuals)
      toggleTouchVisuals.addEventListener("change", (e) =>
        this.updateTouchVisuals(e.target.checked),
      );
    if (toggleMediaAreaMarker)
      toggleMediaAreaMarker.addEventListener("change", (e) =>
        this.updateMediaAreaMarkerVisibility(e.target.checked),
      );
    if (toggleMediaContent)
      toggleMediaContent.addEventListener("change", (e) =>
        this.updateMediaContentVisibility(e.target.checked),
      );
    if (toggleBeepSound) {
      toggleBeepSound.addEventListener("change", (e) => {
        const checked = e.target.checked;
        localStorage.setItem("playBeepSound", checked ? "true" : "false");
        if (window.configManager?.updateUserSetting) {
          window.configManager.updateUserSetting("playBeepSound", checked);
        }
        if (window.logger)
          window.logger.logAction(`提示音效已 ${checked ? "開啟" : "關閉"}`);
      });
    }

    // 音量控制 - 滑桿
    const beepVolume = document.getElementById("beepVolume");
    const beepVolumeNumber = document.getElementById("beepVolumeNumber");
    if (beepVolume) {
      beepVolume.addEventListener("input", (e) => {
        const volume = e.target.value;
        localStorage.setItem("beepVolume", volume);
        if (window.configManager?.updateUserSetting) {
          window.configManager.updateUserSetting("beepVolume", volume);
        }
        if (beepVolumeNumber) beepVolumeNumber.value = volume;
        this.updateBeepVolume(volume);
      });
    }

    // 音量控制 - 數字輸入框
    if (beepVolumeNumber) {
      beepVolumeNumber.addEventListener("input", (e) => {
        const volume = e.target.value;
        // 確保值在有效範圍內
        const clampedVolume = Math.max(0, Math.min(100, volume));
        e.target.value = clampedVolume;
        localStorage.setItem("beepVolume", clampedVolume);
        if (window.configManager?.updateUserSetting) {
          window.configManager.updateUserSetting("beepVolume", clampedVolume);
        }
        if (beepVolume) beepVolume.value = clampedVolume;
        this.updateBeepVolume(clampedVolume);
      });
    }

    // 媒體音量控制 - 滑桿
    const mediaVolume = document.getElementById("mediaVolume");
    const mediaVolumeNumber = document.getElementById("mediaVolumeNumber");
    if (mediaVolume) {
      mediaVolume.addEventListener("input", (e) => {
        const volume = e.target.value;
        localStorage.setItem("mediaVolume", volume);
        if (window.configManager?.updateUserSetting) {
          window.configManager.updateUserSetting("mediaVolume", volume);
        }
        if (mediaVolumeNumber) mediaVolumeNumber.value = volume;
        this.updateMediaVolume(volume);
      });
    }

    // 媒體音量控制 - 數字輸入框
    if (mediaVolumeNumber) {
      mediaVolumeNumber.addEventListener("input", (e) => {
        const volume = e.target.value;
        // 確保值在有效範圍內
        const clampedVolume = Math.max(0, Math.min(100, volume));
        e.target.value = clampedVolume;
        localStorage.setItem("mediaVolume", clampedVolume);
        if (window.configManager?.updateUserSetting) {
          window.configManager.updateUserSetting("mediaVolume", clampedVolume);
        }
        if (mediaVolume) mediaVolume.value = clampedVolume;
        this.updateMediaVolume(clampedVolume);
      });
    }

    // 全螢幕按鈕
    const fullscreenButton = document.getElementById("fullscreenButton");
    if (fullscreenButton)
      fullscreenButton.addEventListener("click", () => this.toggleFullscreen());

    // 全螢幕狀態變化監聽器
    document.addEventListener("fullscreenchange", () =>
      this.updateFullscreenButtonIcon(),
    );

    // 防止右鍵選單
    document.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // ============ UI狀態初始化與設定載入 (來自 main.js) ============

  /**
   * 載入初始設定
   */
  loadInitialSettings() {
    // Logger 顯示狀態
    const showLogger = localStorage.getItem("showLogger");
    const loggerMinimized = localStorage.getItem("loggerMinimized");
    if (window.logger) {
      if (showLogger === "true") {
        loggerMinimized === "true"
          ? window.logger.minimizeLogger()
          : window.logger.showLoggerPanel();
      } else {
        window.logger.hideLoggerPanel();
      }
    }
    // 隱藏參考卡片與設定面板
    const refCard = document.getElementById("refCard");
    const settingsPanel = document.getElementById("settingsPanel");
    if (refCard) {
      this.hideElement(refCard);
    }
    if (settingsPanel) settingsPanel.classList.add("hidden");
  }

  /**
   * 初始化 UI 狀態
   */
  initializeUIState() {
    // 初始化全螢幕按鈕圖標
    this.updateFullscreenButtonIcon();

    // 載入設定並套用
    const configSettings = window.configManager?.userSettings || {};

    // 套用數值設定
    this.updateScale(
      configSettings.mainScale ??
        localStorage.getItem("mainScale") ??
        PanelUIManager.DEFAULTS.mainScale,
    );
    this.updateTopSpacer(
      configSettings.topSpacerHeight ??
        localStorage.getItem("topSpacerHeight") ??
        PanelUIManager.DEFAULTS.topSpacerHeight,
    );
    this.updateBottomSpacer(
      configSettings.bottomSpacerHeight ??
        localStorage.getItem("bottomSpacerHeight") ??
        PanelUIManager.DEFAULTS.bottomSpacerHeight,
    );
    this.updatePowerScale(
      configSettings.powerSwitchScale ??
        localStorage.getItem("powerSwitchScale") ??
        PanelUIManager.DEFAULTS.powerSwitchScale,
    );

    // 套用切換設定
    this.updateButtonLabelVisibility(
      localStorage.getItem("showButtonLabels") !== "false",
    );
    this.updateButtonColorVisibility(
      localStorage.getItem("showButtonColors") !== "false",
    );
    this.updateTouchVisuals(
      localStorage.getItem("showTouchVisuals") !== "false",
    );
    this.updateMediaAreaMarkerVisibility(
      localStorage.getItem("showMediaAreaMarker") === "true",
    );
    this.updateMediaContentVisibility(
      localStorage.getItem("showMediaContent") !== "false",
    );

    // 套用音量設定
    const beepVolume =
      configSettings.beepVolume ??
      localStorage.getItem("beepVolume") ??
      PanelUIManager.DEFAULTS.beepVolume;
    const mediaVolume =
      configSettings.mediaVolume ??
      localStorage.getItem("mediaVolume") ??
      PanelUIManager.DEFAULTS.mediaVolume;

    this.updateBeepVolume(beepVolume);
    this.updateMediaVolume(mediaVolume);

    // 更新 UI 元素值
    this.syncUIElements(configSettings);

    // 設定重置按鈕事件
    this.setupResetButton();

    // 確保電源燈號區域總是可見（電源狀態指示器）
    if (this.powerLightArea) {
      this.showElement(this.powerLightArea);
      Logger.debug("電源燈號區域已顯示 (initializeUIState)");
    }
  }

  /**
   * 同步 UI 元素值
   * @param {Object} configSettings - 設定物件
   */
  syncUIElements(configSettings) {
    // 縮放控制
    const scaleRange = document.getElementById("scaleRange");
    const scaleNumberInput = document.getElementById("scaleNumberInput");
    const scaleValue =
      configSettings.mainScale ??
      localStorage.getItem("mainScale") ??
      PanelUIManager.DEFAULTS.mainScale;
    if (scaleRange) scaleRange.value = scaleValue;
    if (scaleNumberInput)
      scaleNumberInput.value = parseFloat(scaleValue).toFixed(2);

    // 間距控制
    const topSpacerRange = document.getElementById("topSpacerRange");
    const topSpacerNumberInput = document.getElementById(
      "topSpacerNumberInput",
    );
    const topValue =
      configSettings.topSpacerHeight ??
      localStorage.getItem("topSpacerHeight") ??
      PanelUIManager.DEFAULTS.topSpacerHeight;
    if (topSpacerRange) topSpacerRange.value = topValue;
    if (topSpacerNumberInput) topSpacerNumberInput.value = topValue;

    const bottomSpacerRange = document.getElementById("bottomSpacerRange");
    const bottomSpacerNumberInput = document.getElementById(
      "bottomSpacerNumberInput",
    );
    const bottomValue =
      configSettings.bottomSpacerHeight ??
      localStorage.getItem("bottomSpacerHeight") ??
      PanelUIManager.DEFAULTS.bottomSpacerHeight;
    if (bottomSpacerRange) bottomSpacerRange.value = bottomValue;
    if (bottomSpacerNumberInput) bottomSpacerNumberInput.value = bottomValue;

    // 電源縮放控制
    const powerScaleRange = document.getElementById("powerScaleRange");
    const powerScaleNumberInput = document.getElementById(
      "powerScaleNumberInput",
    );
    const powerValue =
      configSettings.powerSwitchScale ??
      localStorage.getItem("powerSwitchScale") ??
      PanelUIManager.DEFAULTS.powerSwitchScale;
    if (powerScaleRange) powerScaleRange.value = powerValue;
    if (powerScaleNumberInput)
      powerScaleNumberInput.value = parseFloat(powerValue).toFixed(2);

    // 切換控制
    const toggleButtonLabels = document.getElementById("toggleButtonLabels");
    const toggleButtonColors = document.getElementById("toggleButtonColors");
    const toggleTouchVisuals = document.getElementById("toggleTouchVisuals");
    const toggleMediaAreaMarker = document.getElementById(
      "toggleMediaAreaMarker",
    );
    const toggleMediaContent = document.getElementById("toggleMediaContent");
    const toggleBeepSound = document.getElementById("toggleBeepSound");

    if (toggleButtonLabels)
      toggleButtonLabels.checked =
        configSettings.showButtonLabels ??
        localStorage.getItem("showButtonLabels") !== "false";
    if (toggleButtonColors)
      toggleButtonColors.checked =
        configSettings.showButtonColors ??
        localStorage.getItem("showButtonColors") !== "false";
    if (toggleTouchVisuals)
      toggleTouchVisuals.checked =
        configSettings.showTouchVisuals ??
        localStorage.getItem("showTouchVisuals") !== "false";
    if (toggleMediaAreaMarker)
      toggleMediaAreaMarker.checked =
        configSettings.showMediaAreaMarker ??
        localStorage.getItem("showMediaAreaMarker") === "true";
    if (toggleMediaContent)
      toggleMediaContent.checked =
        configSettings.showMediaContent ??
        localStorage.getItem("showMediaContent") !== "false";
    if (toggleBeepSound)
      toggleBeepSound.checked =
        configSettings.playBeepSound ??
        localStorage.getItem("playBeepSound") !== "false";

    // 音量控制
    const beepVolume = document.getElementById("beepVolume");
    const beepVolumeNumber = document.getElementById("beepVolumeNumber");
    const beepVolValue =
      configSettings.beepVolume ??
      localStorage.getItem("beepVolume") ??
      PanelUIManager.DEFAULTS.beepVolume;
    if (beepVolume) beepVolume.value = beepVolValue;
    if (beepVolumeNumber) beepVolumeNumber.value = beepVolValue;

    const mediaVolume = document.getElementById("mediaVolume");
    const mediaVolumeNumber = document.getElementById("mediaVolumeNumber");
    const mediaVolValue =
      configSettings.mediaVolume ??
      localStorage.getItem("mediaVolume") ??
      PanelUIManager.DEFAULTS.mediaVolume;
    if (mediaVolume) mediaVolume.value = mediaVolValue;
    if (mediaVolumeNumber) mediaVolumeNumber.value = mediaVolValue;
  }

  /**
   * 設定重置按鈕事件
   */
  setupResetButton() {
    const resetSettingsBtn = document.getElementById("resetSettingsBtn");
    if (!resetSettingsBtn) return;

    resetSettingsBtn.addEventListener("click", async () => {
      if (window.configManager?.resetUserSettingsToDefaults) {
        await window.configManager.resetUserSettingsToDefaults();
        // 重置後重新初始化 UI 狀態以載入預設值
        this.initializeUIState();
        if (window.logger) window.logger.logAction("已還原設定為預設值");
      }
    });
  }

  /**
   * 從 DOM 控制項重新載入設定值
   */
  loadControlsFromDOM() {
    // 從範圍輸入框重新載入數值
    const scaleRange = document.getElementById("scaleRange");
    const topSpacerRange = document.getElementById("topSpacerRange");
    const bottomSpacerRange = document.getElementById("bottomSpacerRange");
    const powerScaleRange = document.getElementById("powerScaleRange");

    if (scaleRange) this.updateScale(scaleRange.value);
    if (topSpacerRange) this.updateTopSpacer(topSpacerRange.value);
    if (bottomSpacerRange) this.updateBottomSpacer(bottomSpacerRange.value);
    if (powerScaleRange) this.updatePowerScale(powerScaleRange.value);

    // 重新載入切換開關狀態
    const toggleButtonLabels = document.getElementById("toggleButtonLabels");
    const toggleButtonColors = document.getElementById("toggleButtonColors");
    const toggleTouchVisuals = document.getElementById("toggleTouchVisuals");
    const toggleMediaAreaMarker = document.getElementById(
      "toggleMediaAreaMarker",
    );
    const toggleMediaContent = document.getElementById("toggleMediaContent");

    if (toggleButtonLabels)
      this.updateButtonLabelVisibility(toggleButtonLabels.checked);
    if (toggleButtonColors)
      this.updateButtonColorVisibility(toggleButtonColors.checked);
    if (toggleTouchVisuals) this.updateTouchVisuals(toggleTouchVisuals.checked);
    if (toggleMediaAreaMarker)
      this.updateMediaAreaMarkerVisibility(toggleMediaAreaMarker.checked);
    if (toggleMediaContent)
      this.updateMediaContentVisibility(toggleMediaContent.checked);
  }
}

// 匯出單例
window.panelUIManager = new PanelUIManager();
