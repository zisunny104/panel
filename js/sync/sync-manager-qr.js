/**
 * SyncManagerQR - 處理 QR Code 相關功能
 * - QR Code 產生 (分享用)
 * - QR Code 掃描 (透過攝影機啟動掃描器並使用 jsQR 分析)
 * - URL 參數解析（支援 ?shareCode=XXX&role=YYY）
 *
 * 設計要點：
 * - 使用本機 (local) enumerateDevices / getUserMedia 取得 videoinput
 * - 避免 race condition：單次啟動攝影機使用互斥鎖（this.cameraLoading）防止重複啟動
 * - 採用 fallback 與逐 clientId 嘗試來增加在各種驅動/裝置上的相容性
 * */

import { SyncEvents } from "../core/sync-events-constants.js";

export class SyncManagerQR {
  constructor(core) {
    this.core = core;
    this.qrScanner = null;
    this.countdownInterval = null;
    this.scanning = false;
    this.scanTimer = null;
    this.initialized = false;

    // 防止同時多次啟動相機（互斥鎖），避免 race condition
    this.cameraLoading = false;
    // 可用的 video devices 列表（由 enumerateDevices 填入）
    this.availableVideoDevices = [];
    // 最近的相機嘗試記錄（供偵錯用）
    this.lastCameraAttempts = [];
  }

  /**
   * 判斷 label 是否看起來像虛擬或橋接的攝影機（例如 Meta Quest、OBS 虚擬攝影機等）
   * - 回傳 true 表示為虛擬設備，會在排序時降級
   */
  isVirtualDeviceLabel(label) {
    if (!label) return false;
    const l = label.toLowerCase();
    const virtualKeywords = [
      "meta quest",
      "obs",
      "virtual",
      "nvidia",
      "oculus",
      "quest",
      "vr",
    ];
    return virtualKeywords.some((k) => l.includes(k));
  }

  /**
   * 以虛擬裝置降級方式排序 video device list（非破壞式）
   */
  sortVideoDevices(videoDevices) {
    if (!Array.isArray(videoDevices)) return videoDevices;
    return videoDevices.slice().sort((a, b) => {
      const aIsVirtual = this.isVirtualDeviceLabel(a.label || "");
      const bIsVirtual = this.isVirtualDeviceLabel(b.label || "");
      if (aIsVirtual && !bIsVirtual) return 1;
      if (!aIsVirtual && bIsVirtual) return -1;
      return 0;
    });
  }

  /**
   * 初始化QR處理
   */
  initialize() {
    // 防止重複初始化
    if (this.initialized) {
      return;
    }

    // 確保在 DOM 完全準備好後再檢查URL參數
    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          this.checkUrlParameters();
        },
        { once: true },
      );
    } else {
      // 檢查URL參數（從 QR Code 掃描進入）
      this.checkUrlParameters();
    }

    // 監聽 QR Code 產生事件
    window.addEventListener("sync_generate_qr", async (event) => {
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
    window.addEventListener("sync_start_qr_scan", () => {
      this.startQRScanner();
    });

    // [新增] 監聽裝置變更事件 (devicechange)，當作業系統或驅動新增/移除裝置時自動刷新
    if (
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.addEventListener === "function"
    ) {
      navigator.mediaDevices.addEventListener("devicechange", async () => {
        const video = document.getElementById("syncQrVideo");
        // 只有當掃描器已經打開時才刷新，避免背景執行報錯
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
   * 檢查URL參數（處理 QR Code 掃描進入的情況）
   * 支援模式：
   * - ?shareCode=XXX&role=YYY (分享代碼)
   */
  checkUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const shareCode = urlParams.get("shareCode");
    const role = urlParams.get("role") || window.SyncManager?.ROLE?.VIEWER;

    // 使用分享代碼
    const code = shareCode;

    if (code) {
      //檢查目前裝置是否已在工作階段中（產生者自己不應該加入）
      if (this.core?.syncClient?.sessionId) {
        // 立即清理URL
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname,
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
          window.dispatchEvent(new Event(SyncEvents.SESSION_JOINED));
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
   * 產生 QR Code （包含完整URL）
   * @param {string} code - 分享代碼
   * @param {string} role - 'viewer' 或 'operator'
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
            ? window.SyncManager?.PAGE?.EXPERIMENT
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
        modeBtn.innerHTML = `<strong>${roleText}</strong>`;
        modeBtn.dataset.role = role;
      }

      const enterBtn = container.querySelector("#qrEnterPageBtn");
      if (enterBtn) {
        const enterLabel = window.SyncManager?.getPageName(target) || target;
        enterBtn.textContent = enterLabel;
      }

      container.dataset.qrTarget = target;
      container.dataset.qrRole = role;

      Logger.info("QR Code 產生成功", { code, role });
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
            currentTarget === window.SyncManager?.PAGE?.EXPERIMENT
              ? window.SyncManager?.PAGE?.PANEL
              : window.SyncManager?.PAGE?.EXPERIMENT;

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
  startQRCodeCountdown(remainingTime = null) {
    Logger.debug("開始 QR Code 倒數計時", { remainingTime });

    const countdownElement = document.getElementById("qrCountdown");
    if (!countdownElement) {
      Logger.warn("找不到倒數計時元素 (qrCountdown)");
      return;
    }

    // 如果沒有提供剩餘時間，使用預設的300秒
    let initialTime = remainingTime !== null ? remainingTime : 300;
    Logger.debug("使用倒數時間", {
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
        Logger.debug("QR Code 倒數結束，已過期");
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
   * [新增] 重新抓取並更新相機下拉選單
   * - 會保留目前選取（若仍存在）或套用儲存的偏好
   */
  async refreshDeviceList(video) {
    const cameraSelect = document.getElementById("syncCameraSelect");
    const statusEl = this.qrScanner?.querySelector(".sync-scanner-status");
    if (!cameraSelect) return;

    try {
      // 1. 重新列舉裝置並排序
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === "videoinput");
      const sorted = this.sortVideoDevices(videoDevices);
      this.availableVideoDevices = sorted;

      // 2. 記錄目前選中的 ID (刷新後嘗試選回它)
      const currentSelectedId = cameraSelect.value;

      // 3. 重繪下拉選單
      cameraSelect.innerHTML = "";
      sorted.forEach((device, index) => {
        const option = document.createElement("option");
        option.value = device.clientId;
        option.textContent = device.label || `相機 ${index + 1}`;
        cameraSelect.appendChild(option);
      });

      // 4. 嘗試保持原本的選擇或套用儲存偏好
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
      if (statusEl) statusEl.textContent = "刷新相機清單失敗";
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
                        <button id="applyCameraFilterBtn" class="sync-camera-apply-btn" title="套用並選擇匹配的相機">選取</button>
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
          devices: (this.availableVideoDevices || []).map((d) => ({
            clientId: d.clientId,
            label: d.label,
          })),
          attempts: this.lastCameraAttempts || [],
        };
        try {
          await navigator.clipboard.writeText(JSON.stringify(debug, null, 2));
          if (statusEl) statusEl.textContent = "已複製偵錯資訊到剪貼簿";
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
          if (statusEl) statusEl.textContent = "無法複製偵錯資訊";
        }
      });
    }

    // 重新整理按鈕：重新列舉相機並重新啟動（使用者可視覺確認）
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        if (this.cameraLoading) {
          if (statusEl) statusEl.textContent = "攝影機正在啟動中，請稍後...";
          return;
        }

        try {
          if (statusEl) statusEl.textContent = "正在重新整理相機列表...";
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevices = devices.filter((d) => d.kind === "videoinput");

          // 使用排序後的清單（實體相機優先）
          const sorted = this.sortVideoDevices(videoDevices);
          this.availableVideoDevices = sorted;
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

    // 列出可用的相機
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(
        (device) => device.kind === "videoinput",
      );

      // 優先排序：把已知的虛擬裝置（Meta Quest / OBS / Virtual 等）降到清單後面
      const sorted = this.sortVideoDevices(videoDevices);

      // 清空現有選項（只顯示具體裝置）
      cameraSelect.innerHTML = "";

      // 記錄可用相機
      this.availableVideoDevices = sorted;

      // 新增相機選項（使用排序後的清單，實體相機在前）
      sorted.forEach((device, index) => {
        const option = document.createElement("option");
        option.value = device.clientId;
        option.textContent = device.label || `相機 ${index + 1}`;
        cameraSelect.appendChild(option);
      });

      // 智慧預設：
      // 1) 儲存的 ID 優先
      // 2) 儲存的 label（substring）作為備援
      // 3) 否則使用排序後第一台
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

      // 設定選單並啟動目標相機
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
        Logger.debug("enumerateDevices failed:", {
          name: error && error.name,
          message: error && error.message,
          stack: error && error.stack,
        });
      } catch (e) {}
    }

    // 相機選擇變更事件
    cameraSelect.addEventListener("change", async () => {
      // 停止目前stream
      if (this.currentStream) {
        this.currentStream.getTracks().forEach((track) => track.stop());
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
      (this.availableVideoDevices || []).forEach((device, index) => {
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
      });
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

        const matches = (this.availableVideoDevices || []).filter((d) => {
          const fl = filter.toLowerCase();
          return (
            (d.label && d.label.toLowerCase().includes(fl)) ||
            d.clientId.toLowerCase().includes(fl)
          );
        });

        if (!matches.length) {
          if (statusEl) statusEl.textContent = "找不到匹配的相機";
          return;
        }

        // 選擇第一個匹配項並啟動（同時儲存為使用者偏好，包含 label 備援）
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
   * 啟動指定的相機 (startCamera)
   *
   * 行為說明：
   * - 使用 getUserMedia 嘗試依 constraints 啟動相機
   * - 若未指定 clientId，會以 facingMode(環境鏡頭) 為優先
   * - 若首次嘗試失敗（NotReadable 或 Overconstrained），會使用更寬鬆的 fallback
   * - 若 fallback 仍失敗，會依 enumerateDevices 提供的 clientId 列表逐一嘗試
   * - 內部會使用互斥旗標 (this.cameraLoading) 防止重複啟動造成 race condition
   *
   * 參數：
   * - video: HTMLVideoElement - 用於顯示流的 video 元素
   * - clientId: string (可選) - 精準指定要啟動的裝置 id
   */
  async startCamera(video, clientId) {
    // 停掉現有 stream（如果有）以釋放資源
    if (this.currentStream) {
      try {
        this.currentStream.getTracks().forEach((t) => t.stop());
      } catch (e) {
        Logger.warn("stop currentStream failed:", e);
      }
      this.currentStream = null;
    }

    // 建立基本 constraints：保留解析度偏好，但若未指定 clientId 時使用系統預設（避免強制 facingMode）
    const baseVideo = {
      width: { ideal: 640 },
      height: { ideal: 480 },
    };

    let constraints = {
      video: clientId
        ? { ...baseVideo, clientId: { exact: clientId } }
        : { ...baseVideo },
      audio: false,
    };

    const statusEl = this.qrScanner?.querySelector(".sync-scanner-status");

    // Prevent concurrent camera startup requests to avoid race conditions
    if (this.cameraLoading) {
      Logger.warn("camera already loading, ignoring new request");
      if (statusEl) statusEl.textContent = "攝影機正在啟動中，請稍後...";
      return;
    }

    this.cameraLoading = true; // lock to prevent concurrent starts

    try {
      // 主要嘗試：使用指定 constraints 啟動
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // 檢查元素是否還存在（可能在取得攝影機期間被關閉）
      if (!this.qrScanner || !document.body.contains(this.qrScanner)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      video.srcObject = stream;
      this.currentStream = stream; // 儲存 stream 引用

      // 播放並開始檢測
      try {
        await video.play();
        if (statusEl) statusEl.textContent = "請對準 QR Code 掃描";
        this.startQRDetection(video);
        return;
      } catch (err) {
        Logger.warn("Video play 被中斷:", err);
        if (this.currentStream)
          this.currentStream.getTracks().forEach((t) => t.stop());
        this.stopQRScanner();
        return;
      }
    } catch (error) {
      Logger.error("攝影機存取錯誤:", error);
      // 詳細 debug 日誌（包含錯誤名稱、訊息與堆疊資訊）
      try {
        Logger.debug("startCamera error details:", {
          name: error && error.name,
          message: error && error.message,
          stack: error && error.stack,
          constraints: constraints,
        });
      } catch (e) {
        // ignore if Logger.debug fails
      }

      // 顯示在 scanner UI（避免多餘 alert）
      if (statusEl)
        statusEl.textContent = `無法存取攝影機：${error.name || error.message}`;

      // 若是可讀取資源被佔用或過度限制，嘗試 fallback（放寬限制）
      if (
        error.name === "NotReadableError" ||
        error.name === "OverconstrainedError"
      ) {
        Logger.warn("startCamera fallback: 將嘗試使用放寬的 constraints");

        // 放寬限制嘗試
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });

          if (!this.qrScanner || !document.body.contains(this.qrScanner)) {
            fallbackStream.getTracks().forEach((t) => t.stop());
            return;
          }

          video.srcObject = fallbackStream;
          this.currentStream = fallbackStream;

          try {
            await video.play();
            if (statusEl)
              statusEl.textContent = "使用備援攝影機，請對準 QR Code ";
            this.startQRDetection(video);
            return;
          } catch (err2) {
            Logger.warn("Video play on fallback 被中斷:", err2);
            fallbackStream.getTracks().forEach((t) => t.stop());
            this.stopQRScanner();
            return;
          }
        } catch (err2) {
          Logger.error("fallback 仍然無法存取攝影機:", err2);
          try {
            Logger.debug("startCamera fallback error details:", {
              name: err2 && err2.name,
              message: err2 && err2.message,
              stack: err2 && err2.stack,
            });
          } catch (e) {}

          // 嘗試利用 enumerateDevices 得到的 clientId 列表逐一嘗試（新增多種 constraints variant 並紀錄每次失敗以便偵錯）
          const devicesList = this.availableVideoDevices || [];
          if (devicesList.length > 0) {
            const attemptRecords = [];

            for (let i = 0; i < devicesList.length; i++) {
              const d = devicesList[i];
              const deviceLabel = d.label || d.clientId;

              // variants：多種嘗試策略（由寬鬆到嚴格）
              const variants = [
                {
                  desc: "exact-low-res",
                  constraints: {
                    video: {
                      clientId: { exact: d.clientId },
                      width: { ideal: 320 },
                      height: { ideal: 240 },
                      frameRate: { ideal: 15, max: 30 },
                    },
                    audio: false,
                  },
                },
                {
                  desc: "exact-default",
                  constraints: {
                    video: { clientId: { exact: d.clientId } },
                    audio: false,
                  },
                },
                {
                  desc: "ideal-device-low-res",
                  constraints: {
                    video: {
                      clientId: { ideal: d.clientId },
                      width: { ideal: 320 },
                      height: { ideal: 240 },
                    },
                    audio: false,
                  },
                },
              ];

              for (let v = 0; v < variants.length; v++) {
                const variant = variants[v];
                try {
                  if (statusEl)
                    statusEl.textContent = `嘗試相機 ${i + 1}/${devicesList.length} (${deviceLabel}) - ${variant.desc}`;

                  Logger.debug("startCamera attempting device variant", {
                    clientId: d.clientId,
                    label: deviceLabel,
                    variant: variant.desc,
                    constraints: variant.constraints,
                  });

                  // 小延遲避免快速重試導致系統忙碌
                  await new Promise((resolve) => setTimeout(resolve, 300));

                  const deviceStream =
                    await navigator.mediaDevices.getUserMedia(
                      variant.constraints,
                    );

                  if (
                    !this.qrScanner ||
                    !document.body.contains(this.qrScanner)
                  ) {
                    deviceStream.getTracks().forEach((t) => t.stop());
                    this.lastCameraAttempts = attemptRecords;
                    return;
                  }

                  video.srcObject = deviceStream;
                  this.currentStream = deviceStream;

                  try {
                    await video.play();
                    if (statusEl)
                      statusEl.textContent = "使用相機完成，請對準 QR Code ";
                    this.startQRDetection(video);
                    this.lastCameraAttempts = attemptRecords;
                    return;
                  } catch (vErr) {
                    Logger.warn("Video play failed for device variant:", vErr);
                    deviceStream.getTracks().forEach((t) => t.stop());
                    attemptRecords.push({
                      clientId: d.clientId,
                      label: deviceLabel,
                      variant: variant.desc,
                      name: vErr && vErr.name,
                      message: vErr && vErr.message,
                      time: Date.now(),
                    });
                    continue; // 嘗試下一個 variant
                  }
                } catch (devErr) {
                  Logger.warn(
                    `device ${d.clientId} variant ${variant.desc} 嘗試失敗:`,
                    devErr,
                  );
                  try {
                    Logger.debug("device attempt error details:", {
                      name: devErr && devErr.name,
                      message: devErr && devErr.message,
                      stack: devErr && devErr.stack,
                    });
                  } catch (e) {}

                  attemptRecords.push({
                    clientId: d.clientId,
                    label: deviceLabel,
                    variant: variant.desc,
                    name: devErr && devErr.name,
                    message: devErr && devErr.message,
                    time: Date.now(),
                  });
                  continue;
                }
              }
            }

            // 若全部嘗試失敗，儲存嘗試記錄並提示使用者複製偵錯日誌
            this.lastCameraAttempts = attemptRecords;
            if (statusEl)
              statusEl.textContent =
                "所有相機嘗試失敗。請按右上資訊按鈕複製偵錯日誌以協助排查。";
            Logger.debug("all device attempts failed", attemptRecords);
            return;
          }

          if (statusEl)
            statusEl.textContent =
              "無法啟動攝影機（可能被其他應用佔用或權限被拒）。";
          return;
        }
      }

      // 一般錯誤處理與提示
      if (error.name === "NotAllowedError") {
        if (statusEl) statusEl.textContent = "請允許網站使用您的攝影機。";
      } else if (error.name === "NotFoundError") {
        if (statusEl) statusEl.textContent = "找不到可用的攝影機。";
      } else {
        if (statusEl) statusEl.textContent = "無法啟動攝影機。";
      }
    } finally {
      // 最終清理：確保互斥鎖釋放
      if (this.cameraLoading) this.cameraLoading = false;
    }
  }

  /**
   * 使用者觸發的相機重試：
   * - 停止現有 stream（若有）並呼叫 startCamera
   * - 回報狀態到 scanner UI 並寫入 Debug 日誌
   *
   * @param {string} clientId - 指定 clientId（空字串表示自動選擇）
   * @param {HTMLVideoElement} video - 顯示用 video 元素
   */
  async retryCamera(clientId = "", video) {
    const statusEl = this.qrScanner?.querySelector(".sync-scanner-status");
    if (this.cameraLoading) {
      Logger.debug("retryCamera: camera is already loading, ignoring");
      if (statusEl) statusEl.textContent = "攝影機正在啟動中，請稍後...";
      return;
    }

    Logger.debug("retryCamera: user-initiated retry", { clientId });
    if (statusEl) statusEl.textContent = "使用者要求重新嘗試啟動相機...";

    // 停掉目前 stream
    if (this.currentStream) {
      try {
        this.currentStream.getTracks().forEach((t) => t.stop());
      } catch (err) {
        Logger.warn("retryCamera: 停止 stream 發生錯誤:", err);
      }
      this.currentStream = null;
    }

    // 使用既有機制啟動相機（會處理鎖、fallback 以及 device 列表逐一嘗試）
    await this.startCamera(video, clientId);
  }

  /**
   * 開始 QR Code 檢測
   */
  startQRDetection(video) {
    if (typeof jsQR === "undefined") {
      Logger.error("jsQR庫未載入");
      this.stopQRScanner();
      alert(" QR Code 掃描庫未載入，請重新整理頁面");
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
        // --- 降取樣 (Downsampling) ---
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
          Logger.info(" QR Code  識別成功");
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
          role =
            url.searchParams.get("role") || window.SyncManager?.ROLE?.VIEWER;
        } catch (e) {
          Logger.warn("URL 解析失敗:", e);
          return;
        }
      } else if (/^[A-Z0-9]{8}$/.test(qrData.trim().toUpperCase())) {
        // 純代碼格式（8位大寫字母或數字 - 新格式：6位基礎碼 + 2位檢查碼）
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
        window.dispatchEvent(new Event("show_sync_panel"));
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
      if (this.currentStream) {
        this.currentStream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (error) {
            Logger.warn("停止媒體軌道失敗:", error);
          }
        });
        this.currentStream = null;
      }

      // 延遲移除元素，確保 video 已完全停止
      // 解除任何可能的 loading 鎖，避免停掉掃描器後無法再啟動
      this.cameraLoading = false;
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
