/**
 * UIControlsManager - UI 控制項與面板管理器
 *
 * 負責 UI 控制項的管理、面板縮放、間距調整和視覺效果控制
 */
class UIControlsManager {
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
   * 建構子 - 初始化 UI 控制項管理器
   */
  constructor() {
    // 初始化 DOM 元素引用
    this.initializeDOMReferences();

    // 設定事件監聽器
    this.setupEventListeners();

    // 初始化 UI 控制項狀態
    this.initializeUIState();
  }

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
    if (this.powerSwitchArea) this.powerSwitchArea.style.display = "block";
    if (this.powerLightArea) this.powerLightArea.style.display = "block";
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
  updateScale(value) {
    const scaleRange = document.getElementById("scaleRange");
    const scaleNumberInput = document.getElementById("scaleNumberInput");

    value = Math.max(0.5, Math.min(2, parseFloat(value)));
    if (this.scalable) this.scalable.style.transform = `scale(${value})`;
    if (scaleRange) scaleRange.value = value;
    if (scaleNumberInput) scaleNumberInput.value = value.toFixed(2);
    localStorage.setItem("mainScale", value);
    // keep settings panel aligned after scale changes
    if (
      window.panelManager &&
      typeof window.panelManager.alignPanelToButton === "function"
    ) {
      window.panelManager.alignPanelToButton("settings");
    }
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
    if (
      window.panelManager &&
      typeof window.panelManager.alignPanelToButton === "function"
    ) {
      window.panelManager.alignPanelToButton("settings");
    }
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
    if (
      window.panelManager &&
      typeof window.panelManager.alignPanelToButton === "function"
    ) {
      window.panelManager.alignPanelToButton("settings");
    }
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
  }

  /**
   * 更新音效音量
   * @param {string|number} volume - 音量值 (0-100)
   */
  updateBeepVolume(volume) {
    const beepAudio = document.getElementById("beepSound");
    if (beepAudio) {
      beepAudio.volume = parseInt(volume) / 100;
    }
  }

  /**
   * 更新媒體音量
   * @param {string|number} volume - 音量值 (0-100)
   */
  updateMediaVolume(volume) {
    // 將音量設定儲存到 window.mediaManager 或全域變數
    if (window.mediaManager) {
      window.mediaManager.setMediaVolume(parseInt(volume) / 100);
    }
  }

  /**
   * 顯示設定面板
   */
  showSettingsPanel() {
    if (this.settingsPanel) this.settingsPanel.classList.remove("hidden");
    if (this.refCard) this.refCard.style.display = "block";
    // keep power switch visible so user can preview scaling
  }

  /**
   * 隱藏設定面板
   */
  hideSettingsPanel() {
    if (this.settingsPanel) this.settingsPanel.classList.add("hidden");
    if (this.refCard) this.refCard.style.display = "none";
    if (this.powerSwitchArea) this.powerSwitchArea.style.display = "block";
    if (this.powerLightArea) this.powerLightArea.style.display = "block";
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
      enterSvg.style.display = "none";
      exitSvg.style.display = "block";
      fullscreenButton.title = "退出全螢幕";
    } else {
      // 正常狀態：顯示進入圖標
      enterSvg.style.display = "block";
      exitSvg.style.display = "none";
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
      document.documentElement.requestFullscreen().catch((err) => {
        alert(`無法啟用全螢幕模式: ${err.message}`);
        if (window.logger)
          window.logger.logAction(`無法啟用全螢幕模式: ${err.message}`);
      });
      if (window.logger) window.logger.logAction("進入全螢幕模式");
    }
  }

  /**
   * 初始化 UI 控制項狀態，同步 checkbox 和實際效果
   */
  /**
   * 設定事件監聽器
   */
  setupEventListeners() {
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
        localStorage.setItem(
          "playBeepSound",
          e.target.checked ? "true" : "false",
        );
        if (window.logger)
          window.logger.logAction(
            `提示音效已 ${e.target.checked ? "開啟" : "關閉"}`,
          );
      });
    }

    // 音量控制 - 滑桿
    const beepVolume = document.getElementById("beepVolume");
    const beepVolumeNumber = document.getElementById("beepVolumeNumber");
    if (beepVolume) {
      beepVolume.addEventListener("input", (e) => {
        const volume = e.target.value;
        localStorage.setItem("beepVolume", volume);
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
        UIControlsManager.DEFAULTS.mainScale,
    );
    this.updateTopSpacer(
      configSettings.topSpacerHeight ??
        localStorage.getItem("topSpacerHeight") ??
        UIControlsManager.DEFAULTS.topSpacerHeight,
    );
    this.updateBottomSpacer(
      configSettings.bottomSpacerHeight ??
        localStorage.getItem("bottomSpacerHeight") ??
        UIControlsManager.DEFAULTS.bottomSpacerHeight,
    );
    this.updatePowerScale(
      configSettings.powerSwitchScale ??
        localStorage.getItem("powerSwitchScale") ??
        UIControlsManager.DEFAULTS.powerSwitchScale,
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
      UIControlsManager.DEFAULTS.beepVolume;
    const mediaVolume =
      configSettings.mediaVolume ??
      localStorage.getItem("mediaVolume") ??
      UIControlsManager.DEFAULTS.mediaVolume;

    this.updateBeepVolume(beepVolume);
    this.updateMediaVolume(mediaVolume);

    // 更新 UI 元素值
    this.syncUIElements(configSettings);

    // 設定重置按鈕事件
    this.setupResetButton();
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
      UIControlsManager.DEFAULTS.mainScale;
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
      UIControlsManager.DEFAULTS.topSpacerHeight;
    if (topSpacerRange) topSpacerRange.value = topValue;
    if (topSpacerNumberInput) topSpacerNumberInput.value = topValue;

    const bottomSpacerRange = document.getElementById("bottomSpacerRange");
    const bottomSpacerNumberInput = document.getElementById(
      "bottomSpacerNumberInput",
    );
    const bottomValue =
      configSettings.bottomSpacerHeight ??
      localStorage.getItem("bottomSpacerHeight") ??
      UIControlsManager.DEFAULTS.bottomSpacerHeight;
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
      UIControlsManager.DEFAULTS.powerSwitchScale;
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
        localStorage.getItem("showButtonLabels") !== "false";
    if (toggleButtonColors)
      toggleButtonColors.checked =
        localStorage.getItem("showButtonColors") !== "false";
    if (toggleTouchVisuals)
      toggleTouchVisuals.checked =
        localStorage.getItem("showTouchVisuals") !== "false";
    if (toggleMediaAreaMarker)
      toggleMediaAreaMarker.checked =
        localStorage.getItem("showMediaAreaMarker") === "true";
    if (toggleMediaContent)
      toggleMediaContent.checked =
        localStorage.getItem("showMediaContent") !== "false";
    if (toggleBeepSound)
      toggleBeepSound.checked =
        localStorage.getItem("playBeepSound") !== "false";

    // 音量控制
    const beepVolume = document.getElementById("beepVolume");
    const beepVolumeNumber = document.getElementById("beepVolumeNumber");
    const beepVolValue =
      configSettings.beepVolume ??
      localStorage.getItem("beepVolume") ??
      UIControlsManager.DEFAULTS.beepVolume;
    if (beepVolume) beepVolume.value = beepVolValue;
    if (beepVolumeNumber) beepVolumeNumber.value = beepVolValue;

    const mediaVolume = document.getElementById("mediaVolume");
    const mediaVolumeNumber = document.getElementById("mediaVolumeNumber");
    const mediaVolValue =
      configSettings.mediaVolume ??
      localStorage.getItem("mediaVolume") ??
      UIControlsManager.DEFAULTS.mediaVolume;
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
        if (this.loadControlsFromDOM) {
          this.loadControlsFromDOM();
        }
        if (window.logger) window.logger.logAction("已還原設定為預設值");
      }
    });
  }

  /**
   * 設定設定重置事件監聽器
   */
  setupSettingsResetListener() {
    document.addEventListener("user_settings_reset", () => {
      const s = window.configManager?.userSettings || {};

      if (s.mainScale !== undefined) this.updateScale(s.mainScale);
      if (s.topSpacerHeight !== undefined)
        this.updateTopSpacer(s.topSpacerHeight);
      if (s.bottomSpacerHeight !== undefined)
        this.updateBottomSpacer(s.bottomSpacerHeight);
      if (s.powerSwitchScale !== undefined)
        this.updatePowerScale(s.powerSwitchScale);

      if (s.showButtonLabels !== undefined)
        this.updateButtonLabelVisibility(s.showButtonLabels);
      if (s.showButtonColors !== undefined)
        this.updateButtonColorVisibility(s.showButtonColors);
      if (s.showTouchVisuals !== undefined)
        this.updateTouchVisuals(s.showTouchVisuals);
      if (s.showMediaAreaMarker !== undefined)
        this.updateMediaAreaMarkerVisibility(s.showMediaAreaMarker);
      if (s.showMediaContent !== undefined)
        this.updateMediaContentVisibility(s.showMediaContent);

      if (s.playBeepSound !== undefined) {
        localStorage.setItem(
          "playBeepSound",
          s.playBeepSound ? "true" : "false",
        );
      }

      if (window.logger) window.logger.logAction("已套用預設設定");
    });
  }
}

// 匯出單例
window.uiControls = new UIControlsManager();
