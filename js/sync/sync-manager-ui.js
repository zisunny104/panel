/**
 * SyncManager UI - UI界面控制
 * 負責膠囊指示器、控制面板、各種按鈕和輸入框
 */

export class SyncManagerUI {
  constructor(core) {
    this.core = core;
    this.capsuleIndicator = null;
    this.controlPanel = null;
    this.statusElement = null;
    this.currentQRRole = "viewer"; //  QR code 的目前預設模式
    this.currentShareCode = null; // 目前連線的分享代碼
    this.qrCountdownInterval = null; //  QR code 計時器
    this.initialized = false; // 初始化標誌，防止重複初始化
    this.sharePanelOpened = false; // 分享面板是否已經打開過
  }

  /**
   * 初始化UI - 僅初始化控制面板和事件監聽（膠囊由 SyncManager 單獨建立）
   */
  initialize() {
    // 防止重複初始化
    if (this.initialized) {
      Logger.debug("[SyncManagerUI] UI 已初始化，跳過重複動作");
      return;
    }

    Logger.info("[SyncManagerUI] 開始初始化 UI");
    try {
      Logger.debug("[SyncManagerUI] 步驟 1/3: 建立控制面板...");
      this.createControlPanel();
      Logger.debug("[SyncManagerUI] 步驟 2/3: 設置事件監聽...");
      this.setupEventListeners();
      Logger.debug("[SyncManagerUI] 步驟 3/3: 更新指示器...");
      this.updateIndicator();

      // 使用 setTimeout 確保 DOM 已完全渲染後再更新 UI 狀態
      setTimeout(() => {
        this.updateUIState();
      }, 0);

      // 標記為已初始化
      this.initialized = true;

      // 註：膠囊指示器由 SyncManager.initialize() 建立
      // 註：工作階段還原由 SyncManager 統一負責，不在此執行
      Logger.info("[SyncManagerUI] UI 初始化完成（不包括膠囊）");
    } catch (error) {
      Logger.error("[SyncManagerUI] UI 初始化失敗", error);
      // Initialize failed, will create new session on demand
    }
  }

  // 注意：工作階段恢復使用 sessionStorage（分頁級），不使用 localStorage
  // sessionStorage 由 SyncClient.saveState() 管理

  /**
   * 建立膠囊狀態指示器
   */
  createCapsuleIndicator() {
    // 防止重複建立
    if (this.capsuleIndicator) {
      Logger.debug("[SyncManagerUI] 膠囊指示器已存在，跳過重複建立");
      return;
    }

    try {
      Logger.debug("[SyncManagerUI] 開始建立膠囊指示器");
      this.capsuleIndicator = document.createElement("div");
      this.capsuleIndicator.className = "sync-capsule-indicator offline";

      this.capsuleIndicator.innerHTML = `
            <div class="sync-status-indicator">
                <div class="sync-status-light"></div>
                <span class="sync-status-text">離線</span>
            </div>
        `;

      // 點擊膠囊打開面板（只在 UI 初始化後有效）
      const indicator = this.capsuleIndicator.querySelector(
        ".sync-status-indicator"
      );
      if (indicator) {
        indicator.addEventListener("click", () => {
          // 如果 UI 未初始化，不執行 showPanel
          if (this.initialized) {
            this.showPanel();
          }
        });
      }

      // 將膠囊指示器附加到 body
      document.body.appendChild(this.capsuleIndicator);
      Logger.debug("[SyncManagerUI] 膠囊指示器已成功建立並附加到 DOM");

      // 建立後立即根據 SyncClient 狀態更新膠囊顯示
      // 本機模式會顯示 "未同步"（idle），同步模式會顯示連線狀態
      this.updateIndicator();
    } catch (error) {
      Logger.error("[SyncManagerUI] 膠囊指示器建立失敗", error);
    }
  }

  /**
   * 建立控制面板
   */
  createControlPanel() {
    this.controlPanel = document.createElement("div");
    this.controlPanel.className = "modal-overlay";
    this.controlPanel.innerHTML = `
            <div class="modal-container sync-control-panel">
                <div class="modal-header">
                    <h2 class="modal-title">同步面板</h2>
                    <div class="sync-page-toggle-group">
                        <button class="sync-page-toggle-btn sync-page-panel" data-page="panel" title="切換至機台面板"><span class="btn-text-split">機台面板</span></button>
                        <button class="sync-page-toggle-btn sync-page-experiment" data-page="experiment" title="切換至實驗管理"><span class="btn-text-split">實驗管理</span></button>
                    </div>
                    <button class="modal-close-btn" title="關閉">×</button>
                </div>

                <div class="modal-body">
                    <div class="sync-panel-content">
                    <!-- 未連線狀態：建立/加入工作階段 -->
                    <div id="syncConnectionSection" class="sync-connection-section">
                    <!-- 外層卡片容器 -->
                    <div class="sync-create-join-container">
                        <!-- 建立工作階段區塊 -->
                        <div class="sync-create-section">
                            <h3>建立新工作階段</h3>
                            <div class="sync-code-input-group">
                                <div class="sync-create-input-container">
                                    <input type="text"
                                           id="createCodeInput"
                                           placeholder="輸入建立代碼"
                                           maxlength="9"
                                           pattern="[0-9]*"
                                           inputmode="numeric"
                                           class="sync-create-input">
                                    <div id="codeValidationStatus" class="sync-code-validation-indicator"></div>
                                </div>
                                <button id="createSessionBtn" class="sync-create-btn" disabled>建立</button>
                            </div>
                        </div>

                        <!-- 分隔線 -->
                        <div class="sync-ui-divider">
                            <span>或</span>
                        </div>

                        <!-- 加入工作階段區塊 -->
                        <div class="sync-join-section">
                            <h3>加入工作階段</h3>

                            <!-- 角色選擇 -->
                            <div class="sync-role-selector">
                                <button class="sync-role-btn viewer active" data-role="viewer">
                                    僅檢視
                                </button>
                                <button class="sync-role-btn operator" data-role="operator">
                                    同步操作
                                </button>
                            </div>

                            <!-- 輸入分享代碼加入 -->
                            <div class="sync-join-input-group">
                                <input type="text"
                                       id="sessionCodeInput"
                                       placeholder="輸入分享代碼"
                                       maxlength="8">
                                <button id="joinSessionBtn">加入</button>
                            </div>

                            <!-- 掃描 QR code -->
                            <button class="sync-scan-btn" id="scanQrBtn">
                                 掃描 QR code
                            </button>
                            <div class="sync-scan-hint">
                                掃描其他裝置的 QR code 加入工作階段
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 已連線狀態：分享和退出 -->
                <div id="syncConnectedSection" class="sync-connected-section">
                    <!-- 工作階段資訊卡片整體容器 -->
                    <div class="sync-session-info-container">
                        <div class="sync-session-info-cards">
                            <div class="sync-info-card">
                                <div class="sync-card-label">工作階段ID</div>
                                <div class="sync-card-value" id="connectedDisplaySessionId">-</div>
                            </div>
                            <div class="sync-info-card sync-role-card" id="roleCard">
                                <div class="sync-card-label">我的角色</div>
                                <div class="sync-card-value" id="connectedDisplayRole">-</div>
                            </div>
                            <div class="sync-info-card">
                                <div class="sync-card-label">連線狀態</div>
                                <div class="sync-card-value" id="connectedDisplayStatus">-</div>
                            </div>
                        </div>
                        <!-- 按鈕區域：分享和其他操作 -->
                        <div class="sync-session-buttons-container">
                            <div class="sync-session-share-row">
                                <button id="shareSessionToggleBtn" class="sync-share-toggle-btn">
                                    分享此工作階段
                                </button>
                                <!-- 分享內容（展開狀態，預設隱藏） -->
                                <div id="shareSessionContent" class="sync-share-content hidden">
                                    <h3>分享此工作階段</h3>

                                    <!-- 分享代碼 -->
                                    <div class="sync-share-code-display">
                                        <label>分享代碼:</label>
                                        <div class="sync-share-code-container">
                                            <button id="regenerateShareCodeBtn" class="sync-regenerate-code-btn sync-regenerate-inline-btn sync-btn-base" title="重新產生分享代碼">
                                                <svg class="sync-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                                                    <path d="M21 3v5h-5"></path>
                                                    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
                                                    <path d="M8 16H3v5"></path>
                                                </svg>
                                            </button>
                                            <span id="shareDisplayCode" class="sync-share-code">-</span>
                                            <div class="sync-share-code-buttons">
                                                <button id="copyShareCodeBtn" class="sync-copy-code-btn sync-btn-base" title="複製分享代碼">
                                                    <svg class="sync-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                                                        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                                                    </svg>
                                                </button>
                                                <button id="copyShareLinkBtn" class="sync-copy-link-btn sync-btn-base" title="複製分享連結">
                                                    <svg class="sync-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- QR Code -->
                                    <div class="sync-qr-display">
                                        <div id="shareQRCountdown" class="sync-qr-countdown">60</div>
                                        <div class="sync-qr-container">
                                            <div id="shareQRCode" class="sync-qr-code"></div>
                                        </div>
                                    </div>

                                    <!-- 收起按鈕 -->
                                    <button id="shareSessionCollapseBtn" class="sync-share-collapse-btn">
                                        <svg class="sync-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M18 15l-6-6-6 6"></path>
                                        </svg>
                                        收起
                                    </button>
                                </div>
                            </div>
                            <div class="sync-session-action-row">
                                <button id="disconnectBtn" class="sync-disconnect-btn">
                                    退出同步連線
                                </button>
                                <button id="manageSessionsBtn" class="sync-manage-sessions-btn">
                                    管理工作階段
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- 加入工作階段區塊（已連線時隱藏） -->
                </div>

                <!-- 狀態訊息 -->
                <div id="syncStatusMessage"></div>
                    </div>
                </div>
            </div>
        `;

    // 將控制面板附加到文檔元素
    document.documentElement.appendChild(this.controlPanel);
  }

  /**
   * 設定事件監聽器
   */
  setupEventListeners() {
    try {
      // 監聽工作階段成功加入/建立事件 - 更新 shareCode
      window.addEventListener("sync_session_joined", (event) => {
        const detail = event.detail || {};
        const { sessionId, shareCode, role } = detail;
        Logger.debug("[SyncUI] 收到 SESSION_JOINED 事件，更新 shareCode", {
          sessionId,
          shareCode,
          role,
        });
        if (shareCode) {
          this.currentShareCode = shareCode;
        }
      });

      // 監聽 WebSocket 連線成功事件（認證完成）
      window.addEventListener("sync_connected", (event) => {
        Logger.debug(
          "[SyncUI] 收到 SYNC_CONNECTED 事件，更新面板狀態",
          event.detail
        );

        // 更新 UI 狀態（切換到已連線面板）
        this.updateUIState();
        this.updateIndicator();
        this.updateConnectedSessionInfo();
      });

      // 監聽 WebSocket 斷線事件
      window.addEventListener("sync_disconnected", (event) => {
        Logger.debug("[SyncUI] 收到 SYNC_DISCONNECTED 事件，更新面板狀態");

        // 更新 UI 狀態（切換回未連線面板）
        this.updateUIState();
        this.updateIndicator();
      });

      // 監聽伺服器狀態變化事件
      window.addEventListener("sync_server_status_changed", (event) => {
        const { online, previousOnline, error } = event.detail;

        // 立即更新膠囊指示器
        this.updateIndicator();

        // 如果從線上變離線，顯示警告訊息
        if (previousOnline && !online) {
          this.showStatus("error", "伺服器已離線，功能受限");
        }
        // 如果從離線變線上，顯示還原訊息
        else if (!previousOnline && online) {
          this.showStatus("success", "伺服器已恢復連線");
        }
      });

      // 關閉面板
      const closeBtn = this.controlPanel.querySelector(".modal-close-btn");
      if (closeBtn) {
        closeBtn.addEventListener("click", () => this.hidePanel());
      }

      // 頁面切換按鈕
      const pageToggleButtons = this.controlPanel.querySelectorAll(
        ".sync-page-toggle-btn"
      );
      if (pageToggleButtons.length > 0) {
        // 設定目前頁面按鈕為 active
        this.updatePageToggleButtonState();

        pageToggleButtons.forEach((btn) => {
          btn.addEventListener("click", () => {
            const targetPage = btn.dataset.page;
            const basePath = window.location.pathname.substring(
              0,
              window.location.pathname.lastIndexOf("/") + 1
            );

            let targetUrl;
            if (targetPage === "panel") {
              // 切換到機台面板
              targetUrl = basePath.endsWith("/") ? basePath : basePath + "/";
            } else if (targetPage === "experiment") {
              // 切換到實驗管理
              targetUrl = basePath + "experiment.html";
            }

            window.location.href = targetUrl;
          });
        });
      }

      // 點擊背景關閉
      this.controlPanel.addEventListener("click", (e) => {
        if (e.target === this.controlPanel) {
          this.hidePanel();
        }
      });

      // 建立代碼輸入 - 即時驗證
      const createCodeInput = document.getElementById("createCodeInput");
      const createBtn = document.getElementById("createSessionBtn");

      createCodeInput.addEventListener("input", (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, "");
        this.validateCreateCode(e.target.value);
      });

      createCodeInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter" && createCodeInput.value.length === 9) {
          this.handleCreateSession();
        }
      });

      // 建立按鈕點擊
      createBtn.addEventListener("click", () => {
        if (createCodeInput.value.length === 9) {
          this.handleCreateSession();
        }
      });

      // 重新產生 QR code 按鈕 - 此按鈕已不存在，使用 regenerateShareCodeBtn
      /*
      const regenerateBtn = document.getElementById("regenerateQrBtn");
      if (regenerateBtn) {
        regenerateBtn.addEventListener("click", () => {
          const sessionId = this.core.getSessionId();
          if (sessionId) {
            window.dispatchEvent(
              new CustomEvent("sync_generate_qr", {
                detail: { sessionId, role: this.currentQRRole },
              })
            );
          }
        });
      }
      */

      //  QR code 區塊的預設模式選擇按鈕
      const qrRoleButtons =
        this.controlPanel.querySelectorAll(".sync-qr-role-btn");
      qrRoleButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
          qrRoleButtons.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          this.currentQRRole = btn.dataset.role;

          // 自動重新產生 QR code
          const sessionId = this.core.getSessionId();
          if (sessionId) {
            window.dispatchEvent(
              new CustomEvent("sync_generate_qr", {
                detail: { sessionId, role: this.currentQRRole },
              })
            );
          }
        });
      });

      // 角色選擇按鈕
      const roleButtons = this.controlPanel.querySelectorAll(".sync-role-btn");
      roleButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
          roleButtons.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          this.core.currentRole = btn.dataset.role;
        });
      });

      // 已連線狀態下的角色卡片點擊切換
      const roleCard = document.getElementById("roleCard");
      if (roleCard) {
        roleCard.addEventListener("click", () => {
          try {
            const currentRole = this.core.syncClient?.role || "viewer";
            const newRole = currentRole === "operator" ? "viewer" : "operator";

            // 切換角色
            if (this.core.syncClient) {
              this.core.syncClient.role = newRole;
              this.core.syncClient.saveRole(newRole); // 新增：儲存角色到 localStorage
            }

            // 儲存角色到本機快取
            try {
              localStorage.setItem("sync_preferred_role", newRole);
              Logger.debug(`[同步面板] 角色已儲存到快取: ${newRole}`);
            } catch (error) {
              Logger.warn("[同步面板] 無法儲存角色到快取:", error);
            }

            // 更新顯示
            this.updateConnectedSessionInfo();

            // 發送切換通知到伺服器
            this.showStatus(
              "info",
              `角色已切換為: ${newRole === "operator" ? "同步操作" : "僅檢視"}`
            );
          } catch (error) {
            Logger.error("角色切換失敗:", error);
            this.showStatus("error", "角色切換失敗");
          }
        });
      }

      // 加入工作階段按鈕
      const joinBtn = document.getElementById("joinSessionBtn");
      joinBtn.addEventListener("click", () => this.handleJoinSession());

      // 工作階段碼輸入Enter鍵
      const sessionCodeInput = document.getElementById("sessionCodeInput");
      sessionCodeInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          this.handleJoinSession();
        }
      });

      // 掃描 QR code 按鈕
      const scanBtn = document.getElementById("scanQrBtn");
      scanBtn.addEventListener("click", () => {
        // 觸發QR掃描事件
        window.dispatchEvent(new Event("sync_start_qr_scan"));
      });

      // 複製加入代碼按鈕 - 此按鈕已不存在，使用新的分享系統
      /*
      const copyCodeBtn = document.getElementById("copyJoinCodeBtn");
      if (copyCodeBtn) {
        copyCodeBtn.addEventListener("click", () => {
          const joinCodeSpan = document.getElementById("displayJoinCode");
          const joinCode = joinCodeSpan.textContent.trim();

          if (joinCode && joinCode !== "-") {
            // 複製到剪貼簿
            navigator.clipboard
              .writeText(joinCode)
              .then(() => {
                // 暫時改變按鈕文字表示複製成功
                const originalText = copyCodeBtn.textContent;
                copyCodeBtn.textContent = "已複製";
                copyCodeBtn.classList.add("copied");

                setTimeout(() => {
                  copyCodeBtn.textContent = originalText;
                  copyCodeBtn.classList.remove("copied");
                }, 2000);
              })
              .catch((err) => {
                Logger.error("複製失敗:", err);
                alert("複製失敗，請手動複製");
              });
          }
        });
      }
      */

      // 分享工作階段展開/隱藏按鈕
      const shareSessionToggleBtn = document.getElementById(
        "shareSessionToggleBtn"
      );
      const shareSessionContent = document.getElementById(
        "shareSessionContent"
      );
      const shareSessionCollapseBtn = document.getElementById(
        "shareSessionCollapseBtn"
      );

      if (shareSessionToggleBtn && shareSessionContent) {
        shareSessionToggleBtn.addEventListener("click", () => {
          // 展開分享內容
          shareSessionContent.classList.remove("hidden");
          shareSessionToggleBtn.classList.add("hidden");

          // 按下時產生分享代碼和  QR code
          this.initializeShareCode();
        });
      }

      if (shareSessionCollapseBtn && shareSessionContent) {
        shareSessionCollapseBtn.addEventListener("click", () => {
          // 隱藏分享內容
          shareSessionContent.classList.add("hidden");
          if (shareSessionToggleBtn) {
            shareSessionToggleBtn.classList.remove("hidden");
          }

          // 停止 QR code 計時器
          if (this.qrCountdownInterval) {
            clearInterval(this.qrCountdownInterval);
            this.qrCountdownInterval = null;
          }
        });
      }

      // 連線後的分享代碼複製按鈕
      const copyShareCodeBtn = document.getElementById("copyShareCodeBtn");
      if (copyShareCodeBtn) {
        copyShareCodeBtn.addEventListener("click", () => {
          const shareCode =
            document.getElementById("shareDisplayCode").textContent;
          if (shareCode && shareCode !== "-") {
            navigator.clipboard
              .writeText(shareCode)
              .then(() => {
                const originalHTML = copyShareCodeBtn.innerHTML;
                copyShareCodeBtn.innerHTML =
                  '<svg class="sync-icon sync-icon-checkmark" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
                copyShareCodeBtn.classList.add("copied");

                setTimeout(() => {
                  copyShareCodeBtn.innerHTML = originalHTML;
                  copyShareCodeBtn.classList.remove("copied");
                }, 2000);
              })
              .catch((err) => {
                Logger.debug("複製失敗:", err);
                alert("複製失敗，請手動複製");
              });
          }
        });
      }

      // 退出同步連線按鈕
      const disconnectBtn = document.getElementById("disconnectBtn");
      if (disconnectBtn) {
        disconnectBtn.addEventListener("click", () => {
          this.handleDisconnect();
        });
      }

      // 管理工作階段按鈕
      const manageSessionsBtn = document.getElementById("manageSessionsBtn");
      if (manageSessionsBtn) {
        manageSessionsBtn.addEventListener("click", () => {
          // 觸發查看工作階段事件
          window.dispatchEvent(new Event("sync_show_sessions"));
        });
      }

      // 重新產生分享 QR code 按鈕
      const regenerateShareCodeBtn = document.getElementById(
        "regenerateShareCodeBtn"
      );
      if (regenerateShareCodeBtn) {
        regenerateShareCodeBtn.addEventListener("click", async () => {
          Logger.debug("[SyncUI] 使用者點擊重新產生分享代碼按鈕");
          regenerateShareCodeBtn.disabled = true;
          regenerateShareCodeBtn.style.opacity = "0.5";
          try {
            Logger.debug("[SyncUI] 呼叫後端API重新產生分享代碼");
            const result = await this.core.syncClient.regenerateShareCode();
            Logger.debug("[SyncUI] regenerateShareCode() 返回結果", {
              result,
              type: typeof result,
              keys: result ? Object.keys(result) : "null",
            });
            if (result) {
              const newShareCode = result.shareCode;
              Logger.debug("[SyncUI] 從結果中提取新分享代碼", { newShareCode });
              this.currentShareCode = newShareCode;

              // 立即更新 UI（不等待其他操作）
              const shareDisplayCode =
                document.getElementById("shareDisplayCode");
              if (shareDisplayCode) {
                shareDisplayCode.textContent = newShareCode;
              }

              Logger.debug("[SyncUI] 重新產生分享代碼成功", { newShareCode });

              // 並行執行：倒計時和 QR 產生
              // 1. 倒計時使用預設值（回應中可能包含剩餘時間）
              const remainingTime = result.remainingTime || 300;
              this.startShareQRCountdown(remainingTime);

              // 2. 非同步產生 QR code（不阻擋 UI）
              window.dispatchEvent(
                new CustomEvent("sync_generate_qr", {
                  detail: {
                    shareCode: newShareCode,
                    role: this.core.syncClient.role,
                    isShareCode: true,
                  },
                })
              );

              this.showStatus("success", "已重新產生分享代碼（有效期已重置）");
            }
          } catch (error) {
            Logger.error("[SyncUI] 重新產生分享代碼失敗:", error);
            this.showStatus("error", "重新產生分享代碼失敗：" + error.message);
          } finally {
            regenerateShareCodeBtn.disabled = false;
            regenerateShareCodeBtn.style.opacity = "1";
          }
        });
      }

      // 複製分享連結按鈕
      const copyShareLinkBtn = document.getElementById("copyShareLinkBtn");
      if (copyShareLinkBtn) {
        copyShareLinkBtn.addEventListener("click", async () => {
          const shareCode =
            document.getElementById("shareDisplayCode")?.textContent;
          if (!shareCode || shareCode === "-") {
            this.showStatus("error", "沒有可用的分享代碼");
            return;
          }

          try {
            // 產生完整的分享連結
            const shareUrl = this.core.generateQRContent(
              shareCode,
              this.core.syncClient?.role || "viewer"
            );

            // 複製到剪貼簿
            await navigator.clipboard.writeText(shareUrl);

            // 顯示成功訊息
            this.showStatus("success", "分享連結已複製到剪貼簿");

            // 視覺回饋 - 顯示勾選圖標
            const originalHTML = copyShareLinkBtn.innerHTML;
            copyShareLinkBtn.innerHTML =
              '<svg class="sync-icon sync-icon-checkmark" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
            copyShareLinkBtn.classList.add("copied");

            setTimeout(() => {
              copyShareLinkBtn.innerHTML = originalHTML;
              copyShareLinkBtn.classList.remove("copied");
            }, 2000);
          } catch (error) {
            Logger.debug("複製分享連結失敗:", error);
            this.showStatus("error", "複製分享連結失敗");
          }
        });
      }
    } catch (error) {
      Logger.error("[SyncManagerUI] 事件監聽器設定失敗:", error);
    }
  }

  /**
   * 驗證建立代碼
   */
  validateCreateCode(code) {
    const statusDiv = document.getElementById("codeValidationStatus");
    const createBtn = document.getElementById("createSessionBtn");

    if (code.length === 0) {
      statusDiv.className = "sync-code-validation-indicator";
      statusDiv.textContent = "";
      createBtn.disabled = true;
      return;
    }

    if (code.length < 9) {
      statusDiv.className = "sync-code-validation-indicator invalid";
      statusDiv.textContent = "✖";
      createBtn.disabled = true;
    } else if (code.length === 9) {
      statusDiv.className = "sync-code-validation-indicator valid";
      statusDiv.textContent = "✓";
      createBtn.disabled = false;
    }
  }

  /**
   * 處理建立工作階段（建立者直接加入，不自動產生分享代碼）
   */
  async handleCreateSession() {
    const input = document.getElementById("createCodeInput");
    const code = input.value.trim();

    if (code.length !== 9) {
      this.showStatus("error", "請輸入有效之建立代碼");
      return;
    }

    this.showStatus("info", "正在建立工作階段...");

    try {
      // 建立工作階段（建立者直接加入為 operator）
      const result = await this.core.createSession(code);
      const sessionId = result.sessionId;

      // sessionStorage 由 SyncClient.saveState() 自動管理

      this.showStatus("success", "工作階段建立成功！");
      this.updateIndicator();
      this.updateUIState();
      this.updateConnectedSessionInfo();

      // 清空分享代碼顯示（尚未產生）
      const shareDisplayCode = document.getElementById("shareDisplayCode");
      if (shareDisplayCode) {
        shareDisplayCode.textContent = "點擊「產生分享代碼」按鈕";
      }

      // 重置預設模式為僅檢視
      this.currentQRRole = "viewer";

      // 通知工作階段管理面板
      window.dispatchEvent(
        new CustomEvent("sync_session_created", {
          detail: { sessionId },
        })
      );

      // 清除輸入框
      input.value = "";

      Logger.info("[SyncManagerUI] 工作階段建立成功", { sessionId });
    } catch (error) {
      this.showStatus("error", `建立失敗: ${error.message}`);
      Logger.error("[SyncManagerUI] 建立工作階段失敗:", error);
    }
  }

  /**
   * 處理產生分享代碼（在工作階段建立後）
   */
  async handleGenerateShareCode() {
    this.showStatus("info", "正在產生分享代碼...");

    try {
      const result = await this.core.generateShareCode();
      this.currentShareCode = result.shareCode;

      this.showStatus("success", "分享代碼已產生！");

      // 更新分享代碼顯示
      const shareDisplayCode = document.getElementById("shareDisplayCode");
      if (shareDisplayCode) {
        shareDisplayCode.textContent = result.shareCode;
      }

      // 啟用 QR code 按鈕
      const qrRoleButtons =
        this.controlPanel.querySelectorAll(".sync-qr-role-btn");
      qrRoleButtons.forEach((btn) => {
        if (btn.dataset.role === "viewer") {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });

      Logger.info("[SyncManagerUI] 分享代碼已產生", {
        shareCode: result.shareCode,
      });
    } catch (error) {
      this.showStatus("error", `產生分享代碼失敗: ${error.message}`);
      Logger.error("[SyncManagerUI] 產生分享代碼失敗:", error);
    }
  }

  /**
   * 處理加入工作階段
   */
  async handleJoinSession() {
    const input = document.getElementById("sessionCodeInput");
    const code = input.value.trim().toUpperCase();

    // 只接受 8 位分享代碼（工作階段ID已停用，僅作內部使用）
    if (code.length !== 8 || !/^[A-Z0-9]+$/.test(code)) {
      this.showStatus("error", "請輸入有效之8位分享代碼");
      return;
    }

    // 讀取 UI 上目前選擇的角色
    const activeRoleBtn = this.controlPanel.querySelector(
      ".sync-role-btn.active"
    );
    const role = activeRoleBtn ? activeRoleBtn.dataset.role : "viewer";

    this.showStatus("info", "正在加入工作階段...");

    try {
      // 使用分享代碼加入（唯一的加入方式）
      await this.core.joinSessionByShareCode(code, role);
      const actualSessionId = this.core.syncClient.getSessionId(); // 取得真實的 sessionId

      // sessionStorage 由 SyncClient.saveState() 自動管理

      const roleText = role === "viewer" ? "僅檢視" : "同步操作";
      this.showStatus("success", `成功加入工作階段！模式: ${roleText}`);
      this.updateIndicator();
      this.updateUIState();
      this.updateConnectedSessionInfo();

      // 顯示 QR code 區塊 - 此區塊已不存在，使用新的分享系統
      /*
      const qrCodeSection = document.getElementById("qrCodeSection");
      if (qrCodeSection) {
        qrCodeSection.style.display = "block";
      }

      // 更新加入代碼顯示 - 此元素已不存在
      const displayJoinCode = document.getElementById("displayJoinCode");
      if (displayJoinCode) {
        displayJoinCode.textContent = code;
      }
      */

      // 重置預設模式為目前角色
      this.currentQRRole = role;
      const qrRoleButtons =
        this.controlPanel.querySelectorAll(".sync-qr-role-btn");
      qrRoleButtons.forEach((btn) => {
        if (btn.dataset.role === role) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });

      // 觸發 QR code 產生事件（需要 shareCode，不是 sessionId）
      // 注意：如果是通過 sessionId 加入，則沒有 shareCode，不產生 QR
      if (this.currentShareCode) {
        window.dispatchEvent(
          new CustomEvent("sync_generate_qr", {
            detail: { shareCode: this.currentShareCode, role },
          })
        );
      }

      input.value = "";
    } catch (error) {
      this.showStatus("error", error.message || "加入工作階段失敗");
    }
  }

  /**
   * 更新膠囊指示器
   */
  updateIndicator() {
    // 安全檢查 capsuleIndicator 是否存在
    if (!this.capsuleIndicator) {
      Logger.warn(
        "[SyncManagerUI] capsuleIndicator 不存在，UI 初始化可能失敗或未執行",
        {
          hasCore: !!this.core,
          timestamp: new Date().toISOString(),
        }
      );
      return;
    }

    const status = this.core.getStatusText();
    const isConnected = this.core.isConnected();

    // 移除所有狀態類別
    this.capsuleIndicator.classList.remove(
      "offline",
      "online",
      "idle",
      "viewer",
      "operator"
    );

    // 新增連線狀態類別和功能狀態類別
    if (isConnected && status !== "offline") {
      this.capsuleIndicator.classList.add("online", status);
    } else {
      this.capsuleIndicator.classList.add("offline", status);
    }

    const textMap = {
      offline: "離線",
      idle: "未同步",
      viewer: "僅檢視",
      operator: "同步中",
    };

    const statusText = this.capsuleIndicator.querySelector(".sync-status-text");
    if (statusText) {
      statusText.textContent = textMap[status] || "離線";
    }

    // 更新UI狀態（顯示/隱藏建立/加入 vs 分享/退出區塊）
    this.updateUIState();
  }

  /**
   * 顯示狀態訊息
   */
  showStatus(type, message) {
    const statusElement = document.getElementById("syncStatusMessage");
    if (!statusElement) {
      return;
    }

    statusElement.className = `sync-status-message ${type}`;
    statusElement.textContent = message;
    statusElement.style.display = "block";

    if (type !== "success") {
      setTimeout(() => {
        if (statusElement && statusElement.textContent === message) {
          statusElement.style.display = "none";
        }
      }, 5000);
    }
  }

  /**
   * 顯示控制面板
   */
  showPanel() {
    if (!this.controlPanel) {
      Logger.debug("[SyncManagerUI] controlPanel 不存在");
      return;
    }

    // 隱藏膠囊指示器，避免與面板重疊
    if (this.capsuleIndicator) {
      this.capsuleIndicator.style.display = "none";
    }

    // 使用 classList 新增 active 類別（modal 架構使用 active）
    this.controlPanel.classList.add("active");

    // 更新頁面切換按鈕的 active 狀態
    this.updatePageToggleButtonState();

    this.updateUIState();
  }

  /**
   * 更新頁面切換按鈕的 active 狀態
   */
  updatePageToggleButtonState() {
    const currentPath = window.location.pathname;
    let currentPage = "panel"; // 預設為機台面板

    if (currentPath.includes("experiment.html")) {
      currentPage = "experiment";
    }

    const pageToggleButtons = this.controlPanel.querySelectorAll(
      ".sync-page-toggle-btn"
    );
    pageToggleButtons.forEach((btn) => {
      if (btn.dataset.page === currentPage) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  /**
   * 更新UI狀態：根據連線狀態切換建立/加入和分享/退出面板
   */
  updateUIState() {
    try {
      const connectionSection = document.getElementById(
        "syncConnectionSection"
      );
      const connectedSection = document.getElementById("syncConnectedSection");
      const isConnected = this.core.isConnected();

      if (isConnected) {
        if (connectionSection) {
          connectionSection.classList.add("hidden");
        }
        if (connectedSection) {
          connectedSection.classList.add("show");
        }

        this.updateConnectedSessionInfo();
      } else {
        if (connectionSection) {
          connectionSection.classList.remove("hidden");
        }
        if (connectedSection) {
          connectedSection.classList.remove("show");
        }
        // 未連線時不強制隱藏面板，允許使用者手動打開以建立連線
      }
    } catch (error) {
      Logger.warn("[SyncManagerUI] updateUIState 錯誤:", error);
    }
  }

  /**
   * 更新已連線狀態下的工作階段資訊和分享代碼
   */
  updateConnectedSessionInfo() {
    try {
      const sessionId = this.core.getSessionId();
      const role = this.core.syncClient?.role || "-";
      const status = this.core.getStatusText();

      // 狀態文本映射（與膠囊指示器相同）
      const statusTextMap = {
        offline: "離線",
        idle: "未同步",
        viewer: "僅檢視",
        operator: "同步中",
      };

      // 更新工作階段資訊
      const sessionIdSpan = document.getElementById(
        "connectedDisplaySessionId"
      );
      const roleSpan = document.getElementById("connectedDisplayRole");
      const statusSpan = document.getElementById("connectedDisplayStatus");

      if (sessionIdSpan) {
        sessionIdSpan.textContent = sessionId || "-";
      }
      if (roleSpan) {
        roleSpan.textContent = role === "operator" ? "同步操作" : "檢視模式";
      }
      if (statusSpan) {
        statusSpan.textContent = statusTextMap[status] || status;
      }

      // 分享代碼在使用者點擊展開按鈕時才產生
    } catch (error) {
      Logger.warn("[SyncManagerUI] updateConnectedSessionInfo 錯誤:", error);
    }
  }

  /**
   * 初始化分享代碼和  QR code （在使用者點擊展開按鈕時調用）
   */
  async initializeShareCode() {
    Logger.debug("[SyncUI] 開始初始化分享代碼和QR code");

    // 標記分享面板已經打開過
    this.sharePanelOpened = true;

    // 取得目前分享代碼
    let shareCode = this.currentShareCode;
    Logger.debug("[SyncUI] 目前分享代碼", { shareCode });

    // 如果已有分享代碼，立即使用它產生 QR（加快響應速度）
    if (shareCode) {
      Logger.debug("[SyncUI] 使用現有分享代碼立即產生QR", { shareCode });

      // 更新分享代碼顯示
      const shareDisplayCode = document.getElementById("shareDisplayCode");
      if (shareDisplayCode) {
        shareDisplayCode.textContent = shareCode;
      }

      // 立即發送 QR 產生事件（不等待驗證）
      Logger.debug("[SyncUI] 並行啟動QR code產生", { shareCode });
      window.dispatchEvent(
        new CustomEvent("sync_generate_qr", {
          detail: {
            shareCode: shareCode,
            role: this.core.syncClient?.role || "viewer",
            isShareCode: true,
          },
        })
      );

      // 在背景非同步驗證分享代碼（不阻塞UI）
      this.validateAndRefreshShareCodeInBackground(shareCode);
    } else {
      // 沒有分享代碼，需要產生新的
      Logger.debug("[SyncUI] 無現有分享代碼，需要產生新的");
      await this.regenerateAndDisplayShareCode();
    }
  }

  /**
   * 在背景驗證分享代碼，如果無效則重新產生（非同步，不阻塞UI）
   */
  async validateAndRefreshShareCodeInBackground(shareCode) {
    try {
      Logger.debug("[SyncUI] 背景驗證分享代碼", { shareCode });
      const shareCodeInfo = await this.core.getShareCodeInfo(shareCode);

      // 檢查代碼是否有效（未使用且未過期）
      const isValid = !shareCodeInfo.used && !shareCodeInfo.expired;

      if (isValid) {
        Logger.debug("[SyncUI] 分享代碼驗證有效，啟動倒計時", {
          remainingTime: shareCodeInfo.remainingTime,
        });
        this.startShareQRCountdown(shareCodeInfo.remainingTime);
      } else {
        Logger.debug(
          "[SyncUI] 分享代碼無效（已使用或已過期），重新產生新的代碼",
          {
            used: shareCodeInfo.used,
            expired: shareCodeInfo.expired,
          }
        );
        await this.regenerateAndDisplayShareCode();
      }
    } catch (error) {
      Logger.warn("[SyncUI] 背景驗證分享代碼失敗，將重新產生", error);
      await this.regenerateAndDisplayShareCode();
    }
  }

  /**
   * 更新分享代碼狀態顯示
   * @param {string} statusText - 狀態文字
   * @param {string} statusClass - CSS類別 (valid, used, expired)
   */
  updateShareCodeStatus(statusText, statusClass) {
    const shareDisplayCode = document.getElementById("shareDisplayCode");
    if (shareDisplayCode) {
      // 移除之前的狀態類別
      shareDisplayCode.classList.remove(
        "share-code-valid",
        "share-code-used",
        "share-code-expired"
      );
      // 添加新的狀態類別
      shareDisplayCode.classList.add(`share-code-${statusClass}`);
      // 更新文字（保留代碼，但添加狀態）
      const code =
        this.currentShareCode ||
        shareDisplayCode.textContent.replace(/\s*\([^)]*\)$/, "");
      shareDisplayCode.textContent = `${code} (${statusText})`;
    }

    // 更新狀態指示器
    const statusIndicator = document.getElementById("shareCodeStatusIndicator");
    if (statusIndicator) {
      statusIndicator.className = `share-code-status-indicator status-${statusClass}`;
      statusIndicator.textContent = statusText;
    }
  }

  /**
   * 重新產生分享代碼並顯示（含倒計時）
   */
  async regenerateAndDisplayShareCode() {
    try {
      // 使用 sync-client 的標準 API 方法
      if (!this.core.syncClient) {
        throw new Error("SyncClient 未初始化");
      }

      Logger.debug("[SyncUI] 透過 SyncClient 請求產生新分享代碼");

      // 首次產生使用 generateShareCode()，重新產生使用 regenerateShareCode()
      const result = await this.core.generateShareCode();

      const shareCode = result.shareCode;
      Logger.debug("[SyncUI] 成功產生新分享代碼", { shareCode });

      this.currentShareCode = shareCode;

      // 更新分享代碼顯示
      const shareDisplayCode = document.getElementById("shareDisplayCode");
      if (shareDisplayCode) {
        shareDisplayCode.textContent = shareCode;
      }

      // 發送 QR 產生事件
      Logger.debug("[SyncUI] 並行啟動QR code產生（新代碼）", { shareCode });
      window.dispatchEvent(
        new CustomEvent("sync_generate_qr", {
          detail: {
            shareCode: shareCode,
            role: this.core.syncClient?.role || "viewer",
            isShareCode: true,
          },
        })
      );

      // 啟動倒計時（固定 300 秒）
      this.startShareQRCountdown(300);
    } catch (error) {
      Logger.error("[SyncUI] 產生新分享代碼失敗:", error);
      throw error; // 不再使用 fallback，直接拋出錯誤
    }
  }

  /**
   * 啟動分享  QR code 倒數計時
   * @param {number} remainingTime - 剩餘時間（秒），如果未提供則使用預設300秒
   */
  startShareQRCountdown(remainingTime = null) {
    Logger.debug("[SyncUI] 開始分享QR倒數計時", { remainingTime });

    const countdownElement = document.getElementById("shareQRCountdown");
    if (!countdownElement) {
      Logger.warn("[SyncUI] 找不到倒數計時元素 (shareQRCountdown)");
      return;
    }

    // 停止之前的計時器
    if (this.qrCountdownInterval) {
      clearInterval(this.qrCountdownInterval);
    }

    // 如果沒有提供剩餘時間，使用預設的300秒
    let currentTime = remainingTime !== null ? remainingTime : 300;
    Logger.debug("[SyncUI] 使用倒數時間", {
      currentTime,
      provided: remainingTime !== null,
    });

    const updateCountdown = async () => {
      // 禁用動態檢查（避免 API 延遲），直接使用倒計時
      // 原本每10秒檢查一次分享代碼狀態，現在改為只看倒時數
      // if (currentTime % 10 === 0 && this.currentShareCode) {
      //   try {
      //     const shareCodeInfo = await this.core.getShareCodeInfo(
      //       this.currentShareCode
      //     );
      //     if (shareCodeInfo.used) {
      //       Logger.debug("[SyncUI] 分享代碼已被使用，更新顯示狀態");
      //       countdownElement.textContent = "分享代碼已使用";
      //       if (this.qrCountdownInterval) {
      //         clearInterval(this.qrCountdownInterval);
      //         this.qrCountdownInterval = null;
      //       }
      //       return;
      //     }
      //   } catch (error) {
      //     // 忽略檢查錯誤，繼續倒數
      //     Logger.debug(
      //       "[SyncUI] 檢查分享代碼狀態失敗，繼續倒數",
      //       error.message
      //     );
      //   }
      // }

      if (currentTime <= 0) {
        Logger.debug("[SyncUI] 分享QR倒數結束，已過期");
        countdownElement.textContent = "有效期已過期";
        if (this.qrCountdownInterval) {
          clearInterval(this.qrCountdownInterval);
          this.qrCountdownInterval = null;
        }
        return;
      }

      const minutes = Math.floor(currentTime / 60);
      const seconds = currentTime % 60;
      countdownElement.textContent = `有效期: ${minutes}:${seconds
        .toString()
        .padStart(2, "0")}`;
      currentTime--;
    };

    updateCountdown(); // 立即更新一次
    this.qrCountdownInterval = setInterval(updateCountdown, 1000);
  }

  /**
   * 處理斷開連線
   */
  async handleDisconnect() {
    const sessionId = this.core.currentSessionId || this.core.getSessionId?.();

    if (!sessionId) {
      this.showStatus("error", "未連線到任何工作階段");
      return;
    }

    if (!confirm("確定要退出同步連線嗎？")) {
      return;
    }

    try {
      this.showStatus("info", "正在退出工作階段...");

      // 停止任何執行的計時器
      if (this.qrCountdownInterval) {
        clearInterval(this.qrCountdownInterval);
        this.qrCountdownInterval = null;
      }

      // 清除localStorage中的session備份
      localStorage.removeItem("sync_session_backup");

      // 通知後端斷開此客戶端
      if (this.core.syncClient) {
        await this.core.syncClient.disconnect();
      }

      // 重置核心狀態
      this.core.currentSessionId = null;
      this.core.currentShareCode = null;
      this.core.currentRole = null;

      // 小延遲確保狀態更新
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 重置分享UI狀態
      const shareSessionContent = document.getElementById(
        "shareSessionContent"
      );
      const shareSessionToggleBtn = document.getElementById(
        "shareSessionToggleBtn"
      );
      if (shareSessionContent) {
        shareSessionContent.classList.add("hidden");
      }
      if (shareSessionToggleBtn) {
        shareSessionToggleBtn.classList.remove("hidden");
      }

      // 更新指示器和UI狀態
      this.updateIndicator();
      this.updateUIState();

      this.showStatus("success", "已退出同步連線");

      // 1.5秒後隱藏面板
      setTimeout(() => {
        this.hidePanel();
      }, 1500);
    } catch (error) {
      this.showStatus("error", `退出失敗: ${error.message}`);
      Logger.error("Disconnect error:", error);
    }
  }

  /**
   * 隱藏控制面板
   */
  hidePanel() {
    this.controlPanel.classList.remove("active");

    // 重新顯示膠囊指示器
    if (this.capsuleIndicator) {
      this.capsuleIndicator.style.display = "";
    }
  }

  /**
   * 清理資源
   */
  cleanup() {
    if (this.capsuleIndicator) {
      this.capsuleIndicator.remove();
    }
    if (this.controlPanel) {
      this.controlPanel.remove();
    }
  }
}

export default SyncManagerUI;
