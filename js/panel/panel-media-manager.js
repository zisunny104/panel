// media-manager.js - 媒體播放與管理模塊

class MediaManager {
  constructor() {
    this.mediaFiles = [];
    this.currentMediaIndex = 0;
    this.mediaArea = document.getElementById("mediaArea");
    this.isHomePageLooping = false;
    this.homePageVideoElement = null;

    // 媒體快取相關
    this.mediaCache = new Map(); // 儲存已快取的媒體
    this.preloadPromises = new Map(); // 儲存預先載入 Promise
    this.isPreloading = false;
    this.hasPreloadedEssential = false; // 是否已預先載入基本資源

    // 監聽組合選擇事件，進行組合特定的預先載入
    this.setupEventListeners();
  }

  /**
   * 設置事件監聽器
   */
  setupEventListeners() {
    // 監聽組合選擇事件
    document.addEventListener("combination_selected", (event) => {
      // 使用事件中的組合資料，或者延遲一下再檢查
      const combination = event.detail?.combination;
      if (combination) {
        setTimeout(() => this.preloadCombinationMedia(combination), 500);
      } else {
        setTimeout(() => this.preloadCombinationMedia(), 500);
      }
    });

    // 監聽遠端組合選擇事件
    document.addEventListener("remote_combination_selected", (event) => {
      const combination = event.detail?.combination;
      if (combination) {
        setTimeout(() => this.preloadCombinationMedia(combination), 500);
      } else {
        setTimeout(() => this.preloadCombinationMedia(), 500);
      }
    });
  }

  // 統一的媒體播放方法
  playMedia(src, options = {}) {
    if (!this.mediaArea) {
      Logger.warn("playMedia: mediaArea 不存在");
      return null;
    }

    if (!src || src.trim() === "") {
      Logger.warn("playMedia: 收到空的媒體路徑");
      return null;
    }

    // 停止首頁循環
    this.stopHomePageLoop();

    // 清空媒體區域
    this.mediaArea.innerHTML = "";
    this.mediaArea.classList.remove("hide-media-content");

    let mediaElement;

    // 根據檔案類型建立相應元素
    if (src.endsWith(".mp4") || src.endsWith(".webm") || src.endsWith(".ogg")) {
      mediaElement = document.createElement("video");
      this.setupVideoElement(mediaElement, src, options);
    } else if (
      src.endsWith(".jpg") ||
      src.endsWith(".jpeg") ||
      src.endsWith(".png") ||
      src.endsWith(".gif") ||
      src.endsWith(".webp")
    ) {
      mediaElement = document.createElement("img");
      this.setupImageElement(mediaElement, src, options);
    } else {
      Logger.error(`不支援的媒體格式: ${src}`);
      this.mediaArea.innerHTML =
        '<div class="media-error-message">不支援的媒體格式</div>';
      return null;
    }

    this.mediaArea.appendChild(mediaElement);

    // 自動聚焦到媒體區域
    if (options.scrollIntoView !== false) {
      this.mediaArea.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    return mediaElement;
  }

  // 設定影片元素
  setupVideoElement(video, src, options = {}) {
    // 檢查來源路徑是否有效
    if (!src || src.trim() === "") {
      Logger.warn("setupVideoElement: 收到空的影片路徑");
      return;
    }

    // 確保路徑正確，如果是相對路徑則轉換為絕對路徑
    let finalSrc = src;

    if (
      !src.startsWith("http") &&
      !src.startsWith("blob:") &&
      !src.startsWith("data:")
    ) {
      // 對於相對路徑，確保正確編碼，避免雙重編碼
      // PHP 伺服器會自動處理 URL 編碼，所以這裡只需傳遞原始路徑
      const baseUrl =
        window.location.origin +
        window.location.pathname.substring(
          0,
          window.location.pathname.lastIndexOf("/") + 1
        );

      try {
        // 使用 URL API 正確編碼相對路徑
        finalSrc = new URL(src, baseUrl).href;
        // 除錯：確認路徑轉換正確
        if (finalSrc === baseUrl || !finalSrc.includes(src.split("/").pop())) {
          Logger.warn(
            `URL 轉換可能有誤: 原始=${src}, baseUrl=${baseUrl}, 結果=${finalSrc}`
          );
          // 回退到直接拼接
          finalSrc = baseUrl + src;
        }
      } catch (e) {
        // 如果 URL 無效，直接使用原始路徑
        Logger.warn(`URL 編碼失敗，使用原始路徑: ${src}`, e);
        finalSrc = src;
      }
    }

    video.src = finalSrc;

    video.style.width = "100%";
    video.style.height = "100%";
    video.style.display = "block";
    video.style.objectFit = "contain";
    video.style.outline = "none";
    video.style.border = "none";
    video.style.background = "transparent";

    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("preload", "metadata");

    // 強制隱藏控制項
    video.controls = false;
    video.muted = options.muted !== false; // 預設靜音
    video.loop = options.loop || false;
    video.autoplay = options.autoplay !== false; // 預設自動播放

    // 事件監聯
    video.addEventListener("loadstart", () => {
      video.style.background = "transparent";
    });

    // 儲存原始路徑供錯誤處理使用
    const originalSrc = src;
    const resolvedSrc = finalSrc;

    video.addEventListener("error", (e) => {
      // 檢查是否為真正的載入錯誤（排除空 src 或被清除的情況）
      const currentSrc = video.src || "";
      if (
        !currentSrc ||
        currentSrc === window.location.origin + "/" ||
        currentSrc === window.location.href
      ) {
        // 影片 src 被清除或為空，可能是競態條件，忽略此錯誤
        return;
      }

      Logger.error(`影片載入錯誤: ${currentSrc} (原始: ${originalSrc})`, e);
      const errorInfo = this.getDetailedErrorInfo(video, e, originalSrc);
      if (options.onError) {
        options.onError(e, errorInfo);
      } else {
        this.displayDetailedError(errorInfo, "影片");
      }
    });

    video.addEventListener("ended", () => {
      if (options.onEnded) options.onEnded();
    });

    // 嘗試播放
    setTimeout(() => {
      video.play().catch((error) => {
        if (options.onPlayError) {
          options.onPlayError(error);
        } else if (video.paused) {
          // 影片暫停，但保持控制項隱藏
        }
      });
    }, 0);

    if (options.onStart) options.onStart(video);
  }

  // 設定圖片元素
  setupImageElement(img, src, options = {}) {
    // 確保路徑正確，如果是相對路徑則轉換為絕對路徑
    let finalSrc = src;

    if (
      !src.startsWith("http") &&
      !src.startsWith("blob:") &&
      !src.startsWith("data:")
    ) {
      // 對於相對路徑，確保正確編碼，避免雙重編碼
      // PHP 伺服器會自動處理 URL 編碼，所以這裡只需傳遞原始路徑
      const baseUrl =
        window.location.origin +
        window.location.pathname.substring(
          0,
          window.location.pathname.lastIndexOf("/") + 1
        );

      try {
        // 使用 URL API 正確編碼相對路徑
        finalSrc = new URL(src, baseUrl).href;
      } catch (e) {
        // 如果 URL 無效，直接使用原始路徑
        Logger.warn(`URL 編碼失敗，使用原始路徑: ${src}`, e);
        finalSrc = src;
      }
    }

    img.src = finalSrc;

    img.style.width = "100%";
    img.style.height = "100%";
    img.style.display = "block";
    img.style.objectFit = "contain";

    img.addEventListener("error", (e) => {
      Logger.error(`圖片載入錯誤: ${img.src}`, e);
      const errorInfo = this.getDetailedErrorInfo(img, e, src);
      if (options.onError) {
        options.onError(e, errorInfo);
      } else {
        this.displayDetailedError(errorInfo, "圖片");
      }
    });

    img.addEventListener("load", () => {
      if (options.onStart) options.onStart(img);
    });
  }

  // 在媒體區域播放指定媒體
  playMediaInArea(src, options = {}) {
    if (!this.mediaArea) return;

    this.mediaArea.innerHTML = "";
    this.mediaArea.classList.remove("hide-media-content");

    const video = document.createElement("video");
    video.src = src;
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.display = "block";
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("preload", "auto");
    video.controls = options.controls || false;
    video.muted = options.muted ?? true;
    video.autoplay = true;

    this.mediaArea.appendChild(video);
    setTimeout(() => {
      video.play().catch(() => {});
    }, 0);

    if (options.onStart) options.onStart(video);

    video.addEventListener("ended", () => {
      if (options.onEnded) options.onEnded();
    });

    video.addEventListener("error", () => {
      const errorInfo = this.getDetailedErrorInfo(video, null, src);
      this.displayDetailedError(errorInfo, "影片");
      if (options.onError) options.onError();
    });

    this.mediaArea.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // 停止首頁影片循環
  stopHomePageLoop() {
    if (this.isHomePageLooping && this.homePageVideoElement) {
      this.homePageVideoElement.pause();
      this.homePageVideoElement.src = "";
      this.homePageVideoElement.remove();
      this.homePageVideoElement = null;
    }
    this.isHomePageLooping = false;

    // 確保清空媒體區域的任何錯誤訊息
    if (
      this.mediaArea &&
      this.mediaArea.innerHTML.includes("首頁影片載入失敗")
    ) {
      this.mediaArea.innerHTML = "";
    }
  }

  // 播放首頁影片循環
  // @param {boolean} forcePlay - 是否強制播放（即使在實驗模式下）
  playHomePageLoop(forcePlay = false) {
    // 檢查是否在實驗模式，如果是且沒有強制播放就不播放首頁影片
    if (
      !forcePlay &&
      window.experiment &&
      window.experiment.isExperimentRunning
    ) {
      return;
    }

    const video = this.playMedia("assets/units/SYSTEM/home_page.mp4", {
      controls: false,
      muted: true,
      loop: true,
      autoplay: true,
      onError: (e, errorInfo) => {
        Logger.error("首頁影片載入失敗", e);

        // 檢查系統是否還在開機狀態，如果已關機就不顯示錯誤
        const isSystemOn = window.powerControl && window.powerControl.isPowerOn;

        if (!window.experiment || !window.experiment.isExperimentRunning) {
          if (isSystemOn && this.isHomePageLooping) {
            // 只有在系統開機且首頁循環標記還在時才顯示錯誤
            this.mediaArea.innerHTML = `
                            <div class="media-load-error">
                                <div class="media-load-error-title">首頁影片載入失敗</div>
                                <div class="media-load-error-details">
                                    ${errorInfo.errorMessage}<br>
                                    <span class="media-load-error-file">
                                        檔案: assets/units/SYSTEM/home_page.mp4<br>
                                        ${
                                          errorInfo.onlineStatus === "離線"
                                            ? "裝置離線"
                                            : ""
                                        }
                                    </span>
                                </div>
                            </div>
                        `;
          }
        }
      },
    });

    if (video) {
      this.isHomePageLooping = true;
      this.homePageVideoElement = video;
    }
  }

  // 顯示步驟媒體（實驗模式用）
  showStepMedia(mediaFile) {
    if (!mediaFile) {
      return;
    }

    const mediaElement = this.playMedia(mediaFile, {
      controls: false,
      muted: true,
      autoplay: true,
      loop: false,
      scrollIntoView: true,
    });

    return mediaElement;
  }

  // 預先載入媒體檔案（減少黑畫面等待時間）
  preloadMedia(mediaFile) {
    if (!mediaFile) {
      return null;
    }

    let preloadElement;

    if (
      mediaFile.endsWith(".jpg") ||
      mediaFile.endsWith(".jpeg") ||
      mediaFile.endsWith(".png") ||
      mediaFile.endsWith(".gif") ||
      mediaFile.endsWith(".webp")
    ) {
      // 預先載入圖片
      preloadElement = document.createElement("img");
      preloadElement.style.display = "none"; // 不顯示，只預先載入
      preloadElement.src = mediaFile;
      preloadElement.setAttribute("data-preload", "true");
      document.body.appendChild(preloadElement);

      Logger.debug(`預先載入圖片: ${mediaFile}`);
    } else if (
      mediaFile.endsWith(".mp4") ||
      mediaFile.endsWith(".webm") ||
      mediaFile.endsWith(".ogg")
    ) {
      // 預先載入影片（使用 preload 屬性）
      preloadElement = document.createElement("video");
      preloadElement.style.display = "none";
      preloadElement.src = mediaFile;
      preloadElement.setAttribute("preload", "auto");
      preloadElement.setAttribute("data-preload", "true");
      document.body.appendChild(preloadElement);

      Logger.debug(`🎬 預先載入影片: ${mediaFile}`);
    }

    return preloadElement;
  }

  // 批量預先載入多個媒體檔案
  preloadMediaBatch(mediaFiles) {
    if (!Array.isArray(mediaFiles)) {
      return;
    }

    mediaFiles.forEach((mediaFile) => {
      if (mediaFile) {
        this.preloadMedia(mediaFile);
      }
    });

    Logger.debug(`📦 批量預先載入 ${mediaFiles.length} 個媒體檔案`);
  }

  // 清除預先載入的媒體
  clearPreloadedMedia() {
    const preloadElements = document.querySelectorAll("[data-preload='true']");
    preloadElements.forEach((element) => {
      element.remove();
    });

    Logger.debug(`🧹 已清除預先載入的媒體`);
  }

  // 顯示媒體（實驗模式用的別名方法）
  displayMedia(mediaFile) {
    return this.showStepMedia(mediaFile);
  }

  // 清空媒體區域
  clearMediaArea() {
    if (this.mediaArea) {
      this.mediaArea.innerHTML = "";
      this.mediaFiles = [];
      this.currentMediaIndex = 0;
    }

    // 更新顯示狀態
    if (window.uiControls) {
      const toggleMediaAreaMarker = document.getElementById(
        "toggleMediaAreaMarker"
      );
      const toggleMediaContent = document.getElementById("toggleMediaContent");

      if (toggleMediaAreaMarker) {
        window.uiControls.updateMediaAreaMarkerVisibility(
          toggleMediaAreaMarker.checked
        );
      }
      if (toggleMediaContent) {
        window.uiControls.updateMediaContentVisibility(
          toggleMediaContent.checked
        );
      }
    }
  }

  // 重設媒體管理器
  reset() {
    this.stopHomePageLoop();
    this.clearMediaArea();
    if (window.logger) {
      window.logger.logAction("媒體已初始化");
    }
  }

  // 取得錯誤資訊
  getDetailedErrorInfo(mediaElement, errorEvent, originalSrc) {
    const timestamp = window.timeSyncManager
      ? window.timeSyncManager.formatDateTime(Date.now())
      : new Date().toLocaleString("zh-TW", {
          timeZone: window.timeSyncManager?.timezone || "Asia/Taipei",
        });

    const errorInfo = {
      timestamp: timestamp,
      originalSrc: originalSrc,
      currentSrc: mediaElement.src,
      mediaType: mediaElement.tagName.toLowerCase(),
      onlineStatus: navigator.onLine ? "線上" : "離線",
      errorCode: null,
      errorMessage: "載入失敗",
    };

    // 取得具體錯誤代碼
    if (mediaElement.error) {
      errorInfo.errorCode = mediaElement.error.code;
      errorInfo.errorMessage = this.getMediaErrorText(mediaElement.error.code);
    }

    // 分析可能的錯誤原因
    if (
      originalSrc &&
      !originalSrc.startsWith("blob:") &&
      !originalSrc.startsWith("data:")
    ) {
      errorInfo.possibleCauses = this.analyzePossibleCauses(
        originalSrc,
        errorInfo
      );
    }

    return errorInfo;
  }

  // 取得簡化的媒體錯誤文字
  getMediaErrorText(errorCode) {
    const errors = {
      1: "載入被中止",
      2: "網路錯誤",
      3: "解碼錯誤",
      4: "不支援的檔案格式",
    };
    return errors[errorCode] || "載入失敗";
  }

  // 分析可能的錯誤原因
  analyzePossibleCauses(src, errorInfo) {
    // 檢查錯誤代碼特定原因
    if (errorInfo.errorCode === 2) {
      return ["網路連線問題"];
    } else if (errorInfo.errorCode === 4) {
      return ["檔案不存在或無法存取"];
    } else if (errorInfo.errorCode === 3) {
      return ["檔案格式錯誤"];
    }

    // 檢查檔案副檔名
    const extension = src.split(".").pop().toLowerCase();
    const supportedVideo = ["mp4", "webm", "ogg"];
    const supportedImage = ["jpg", "jpeg", "png", "gif", "webp"];

    if (
      errorInfo.mediaType === "video" &&
      !supportedVideo.includes(extension)
    ) {
      return [`不支援的影片格式: ${extension}`];
    } else if (
      errorInfo.mediaType === "img" &&
      !supportedImage.includes(extension)
    ) {
      return [`不支援的圖片格式: ${extension}`];
    }

    // 檢查網路狀態
    if (!navigator.onLine) {
      return ["裝置離線狀態"];
    }

    return ["檔案載入失敗"];
  }

  // 顯示簡化的錯誤資訊
  displayDetailedError(errorInfo, mediaType) {
    const errorHtml = `
            <div class="media-detailed-error">
                <div class="media-detailed-error-title">
                    ${mediaType}載入失敗
                </div>
                <div class="media-detailed-error-message">
                    無法載入媒體檔案
                </div>
                ${
                  errorInfo.possibleCauses
                    ? `
                <div class="media-detailed-error-cause">
                    ${errorInfo.possibleCauses[0]}
                </div>
                `
                    : ""
                }
            </div>
        `;

    this.mediaArea.innerHTML = errorHtml;

    // 記錄到日誌
    if (window.logger) {
      window.logger.logAction(
        `${mediaType}載入失敗: ${errorInfo.errorMessage} (${errorInfo.originalSrc})`
      );
    }
  }

  /**
   * 預先載入所有媒體檔案到快取
   * 現在只預先載入基本資源，組合特定的媒體在組合選擇後預先載入
   */
  async preloadAllMedia() {
    if (this.isPreloading) {
      Logger.debug("媒體預先載入已在進行中");
      return;
    }

    this.isPreloading = true;
    const startTime = performance.now();

    try {
      // 只預先載入基本資源
      const essentialFiles = await this.collectEssentialMediaFiles();

      Logger.debug(`開始預先載入 ${essentialFiles.length} 個基本媒體檔案...`);

      // 按優先級排序：先載入小的、常用的檔案
      const sortedFiles = this.sortMediaByPriority(essentialFiles);

      // 批次處理，避免阻塞主線程
      const batchSize = 2; // 每次只處理2個檔案
      const batches = [];
      for (let i = 0; i < sortedFiles.length; i += batchSize) {
        batches.push(sortedFiles.slice(i, i + batchSize));
      }

      let totalSuccessful = 0;
      let totalFailed = 0;
      const successfulFiles = [];
      const failedFiles = [];

      for (const batch of batches) {
        const results = await Promise.allSettled(
          batch.map((file) => this.preloadMediaFile(file))
        );

        results.forEach((result, index) => {
          const file = batch[index];
          if (result.status === "fulfilled") {
            totalSuccessful++;
            successfulFiles.push(file);
          } else {
            totalFailed++;
            failedFiles.push(file);
            Logger.warn(`媒體檔案預先載入失敗: ${file}`, result.reason);
          }
        });

        // 批次間短暫延遲，讓出主線程
        if (batches.indexOf(batch) < batches.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      const endTime = performance.now();
      Logger.debug(
        `基本媒體預先載入完成: ${totalSuccessful} 成功, ${totalFailed} 失敗 (${(
          endTime - startTime
        ).toFixed(2)}ms)`
      );

      if (successfulFiles.length > 0) {
        Logger.debug("成功預先載入的檔案:", successfulFiles);
      }

      if (failedFiles.length > 0) {
        Logger.warn("預先載入失敗的檔案:", failedFiles);
      }

      this.hasPreloadedEssential = true;

      // 如果已經有組合，立即預先載入組合媒體
      if (
        window.experimentManager?.currentCombination ||
        window.combinationSelector?.currentCombination
      ) {
        setTimeout(() => this.preloadCombinationMedia(), 100);
      }
    } catch (error) {
      Logger.error("基本媒體預先載入過程發生錯誤:", error);
    } finally {
      this.isPreloading = false;
    }
  }

  /**
   * 按優先級排序媒體檔案
   * 優先載入：小檔案、常用檔案、UI資源
   */
  sortMediaByPriority(mediaFiles) {
    const priorityMap = new Map();

    // 設定優先級權重
    mediaFiles.forEach((file) => {
      let priority = 0;

      // UI 資源優先級最高
      if (file.includes("/ui/") || file.includes("panel.webp")) {
        priority += 100;
      }

      // 音頻檔案優先級高
      if (file.endsWith(".mp3") || file.endsWith(".wav")) {
        priority += 50;
      }

      // 小檔案優先級高（估計）
      if (file.endsWith(".svg") || file.endsWith(".ico")) {
        priority += 30;
      }

      // 圖片檔案按類型排序
      if (file.endsWith(".webp")) {
        priority += 20; // webp 通常較小
      } else if (file.endsWith(".jpg") || file.endsWith(".jpeg")) {
        priority += 15;
      } else if (file.endsWith(".png")) {
        priority += 10;
      }

      priorityMap.set(file, priority);
    });

    // 按優先級降序排序
    return Array.from(mediaFiles).sort((a, b) => {
      return priorityMap.get(b) - priorityMap.get(a);
    });
  }

  /**
   * 收集基本媒體檔案（首頁輪播和固定資源）
   */
  async collectEssentialMediaFiles() {
    const mediaFiles = new Set();

    // 手動新增已知的重要媒體檔案（首頁輪播和固定資源）
    // 注意：音頻檔案通常不需要預先載入，因為它們在需要時才播放
    const essentialFiles = ["./assets/ui/panel.webp"];

    essentialFiles.forEach((file) => mediaFiles.add(file));

    Logger.debug(
      "collectEssentialMediaFiles: 收集到的基本媒體檔案 =",
      Array.from(mediaFiles)
    );

    return Array.from(mediaFiles);
  }

  /**
   * 預先載入目前組合的媒體檔案
   */
  async preloadCombinationMedia(providedCombination = null) {
    if (this.isPreloading) {
      Logger.debug("媒體預先載入已在進行中，跳過組合媒體預先載入");
      return;
    }

    // 確保基本資源已預先載入
    if (!this.hasPreloadedEssential) {
      Logger.debug("基本資源尚未預先載入，先預先載入基本資源");
      await this.preloadAllMedia();
      return;
    }

    const currentCombination =
      providedCombination ||
      window.experimentManager?.currentCombination ||
      window.combinationSelector?.currentCombination;

    if (!currentCombination) {
      Logger.debug("沒有找到目前組合，跳過組合媒體預先載入");
      return;
    }

    this.isPreloading = true;
    const startTime = performance.now();

    try {
      // 收集目前組合的媒體檔案
      const combinationFiles = await this.collectCombinationMediaFiles(
        currentCombination
      );

      if (combinationFiles.length === 0) {
        Logger.debug("目前組合沒有需要預先載入的媒體檔案");
        return;
      }

      Logger.debug(
        `開始預先載入組合媒體檔案: ${combinationFiles.length} 個檔案...`
      );

      // 過濾掉已經預先載入的檔案
      const newFiles = combinationFiles.filter(
        (file) => !this.mediaCache.has(file)
      );

      if (newFiles.length === 0) {
        Logger.debug("組合中的所有媒體檔案已預先載入");
        return;
      }

      Logger.debug(`📦 需要預先載入 ${newFiles.length} 個新媒體檔案`);

      // 按優先級排序
      const sortedFiles = this.sortMediaByPriority(newFiles);

      // 批次處理
      const batchSize = 2;
      const batches = [];
      for (let i = 0; i < sortedFiles.length; i += batchSize) {
        batches.push(sortedFiles.slice(i, i + batchSize));
      }

      let totalSuccessful = 0;
      let totalFailed = 0;
      const successfulFiles = [];
      const failedFiles = [];

      for (const batch of batches) {
        const results = await Promise.allSettled(
          batch.map((file) => this.preloadMediaFile(file))
        );

        results.forEach((result, index) => {
          const file = batch[index];
          if (result.status === "fulfilled") {
            totalSuccessful++;
            successfulFiles.push(file);
          } else {
            totalFailed++;
            failedFiles.push(file);
            Logger.warn(`媒體檔案預先載入失敗: ${file}`, result.reason);
          }
        });

        // 批次間短暫延遲
        if (batches.indexOf(batch) < batches.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      const endTime = performance.now();
      Logger.debug(
        `組合媒體預先載入完成: ${totalSuccessful} 成功, ${totalFailed} 失敗 (${(
          endTime - startTime
        ).toFixed(2)}ms)`
      );

      if (successfulFiles.length > 0) {
        Logger.debug("成功預先載入的檔案:", successfulFiles);
      }

      if (failedFiles.length > 0) {
        Logger.warn("預先載入失敗的檔案:", failedFiles);
      }
    } catch (error) {
      Logger.error("組合媒體預先載入過程發生錯誤:", error);
    } finally {
      this.isPreloading = false;
    }
  }

  /**
   * 收集目前組合的媒體檔案
   */
  async collectCombinationMediaFiles(currentCombination) {
    const mediaFiles = new Set();

    try {
      // 從目前組合的單元中收集媒體檔案
      const unitIds = Array.isArray(currentCombination.units)
        ? currentCombination.units
        : currentCombination.units.fixed?.concat(
            currentCombination.units.randomizable
          ) || [];

      Logger.debug("collectCombinationMediaFiles: 組合單元 =", unitIds);

      for (const unitId of unitIds) {
        try {
          // 從 scenarios.json 中查找對應的單元
          const scenariosResponse = await fetch("./data/scenarios.json");
          const scenariosData = await scenariosResponse.json();

          if (scenariosData.sections) {
            for (const section of scenariosData.sections) {
              if (section.units) {
                const unit = section.units.find((u) => u.unit_id === unitId);
                if (unit && unit.steps) {
                  unit.steps.forEach((step) => {
                    if (step.actions) {
                      step.actions.forEach((action) => {
                        if (action.media_file) {
                          mediaFiles.add(action.media_file);
                        }
                      });
                    }
                  });
                }
              }
            }
          }

          // 從 units.json 中查找對應的單元
          const unitsResponse = await fetch("./data/units.json");
          const unitsData = await unitsResponse.json();

          if (unitsData.units) {
            const unit = unitsData.units.find((u) => u.unit_id === unitId);
            if (unit && unit.steps) {
              unit.steps.forEach((step) => {
                if (step.media_file) {
                  mediaFiles.add(step.media_file);
                }
              });
            }
          }
        } catch (error) {
          Logger.warn(`收集單元 ${unitId} 的媒體檔案失敗:`, error);
        }
      }
    } catch (error) {
      Logger.warn("收集組合媒體檔案失敗:", error);
    }

    Logger.debug(
      "collectCombinationMediaFiles: 收集到的組合媒體檔案 =",
      Array.from(mediaFiles)
    );

    return Array.from(mediaFiles);
  }

  /**
   * 收集所有可能的媒體檔案（後備方案）
   */
  async collectAllPossibleMediaFiles(mediaFiles) {
    try {
      // 從 scenarios.json 中收集圖片檔案
      const response = await fetch("./data/scenarios.json");
      const scenariosData = await response.json();

      if (scenariosData.sections) {
        scenariosData.sections.forEach((section) => {
          if (section.units) {
            section.units.forEach((unit) => {
              if (unit.steps) {
                unit.steps.forEach((step) => {
                  if (step.actions) {
                    step.actions.forEach((action) => {
                      if (action.media_file) {
                        mediaFiles.add(action.media_file);
                      }
                    });
                  }
                });
              }
            });
          }
        });
      }
    } catch (error) {
      Logger.warn("收集 scenarios.json 中的媒體檔案失敗:", error);
    }

    try {
      // 從 units.json 中收集圖片檔案
      const response = await fetch("./data/units.json");
      const unitsData = await response.json();

      if (unitsData.units) {
        unitsData.units.forEach((unit) => {
          if (unit.steps) {
            unit.steps.forEach((step) => {
              if (step.media_file) {
                mediaFiles.add(step.media_file);
              }
            });
          }
        });
      }
    } catch (error) {
      Logger.warn("收集 units.json 中的媒體檔案失敗:", error);
    }
  }

  /**
   * 預先載入單個媒體檔案
   */
  async preloadMediaFile(src) {
    if (this.mediaCache.has(src)) {
      return this.mediaCache.get(src); // 已快取，直接回傳
    }

    if (this.preloadPromises.has(src)) {
      return this.preloadPromises.get(src); // 正在預先載入中，回傳 Promise
    }

    const preloadPromise = this.doPreloadMediaFile(src);
    this.preloadPromises.set(src, preloadPromise);

    try {
      const result = await preloadPromise;
      this.mediaCache.set(src, result);
      this.preloadPromises.delete(src);
      return result;
    } catch (error) {
      this.preloadPromises.delete(src);
      throw error;
    }
  }

  /**
   * 實際執行媒體檔案預先載入
   */
  async doPreloadMediaFile(src) {
    return new Promise(async (resolve, reject) => {
      let element;
      let timeoutId;

      // 對於音頻檔案，先檢查檔案是否存在
      if (
        src.endsWith(".mp3") ||
        src.endsWith(".wav") ||
        src.endsWith(".ogg")
      ) {
        try {
          // 先用 fetch 檢查檔案是否存在
          const response = await fetch(src, { method: "HEAD" });
          if (!response.ok) {
            reject(new Error(`File not found: ${src}`));
            return;
          }
        } catch (error) {
          reject(new Error(`Failed to access ${src}: ${error.message}`));
          return;
        }
      }

      // 根據檔案類型建立相應元素
      if (
        src.endsWith(".mp3") ||
        src.endsWith(".wav") ||
        src.endsWith(".ogg")
      ) {
        // 音頻檔案
        element = new Audio();
        element.preload = "metadata"; // 只載入元資料，不載入整個檔案
      } else if (src.endsWith(".mp4") || src.endsWith(".webm")) {
        // 影片檔案 - 只載入元資料
        element = document.createElement("video");
        element.preload = "metadata";
      } else {
        // 圖片檔案
        element = new Image();
      }

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        element.onload = null;
        element.onerror = null;
      };

      element.onload = () => {
        cleanup();
        resolve({ src, element, loaded: true });
      };

      element.onerror = (error) => {
        cleanup();
        reject(
          new Error(
            `Failed to preload ${src}: ${error.message || "Unknown error"}`
          )
        );
      };

      // 設定更長的超時時間
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`Preload timeout for ${src}`));
      }, 15000); // 15秒超時

      // 設置來源
      element.src = src;
    });
  }

  /**
   * 檢查媒體是否已快取
   */
  isMediaCached(src) {
    return this.mediaCache.has(src);
  }

  /**
   * 取得快取的媒體
   */
  getCachedMedia(src) {
    return this.mediaCache.get(src);
  }

  /**
   * 取得快取統計
   */
  getCacheStats() {
    return {
      cachedCount: this.mediaCache.size,
      preloadingCount: this.preloadPromises.size,
      isPreloading: this.isPreloading,
      cachedFiles: Array.from(this.mediaCache.keys()),
    };
  }

  // 語言變更處理
  onLanguageChange(newLanguage) {
    // 記錄語言變更
    if (window.logger) {
      const langName = newLanguage === "zh" ? "中文" : "English";
      window.logger.logAction(`媒體語言已變更為: ${langName}`);
    }

    // 未來可以在這裡新增語言相關的媒體路徑處理邏輯
  }
}

// 匯出單例
window.mediaManager = new MediaManager();
