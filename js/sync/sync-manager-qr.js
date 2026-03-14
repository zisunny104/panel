/**
 * SyncManagerQR - QR 同步管理器
 * 負責 QR Code 產生與掃描功能
 */

import { SYNC_EVENTS } from "../constants/index.js";
import CameraUtils from "../core/camera-utils.js";

export class SyncManagerQR {
  constructor(core) {
    this.core = core;
    this.qrScanner = null;
    this.countdownInterval = null;
    this.scanning = false;
    this.scanTimer = null;
    this.initialized = false;

    // 通用相機邏輯委派給 CameraUtils
    this.cameraUtils = new CameraUtils();
  }

  /**
   * 判斷設備標籤是否為虛擬設備
   */
  isVirtualDeviceLabel(label) {
    return CameraUtils.isVirtualDeviceLabel(label);
  }

  /**
   * 排序視訊設備列表
   */
  sortVideoDevices(videoDevices) {
    return CameraUtils.sortVideoDevices(videoDevices);
  }

  /**
   * 初始化 QR 處理
   */
  initialize() {
    // 防止重複初始化
    if (this.initialized) {
      return;
    }

    // 確保在 DOM 完全準備好後再檢查 URL 參數
    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          this.checkUrlParameters();
        },
        { once: true },
      );
    } else {
      // 檢查 URL 參數（從 QR Code 掃描進入）
      this.checkUrlParameters();
    }

    // 監聽 QR Code 產生事件
    window.addEventListener(SYNC_EVENTS.GENERATE_QR, async (event) => {
      const {
        shareCode,
        role,
        target = window.SyncManager?.PAGE?.PANEL,
      } = event.detail;

      Logger.debug("收到 QR Code 產生事件", { shareCode, role, target });

      // 使用分享代碼
      const codeToUse = shareCode;

      if (!codeToUse) {
        return;
      }

      try {
        await this.generateQRCode(codeToUse, role, target);
      } catch (error) {
        Logger.error("QR Code 產生過程中發生錯誤", error);
      }
    });

    // 監聽 QR Code 掃描事件
    window.addEventListener(SYNC_EVENTS.START_QR_SCAN, () => {
      this.startQRScanner();
    });

    // 監聽裝置變更事件，當作業系統或驅動新增/移除裝置時自動重新載入
    if (
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.addEventListener === "function"
    ) {
      navigator.mediaDevices.addEventListener("devicechange", async () => {
        const video = document.getElementById("syncQrVideo");
        // 只有當掃描器已經打開時才重新載入，避免背景執行報錯
        if (this.qrScanner && video) {
          try {
            await this.refreshDeviceList(video);
          } catch (err) {
            Logger.warn("devicechange refresh failed:", err);
          }
        }
      });
    }

    this.initialized = true;
  }

  /**
   * 檢查 URL 參數（處理 QR Code 掃描進入的情況）
   */
  checkUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const shareCode = urlParams.get("shareCode");
    const role = urlParams.get("role") || window.SyncManager?.ROLE?.VIEWER;

    // 使用分享代碼
    const code = shareCode;

    if (code) {
      // 檢查目前裝置是否已在工作階段中（產生者自己不應該加入）
      if (this.core?.syncClient?.sessionId) {
        // 立即清理 URL
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname,
        );
        return;
      }

      // 立即清理 URL 中的參數（避免使用者看到 URL 中有參數，或手動複製時包含參數）
      window.history.replaceState({}, document.title, window.location.pathname);

      // 檢查此分享代碼是否已在此工作階段中被使用過
      const processedShareCodes =
        sessionStorage.getItem("processedShareCodes") || "{}";
      const processed = JSON.parse(processedShareCodes);

      if (processed[code]) {
        return;
      }

      // 延遲檢查以確保 SyncConfirmDialogManager 已載入
      if (window.SyncConfirmDialogManager) {
        // 已載入，直接顯示
        this.showJoinConfirmation(code, role);
      } else {
        // 未載入，延遲 500ms 後重試（最多重試 20 次 = 10秒）
        let retryCount = 0;
        const maxRetries = 20;
        const retryInterval = setInterval(() => {
          retryCount++;
          if (window.SyncConfirmDialogManager) {
            clearInterval(retryInterval);
            this.showJoinConfirmation(code, role);
          } else if (retryCount >= maxRetries) {
            clearInterval(retryInterval);
            Logger.error("SyncConfirmDialogManager 載入超時");
            alert("系統初始化失敗，請重新整理頁面");
          }
        }, 500);
      }
    }
  }

  /**
   * 顯示加入工作階段確認對話框（使用統一管理器）
   */
  showJoinConfirmation(code, role) {
    // 確保 SyncConfirmDialogManager 已載入
    if (!window.SyncConfirmDialogManager) {
      Logger.error("SyncConfirmDialogManager 未載入");
      return;
    }

    // 使用統一的對話框管理器
    window.SyncConfirmDialogManager.showJoinConfirmation(
      code,
      role,
      // onConfirm Callback
      async (editedCode, selectedRole) => {
        try {
          // 使用分享代碼加入（使用重試機制以提高穩定性）
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
            JSON.stringify(processed),
          );

          //確認加入成功後，清除URL中的分享代碼和角色參數
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );

          // 更新UI
          window.dispatchEvent(new CustomEvent(SYNC_EVENTS.SESSION_JOINED));
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
          window.location.pathname,
        );
      },
    );
  }

  /**
   * 產生 QR Code
   */
  async generateQRCode(
    code,
    role = window.SyncManager?.ROLE?.VIEWER,
    target = window.SyncManager?.PAGE?.PANEL,
  ) {
    Logger.debug("開始產生 QR Code ", { code, role, target });

    if (!code) {
      Logger.error("QR Code 產生失敗：代碼為空");
      return;
    }

    // 優先使用分享 QR Code 容器，若不存在則使用普通容器
    let container = document.getElementById("shareQRCode");
    if (!container) {
      container = document.getElementById("qrCodeDisplay");
    }
    if (!container) {
      Logger.warn("找不到 QR Code 容器 (shareQRCode 或 qrCodeDisplay)");
      return;
    }

    // 清除之前的倒數計時
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }

    // 取得分享代碼資訊
    let shareCodeInfo = null;
    try {
      shareCodeInfo = await this.core.getShareCodeInfo(code);
    } catch (error) {
      Logger.error("取得分享代碼資訊失敗（將繼續產生 QR Code）", error);
    }

    // 構建完整URL（根據 target）
    const qrUrl = this.core.generateQRContent(code, role, target);

    // 檢查分享代碼是否已過期
    const isExpired = shareCodeInfo && shareCodeInfo.expired;
    const statusText = isExpired ? " (已過期)" : "";

    // 檢查 QRCodeStyling 庫是否已載入
    if (typeof QRCodeStyling === "undefined") {
      // QR庫未載入，顯示文字URL
      const qrImageContainer = container.querySelector(
        ".sync-qr-image-container",
      );
      if (qrImageContainer) {
        qrImageContainer.innerHTML = `
          <div class="sync-qr-fallback">
              <h3>分享代碼: ${code}${statusText}</h3>
              <p>
                  URL: <a href="${qrUrl}" target="_blank">${qrUrl}</a>
              </p>
          </div>
        `;
      } else {
        container.innerHTML = `
          <div class="sync-qr-fallback">
              <h3>分享代碼: ${code}${statusText}</h3>
              <p>
                  URL: <a href="${qrUrl}" target="_blank">${qrUrl}</a>
              </p>
          </div>
        `;
      }
      return;
    }

    try {
      // 初次建立：建立容器結構
      if (!container.querySelector(".sync-qr-image-container")) {
        container.innerHTML = "";

        // 建立 QR 圖片容器
        const qrImageContainer = document.createElement("div");
        qrImageContainer.className = "sync-qr-image-container";
        container.appendChild(qrImageContainer);

        // 建立控制按鈕容器
        const roleText = window.SyncManager?.getRoleText(role) || "未知角色";
        const initialTarget =
          target ||
          (window.location.pathname.includes("board.html")
            ? window.SyncManager?.PAGE?.BOARD
            : window.SyncManager?.PAGE?.PANEL);
        const enterLabel =
          window.SyncManager?.getPageName(initialTarget) || initialTarget;

        const codeText = document.createElement("div");
        codeText.className = "sync-qr-code-text";
        codeText.innerHTML = `
          <div class="sync-qr-controls sync-share-code-buttons" role="group" aria-label="QR 操作">
            <button id="qrDefaultModeBtn" class="sync-btn-base" data-role="${role}" title="切換預設模式">
              ${roleText}
            </button>
            <button id="qrEnterPageBtn" class="sync-btn-base" title="切換 QR 目標頁面">${enterLabel}</button>
          </div>
        `;
        container.appendChild(codeText);

        container.dataset.qrTarget = initialTarget;
        container.dataset.qrRole = role;

        // 綁定按鈕事件
        this.bindQRButtons(container, code);
      }

      // 只更新 QR 圖片容器
      const qrImageContainer = container.querySelector(
        ".sync-qr-image-container",
      );
      if (qrImageContainer) {
        qrImageContainer.innerHTML = ""; // 清空舊 QR 碼
      }

      // 產生新 QR Code 並附加到圖片容器
      const qrCode = new QRCodeStyling({
        width: 200,
        height: 200,
        data: qrUrl,
        margin: 8,
        qrOptions: {
          typeNumber: 6,
          errorCorrectionLevel: "M",
        },
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

      qrCode.append(qrImageContainer);

      // 更新按鈕狀態
      const modeBtn = container.querySelector("#qrDefaultModeBtn");
      if (modeBtn) {
        const roleText = window.SyncManager?.getRoleText(role) || "未知角色";
        modeBtn.textContent = roleText;
        modeBtn.dataset.role = role;
      }

      const enterBtn = container.querySelector("#qrEnterPageBtn");
      if (enterBtn) {
        const enterLabel = window.SyncManager?.getPageName(target) || target;
        enterBtn.textContent = enterLabel;
      }

      container.dataset.qrTarget = target;
      container.dataset.qrRole = role;

      Logger.info("QR Code 產產生功", { code, role });
    } catch (error) {
      Logger.error("QR Code 產生失敗:", error);
    }
  }

  /**
   * 綁定 QR 控制按鈕事件（避免重複綁定）
   */
  bindQRButtons(container, code) {
    // 綁定按鈕事件：切換預設模式並重新產生 QR（保留原分享代碼）
    const modeBtn = container.querySelector("#qrDefaultModeBtn");
    if (modeBtn && !modeBtn._isBound) {
      modeBtn._isBound = true;
      modeBtn.addEventListener("click", () => {
        try {
          const current =
            modeBtn.dataset.role || window.SyncManager?.ROLE?.VIEWER;
          const newRole =
            current === window.SyncManager?.ROLE?.OPERATOR
              ? window.SyncManager?.ROLE?.VIEWER
              : window.SyncManager?.ROLE?.OPERATOR;

          Logger.debug("使用者切換預設模式，重新產生 QR", {
            code,
            newRole,
          });
          // 重新產生 QR（保留目前 target）
          const currentTarget =
            container.dataset.qrTarget || window.SyncManager?.PAGE?.PANEL;
          this.generateQRCode(code, newRole, currentTarget);
        } catch (err) {
          Logger.error("切換預設模式失敗:", err);
        }
      });
    }

    // 綁定按鈕事件：切換頁面（機台面板 <-> 實驗管理）
    const enterBtn = container.querySelector("#qrEnterPageBtn");
    if (enterBtn && !enterBtn._isBound) {
      enterBtn._isBound = true;
      enterBtn.addEventListener("click", () => {
        try {
          // 切換 QR 目標（只影響 QR 的內容，不會在此頁面跳轉）
          const currentTarget =
            container.dataset.qrTarget || window.SyncManager?.PAGE?.PANEL;
          const newTarget =
            currentTarget === window.SyncManager?.PAGE?.BOARD
              ? window.SyncManager?.PAGE?.PANEL
              : window.SyncManager?.PAGE?.BOARD;

          Logger.debug("使用者切換 QR 目標頁面", { code, newTarget });

          // 重新產生 QR（使用相同 shareCode 與目前 role）
          const currentRole =
            container.dataset.qrRole || window.SyncManager?.ROLE?.VIEWER;
          this.generateQRCode(code, currentRole, newTarget);
        } catch (err) {
          Logger.error("切換 QR 目標頁面失敗:", err);
        }
      });
    }
  }

  /**
   * 啟動 QR Code 倒數計時
   * @param {number} remainingTime - 剩餘時間（秒），如果未提供則使用預設300秒
   */
  startQRCodeCountdown(
    remainingTime = null,
    countdownElementId = "qrCountdown",
  ) {
    Logger.debug("開始 QR Code 倒數計時", {
      remainingTime,
      countdownElementId,
    });

    const countdownElement = document.getElementById(countdownElementId);
    if (!countdownElement) {
      Logger.warn(`找不到倒數計時元素 (${countdownElementId})`);
      return;
    }

    // 清除上一次的倒數計時，避免異佈 interval 累積
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    // 如果沒有提供剩餘時間，使用預設的300秒
    let initialTime = remainingTime !== null ? remainingTime : 300;
    Logger.debug("使用倒數時間", {
      initialTime,
      provided: remainingTime !== null,
    });

    let currentTime = initialTime;

    // 立即更新一次
    this.updateCountdownDisplay(currentTime, countdownElementId);

    // 設定倒數計時
    this.countdownInterval = setInterval(() => {
      currentTime--;

      if (currentTime <= 0) {
        Logger.debug("QR Code 倒數結束，已過期");
        clearInterval(this.countdownInterval);
        countdownElement.textContent = "有效期限已過期";
        countdownElement.classList.add("sync-qr-expired");
        // 隱藏 QR Code
        const qrSection = document.getElementById("qrCodeSection");
        if (qrSection) {
          qrSection.innerHTML =
            '<div class="sync-qr-expired"> QR Code 已過期，請重新建立工作階段</div>';
        }
        return;
      }

      this.updateCountdownDisplay(currentTime, countdownElementId);
    }, 1000);
  }

  /**
   * 更新倒數計時顯示
   */
  updateCountdownDisplay(seconds, countdownElementId = "qrCountdown") {
    const countdownElement = document.getElementById(countdownElementId);
    if (!countdownElement) return;

    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;

    let color = "#28a745";
    if (seconds <= 60) {
      color = "#dc3545"; // 紅色 - 少於1分鐘
    } else if (seconds <= 120) {
      color = "#ffc107"; // 黃色 - 少於2分鐘
    }

    countdownElement.textContent = `${minutes}:${secs < 10 ? "0" : ""}${secs}`;
    countdownElement.style.color = color;
  }

  /**
   * 停止 QR Code 倒數計時
   */
  /**
   * 停止 QR Code 倒數計時
   */
  stopQRCodeCountdown() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
      Logger.debug("已停止 QR Code 倒數計時");
    }
  }

  /**
   * 重新載入設備列表
   */
  async refreshDeviceList(video) {
    const cameraSelect = document.getElementById("syncCameraSelect");
    const statusEl = this.qrScanner?.querySelector(".sync-scanner-status");
    if (!cameraSelect) return;

    try {
      const sorted = await this.cameraUtils.refreshDeviceList();
      this.cameraUtils.availableVideoDevices = sorted;

      const currentSelectedId = cameraSelect.value;
      cameraSelect.innerHTML = "";
      sorted.forEach((device, index) => {
        const option = document.createElement("option");
        option.value = device.clientId;
        option.textContent = device.label || `相機 ${index + 1}`;
        cameraSelect.appendChild(option);
      });

      if (
        currentSelectedId &&
        sorted.some((d) => d.clientId === currentSelectedId)
      ) {
        cameraSelect.value = currentSelectedId;
      } else {
        const savedId = localStorage.getItem("preferredCameraId");
        const savedLabel = (
          localStorage.getItem("preferredCameraLabel") || ""
        ).toLowerCase();

        if (savedId && sorted.some((d) => d.clientId === savedId)) {
          cameraSelect.value = savedId;
        } else if (savedLabel) {
          const match = sorted.find((d) =>
            (d.label || "").toLowerCase().includes(savedLabel),
          );
          if (match) {
            cameraSelect.value = match.clientId;
          } else if (sorted.length > 0) {
            cameraSelect.value = sorted[0].clientId;
          }
        } else if (sorted.length > 0) {
          cameraSelect.value = sorted[0].clientId;
        }
      }
    } catch (error) {
      Logger.warn("refreshDeviceList failed:", error);
      if (statusEl) statusEl.textContent = "重新載入相機清單失敗";
    }
  }

  /**
   * 啟動 QR Code 掃描器
   */
  async startQRScanner() {
    // 防止同時多次建立 scanner UI 或重複啟動
    if (this.qrScanner) {
      Logger.warn("Scanner UI 已存在，忽略重複啟動請求");
      return;
    }

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
                    <h3>掃描 QR Code </h3>
                    <div class="sync-scanner-header-actions">
                        <button class="sync-scanner-refresh-btn" id="refreshCamerasBtn" title="重新整理相機" aria-label="重新整理相機">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="icon-sm">
                                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                                <path d="M21 3v5h-5"></path>
                                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
                                <path d="M3 21v-5h5"></path>
                            </svg>
                        </button>
                        <button class="sync-scanner-copy-btn" id="copyDebugBtn" title="複製偵錯日誌" aria-label="複製偵錯日誌">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="icon-sm">
                                <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                        <button class="sync-scanner-close-btn" title="關閉" aria-label="關閉掃描器">×</button>
                    </div>
                </div>
                <div class="sync-scanner-video-container">
                    <video id="syncQrVideo" autoplay playsinline muted webkit-playsinline></video>
                    <div class="sync-scanning-frame"></div>
                    <select id="syncCameraSelect" class="sync-camera-select"></select>
                    <div class="sync-camera-filter">
                        <input id="syncCameraFilter" class="sync-camera-filter-input" placeholder="過濾相機（例如: 174f:1811 或 'Integrated'）" aria-label="過濾相機" />
                        <button id="applyCameraFilterBtn" class="sync-camera-apply-btn" title="套用並選擇符合的相機">選取</button>
                    </div>
                </div>
                <div class="sync-scanner-status">對準 QR Code 掃描加入工作階段</div>
            </div>
        `;

    document.body.appendChild(this.qrScanner);

    const video = document.getElementById("syncQrVideo");
    const cameraSelect = document.getElementById("syncCameraSelect");
    const closeBtn = this.qrScanner.querySelector(".sync-scanner-close-btn");
    const refreshBtn = this.qrScanner.querySelector("#refreshCamerasBtn");
    const copyBtn = this.qrScanner.querySelector("#copyDebugBtn");
    const statusEl = this.qrScanner.querySelector(".sync-scanner-status");

    // 相機過濾輸入與套用按鈕（提前宣告，避免後續閉包中使用前未定義）
    const filterInput = this.qrScanner.querySelector("#syncCameraFilter");
    const applyFilterBtn = this.qrScanner.querySelector(
      "#applyCameraFilterBtn",
    );

    // 關閉掃描器
    closeBtn.addEventListener("click", () => this.stopQRScanner());

    // 複製偵錯資訊按鈕（使用 SVG 圖示而非 emoji）
    if (copyBtn) {
      copyBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        const debug = {
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
          devices: (this.cameraUtils.availableVideoDevices || []).map((d) => ({
            clientId: d.clientId,
            label: d.label,
          })),
          attempts: this.cameraUtils.lastCameraAttempts || [],
        };
        try {
          await navigator.clipboard.writeText(JSON.stringify(debug, null, 2));
          if (window.indicatorManager) {
            window.indicatorManager.showStatus(
              "success",
              "已複製偵錯資訊到剪貼簿",
            );
          } else if (statusEl) {
            statusEl.textContent = "已複製偵錯資訊到剪貼簿";
          }
          const originalHTML = copyBtn.innerHTML;
          copyBtn.innerHTML =
            '<svg class="sync-icon sync-icon-checkmark" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
          copyBtn.classList.add("copied");
          Logger.info("已複製偵錯資訊到剪貼簿", debug);
          setTimeout(() => {
            copyBtn.innerHTML = originalHTML;
            copyBtn.classList.remove("copied");
          }, 1400);
        } catch (err) {
          Logger.warn("複製偵錯資訊失敗:", err);
          if (window.indicatorManager) {
            window.indicatorManager.showStatus("error", "無法複製偵錯資訊");
          } else if (statusEl) {
            statusEl.textContent = "無法複製偵錯資訊";
          }
        }
      });
    }

    // 重新整理按鈕：重新列舉相機並重新啟動（使用者可視覺確認）
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        if (this.cameraUtils.cameraLoading) {
          if (statusEl) statusEl.textContent = "攝影機正在啟動中，請稍後...";
          return;
        }

        try {
          if (statusEl) statusEl.textContent = "正在重新整理相機列表...";
          const sorted = await this.cameraUtils.refreshDeviceList();
          this.cameraUtils.availableVideoDevices = sorted;
          rebuildCameraOptions(filterInput?.value || "");

          // 智慧選擇：先用記憶 (ID / label) → 否則選排序後第一台
          const savedId = localStorage.getItem("preferredCameraId");
          const savedLabel = (
            localStorage.getItem("preferredCameraLabel") || ""
          ).toLowerCase();

          let toStart = "";

          if (savedId && sorted.some((d) => d.clientId === savedId)) {
            toStart = savedId;
          } else if (savedLabel) {
            const labelMatch = sorted.find((d) =>
              (d.label || "").toLowerCase().includes(savedLabel),
            );
            if (labelMatch) {
              toStart = labelMatch.clientId;
              cameraSelect.value = toStart;
            }
          }

          if (!toStart && sorted.length > 0) {
            toStart = sorted[0].clientId;
          }

          if (toStart) {
            if (statusEl) statusEl.textContent = "啟動選擇的相機...";
            cameraSelect.value = toStart;
            await this.startCamera(video, toStart);
          } else {
            if (statusEl) statusEl.textContent = "找不到可用的攝影機";
          }
        } catch (err) {
          Logger.warn("refreshCamerasBtn error:", err);
          if (statusEl) statusEl.textContent = "重新整理相機失敗";
        }
      });
    }

    // 列出可用的相機（委派給 CameraUtils）
    try {
      const sorted = await this.cameraUtils.refreshDeviceList();
      cameraSelect.innerHTML = "";
      this.cameraUtils.availableVideoDevices = sorted;
      sorted.forEach((device, index) => {
        const option = document.createElement("option");
        option.value = device.clientId;
        option.textContent = device.label || `相機 ${index + 1}`;
        cameraSelect.appendChild(option);
      });

      const savedId = localStorage.getItem("preferredCameraId") || "";
      const savedLabel = (
        localStorage.getItem("preferredCameraLabel") || ""
      ).toLowerCase();

      let targetDeviceId = "";

      if (savedId && sorted.some((d) => d.clientId === savedId)) {
        targetDeviceId = savedId;
      } else if (savedLabel) {
        const byLabel = sorted.find((d) =>
          (d.label || "").toLowerCase().includes(savedLabel),
        );
        if (byLabel) {
          targetDeviceId = byLabel.clientId;
        }
      }

      if (!targetDeviceId && sorted.length > 0) {
        targetDeviceId = sorted[0].clientId;
      }

      cameraSelect.value = targetDeviceId;
      try {
        if (statusEl) statusEl.textContent = "啟動選擇的相機...";
        await this.startCamera(video, targetDeviceId);
      } catch (e) {
        Logger.warn("startCamera failed for initial selection:", e);
      }
    } catch (error) {
      Logger.warn("無法列出相機裝置:", error);
      try {
        Logger.debug("refreshDeviceList failed:", {
          name: error && error.name,
          message: error && error.message,
          stack: error && error.stack,
        });
      } catch (e) {}
    }

    // 相機選擇變更事件
    cameraSelect.addEventListener("change", async () => {
      // 停止目前stream
      if (this.cameraUtils.currentStream) {
        this.cameraUtils.currentStream
          .getTracks()
          .forEach((track) => track.stop());
      }

      // 儲存使用者偏好（clientId 與 label 作為備援），然後重新啟動相機
      const val = cameraSelect.value;
      if (val) {
        localStorage.setItem("preferredCameraId", val);
        const selOption =
          cameraSelect.selectedOptions && cameraSelect.selectedOptions[0];
        const selLabel = selOption ? selOption.textContent : "";
        if (selLabel) localStorage.setItem("preferredCameraLabel", selLabel);
        Logger.debug("使用者手動切換相機，已儲存偏好", {
          preferred: val,
          label: selLabel,
        });
      }

      // 重新啟動相機
      await this.startCamera(video, cameraSelect.value);
    });

    // 相機過濾與快速選取
    const rebuildCameraOptions = (filter) => {
      cameraSelect.innerHTML = "";
      const lower = filter ? filter.toLowerCase() : "";
      (this.cameraUtils.availableVideoDevices || []).forEach(
        (device, index) => {
          if (
            !lower ||
            (device.label && device.label.toLowerCase().includes(lower)) ||
            device.clientId.toLowerCase().includes(lower)
          ) {
            const option = document.createElement("option");
            option.value = device.clientId;
            option.textContent = device.label || `相機 ${index + 1}`;
            cameraSelect.appendChild(option);
          }
        },
      );
    };

    if (filterInput) {
      filterInput.addEventListener("input", (e) => {
        rebuildCameraOptions(e.target.value);
      });
    }

    if (applyFilterBtn) {
      applyFilterBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        const filter = filterInput?.value?.trim();
        if (!filter) {
          if (statusEl) statusEl.textContent = "請輸入過濾字串";
          return;
        }

        const matches = (this.cameraUtils.availableVideoDevices || []).filter(
          (d) => {
            const fl = filter.toLowerCase();
            return (
              (d.label && d.label.toLowerCase().includes(fl)) ||
              d.clientId.toLowerCase().includes(fl)
            );
          },
        );

        if (!matches.length) {
          if (statusEl) statusEl.textContent = "找不到符合的相機";
          return;
        }

        // 選擇第一個符合項並啟動（同時儲存為使用者偏好，包含 label 備援）
        cameraSelect.value = matches[0].clientId;
        localStorage.setItem("preferredCameraId", matches[0].clientId);
        if (matches[0].label)
          localStorage.setItem("preferredCameraLabel", matches[0].label);
        if (statusEl)
          statusEl.textContent = `選擇相機：${matches[0].label || matches[0].clientId}`;
        Logger.info("applyCameraFilter: selected device", {
          clientId: matches[0].clientId,
          label: matches[0].label,
        });
        await this.startCamera(video, cameraSelect.value);
      });
    }

    // 初始啟動已在上方完成（依智慧選擇邏輯）
  }

  /**
   * 啟動相機
   */
  async startCamera(video, clientId) {
    const statusEl = this.qrScanner?.querySelector(".sync-scanner-status");

    if (this.cameraUtils.cameraLoading) {
      Logger.warn("camera already loading, ignoring new request");
      if (statusEl) statusEl.textContent = "攝影機正在啟動中，請稍後...";
      return;
    }

    try {
      const stream = await this.cameraUtils.startCamera(clientId);

      if (!this.qrScanner || !document.body.contains(this.qrScanner)) {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        return;
      }

      video.srcObject = stream;
      this.cameraUtils.currentStream = stream;

      try {
        await video.play();
        if (statusEl) statusEl.textContent = "請對準 QR Code 掃描";
        this.startQRDetection(video);
        return;
      } catch (err) {
        Logger.warn("Video play 被中斷:", err);
        await this.cameraUtils.stopCurrentStream();
        this.stopQRScanner();
        return;
      }
    } catch (error) {
      Logger.error("攝影機存取錯誤:", error);
      if (statusEl)
        statusEl.textContent =
          error && error.message
            ? `無法存取攝影機：${error.message}`
            : "無法啟動攝影機。";
      if (error && error.name === "NotAllowedError") {
        if (statusEl) statusEl.textContent = "請允許網站使用您的攝影機。";
      } else if (error && error.name === "NotFoundError") {
        if (statusEl) statusEl.textContent = "找不到可用的攝影機。";
      }
      return;
    }
  }

  /**
   * 重試相機
   */
  async retryCamera(clientId = "", video) {
    const statusEl = this.qrScanner?.querySelector(".sync-scanner-status");
    if (this.cameraUtils.cameraLoading) {
      Logger.debug("retryCamera: camera is already loading, ignoring");
      if (statusEl) statusEl.textContent = "攝影機正在啟動中，請稍後...";
      return;
    }

    Logger.debug("retryCamera: user-initiated retry", { clientId });
    if (statusEl) statusEl.textContent = "使用者要求重新嘗試啟動相機...";

    // 停掉目前 stream
    if (this.cameraUtils.currentStream) {
      this.cameraUtils.currentStream.getTracks().forEach((t) => t.stop());
      this.cameraUtils.currentStream = null;
    }

    // 使用既有機制啟動相機
    await this.startCamera(video, clientId);
  }

  /**
   * 開始 QR Code 檢測
   */
  startQRDetection(video) {
    if (typeof jsQR === "undefined") {
      Logger.error("jsQR 庫未載入");
      this.stopQRScanner();
      alert(" QR Code 掃描庫未載入，請重新整理頁面");
      return;
    }

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    this.scanning = true;

    const performQRScan = () => {
      if (!this.scanning || video.readyState !== video.HAVE_ENOUGH_DATA) {
        return;
      }

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

      context.drawImage(video, 0, 0, width, height);

      const imageData = context.getImageData(0, 0, width, height);

      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert",
      });

      if (code && code.data) {
        Logger.info(" QR Code  識別成功");
        this.scanning = false;
        this.stopQRScanner();
        this.handleQRCodeScanned(code.data);
      }
    };

    this.scanTimer = setInterval(() => {
      if (!this.scanning) {
        clearInterval(this.scanTimer);
        this.scanTimer = null;
        return;
      }

      setTimeout(performQRScan, 0);
    }, 1000);
  }

  /**
   * 處理掃描到的 QR Code
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
          role =
            url.searchParams.get("role") || window.SyncManager?.ROLE?.VIEWER;
        } catch (e) {
          Logger.warn("URL 解析失敗:", e);
          return;
        }
      } else if (/^[A-Z0-9]{8}$/.test(qrData.trim().toUpperCase())) {
        // 純代碼格式（8位大寫字母或數字）
        const code = qrData.trim().toUpperCase();
        // 作為分享代碼
        shareCode = code;
        role = window.SyncManager?.ROLE?.VIEWER;
      } else {
        // 非分享代碼相關的 QR Code ，靜默忽略
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
        window.dispatchEvent(new CustomEvent(SYNC_EVENTS.SHOW_SYNC_PANEL));
      } else {
        // 未在工作階段中，顯示確認對話框
        this.showJoinConfirmation(codeToUse, role);
      }
    } catch (error) {
      Logger.error(" QR Code  處理錯誤:", error);
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
      if (this.cameraUtils.currentStream) {
        this.cameraUtils.currentStream.getTracks().forEach((track) => {
          track.stop();
        });
        this.cameraUtils.currentStream = null;
      }

      // 延遲移除元素，確保 video 已完全停止
      // 解除任何可能的 loading 鎖，避免停掉掃描器後無法再啟動
      this.cameraUtils.cameraLoading = false;
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
