/**
 * SyncManager QR -  QR Code 處理
 * 負責 QR Code 產生、掃描、URL參數解析、確認對話框
 */

export class SyncManagerQR {
  constructor(core) {
    this.core = core;
    this.qrScanner = null;
    this.countdownInterval = null;
    this.scanning = false;
    this.scanTimer = null;
    this.initialized = false;
  }

  /**
   * 初始化QR處理
   */
  initialize() {
    // 防止重複初始化
    if (this.initialized) {
      Logger.debug("[QR] 已初始化，跳過");
      return;
    }

    // 確保在 DOM 完全準備好後再檢查URL參數
    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          this.checkUrlParameters();
        },
        { once: true }
      );
    } else {
      // 檢查URL參數（從QR掃描進入）
      this.checkUrlParameters();
    }

    // 監聽 QR Code 產生事件
    window.addEventListener("sync_generate_qr", async (event) => {
      const { shareCode, role } = event.detail;

      Logger.debug("[QR] 收到QR Code產生事件", { shareCode, role });

      // 使用分享代碼
      const codeToUse = shareCode;

      if (!codeToUse) {
        Logger.debug("[QR] QR Code 產生失敗：沒有有效的代碼", event.detail);
        return;
      }

      try {
        await this.generateQRCode(codeToUse, role);
        Logger.debug("[QR] QR Code產生完成");
      } catch (error) {
        Logger.error("[QR] QR Code產生過程中發生錯誤", error);
      }
    });

    // 監聽QR掃描事件
    window.addEventListener("sync_start_qr_scan", () => {
      this.startQRScanner();
    });

    this.initialized = true;
  }

  /**
   * 檢查URL參數（處理 QR Code 掃描進入的情況）
   * 支援模式：
   * - ?shareCode=XXX&role=YYY (分享代碼)
   */
  checkUrlParameters() {
    Logger.debug("[QR] 檢查URL參數開始");
    const urlParams = new URLSearchParams(window.location.search);
    const shareCode = urlParams.get("shareCode");
    const role = urlParams.get("role") || "viewer";

    Logger.debug("[QR] 解析URL參數", { shareCode, role });

    // 使用分享代碼
    const code = shareCode;

    if (code) {
      //檢查目前裝置是否已在工作階段中（產生者自己不應該加入）
      if (this.core?.syncClient?.sessionId) {
        Logger.debug("[QR] 目前裝置已在工作階段中，忽略 URL 中的分享代碼");
        // 立即清理URL
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname
        );
        return;
      }

      //立即清理URL中的參數（避免使用者看到URL中有參數，或手動複製時包含參數）
      window.history.replaceState({}, document.title, window.location.pathname);

      //檢查此分享代碼是否已在此工作階段中被使用過
      const processedShareCodes =
        sessionStorage.getItem("processedShareCodes") || "{}";
      const processed = JSON.parse(processedShareCodes);

      if (processed[code]) {
        return;
      }

      // 延遲檢查以確保 SyncConfirmDialogManager 已載入
      if (window.SyncConfirmDialogManager) {
        Logger.debug(
          "[QR] SyncConfirmDialogManager 已載入，直接顯示確認對話框"
        );
        // 已載入，直接顯示
        this.showJoinConfirmation(code, role);
      } else {
        Logger.debug("[QR] SyncConfirmDialogManager 未載入，開始延遲重試");
        // 未載入，延遲 500ms 後重試（最多重試 20 次 = 10秒）
        let retryCount = 0;
        const maxRetries = 20;
        const retryInterval = setInterval(() => {
          retryCount++;
          Logger.debug(
            `[QR] 重試載入 SyncConfirmDialogManager (${retryCount}/${maxRetries})`
          );
          if (window.SyncConfirmDialogManager) {
            Logger.debug(
              "[QR] SyncConfirmDialogManager 載入成功，顯示確認對話框"
            );
            clearInterval(retryInterval);
            this.showJoinConfirmation(code, role);
          } else if (retryCount >= maxRetries) {
            clearInterval(retryInterval);
            Logger.error("[QR] SyncConfirmDialogManager 載入超時");
            alert("系統初始化失敗，請重新整理頁面");
          }
        }, 500);
      }
    } else {
    }
  }

  /**
   * 顯示加入工作階段確認對話框（使用統一管理器）
   */
  showJoinConfirmation(code, role) {
    Logger.debug("[QR] showJoinConfirmation 被調用", { code, role });

    // 確保 SyncConfirmDialogManager 已載入
    if (!window.SyncConfirmDialogManager) {
      Logger.error("[QR] SyncConfirmDialogManager 未載入");
      return;
    }

    Logger.debug("[QR] SyncConfirmDialogManager 已載入，準備顯示對話框");

    // 使用統一的對話框管理器
    window.SyncConfirmDialogManager.showJoinConfirmation(
      code,
      role,
      // onConfirm Callback
      async (editedCode, selectedRole) => {
        try {
          // 使用分享代碼加入（使用重試機制，避免暫時性錯誤）
          let joinSuccess = false;
          let lastError = null;
          const maxRetries = 3;

          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              await this.core.joinSessionByShareCode(editedCode, selectedRole);
              joinSuccess = true;
              break;
            } catch (error) {
              lastError = error;
              Logger.warn(`第${attempt}次加入失敗: ${error.message}`);

              //如果是「已使用」或「已過期」的錯誤，不再重試
              if (
                error.message.includes("已使用") ||
                error.message.includes("已過期")
              ) {
                break;
              }

              // 如果還有重試次數，延遲後重試
              if (attempt < maxRetries) {
                await new Promise((resolve) => setTimeout(resolve, 500));
              }
            }
          }

          if (!joinSuccess) {
            throw lastError || new Error("無法加入工作階段");
          }

          // sessionStorage 由 SyncClient.saveState() 自動管理

          //記錄此分享代碼已被處理過（防止頁面重新整理時重複顯示確認對話框）
          const processedShareCodes =
            sessionStorage.getItem("processedShareCodes") || "{}";
          const processed = JSON.parse(processedShareCodes);
          processed[editedCode] = {
            processedAt: Date.now(),
            role: selectedRole,
          };
          sessionStorage.setItem(
            "processedShareCodes",
            JSON.stringify(processed)
          );

          //確認加入成功後，清除URL中的分享代碼和角色參數
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname
          );

          // 更新UI
          Logger.debug("[QR] 同步工作階段加入流程完成，觸發UI更新事件");
          window.dispatchEvent(new Event("sync_session_joined"));
        } catch (error) {
          Logger.error("加入工作階段失敗:", error);

          // 根據錯誤類型提供不同的錯誤訊息
          let errorMessage = error.message || "未知錯誤";
          if (errorMessage.includes("已使用")) {
            errorMessage =
              "此分享代碼已被使用，請聯繫工作階段建立者重新產生新的分享代碼";
          } else if (errorMessage.includes("已過期")) {
            errorMessage =
              "此分享代碼已過期，請聯繫工作階段建立者重新產生新的分享代碼";
          }

          alert(`加入失敗: ${errorMessage}`);
        }
      },
      // onCancel Callback
      () => {
        // 取消時也清除URL參數
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname
        );
      }
    );
  }

  /**
   * 產生 QR Code （包含完整URL）
   * @param {string} code - 分享代碼
   * @param {string} role - 'viewer' 或 'operator'
   */
  async generateQRCode(code, role = "viewer") {
    Logger.debug("[QR] 開始產生QR Code", { code, role });

    if (!code) {
      Logger.error("[QR] QR Code 產生失敗：代碼為空");
      return;
    }

    // 優先使用分享QR容器，若不存在則使用普通容器
    let container = document.getElementById("shareQRCode");
    if (!container) {
      container = document.getElementById("qrCodeDisplay");
    }
    if (!container) {
      Logger.warn("[QR] 找不到 QR Code 容器 (shareQRCode 或 qrCodeDisplay)");
      return;
    }

    container.innerHTML = "";

    // 清除之前的倒數計時
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }

    // 取得分享代碼資訊
    let shareCodeInfo = null;
    try {
      Logger.debug("[QR] 取得分享代碼資訊", { code });
      shareCodeInfo = await this.core.getShareCodeInfo(code);
      Logger.debug("[QR] 分享代碼資訊取得成功", shareCodeInfo);
    } catch (error) {
      Logger.error("[QR] 取得分享代碼資訊失敗（將繼續產生QR）", error);
      // 如果無法取得資訊，繼續使用預設邏輯
    }

    // 構建完整URL
    const qrUrl = this.core.generateQRContent(code, role);
    Logger.debug("[QR] 產生的QR URL", { qrUrl });

    // 檢查分享代碼是否已過期
    const isExpired = shareCodeInfo && shareCodeInfo.expired;
    const statusText = isExpired ? " (已過期)" : "";

    // 檢查 QRCodeStyling 庫是否已載入
    Logger.debug("[QR] QRCodeStyling 可用性", {
      available: typeof QRCodeStyling !== "undefined",
      globalType: typeof window.QRCodeStyling,
    });

    if (typeof QRCodeStyling === "undefined") {
      // QR庫未載入，顯示文字URL
      container.innerHTML = `
                <div class="sync-qr-fallback">
                    <h3>分享代碼: ${code}${statusText}</h3>
                    <p>
                        URL: <a href="${qrUrl}" target="_blank">${qrUrl}</a>
                    </p>
                </div>
            `;
      // 不啟動倒數計時，因為這是由UI層負責的
      return;
    }

    try {
      const qrCode = new QRCodeStyling({
        width: 200,
        height: 200,
        data: qrUrl,
        dotsOptions: {
          color: "#000000",
          type: "rounded",
        },
        backgroundOptions: {
          color: "#ffffff",
        },
        cornersSquareOptions: {
          color: "#000000",
          type: "extra-rounded",
        },
        cornersDotOptions: {
          color: "#000000",
          type: "dot",
        },
      });

      qrCode.append(container);
      Logger.debug("[QR] QR Code 已附加到容器");

      const roleText = role === "viewer" ? "僅檢視" : "同步操作";
      const codeText = document.createElement("div");
      codeText.className = "sync-qr-code-text";
      codeText.innerHTML = `
                <p>分享代碼: <strong>${code}${statusText}</strong></p>
                <p class="sync-qr-role-text">
                    預設模式: <strong>${roleText}</strong>
                </p>
            `;
      container.appendChild(codeText);
      Logger.info("[QR] QR Code 產產生功", { code, role });

      // 不啟動倒數計時，因為這是由UI層負責的
    } catch (error) {
      Logger.error("[QR] QR Code 產生失敗:", error);
    }
  }

  /**
   * 啟動 QR Code 倒數計時
   * @param {number} remainingTime - 剩餘時間（秒），如果未提供則使用預設300秒
   */
  startQRCodeCountdown(remainingTime = null) {
    Logger.debug("[QR] 開始QR Code倒數計時", { remainingTime });

    const countdownElement = document.getElementById("qrCountdown");
    if (!countdownElement) {
      Logger.warn("[QR] 找不到倒數計時元素 (qrCountdown)");
      return;
    }

    // 如果沒有提供剩餘時間，使用預設的300秒
    let initialTime = remainingTime !== null ? remainingTime : 300;
    Logger.debug("[QR] 使用倒數時間", {
      initialTime,
      provided: remainingTime !== null,
    });

    let currentTime = initialTime;

    // 立即更新一次
    this.updateCountdownDisplay(currentTime);

    // 設定倒數計時
    this.countdownInterval = setInterval(() => {
      currentTime--;

      if (currentTime <= 0) {
        Logger.debug("[QR] QR Code倒數結束，已過期");
        clearInterval(this.countdownInterval);
        countdownElement.textContent = "有效期已過期";
        countdownElement.classList.add("sync-qr-expired");
        // 隱藏 QR Code
        const qrSection = document.getElementById("qrCodeSection");
        if (qrSection) {
          qrSection.innerHTML =
            '<div class="sync-qr-expired"> QR Code 已過期，請重新建立工作階段</div>';
        }
        return;
      }

      this.updateCountdownDisplay(currentTime);
    }, 1000);
  }

  /**
   * 更新倒數計時顯示
   */
  updateCountdownDisplay(seconds) {
    const countdownElement = document.getElementById("qrCountdown");
    if (!countdownElement) return;

    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;

    let color = "#28a745";
    if (seconds <= 60) {
      color = "#dc3545"; // 紅色 - 少於1分鐘
    } else if (seconds <= 120) {
      color = "#ffc107"; // 黃色 - 少於2分鐘
    }

    countdownElement.textContent = `有效期: ${minutes}:${
      secs < 10 ? "0" : ""
    }${secs}`;
    countdownElement.style.color = color;
  }

  /**
   * 啟動 QR Code 掃描器
   */
  async startQRScanner() {
    if (!navigator.mediaDevices) {
      Logger.error("裝置不支援攝影機存取");
      alert("您的裝置不支援攝影機功能");
      return;
    }

    this.qrScanner = document.createElement("div");
    this.qrScanner.className = "sync-qr-scanner";
    this.qrScanner.innerHTML = `
            <div class="sync-scanner-ui">
                <div class="sync-scanner-header">
                    <h3>掃描 QR Code</h3>
                    <button class="sync-scanner-close-btn" title="關閉" aria-label="關閉掃描器">×</button>
                </div>
                <div class="sync-scanner-video-container">
                    <video id="syncQrVideo" autoplay playsinline muted webkit-playsinline></video>
                    <div class="sync-scanning-frame"></div>
                    <select id="syncCameraSelect" class="sync-camera-select">
                        <option value="">自動選擇相機</option>
                    </select>
                </div>
                <div class="sync-scanner-status">對準 QR Code 掃描加入工作階段</div>
            </div>
        `;

    document.body.appendChild(this.qrScanner);

    const video = document.getElementById("syncQrVideo");
    const cameraSelect = document.getElementById("syncCameraSelect");
    const closeBtn = this.qrScanner.querySelector(".sync-scanner-close-btn");
    closeBtn.addEventListener("click", () => this.stopQRScanner());

    // 列出可用的相機
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(
        (device) => device.kind === "videoinput"
      );

      // 清空現有選項（保留自動選擇）
      cameraSelect.innerHTML = '<option value="">自動選擇相機</option>';

      // 新增相機選項
      videoDevices.forEach((device, index) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent = device.label || `相機 ${index + 1}`;
        cameraSelect.appendChild(option);
      });
    } catch (error) {
      Logger.warn("無法列出相機裝置:", error);
    }

    // 相機選擇變更事件
    cameraSelect.addEventListener("change", async () => {
      // 停止目前stream
      if (this.currentStream) {
        this.currentStream.getTracks().forEach((track) => track.stop());
      }

      // 重新啟動相機
      await this.startCamera(video, cameraSelect.value);
    });

    // 啟動相機
    await this.startCamera(video, cameraSelect.value);
  }

  /**
   * 啟動指定的相機
   */
  async startCamera(video, deviceId) {
    // 儲存目前的 stream 引用，用於稍後清理
    const constraints = {
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "environment",
        // 某些 Android 瀏覽器支援
        advanced: [{ focusMode: "continuous" }],
      },
    };

    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((stream) => {
        // 檢查元素是否還存在（可能在取得攝影機期間被關閉）
        if (!this.qrScanner || !document.body.contains(this.qrScanner)) {
          // 如果掃描器已被關閉，停止 stream
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        video.srcObject = stream;
        this.currentStream = stream; // 儲存 stream 引用

        // 使用 play() 並處理可能的錯誤
        const playPromise = video.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              // Video 播放成功
              this.startQRDetection(video);
            })
            .catch((err) => {
              Logger.warn("Video play 被中斷:", err);
              if (this.currentStream) {
                this.currentStream.getTracks().forEach((track) => track.stop());
              }
              this.stopQRScanner();
            });
        } else {
          // 舊版瀏覽器
          this.startQRDetection(video);
        }
      })
      .catch((error) => {
        Logger.error("攝影機存取錯誤:", error);
        this.stopQRScanner();

        // 顯示更具體的錯誤訊息
        let errorMsg = "無法存取攝影機。";
        if (error.name === "NotAllowedError") {
          errorMsg += "請允許網站使用您的攝影機。";
        } else if (error.name === "NotFoundError") {
          errorMsg += "您的裝置沒有可用的攝影機。";
        }
        alert(errorMsg);
      });
  }

  /**
   * 開始 QR Code 檢測
   */
  startQRDetection(video) {
    if (typeof jsQR === "undefined") {
      Logger.error("jsQR庫未載入");
      this.stopQRScanner();
      alert("QR掃描庫未載入，請重新整理頁面");
      return;
    }

    const canvas = document.createElement("canvas");
    // 使用 willReadFrequently 優化 getImageData 效能
    const context = canvas.getContext("2d", { willReadFrequently: true });
    this.scanning = true;

    // 定義單次掃描邏輯
    const performQRScan = () => {
      // 確保還在掃描狀態且影片資料已準備好
      if (!this.scanning || video.readyState !== video.HAVE_ENOUGH_DATA) {
        return;
      }

      try {
        // --- 優化點：降取樣 (Downsampling) ---
        // 限制處理的最大尺寸（建議 480~640），jsQR 處理大圖非常吃力
        const maxScanSize = 640;
        let width = video.videoWidth;
        let height = video.videoHeight;

        if (width > maxScanSize || height > maxScanSize) {
          const ratio = Math.min(maxScanSize / width, maxScanSize / height);
          width *= ratio;
          height *= ratio;
        }

        canvas.width = width;
        canvas.height = height;

        // 將影片畫面繪製到縮小後的 canvas
        context.drawImage(video, 0, 0, width, height);

        // 取得像素資料
        const imageData = context.getImageData(0, 0, width, height);

        // 分析 QR Code (耗時操作)
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert", // 若不需要掃反色碼，關閉此項可提升一倍速度
        });

        if (code && code.data) {
          Logger.info("QR Code 識別成功");
          this.scanning = false;
          this.stopQRScanner();
          this.handleQRCodeScanned(code.data);
        }
      } catch (error) {
        Logger.warn("QR 單次分析失敗:", error);
      }
    };

    // 使用 setInterval 代替 requestAnimationFrame 進行時間檢查
    // 800ms ~ 1000ms 是一個在台灣行動端網頁兼顧效能與體驗的甜蜜點
    this.scanTimer = setInterval(() => {
      if (!this.scanning) {
        clearInterval(this.scanTimer);
        this.scanTimer = null;
        return;
      }

      // 使用 setTimeout 0 將耗時任務推遲到下一個事件循環
      // 確保不會阻塞相機預覽畫面的渲染
      setTimeout(performQRScan, 0);
    }, 1000);
  }

  /**
   * 處理掃描到的 QR Code （支援URL格式）
   */
  async handleQRCodeScanned(qrData) {
    try {
      let shareCode, role;

      // 檢查是否為分享代碼 URL
      if (qrData.includes("?shareCode=") || qrData.includes("&shareCode=")) {
        // 分享代碼 URL 格式
        try {
          const url = new URL(qrData);
          shareCode = url.searchParams.get("shareCode");
          role = url.searchParams.get("role") || "viewer";
        } catch (e) {
          Logger.warn("URL 解析失敗:", e);
          return;
        }
      } else if (/^[A-Z0-9]{8}$/.test(qrData.trim().toUpperCase())) {
        // 純代碼格式（8位大寫字母或數字 - 新格式：6位基礎碼 + 2位檢查碼）
        const code = qrData.trim().toUpperCase();
        // 作為分享代碼
        shareCode = code;
        role = "viewer";
      } else {
        // 非分享代碼相關的 QR Code，靜默忽略
        return;
      }

      const codeToUse = shareCode;
      if (!codeToUse) {
        Logger.warn("無法提取有效的代碼");
        return;
      }

      // 檢查是否已在工作階段中
      if (this.core.isConnected()) {
        // 已連線，直接填充輸入框並顯示面板
        const sessionCodeInput = document.getElementById("sessionCodeInput");
        if (sessionCodeInput) {
          sessionCodeInput.value = codeToUse;
        }
        window.dispatchEvent(new Event("sync_show_panel"));
      } else {
        // 未在工作階段中，顯示確認對話框
        this.showJoinConfirmation(codeToUse, role);
      }
    } catch (error) {
      Logger.error("QR Code 處理錯誤:", error);
      alert("掃描處理失敗，請重試");
    }
  }

  /**
   * 停止 QR Code 掃描器
   */
  stopQRScanner() {
    this.scanning = false;
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }

    if (this.qrScanner) {
      const video = document.getElementById("syncQrVideo");

      // 停止 video 播放
      if (video) {
        video.pause();
        video.src = "";
        video.srcObject = null;
      }

      // 停止所有媒體軌道
      if (this.currentStream) {
        this.currentStream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (error) {
            Logger.warn("停止媒體軌道失敗:", e);
          }
        });
        this.currentStream = null;
      }

      // 延遲移除元素，確保 video 已完全停止
      setTimeout(() => {
        if (this.qrScanner && this.qrScanner.parentNode) {
          this.qrScanner.remove();
        }
        this.qrScanner = null;
      }, 100);
    }
  }

  /**
   * 清理資源
   */
  cleanup() {
    this.stopQRScanner();
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }
}

export default SyncManagerQR;
