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
  }

  /**
   * 初始化UI
   */
  initialize() {
    // 防止重複初始化
    if (this.initialized) {
      Logger.debug("[SyncManagerUI] UI 已初始化，跳過重複動作");
      return;
    }
    
    Logger.info("[SyncManagerUI] 開始初始化 UI");
    try {
      Logger.debug("[SyncManagerUI] 步驟 1/4: 建立膠囊指示器...");
      this.createCapsuleIndicator();
      Logger.debug("[SyncManagerUI] 步驟 2/4: 建立控制面板...");
      this.createControlPanel();
      Logger.debug("[SyncManagerUI] 步驟 3/4: 設置事件監聽...");
      this.setupEventListeners();
      Logger.debug("[SyncManagerUI] 步驟 4/4: 更新指示器...");
      this.updateIndicator();

      // 使用 setTimeout 確保 DOM 已完全渲染後再更新 UI 狀態
      setTimeout(() => {
        this.updateUIState();
      }, 0);

      // 標記為已初始化
      this.initialized = true;
      
      // 註：工作階段還原由 SyncManager 統一負責，不在此執行
      Logger.info("[SyncManagerUI] UI 初始化完成");
    } catch (error) {
      Logger.error("[SyncManagerUI] UI 初始化失敗", error);
      // Initialize failed, will create new session on demand
    }
  }

  /**
   * 儲存Session資訊到localStorage
   */
  saveSessionBackup(sessionId, role, clientId = null) {
    const sessionData = {
      sessionId,
      role,
      clientId: clientId || this.core?.syncClient?.clientId || null, // 安全存取
      deviceToken: this.core?.syncClient?.deviceToken || null, // 新增：儲存裝置簽章
      createdAt: Date.now(),
    };
    localStorage.setItem("sync_session_backup", JSON.stringify(sessionData));
  }

  /**
   * 清空已儲存的Session資訊
   */
  clearSessionBackup() {
    localStorage.removeItem("sync_session_backup");
  }

  /**
   * 建立膠囊狀態指示器
   */
  createCapsuleIndicator() {
    Logger.debug("[SyncManagerUI] 開始建立膠囊指示器");
    this.capsuleIndicator = document.createElement("div");
    this.capsuleIndicator.className = "sync-capsule-indicator offline";

    this.capsuleIndicator.innerHTML = `
            <div class="sync-status-indicator">
                <div class="sync-status-light"></div>
                <span class="sync-status-text">離線</span>
            </div>
        `;

    // 點擊膠囊打開面板
    this.capsuleIndicator
      .querySelector(".sync-status-indicator")
      .addEventListener("click", () => {
        this.showPanel();
      });

    // 將膠囊指示器附加到 body
    document.body.appendChild(this.capsuleIndicator);
    Logger.debug("[SyncManagerUI] 膠囊指示器已成功建立並附加到 DOM");
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
            if (result) {
              const newShareCode = result.shareCode;
              this.currentShareCode = newShareCode;

              // 立即更新 UI（不等待其他操作）
              const shareDisplayCode =
                document.getElementById("shareDisplayCode");
              if (shareDisplayCode) {
                shareDisplayCode.textContent = newShareCode;
              }

              Logger.debug("[SyncUI] 重新產生分享代碼成功", { newShareCode });

              // 並行執行：倒計時和 QR 生成
              // 1. 倒計時使用預設值（回應中可能包含剩餘時間）
              const remainingTime = result.remainingTime || 300;
              this.startShareQRCountdown(remainingTime);

              // 2. 非同步生成 QR code（不阻擋 UI）
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
            // 生成完整的分享連結
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
   * 處理建立工作階段
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
      const result = await this.core.createSession(code);
      const sessionId = result.sessionId;
      const shareCode = result.shareCode;

      // 建立成功後，建立者自動用分享代碼加入（以便取得 clientId）
      // 這是必要的，因為建立者需要連線到工作階段才能使用同步功能
      try {
        await this.core.joinSessionByShareCode(shareCode, "operator");
        const clientId = this.core.syncClient.clientId;
        this.saveSessionBackup(sessionId, "operator", clientId);
      } catch (joinError) {
        Logger.error("自動加入工作階段失敗:", joinError);
        // 如果自動加入失敗，這意味著建立者無法使用同步功能
        // 應該顯示錯誤而不是成功
        this.showStatus(
          "error",
          `工作階段建立成功但無法加入: ${joinError.message}`
        );
        return;
      }

      this.currentShareCode = shareCode;

      this.showStatus("success", "工作階段建立成功！");
      this.updateIndicator();
      this.updateUIState();
      this.updateConnectedSessionInfo();

      // 更新連線後的分享代碼顯示（但暫不生成 QR code）
      const shareDisplayCode = document.getElementById("shareDisplayCode");
      if (shareDisplayCode) {
        shareDisplayCode.textContent = shareCode;
      }

      // 重置預設模式為僅檢視
      this.currentQRRole = "viewer";

      // 通知工作階段管理面板有新的工作階段
      window.dispatchEvent(
        new CustomEvent("sync_session_created", {
          detail: { sessionId, shareCode },
        })
      );
      const qrRoleButtons =
        this.controlPanel.querySelectorAll(".sync-qr-role-btn");
      qrRoleButtons.forEach((btn) => {
        if (btn.dataset.role === "viewer") {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });

      //改善：不在此處生成 QR code，而是等待使用者展開分享內容時再生成
      // 使用者點擊「展開分享」按鈕時會調用 initializeShareCode()

      input.value = "";
      this.validateCreateCode("");
    } catch (error) {
      this.showStatus("error", error.message || "建立工作階段失敗");
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
      const clientId = this.core.syncClient.clientId; // 取得 clientId

      // 儲存Session資訊（使用真實的 sessionId，而不是分享代碼）
      this.saveSessionBackup(actualSessionId, role, clientId);

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
      Logger.warn("[SyncManagerUI] capsuleIndicator 不存在，UI 初始化可能失敗或未執行", {
        hasCore: !!this.core,
        timestamp: new Date().toISOString()
      });
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

    // 取得目前分享代碼
    let shareCode = this.currentShareCode;
    Logger.debug("[SyncUI] 目前分享代碼", { shareCode });

    // 檢查現有分享代碼是否仍然有效
    let needNewShareCode = !shareCode;
    let shareCodeInfo = null;

    if (shareCode) {
      try {
        Logger.debug("[SyncUI] 檢查現有分享代碼狀態", { shareCode });
        shareCodeInfo = await this.core.getShareCodeInfo(shareCode);

        // 如果分享代碼已被使用或已過期，需要重新產生
        if (shareCodeInfo.used || shareCodeInfo.expired) {
          Logger.debug("[SyncUI] 現有分享代碼已無效，需要重新產生", {
            used: shareCodeInfo.used,
            expired: shareCodeInfo.expired,
          });
          needNewShareCode = true;
        }
      } catch (error) {
        Logger.warn("[SyncUI] 無法檢查分享代碼狀態，將重新產生", error);
        needNewShareCode = true;
      }
    }

    if (needNewShareCode) {
      Logger.debug("[SyncUI] 需要重新產生分享代碼");
      try {
        const sessionId = this.core.getSessionId();
        if (!sessionId) {
          throw new Error("未設定工作階段 ID");
        }

        Logger.debug("[SyncUI] 向伺服器請求重新產生分享代碼", { sessionId });
        const response = await fetch("php/sync-api.php", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: `action=regenerate_share_code&sessionId=${encodeURIComponent(
            sessionId
          )}`,
        });

        const result = await response.json();
        if (result.success && result.data) {
          shareCode = result.data.shareCode || result.data.newShareCode;
          this.currentShareCode = shareCode;
          Logger.debug("[SyncUI] 成功重新產生分享代碼", { shareCode });
          // 已獲得新代碼，直接設定 shareCodeInfo 中的餘時（來自回應）
          if (result.data.remainingTime !== undefined) {
            shareCodeInfo = {
              remainingTime: result.data.remainingTime,
              createdAt: result.data.createdAt,
              expiresAt: result.data.expiresAt,
              used: false,
              expired: false,
            };
          }
        } else {
          throw new Error("無法產生新的分享代碼");
        }
      } catch (error) {
        Logger.error("[SyncUI] 無法產生分享代碼:", error);
        shareCode = this.core.getSessionId();
        this.currentShareCode = shareCode;
        Logger.warn("[SyncUI] 使用工作階段ID作為分享代碼", { shareCode });
      }
    }

    // 更新分享代碼顯示
    const shareDisplayCode = document.getElementById("shareDisplayCode");
    if (shareDisplayCode) {
      shareDisplayCode.textContent = shareCode;
    }

    // 如果還沒有 shareCodeInfo，取得一次
    if (!shareCodeInfo) {
      try {
        Logger.debug("[SyncUI] 取得分享代碼資訊", { shareCode });
        shareCodeInfo = await this.core.getShareCodeInfo(shareCode);
      } catch (error) {
        Logger.warn("[SyncUI] 無法取得分享代碼資訊", error);
        shareCodeInfo = { remainingTime: null };
      }
    }

    const remainingTime = shareCodeInfo?.remainingTime;

    // 並行執行：生成 QR code 和啟動倒計時
    Logger.debug("[SyncUI] 並行啟動QR code生成和倒數計時", {
      shareCode,
      remainingTime,
    });

    // 立即啟動倒計時
    this.startShareQRCountdown(remainingTime);

    // 異步生成 QR code（不等待）
    window.dispatchEvent(
      new CustomEvent("sync_generate_qr", {
        detail: {
          shareCode: shareCode,
          role: this.core.syncClient?.role || "viewer",
          isShareCode: true,
        },
      })
    );
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
      // 每10秒檢查一次分享代碼狀態（減少伺服器負擔）
      if (currentTime % 10 === 0 && this.currentShareCode) {
        try {
          const shareCodeInfo = await this.core.getShareCodeInfo(
            this.currentShareCode
          );
          if (shareCodeInfo.used) {
            Logger.debug("[SyncUI] 分享代碼已被使用，更新顯示狀態");
            countdownElement.textContent = "分享代碼已使用";
            if (this.qrCountdownInterval) {
              clearInterval(this.qrCountdownInterval);
              this.qrCountdownInterval = null;
            }
            return;
          }
        } catch (error) {
          // 忽略檢查錯誤，繼續倒數
          Logger.debug(
            "[SyncUI] 檢查分享代碼狀態失敗，繼續倒數",
            error.message
          );
        }
      }

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
