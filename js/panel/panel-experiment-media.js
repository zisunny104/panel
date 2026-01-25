/**
 * PanelExperimentMedia - 面板實驗媒體管理器
 *
 * 負責媒體顯示、播放控制、結束處理等媒體相關功能
 * 專門處理實驗過程中媒體的載入和展示邏輯
 */
class PanelExperimentMedia {
  constructor(manager) {
    this.manager = manager; // 引用到主管理器
    this.currentMediaElement = null;
    this.currentMediaPath = null;
  }

  /**
   * 顯示媒體
   */
  displayMedia(mediaPath) {
    if (!mediaPath) {
      Logger.warn("無效的媒體路徑");
      return;
    }

    Logger.debug(`顯示媒體: ${mediaPath}`);

    // 停止當前媒體（如果有）
    this.stopCurrentMedia();

    // 更新當前媒體路徑
    this.currentMediaPath = mediaPath;

    // 取得媒體容器
    const mediaContainer = document.getElementById("mediaContainer");
    if (!mediaContainer) {
      Logger.warn("找不到媒體容器");
      return;
    }

    // 清空容器
    mediaContainer.innerHTML = "";

    // 根據檔案類型決定如何顯示媒體
    const fileExtension = this.getFileExtension(mediaPath).toLowerCase();

    if (this.isVideoFile(fileExtension)) {
      this.displayVideo(mediaPath, mediaContainer);
    } else if (this.isImageFile(fileExtension)) {
      this.displayImage(mediaPath, mediaContainer);
    } else if (this.isAudioFile(fileExtension)) {
      this.displayAudio(mediaPath, mediaContainer);
    } else {
      Logger.warn(`不支援的媒體類型: ${fileExtension}`);
      this.displayText("不支援的媒體格式", mediaContainer);
    }

    // 記錄日誌
    if (window.logger) {
      window.logger.logAction(
        `顯示媒體: ${mediaPath}`,
        "media_display",
        null,
        false,
        false
      );
    }
  }

  /**
   * 顯示影片
   */
  displayVideo(mediaPath, container) {
    const video = document.createElement("video");
    video.src = mediaPath;
    video.controls = true;
    video.autoplay = false; // 不自動播放，讓用戶控制
    video.style.width = "100%";
    video.style.height = "auto";
    video.style.maxHeight = "400px";

    // 設定影片事件監聽器
    video.addEventListener("ended", () => {
      this.handleMediaEnd();
    });

    video.addEventListener("error", (e) => {
      Logger.error(`影片載入錯誤: ${mediaPath}`, e);
      this.displayText(`影片載入失敗: ${mediaPath}`, container);
    });

    // 儲存當前媒體元素引用
    this.currentMediaElement = video;

    container.appendChild(video);

    Logger.debug(`影片元素已建立: ${mediaPath}`);
  }

  /**
   * 顯示圖片
   */
  displayImage(mediaPath, container) {
    const img = document.createElement("img");
    img.src = mediaPath;
    img.style.width = "100%";
    img.style.height = "auto";
    img.style.maxHeight = "400px";
    img.style.objectFit = "contain";

    img.addEventListener("error", (e) => {
      Logger.error(`圖片載入錯誤: ${mediaPath}`, e);
      this.displayText(`圖片載入失敗: ${mediaPath}`, container);
    });

    // 儲存當前媒體元素引用
    this.currentMediaElement = img;

    container.appendChild(img);

    Logger.debug(`圖片元素已建立: ${mediaPath}`);
  }

  /**
   * 顯示音訊
   */
  displayAudio(mediaPath, container) {
    const audio = document.createElement("audio");
    audio.src = mediaPath;
    audio.controls = true;
    audio.autoplay = false;
    audio.style.width = "100%";

    // 設定音訊事件監聽器
    audio.addEventListener("ended", () => {
      this.handleMediaEnd();
    });

    audio.addEventListener("error", (e) => {
      Logger.error(`音訊載入錯誤: ${mediaPath}`, e);
      this.displayText(`音訊載入失敗: ${mediaPath}`, container);
    });

    // 儲存當前媒體元素引用
    this.currentMediaElement = audio;

    container.appendChild(audio);

    Logger.debug(`音訊元素已建立: ${mediaPath}`);
  }

  /**
   * 顯示文字
   */
  displayText(text, container) {
    const textElement = document.createElement("div");
    textElement.textContent = text;
    textElement.style.padding = "20px";
    textElement.style.textAlign = "center";
    textElement.style.fontSize = "16px";
    textElement.style.color = "#666";

    container.appendChild(textElement);

    Logger.debug(`文字已顯示: ${text}`);
  }

  /**
   * 處理媒體結束
   */
  handleMediaEnd() {
    Logger.debug("媒體播放結束");

    // 記錄日誌
    if (window.logger) {
      window.logger.logAction(
        `媒體結束: ${this.currentMediaPath}`,
        "media_end",
        null,
        false,
        false
      );
    }

    // 如果是實驗運行中且未暫停，自動進入下一步
    if (this.manager.isExperimentRunning && !this.manager.timer.isPaused()) {
      // 延遲一下再進入下一步，給用戶一點時間
      setTimeout(() => {
        this.manager.flow.nextStep();
      }, 1000);
    }
  }

  /**
   * 停止當前媒體
   */
  stopCurrentMedia() {
    if (this.currentMediaElement) {
      // 如果是影片或音訊，停止播放
      if (this.currentMediaElement.pause) {
        this.currentMediaElement.pause();
      }

      // 移除事件監聽器（如果有的話）
      if (this.currentMediaElement.removeEventListener) {
        this.currentMediaElement.removeEventListener(
          "ended",
          this.handleMediaEnd
        );
      }

      this.currentMediaElement = null;
    }

    this.currentMediaPath = null;
  }

  /**
   * 暫停媒體
   */
  pauseMedia() {
    if (this.currentMediaElement && this.currentMediaElement.pause) {
      this.currentMediaElement.pause();
      Logger.debug("媒體已暫停");
    }
  }

  /**
   * 恢復媒體播放
   */
  resumeMedia() {
    if (this.currentMediaElement && this.currentMediaElement.play) {
      this.currentMediaElement.play().catch((error) => {
        Logger.warn("無法恢復媒體播放:", error);
      });
      Logger.debug("媒體已恢復播放");
    }
  }

  /**
   * 取得檔案副檔名
   */
  getFileExtension(filename) {
    return filename.split(".").pop();
  }

  /**
   * 檢查是否為影片檔案
   */
  isVideoFile(extension) {
    const videoExtensions = ["mp4", "avi", "mov", "wmv", "flv", "webm", "mkv"];
    return videoExtensions.includes(extension);
  }

  /**
   * 檢查是否為圖片檔案
   */
  isImageFile(extension) {
    const imageExtensions = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"];
    return imageExtensions.includes(extension);
  }

  /**
   * 檢查是否為音訊檔案
   */
  isAudioFile(extension) {
    const audioExtensions = ["mp3", "wav", "ogg", "aac", "flac", "m4a"];
    return audioExtensions.includes(extension);
  }

  /**
   * 取得當前媒體路徑
   */
  getCurrentMediaPath() {
    return this.currentMediaPath;
  }

  /**
   * 檢查是否有正在播放的媒體
   */
  hasActiveMedia() {
    return this.currentMediaElement !== null;
  }

  /**
   * 顯示目前步驟的媒體或首頁
   */
  showCurrentStepMediaOrHome() {
    if (!window._allUnits || this.manager.loadedUnits.length === 0) return;
    const unitId = this.manager.loadedUnits[this.manager.currentUnitIndex];
    const unit = window._allUnits.find((u) => u.unit_id === unitId);
    if (!unit) return;
    const step = unit.steps[this.manager.currentStepIndex];
    if (!step) return;

    const _isFirstStep =
      this.manager.currentStepIndex === 0 && step.step_id.includes("_1");
    const isPowerOn = window.buttonManager
      ? window.buttonManager.isPowerOn()
      : true;

    // 如果機器未開機，顯示等待開機提示（所有步驟都一樣）
    if (!isPowerOn) {
      if (window.mediaManager && window.mediaManager.mediaArea) {
        window.mediaManager.mediaArea.innerHTML = `
                    <div class="machine-status-message">
                        <div class="machine-status-icon">⚡</div>
                        <div class="machine-status-title">機器未開機</div>
                        <div class="machine-status-subtitle">請先開啟機器電源</div>
                        <div class="machine-status-waiting">等待中...</div>
                    </div>
                `;
      }
      // 清除按鈕高亮（因為機器未開機）
      if (window.buttonManager) {
        window.buttonManager.updateExperimentButtonStyles();
      }
      return;
    }

    // 處理媒體播放
    const mediaFile = step.media_file;
    if (mediaFile && window.mediaManager) {
      // 有媒體檔案，播放步驟媒體
      window.mediaManager.showStepMedia(mediaFile);
    } else if (window.mediaManager && isPowerOn) {
      // 沒有媒體檔案且機器已開機，播放首頁循環
      window.mediaManager.showHomePageVideo();
    }

    // 更新按鈕高亮
    if (window.buttonManager) {
      window.buttonManager.updateExperimentButtonStyles();
    }
  }

  /**
   * 清除媒體容器
   */
  clearMediaContainer() {
    const mediaContainer = document.getElementById("mediaContainer");
    if (mediaContainer) {
      mediaContainer.innerHTML = "";
    }

    this.stopCurrentMedia();
    Logger.debug("媒體容器已清除");
  }
}

// 匯出媒體管理器類別（實例化時需要傳入manager）
window.PanelExperimentMedia = PanelExperimentMedia;
