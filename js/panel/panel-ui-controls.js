// ui-controls.js - UI 控制項與面板管理模組

class UIControlsManager {
  constructor() {
    // 主要 DOM 元素
    this.settingsPanel = document.getElementById("settingsPanel");
    this.scalable = document.getElementById("scalableArea");
    this.mediaArea = document.getElementById("mediaArea");
    this.topSpacerPlaceholder = document.getElementById("topSpacerPlaceholder");
    this.refCard = document.getElementById("refCard");
    this.powerSwitchArea = document.getElementById("powerSwitchArea");
    this.powerLightArea = document.getElementById("powerLightArea");
    this.panelBottomRow = document.getElementById("panelBottomRow");
    if (this.powerSwitchArea) this.powerSwitchArea.style.display = "block";
    if (this.powerLightArea) this.powerLightArea.style.display = "block";
    if (this.settingsPanel) this.settingsPanel.classList.add("hidden");

    // 初始化媒體區塊的視覺提示外框
    if (this.mediaArea) {
      this.mediaArea.classList.add("step-complete-indicator");
      // 初始化時預設為關機狀態（墨綠色）
      this.mediaArea.classList.add("power-off");
      // 如果視覺提示關閉，隱藏提示外框
      const showTouchVisuals =
        localStorage.getItem("showTouchVisuals") !== "false";
      if (!showTouchVisuals) {
        this.mediaArea.classList.add("hidden-indicator");
      }
    }

    // 監聽器要在建構時綁定，確保 UI 控制項能即時生效
    this.setupEventListeners();

    // 當設定被重置為預設值時，更新 UI 控制項以反映新的預設值
    document.addEventListener("userSettingsReset", () => {
      const s = window.configManager?.userSettings || {};
      // Apply numeric values through existing methods
      if (s.powerSwitchScale !== undefined)
        this.updatePowerScale(s.powerSwitchScale);
      if (s.bottomSpacerHeight !== undefined)
        this.updateBottomSpacer(s.bottomSpacerHeight);
      if (s.mainScale !== undefined) this.updateScale(s.mainScale);
      if (s.topSpacerHeight !== undefined)
        this.updateTopSpacer(s.topSpacerHeight);

      // Toggle-style settings - update via the manager methods (some methods exist in this file)
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

      // Beep sound stored in localStorage; let other code read it
      if (s.playBeepSound !== undefined)
        localStorage.setItem(
          "playBeepSound",
          s.playBeepSound ? "true" : "false"
        );

      if (window.logger) window.logger.logAction("已套用預設設定");
    });
  }

  // 更新主縮放比例
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
  // 更新上方間隔高度
  updateTopSpacer(value) {
    const topSpacerRange = document.getElementById("topSpacerRange");
    const topSpacerNumberInput = document.getElementById(
      "topSpacerNumberInput"
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

  // 更新底部間距高度（針對 panelBottomRow）
  updateBottomSpacer(value) {
    const bottomSpacerRange = document.getElementById("bottomSpacerRange");
    const bottomSpacerNumberInput = document.getElementById(
      "bottomSpacerNumberInput"
    );

    value = Math.max(0, Math.min(50, parseFloat(value)));
    console.debug(`[UIControls] updateBottomSpacer => ${value}vh`);
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

  // 更新電源按鈕縮放
  updatePowerScale(value) {
    const powerScaleRange = document.getElementById("powerScaleRange");
    const powerScaleNumberInput = document.getElementById(
      "powerScaleNumberInput"
    );

    value = Math.max(0.5, Math.min(2, parseFloat(value)));
    console.debug(`[UIControls] updatePowerScale => ${value}`);
    // apply transform on container so all internal images scale uniformly
    if (this.powerSwitchArea)
      this.powerSwitchArea.style.transform = `scale(${value})`;
    if (powerScaleRange) powerScaleRange.value = value;
    if (powerScaleNumberInput) powerScaleNumberInput.value = value.toFixed(2);
    localStorage.setItem("powerSwitchScale", value);
  }
  // 切換按鈕標籤顯示
  updateButtonLabelVisibility(visible) {
    document.querySelectorAll(".button-label-text").forEach((label) => {
      label.classList.toggle("hidden", !visible);
    });
    localStorage.setItem("showButtonLabels", visible ? "true" : "false");
  }

  // 切換按鈕顏色顯示
  updateButtonColorVisibility(visible) {
    document.querySelectorAll(".button-overlay").forEach((button) => {
      button.classList.toggle("no-color", !visible);
    });
    localStorage.setItem("showButtonColors", visible ? "true" : "false");
    if (window.buttonManager)
      window.buttonManager.updateExperimentButtonStyles();
  }

  // 切換視覺提示回饋
  updateTouchVisuals(visible) {
    const buttonOverlays = document.querySelectorAll(".button-overlay");
    const shiftButtonOverlay = document.querySelector(
      ".button-overlay[data-label=\"B1\"]"
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
        button.classList.remove("touch-active")
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

  // 切換媒體區域標記顯示
  updateMediaAreaMarkerVisibility(visible) {
    if (this.mediaArea)
      this.mediaArea.classList.toggle("hide-area-marker", !visible);
    localStorage.setItem("showMediaAreaMarker", visible ? "true" : "false");
  }

  // 切換媒體內容顯示
  updateMediaContentVisibility(visible) {
    const mediaFiles = window.mediaManager
      ? window.mediaManager.mediaFiles
      : [];
    if (this.mediaArea)
      this.mediaArea.classList.toggle(
        "hide-media-content",
        !(visible && mediaFiles.length > 0)
      );
    localStorage.setItem("showMediaContent", visible ? "true" : "false");
  }

  // 顯示設定面板
  showSettingsPanel() {
    if (this.settingsPanel) this.settingsPanel.classList.remove("hidden");
    if (this.refCard) this.refCard.style.display = "block";
    // keep power switch visible so user can preview scaling
  }

  // 隱藏設定面板
  hideSettingsPanel() {
    if (this.settingsPanel) this.settingsPanel.classList.add("hidden");
    if (this.refCard) this.refCard.style.display = "none";
    if (this.powerSwitchArea) this.powerSwitchArea.style.display = "block";
    if (this.powerLightArea) this.powerLightArea.style.display = "block";
  }

  // 更新全螢幕按鈕圖標
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

  // 切換全螢幕
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

  // 設定事件監聽器
  setupEventListeners() {
    // 縮放控制
    const scaleRange = document.getElementById("scaleRange");
    const scaleNumberInput = document.getElementById("scaleNumberInput");
    if (scaleRange)
      scaleRange.addEventListener("input", (e) =>
        this.updateScale(e.target.value)
      );
    if (scaleNumberInput)
      scaleNumberInput.addEventListener("change", (e) =>
        this.updateScale(e.target.value)
      );

    // 頂部間隔控制
    const topSpacerRange = document.getElementById("topSpacerRange");
    const topSpacerNumberInput = document.getElementById(
      "topSpacerNumberInput"
    );
    if (topSpacerRange)
      topSpacerRange.addEventListener("input", (e) =>
        this.updateTopSpacer(e.target.value)
      );
    if (topSpacerNumberInput)
      topSpacerNumberInput.addEventListener("change", (e) =>
        this.updateTopSpacer(e.target.value)
      );

    // 底部間距控制
    const bottomSpacerRange = document.getElementById("bottomSpacerRange");
    const bottomSpacerNumberInput = document.getElementById(
      "bottomSpacerNumberInput"
    );
    if (bottomSpacerRange)
      bottomSpacerRange.addEventListener("input", (e) =>
        this.updateBottomSpacer(e.target.value)
      );
    if (bottomSpacerNumberInput)
      bottomSpacerNumberInput.addEventListener("change", (e) =>
        this.updateBottomSpacer(e.target.value)
      );

    // 電源按鈕縮放控制
    const powerScaleRange = document.getElementById("powerScaleRange");
    const powerScaleNumberInput = document.getElementById(
      "powerScaleNumberInput"
    );
    if (powerScaleRange)
      powerScaleRange.addEventListener("input", (e) =>
        this.updatePowerScale(e.target.value)
      );
    if (powerScaleNumberInput)
      powerScaleNumberInput.addEventListener("change", (e) =>
        this.updatePowerScale(e.target.value)
      );

    // 關閉設定面板按鈕
    const closeSettingsPanel = document.getElementById("closeSettingsPanel");
    if (closeSettingsPanel)
      closeSettingsPanel.addEventListener("click", () =>
        this.hideSettingsPanel()
      );

    // 顯示/隱藏控制項
    const toggleButtonLabels = document.getElementById("toggleButtonLabels");
    const toggleButtonColors = document.getElementById("toggleButtonColors");
    const toggleTouchVisuals = document.getElementById("toggleTouchVisuals");
    const toggleMediaAreaMarker = document.getElementById(
      "toggleMediaAreaMarker"
    );
    const toggleMediaContent = document.getElementById("toggleMediaContent");
    const toggleBeepSound = document.getElementById("toggleBeepSound");

    if (toggleButtonLabels)
      toggleButtonLabels.addEventListener("change", (e) =>
        this.updateButtonLabelVisibility(e.target.checked)
      );
    if (toggleButtonColors)
      toggleButtonColors.addEventListener("change", (e) =>
        this.updateButtonColorVisibility(e.target.checked)
      );
    if (toggleTouchVisuals)
      toggleTouchVisuals.addEventListener("change", (e) =>
        this.updateTouchVisuals(e.target.checked)
      );
    if (toggleMediaAreaMarker)
      toggleMediaAreaMarker.addEventListener("change", (e) =>
        this.updateMediaAreaMarkerVisibility(e.target.checked)
      );
    if (toggleMediaContent)
      toggleMediaContent.addEventListener("change", (e) =>
        this.updateMediaContentVisibility(e.target.checked)
      );
    if (toggleBeepSound) {
      toggleBeepSound.addEventListener("change", (e) => {
        localStorage.setItem(
          "playBeepSound",
          e.target.checked ? "true" : "false"
        );
        if (window.logger)
          window.logger.logAction(
            `提示音效已 ${e.target.checked ? "開啟" : "關閉"}`
          );
      });
    }

    // 全螢幕按鈕
    const fullscreenButton = document.getElementById("fullscreenButton");
    if (fullscreenButton)
      fullscreenButton.addEventListener("click", () => this.toggleFullscreen());

    // 全螢幕狀態變化監聽器
    document.addEventListener("fullscreenchange", () =>
      this.updateFullscreenButtonIcon()
    );

    // 防止右鍵選單
    document.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // 初始化 UI 狀態
  initializeUIState() {
    Logger.debug("初始化 UI 狀態，載入設定...");

    // 初始化全螢幕按鈕圖標
    this.updateFullscreenButtonIcon();

    // 從 configManager 或 localStorage 載入設定
    const configSettings = window.configManager?.userSettings || {};
    const savedMainScale =
      configSettings.mainScale || localStorage.getItem("mainScale");
    Logger.debug(`載入縮放比例: ${savedMainScale || "預設 1.29"}`);
    this.updateScale(savedMainScale || 1.29);

    const savedTopSpacerHeight =
      configSettings.topSpacerHeight || localStorage.getItem("topSpacerHeight");
    Logger.debug(
      `載入頂部空間: ${
        savedTopSpacerHeight !== null ? savedTopSpacerHeight : "預設 5"
      }`
    );
    this.updateTopSpacer(
      savedTopSpacerHeight !== null ? savedTopSpacerHeight : 5
    );

    // 載入並套用底部間距
    const savedBottomSpacerHeight =
      configSettings.bottomSpacerHeight ||
      localStorage.getItem("bottomSpacerHeight");
    Logger.debug(
      `載入底部間距: ${savedBottomSpacerHeight !== null ? savedBottomSpacerHeight : "預設 0"}`
    );
    this.updateBottomSpacer(
      savedBottomSpacerHeight !== null ? savedBottomSpacerHeight : 3
    );

    // 載入並套用電源按鈕縮放
    const savedPowerScale =
      configSettings.powerSwitchScale ||
      localStorage.getItem("powerSwitchScale");
    Logger.debug(
      `載入電源按鈕縮放: ${savedPowerScale !== null ? savedPowerScale : "預設 0.90"}`
    );
    this.updatePowerScale(savedPowerScale !== null ? savedPowerScale : 0.9);

    // 控制項初始狀態
    const toggleButtonLabels = document.getElementById("toggleButtonLabels");
    const toggleButtonColors = document.getElementById("toggleButtonColors");
    const toggleTouchVisuals = document.getElementById("toggleTouchVisuals");
    const toggleMediaAreaMarker = document.getElementById(
      "toggleMediaAreaMarker"
    );
    const toggleMediaContent = document.getElementById("toggleMediaContent");
    const toggleBeepSound = document.getElementById("toggleBeepSound");

    // 還原預設按鈕
    const resetSettingsBtn = document.getElementById("resetSettingsBtn");
    if (resetSettingsBtn) {
      resetSettingsBtn.addEventListener("click", async () => {
        // 保守做法：呼叫 ConfigManager 的 reset 方法
        if (
          window.configManager &&
          typeof window.configManager.resetUserSettingsToDefaults === "function"
        ) {
          await window.configManager.resetUserSettingsToDefaults();
          // 更新本機 UIControls 的狀態
          if (
            window.uiControls &&
            typeof window.uiControls.loadControlsFromDOM === "function"
          ) {
            window.uiControls.loadControlsFromDOM();
          }
          // 顯示短暫通知
          if (window.logger) window.logger.logAction("已還原設定為預設值");
        }
      });
    }

    if (toggleButtonLabels) {
      toggleButtonLabels.checked =
        localStorage.getItem("showButtonLabels") === "true";
      this.updateButtonLabelVisibility(toggleButtonLabels.checked);
    }
    if (toggleButtonColors) {
      toggleButtonColors.checked =
        localStorage.getItem("showButtonColors") === "true";
      this.updateButtonColorVisibility(toggleButtonColors.checked);
    }
    if (toggleTouchVisuals) {
      // default to true unless explicitly set to "false" in localStorage
      toggleTouchVisuals.checked =
        localStorage.getItem("showTouchVisuals") !== "false";
      this.updateTouchVisuals(toggleTouchVisuals.checked);
    }
    if (toggleMediaAreaMarker) {
      toggleMediaAreaMarker.checked =
        localStorage.getItem("showMediaAreaMarker") === "true";
      this.updateMediaAreaMarkerVisibility(toggleMediaAreaMarker.checked);
    }
    if (toggleMediaContent) {
      toggleMediaContent.checked =
        localStorage.getItem("showMediaContent") !== "false";
      this.updateMediaContentVisibility(toggleMediaContent.checked);
    }
    if (toggleBeepSound) {
      toggleBeepSound.checked =
        localStorage.getItem("playBeepSound") !== "false";
    }
  }
}

// 匯出單例
window.uiControls = new UIControlsManager();
