/**
 * PanelUIManager - 面板UI管理器
 *
 * 整合面板管理、UI控制項管理和初始設定載入功能
 * 負責所有UI相關的操作和狀態管理
 */
import { Logger } from "../core/console-manager.js";

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
   * 建構子
   */
  constructor({
    logger = Logger,
    configManager = null,
    uiManager = null,
    buttonManager = null,
    panelMediaManager = null,
  } = {}) {
    this.logger = logger;
    this.configManager = configManager;
    this.uiManager = uiManager;
    this.buttonManager = buttonManager;
    this.panelMediaManager = panelMediaManager;
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

    this.settingsPanel = null;
    this.scalable = null;
    this.mediaArea = null;
    this.topSpacerPlaceholder = null;
    this.refCard = null;
    this.powerSwitchArea = null;
    this.powerLightArea = null;
    this.panelBottomRow = null;
    this.pendingMediaVolume = null;
    this._resizeHandler = () => {
      if (this.currentOpenPanel === "settings") {
        this.alignPanelToButton("settings");
      }
    };
    this._resizeHandlerBound = false;

    this.initialize();
  }

  updateDependencies(deps = {}) {
    Object.assign(this, deps);
  }

  /**
   * 初始化
   */
  initialize() {
    this.initializeDOMReferences();
    this.initializePanels();
    this.setupEventListeners();
    this.initializeUIState();
    this.loadInitialSettings();

    if (!this._resizeHandlerBound) {
      window.addEventListener("resize", this._resizeHandler);
      this._resizeHandlerBound = true;
    }
  }

  destroy() {
    if (this._resizeHandlerBound) {
      window.removeEventListener("resize", this._resizeHandler);
      this._resizeHandlerBound = false;
    }
  }

  // ============ 面板管理 ============

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

    this.showElement(panel.element);

    // 面板專屬的額外處理
    if (panelName === "settings") {
      // 對齊到設定切換按鈕，避免 UI 縮放時垂直位置偏移
      this.alignPanelToButton("settings");
    } else if (panelName === "experiment") {
      // 初始化實驗面板 UI 元件
      const uiManager = this.uiManager;
      if (uiManager && typeof uiManager.initializePanelUI === "function") {
        uiManager.initializePanelUI().catch((error) => {
          Logger.error("初始化實驗面板UI失敗:", error);
        });
      }
      window.dispatchEvent(new CustomEvent("panel:experiment:opened"));
    }

    this.currentOpenPanel = panelName;

    // 只記錄設定面板的操作，實驗面板不記錄
    const logger = this.logger;
    if (logger && panelName === "settings") {
      logger.logAction("開啟設定面板");
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

    // 統一使用 is-hidden 控制所有面板的隱藏
    this.hideElement(panel.element);

    // 面板專屬的額外處理
    if (panelName === "settings") {
      // 關閉設定面板後，保留視覺提示狀態
      const showTouchVisuals =
        localStorage.getItem("showTouchVisuals") !== "false";
      if (showTouchVisuals) {
        document.body.classList.add("visual-hints-enabled");
      }
    }

    // 如果關閉的是目前開啟的面板，清除記錄
    if (this.currentOpenPanel === panelName) {
      this.currentOpenPanel = null;
    }

    // 只記錄設定面板的操作，實驗面板不記錄
    const logger = this.logger;
    if (logger && panelName === "settings") {
      logger.logAction("關閉設定面板");
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

  // 根據實驗狀態切換 experimentPanelButton 底色
  setupExperimentPanelButtonColor() {
    this.setExperimentPanelButtonColor("default");
  }

  // 直接用 JS 切換 experimentPanelButton 底色
  setExperimentPanelButtonColor(status) {
    const btn = document.getElementById("experimentPanelButton");

    if (status === "running") {
      btn.style.setProperty("background", "#27ae60", "important");
      btn.style.setProperty("color", "#fff", "important");
      return;
    }

    if (status === "paused") {
      btn.style.setProperty("background", "#f39c12", "important");
      btn.style.setProperty("color", "#fff", "important");
      return;
    }

    btn.style.setProperty("background", "#888", "important");
    btn.style.setProperty("color", "#fff", "important");
  }

  // ============ UI 控制項功能============

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
    if (this.settingsPanel) this.hideElement(this.settingsPanel);

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
    value = Math.max(0.5, Math.min(2, parseFloat(value)));

    this.scalable && (this.scalable.style.transform = `scale(${value})`);

    const scaleRange = document.getElementById("scaleRange");
    const scaleNumberInput = document.getElementById("scaleNumberInput");
    scaleRange && (scaleRange.value = value);
    scaleNumberInput && (scaleNumberInput.value = value.toFixed(2));

    localStorage.setItem("mainScale", value);
    const configManager = this.configManager;
    configManager?.updateUserSetting("mainScale", value);

    this.alignPanelToButton("settings");
  }

  /**
   * 更新上方間隔高度
   * @param {number} value - 間隔高度 vh 值 (0-50)
   */
  updateTopSpacer(value) {
    value = Math.max(0, Math.min(50, parseFloat(value)));

    this.topSpacerPlaceholder &&
      (this.topSpacerPlaceholder.style.height = `${value}vh`);

    const topSpacerRange = document.getElementById("topSpacerRange");
    const topSpacerNumberInput = document.getElementById(
      "topSpacerNumberInput",
    );
    topSpacerRange && (topSpacerRange.value = value);
    topSpacerNumberInput && (topSpacerNumberInput.value = value);

    localStorage.setItem("topSpacerHeight", value);
    const configManager = this.configManager;
    configManager?.updateUserSetting("topSpacerHeight", value);

    this.alignPanelToButton("settings");
  }

  /**
   * 更新底部間距高度
   * @param {number} value - 間距高度 vh 值 (0-50)
   */
  updateBottomSpacer(value) {
    value = Math.max(0, Math.min(50, parseFloat(value)));

    this.panelBottomRow && (this.panelBottomRow.style.marginTop = `${value}vh`);

    const bottomSpacerRange = document.getElementById("bottomSpacerRange");
    const bottomSpacerNumberInput = document.getElementById(
      "bottomSpacerNumberInput",
    );
    bottomSpacerRange && (bottomSpacerRange.value = value);
    bottomSpacerNumberInput && (bottomSpacerNumberInput.value = value);

    localStorage.setItem("bottomSpacerHeight", value);
    const configManager = this.configManager;
    configManager?.updateUserSetting("bottomSpacerHeight", value);
    this.alignPanelToButton("settings");
  }

  /**
   * 更新電源按鈕縮放
   * @param {number} value - 縮放比例 (0.5-2.0)
   */
  updatePowerScale(value) {
    value = Math.max(0.5, Math.min(2, parseFloat(value)));

    this.powerSwitchArea &&
      (this.powerSwitchArea.style.transform = `scale(${value})`);

    const powerScaleRange = document.getElementById("powerScaleRange");
    const powerScaleNumberInput = document.getElementById(
      "powerScaleNumberInput",
    );
    powerScaleRange && (powerScaleRange.value = value);
    powerScaleNumberInput && (powerScaleNumberInput.value = value.toFixed(2));

    localStorage.setItem("powerSwitchScale", value);
    const configManager = this.configManager;
    configManager?.updateUserSetting("powerSwitchScale", value);
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
    const configManager = this.configManager;
    configManager?.updateUserSetting("showButtonLabels", visible);
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
    const configManager = this.configManager;
    configManager?.updateUserSetting("showButtonColors", visible);
    this.buttonManager?.updateExperimentButtonStyles?.();
  }

  /**
   * 切換視覺提示回饋
   * @param {boolean} visible - 是否顯示視覺提示
   */
  updateTouchVisuals(visible) {
    const buttonOverlays = document.querySelectorAll(".button-overlay");
    const shiftButtonOverlay = document.querySelector(
      ".button-overlay[data-label=\"B1\"]",
    );
    const mediaArea = document.getElementById("mediaArea");
    const powerSwitchArea = document.getElementById("powerSwitchArea");

    localStorage.setItem("showTouchVisuals", visible ? "true" : "false");
    const configManager = this.configManager;
    configManager?.updateUserSetting("showTouchVisuals", visible);

    // 控制 body 上的視覺提示類別
    document.body.classList.toggle("visual-hints-enabled", visible);

    if (!visible) {
      buttonOverlays.forEach((button) =>
        button.classList.remove("touch-active"),
      );
      shiftButtonOverlay?.classList.remove("shift-active");
      powerSwitchArea?.classList.remove("next-step-highlight");
      document.querySelectorAll(".button-overlay").forEach((btn) => {
        btn.classList.remove("next-step-highlight");
      });
      mediaArea?.classList.add("hidden-indicator");
    } else {
      mediaArea?.classList.remove("hidden-indicator");
      this.uiManager?.updateHighlightVisibility?.();
    }
  }

  /**
   * 切換媒體區域標記
   * @param {boolean} visible - 是否顯示媒體區域標記
   */
  updateMediaAreaMarkerVisibility(visible) {
    this.mediaArea?.classList.toggle("hide-area-marker", !visible);
    localStorage.setItem("showMediaAreaMarker", visible ? "true" : "false");
    const configManager = this.configManager;
    configManager?.updateUserSetting("showMediaAreaMarker", visible);
  }

  /**
   * 切換媒體內容顯示
   * @param {boolean} visible - 是否顯示媒體內容
   */
  updateMediaContentVisibility(visible) {
    const mediaFiles = this.panelMediaManager?.mediaFiles || [];
    this.mediaArea?.classList.toggle(
      "hide-media-content",
      !(visible && mediaFiles.length > 0),
    );
    localStorage.setItem("showMediaContent", visible ? "true" : "false");
    const configManager = this.configManager;
    configManager?.updateUserSetting("showMediaContent", visible);
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
    }
  }

  /**
   * 更新媒體音量
   * @param {string|number} volume - 音量值 (0-100)
   */
  updateMediaVolume(volume) {
    const normalizedVolume = parseInt(volume) / 100;
    this.panelMediaManager?.setMediaVolume(normalizedVolume);
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

    const isFullscreen = !!document.fullscreenElement;

    // 根據全屏狀態切換 SVG 顯示/隱藏
    enterSvg.classList.toggle("is-hidden", isFullscreen);
    exitSvg.classList.toggle("is-hidden", !isFullscreen);

    // 更新按鈕提示文字
    fullscreenButton.title = isFullscreen ? "退出全螢幕" : "切換全螢幕";
  }

  /**
   * 切換全螢幕
   */
  toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      this.logger?.logAction("退出全螢幕模式");
    } else {
      try {
        document.documentElement.requestFullscreen().catch((err) => {
          alert(`無法啟用全螢幕模式: ${err.message}`);
          this.logger?.logAction(`無法啟用全螢幕模式: ${err.message}`);
        });
        this.logger?.logAction("進入全螢幕模式");
      } catch (err) {
        Logger.warn("requestFullscreen failed synchronously:", err);
        this.logger?.logAction(`同步啟用全螢幕失敗: ${err.message}`);
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

    document.addEventListener("panel:experiment-button-status", (event) => {
      const status = event.detail.status;
      this.setExperimentPanelButtonColor(status);
    });
  }

  /**
   * 設定面板相關事件監聽器
   */
  setupPanelEventListeners() {
    const preventDefault = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    Object.entries(this.panels).forEach(([panelName, panel]) => {
      panel.button?.addEventListener("click", (e) => {
        preventDefault(e);
        this.togglePanel(panelName);
      });

      panel.closeButton?.addEventListener("click", (e) => {
        preventDefault(e);
        this.closePanel(panelName);
      });
    });

    // 點擊外部關閉面板
    this.setupOutsideClickListener();
  }

  /**
   * 設定點擊外部關閉面板的監聽器
   */
  setupOutsideClickListener() {
    document.addEventListener("click", (e) => {
      if (!this.hasOpenPanel()) return;

      const currentPanel = this.panels[this.currentOpenPanel];
      if (!currentPanel?.element) return;

      const isClickInsidePanel = currentPanel.element.contains(e.target);
      const isClickOnButton = currentPanel.button?.contains?.(e.target);

      if (!isClickInsidePanel && !isClickOnButton) {
        this.closePanel(this.currentOpenPanel);
      }
    });
  }

  /**
   * 設定UI控制項相關事件監聽器
   */
  setupUIControlEventListeners() {
    const controlConfigs = [
      {
        rangeId: "scaleRange",
        inputId: "scaleNumberInput",
        handler: (v) => this.updateScale(v),
      },
      {
        rangeId: "topSpacerRange",
        inputId: "topSpacerNumberInput",
        handler: (v) => this.updateTopSpacer(v),
      },
      {
        rangeId: "bottomSpacerRange",
        inputId: "bottomSpacerNumberInput",
        handler: (v) => this.updateBottomSpacer(v),
      },
      {
        rangeId: "powerScaleRange",
        inputId: "powerScaleNumberInput",
        handler: (v) => this.updatePowerScale(v),
      },
    ];

    controlConfigs.forEach(({ rangeId, inputId, handler }) => {
      const range = document.getElementById(rangeId);
      const input = document.getElementById(inputId);
      range?.addEventListener("input", (e) => handler(e.target.value));
      input?.addEventListener("change", (e) => handler(e.target.value));
    });

    // 顯示/隱藏控制項 - 每個都對應到更新方法
    const toggleConfigs = [
      {
        id: "toggleButtonLabels",
        handler: (v) => this.updateButtonLabelVisibility(v),
      },
      {
        id: "toggleButtonColors",
        handler: (v) => this.updateButtonColorVisibility(v),
      },
      { id: "toggleTouchVisuals", handler: (v) => this.updateTouchVisuals(v) },
      {
        id: "toggleMediaAreaMarker",
        handler: (v) => this.updateMediaAreaMarkerVisibility(v),
      },
      {
        id: "toggleMediaContent",
        handler: (v) => this.updateMediaContentVisibility(v),
      },
    ];

    toggleConfigs.forEach(({ id, handler }) => {
      const element = document.getElementById(id);
      element?.addEventListener("change", (e) => handler(e.target.checked));
    });

    // 提示音效開關
    const toggleBeepSound = document.getElementById("toggleBeepSound");
    toggleBeepSound?.addEventListener("change", (e) => {
      const checked = e.target.checked;
      localStorage.setItem("playBeepSound", checked ? "true" : "false");
      const configManager = this.configManager;
      configManager?.updateUserSetting("playBeepSound", checked);
      this.logger?.logAction(`提示音效已 ${checked ? "開啟" : "關閉"}`);
    });

    // 音量控制
    const volumeConfigs = [
      {
        rangeId: "beepVolume",
        inputId: "beepVolumeNumber",
        key: "beepVolume",
        handler: (v) => this.updateBeepVolume(v),
      },
      {
        rangeId: "mediaVolume",
        inputId: "mediaVolumeNumber",
        key: "mediaVolume",
        handler: (v) => this.updateMediaVolume(v),
      },
    ];

    volumeConfigs.forEach(({ rangeId, inputId, key, handler }) => {
      const range = document.getElementById(rangeId);
      const input = document.getElementById(inputId);

      const syncValues = (value) => {
        const clamped = Math.max(0, Math.min(100, value));
        localStorage.setItem(key, clamped);
        const configManager = this.configManager;
        configManager?.updateUserSetting(key, clamped);
        handler(clamped);
        if (range && range.value !== clamped) range.value = clamped;
        if (input && input.value !== clamped) input.value = clamped;
      };

      range?.addEventListener("input", (e) => syncValues(e.target.value));
      input?.addEventListener("input", (e) => syncValues(e.target.value));
    });

    // 全螢幕按鈕
    document
      .getElementById("fullscreenButton")
      ?.addEventListener("click", () => this.toggleFullscreen());

    // 全螢幕狀態變化監聽器
    document.addEventListener("fullscreenchange", () =>
      this.updateFullscreenButtonIcon(),
    );

    // 防止右鍵選單
    document.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // ============ UI 狀態初始化 ============

  /**
   * 載入初始設定
   */
  loadInitialSettings() {
    document.getElementById("refCard")?.classList.add("is-hidden");
    document.getElementById("settingsPanel")?.classList.add("is-hidden");
  }

  /**
   * 初始化 UI 狀態
   */
  initializeUIState() {
    this.updateFullscreenButtonIcon();

    const configSettings = this.configManager?.userSettings || {};
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
    const showButtonLabels =
      localStorage.getItem("showButtonLabels") !== "false";
    const showButtonColors =
      localStorage.getItem("showButtonColors") !== "false";
    const showTouchVisuals =
      localStorage.getItem("showTouchVisuals") !== "false";
    const showMediaAreaMarker =
      localStorage.getItem("showMediaAreaMarker") === "true";
    const showMediaContent =
      localStorage.getItem("showMediaContent") !== "false";

    this.updateButtonLabelVisibility(showButtonLabels);
    this.updateButtonColorVisibility(showButtonColors);
    this.updateTouchVisuals(showTouchVisuals);
    this.updateMediaAreaMarkerVisibility(showMediaAreaMarker);
    this.updateMediaContentVisibility(showMediaContent);

    // 同步設定面板的開關狀態
    const toggleButtonLabels = document.getElementById("toggleButtonLabels");
    if (toggleButtonLabels) toggleButtonLabels.checked = showButtonLabels;
    const toggleButtonColors = document.getElementById("toggleButtonColors");
    if (toggleButtonColors) toggleButtonColors.checked = showButtonColors;
    const toggleTouchVisuals = document.getElementById("toggleTouchVisuals");
    if (toggleTouchVisuals) toggleTouchVisuals.checked = showTouchVisuals;
    const toggleMediaAreaMarker = document.getElementById(
      "toggleMediaAreaMarker",
    );
    if (toggleMediaAreaMarker)
      toggleMediaAreaMarker.checked = showMediaAreaMarker;
    const toggleMediaContent = document.getElementById("toggleMediaContent");
    if (toggleMediaContent) toggleMediaContent.checked = showMediaContent;

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
    this.syncUIElements(configSettings);
    this.setupResetButton();

    if (this.powerLightArea) {
      this.showElement(this.powerLightArea);
    }
  }

  /**
   * 同步 UI 元素值
   * @param {Object} configSettings - 設定物件
   */
  syncUIElements(configSettings) {
    const scaleRange = document.getElementById("scaleRange");
    const scaleNumberInput = document.getElementById("scaleNumberInput");
    const scaleValue =
      configSettings.mainScale ??
      localStorage.getItem("mainScale") ??
      PanelUIManager.DEFAULTS.mainScale;
    if (scaleRange) scaleRange.value = scaleValue;
    if (scaleNumberInput)
      scaleNumberInput.value = parseFloat(scaleValue).toFixed(2);

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
   * 設定重置按鈕
   */
  setupResetButton() {
    const resetSettingsBtn = document.getElementById("resetSettingsBtn");
    if (!resetSettingsBtn) return;

    resetSettingsBtn.addEventListener("click", async () => {
      const configManager = this.configManager;
      if (configManager?.resetUserSettingsToDefaults) {
        await configManager.resetUserSettingsToDefaults();
        // 重置後重新初始化 UI 狀態以載入預設值
        this.initializeUIState();
        this.logger?.logAction("已還原設定為預設值");
      }
    });
  }

  /**
   * 從 DOM 控制項載入設定值
   */
  loadControlsFromDOM() {
    const scaleRange = document.getElementById("scaleRange");
    const topSpacerRange = document.getElementById("topSpacerRange");
    const bottomSpacerRange = document.getElementById("bottomSpacerRange");
    const powerScaleRange = document.getElementById("powerScaleRange");

    if (scaleRange) this.updateScale(scaleRange.value);
    if (topSpacerRange) this.updateTopSpacer(topSpacerRange.value);
    if (bottomSpacerRange) this.updateBottomSpacer(bottomSpacerRange.value);
    if (powerScaleRange) this.updatePowerScale(powerScaleRange.value);

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

// ES6 模組匯出
export default PanelUIManager;
export { PanelUIManager };
