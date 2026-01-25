/**
 * SyncManager UI - 同步面板 UI 介面管理
 * 負責膠囊指示器、控制面板、按鈕與輸入框
 */

import { SyncEvents } from "../core/sync-events-constants.js";

export class SyncManagerUI {
  // ========== 構造函數 ==========
  constructor(core) {
    this.core = core;
    this.capsuleIndicator = null;
    this.controlPanel = null;
    this.statusElement = null;
    this.currentQRRole = window.SyncManager?.ROLE?.VIEWER;
    this.currentShareCode = null;
    this.qrCountdownInterval = null;
    this.initialized = false;
    this.sharePanelOpened = false;
  }

  // ========== 初始化方法 ==========
  /**
   * 初始化UI - 僅初始化控制面板和事件監聽（膠囊由 SyncManager 單獨建立）
   */
  initialize() {
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

      setTimeout(() => {
        this.updateUIState();
      }, 0);

      this.initialized = true;

      Logger.info("[SyncManagerUI] UI 初始化完成");
    } catch (error) {
      Logger.error("[SyncManagerUI] UI 初始化失敗", error);
    }
  }

  /**
   * 建立膠囊狀態指示器
   */
  createCapsuleIndicator() {
    if (this.capsuleIndicator) {
      Logger.debug("[SyncManagerUI] 膠囊指示器已存在，跳過重複建立");
      return;
    }

    try {
      Logger.debug("[SyncManagerUI] 開始建立膠囊指示器");
      this.capsuleIndicator = document.createElement("div");
      this.capsuleIndicator.className = "sync-capsule-indicator idle";

      const idleStatusText =
        window.SyncManager?.getStatusText("idle") || "未連線";
      this.capsuleIndicator.innerHTML = `
            <div class="sync-status-indicator">
                <div class="sync-status-light"></div>
                <span class="sync-status-text">${idleStatusText}</span>
            </div>
        `;

      const indicator = this.capsuleIndicator.querySelector(
        ".sync-status-indicator"
      );
      if (indicator) {
        indicator.addEventListener("click", () => {
          if (this.initialized) {
            this.showPanel();
          }
        });
      }

      document.body.appendChild(this.capsuleIndicator);
      Logger.debug("[SyncManagerUI] 膠囊指示器已成功建立並附加到 DOM");

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
                        <button class="sync-page-toggle-btn sync-page-panel" data-page="${window.SyncManager?.PAGE?.PANEL}"><span class="btn-text-split"></span></button>
                        <button class="sync-page-toggle-btn sync-page-experiment" data-page="${window.SyncManager?.PAGE?.EXPERIMENT}"><span class="btn-text-split"></span></button>
                    </div>
                    <button class="modal-close-btn" title="關閉">×</button>
                </div>

                <div class="modal-body">
                    <div class="sync-panel-content">
                    <div id="syncConnectionSection" class="sync-connection-section">
                    <div class="sync-create-join-container">
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

                        <div class="sync-ui-divider">
                            <span>或</span>
                        </div>

                        <div class="sync-join-section">
                            <h3>加入工作階段</h3>

                            <div class="sync-role-selector">
                                <button class="sync-role-btn ${window.SyncManager?.ROLE?.VIEWER} active" data-role="${window.SyncManager?.ROLE?.VIEWER}">
                                    檢視者
                                </button>
                                <button class="sync-role-btn ${window.SyncManager?.ROLE?.OPERATOR}" data-role="${window.SyncManager?.ROLE?.OPERATOR}">
                                    操作者
                                </button>
                            </div>

                            <div class="sync-join-input-group">
                                <input type="text"
                                       id="sessionCodeInput"
                                       placeholder="輸入分享代碼"
                                       maxlength="8">
                                <button id="joinSessionBtn">加入</button>
                            </div>

                            <button class="sync-scan-btn" id="scanQrBtn">
                                 掃描 QR Code
                            </button>
                            <div class="sync-scan-hint">
                                掃描其他裝置的 QR Code 加入工作階段
                            </div>
                        </div>
                    </div>
                </div>

                <div id="syncConnectedSection" class="sync-connected-section">
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
                        <div class="sync-session-buttons-container">
                            <div class="sync-session-share-row">
                                <button id="shareSessionToggleBtn" class="sync-share-toggle-btn">
                                    分享此工作階段
                                </button>
                                <div id="shareSessionContent" class="sync-share-content hidden">
                                    <h3>分享此工作階段</h3>

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

                                    <div class="sync-qr-display">
                                        <div id="shareQRCountdown" class="sync-qr-countdown">60</div>
                                        <div class="sync-qr-container">
                                            <div id="shareQRCode" class="sync-qr-code"></div>
                                        </div>
                                    </div>

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
                                    退出工作階段
                                </button>
                                <button id="manageSessionsBtn" class="sync-manage-sessions-btn">
                                    管理工作階段
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div id="syncStatusMessage"></div>
                    </div>
                </div>
            </div>
        `;

    document.documentElement.appendChild(this.controlPanel);
  }

  /**
   * 設定事件監聽器
   */
  setupEventListeners() {
    try {
      window.addEventListener(SyncEvents.SESSION_JOINED, (event) => {
        const detail = event.detail || {};
        const { sessionId, shareCode, role } = detail;
        Logger.debug("[SyncUI] 收到 SESSION_JOINED 事件，更新 shareCode", {
          sessionId,
          shareCode,
          role
        });
        if (shareCode) {
          this.currentShareCode = shareCode;
        }
      });

      window.addEventListener("sync_connected", (event) => {
        Logger.debug(
          "[SyncUI] 收到 SYNC_CONNECTED 事件，更新面板狀態",
          event.detail
        );
        this.updateUIState();
        this.updateIndicator();
        this.updateConnectedSessionInfo();
      });

      window.addEventListener("sync_disconnected", (event) => {
        Logger.debug("[SyncUI] 收到 SYNC_DISCONNECTED 事件，更新面板狀態");
        this.updateUIState();
        this.updateIndicator();
      });

      window.addEventListener("sync_server_status_changed", (event) => {
        const { online, previousOnline } = event.detail;

        this.updateIndicator();

        if (previousOnline && !online) {
          this.showStatus("error", "伺服器已離線");
        } else if (!previousOnline && online) {
          this.showStatus("success", "伺服器已連線");
        }
      });

      window.addEventListener("sync_session_invalid", (event) => {
        const { reason, originalError } = event.detail;

        Logger.warn("[SyncManagerUI] 工作階段失效", { reason, originalError });

        if (reason === "session_not_found") {
          this.showStatus(
            "error",
            "工作階段已失效，請重新加入或建立新工作階段"
          );
        } else {
          this.showStatus("error", "工作階段連線異常");
        }

        this.updateIndicator();
        this.updateConnectedSessionInfo();
      });

      const closeBtn = this.controlPanel.querySelector(".modal-close-btn");
      if (closeBtn) {
        closeBtn.addEventListener("click", () => this.hidePanel());
      }

      const pageToggleButtons = this.controlPanel.querySelectorAll(
        ".sync-page-toggle-btn"
      );
      if (pageToggleButtons.length > 0) {
        const panelBtn = this.controlPanel.querySelector("[data-page='panel']");
        const experimentBtn = this.controlPanel.querySelector(
          "[data-page='experiment']"
        );

        const panelName =
          window.SyncManager?.getPageName(window.SyncManager?.PAGE?.PANEL) ||
          "機台面板";
        const experimentName =
          window.SyncManager?.getPageName(
            window.SyncManager?.PAGE?.EXPERIMENT
          ) || "實驗管理";

        if (panelBtn) {
          panelBtn.querySelector(".btn-text-split").textContent = panelName;
          panelBtn.title = `切換至${panelName}`;
        }
        if (experimentBtn) {
          experimentBtn.querySelector(".btn-text-split").textContent =
            experimentName;
          experimentBtn.title = `切換至${experimentName}`;
        }

        this.updatePageToggleButtonState();

        pageToggleButtons.forEach((btn) => {
          btn.addEventListener("click", () => {
            const targetPage = btn.dataset.page;
            const basePath = window.location.pathname.substring(
              0,
              window.location.pathname.lastIndexOf("/") + 1
            );

            let targetUrl;
            if (targetPage === window.SyncManager?.PAGE?.PANEL) {
              targetUrl = basePath.endsWith("/") ? basePath : basePath + "/";
            } else if (targetPage === window.SyncManager?.PAGE?.EXPERIMENT) {
              const experimentPath =
                window.SyncManager?.getPagePath(
                  window.SyncManager?.PAGE?.EXPERIMENT
                ) || "experiment.html";
              targetUrl = basePath + experimentPath;
            }

            window.location.href = targetUrl;
          });
        });
      }

      this.controlPanel.addEventListener("click", (e) => {
        if (e.target === this.controlPanel) {
          this.hidePanel();
        }
      });

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

      createBtn.addEventListener("click", () => {
        if (createCodeInput.value.length === 9) {
          this.handleCreateSession();
        }
      });

      const qrRoleButtons =
        this.controlPanel.querySelectorAll(".sync-qr-role-btn");
      qrRoleButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
          qrRoleButtons.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          this.currentQRRole = btn.dataset.role;

          const sessionId = this.core.getSessionId();
          if (sessionId) {
            window.dispatchEvent(
              new CustomEvent("sync_generate_qr", {
                detail: { sessionId, role: this.currentQRRole }
              })
            );
          }
        });
      });

      const roleButtons = this.controlPanel.querySelectorAll(".sync-role-btn");

      const savedRole = localStorage.getItem("sync_preferred_role");
      if (savedRole) {
        roleButtons.forEach((btn) => {
          if (btn.dataset.role === savedRole) {
            btn.classList.add("active");
          } else {
            btn.classList.remove("active");
          }
        });
        Logger.debug("[SyncUI] 初始化：恢復儲存的角色偏好:", savedRole);
      }

      roleButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
          roleButtons.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          this.core.currentRole = btn.dataset.role;

          localStorage.setItem("sync_preferred_role", btn.dataset.role);
          Logger.debug("[SyncUI] 角色已切換並儲存:", btn.dataset.role);
        });
      });

      const roleCard = document.getElementById("roleCard");
      if (roleCard) {
        roleCard.addEventListener("click", () => {
          try {
            const currentRole =
              this.core.syncClient?.role || window.SyncManager?.ROLE?.VIEWER;
            const newRole =
              currentRole === window.SyncManager?.ROLE?.OPERATOR
                ? window.SyncManager?.ROLE?.VIEWER
                : window.SyncManager?.ROLE?.OPERATOR;

            if (this.core.syncClient) {
              this.core.syncClient.role = newRole;
              this.core.syncClient.saveRole(newRole);
            }

            try {
              localStorage.setItem("sync_preferred_role", newRole);
              Logger.debug(`[同步面板] 角色已儲存到快取: ${newRole}`);
            } catch (error) {
              Logger.warn("[同步面板] 無法儲存角色到快取:", error);
            }

            this.updateConnectedSessionInfo();

            this.showStatus(
              "info",
              `角色已切換為: ${window.SyncManager?.getStatusText(newRole)}`
            );
          } catch (error) {
            Logger.error("角色切換失敗:", error);
            this.showStatus("error", "角色切換失敗", error && error.message);
          }
        });
      }

      const joinBtn = document.getElementById("joinSessionBtn");
      joinBtn.addEventListener("click", () => this.handleJoinSession());

      const sessionCodeInput = document.getElementById("sessionCodeInput");
      sessionCodeInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          this.handleJoinSession();
        }
      });

      const scanBtn = document.getElementById("scanQrBtn");
      scanBtn.addEventListener("click", () => {
        window.dispatchEvent(new Event("sync_start_qr_scan"));
      });

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
          shareSessionContent.classList.remove("hidden");
          shareSessionToggleBtn.classList.add("hidden");

          this.initializeShareCode();
        });
      }

      if (shareSessionCollapseBtn && shareSessionContent) {
        shareSessionCollapseBtn.addEventListener("click", () => {
          shareSessionContent.classList.add("hidden");
          if (shareSessionToggleBtn) {
            shareSessionToggleBtn.classList.remove("hidden");
          }

          if (this.qrCountdownInterval) {
            clearInterval(this.qrCountdownInterval);
            this.qrCountdownInterval = null;
          }
        });
      }

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
                  "<svg class=\"sync-icon sync-icon-checkmark\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z\"/></svg>";
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

      const disconnectBtn = document.getElementById("disconnectBtn");
      if (disconnectBtn) {
        disconnectBtn.addEventListener("click", () => {
          this.handleDisconnect();
        });
      }

      const manageSessionsBtn = document.getElementById("manageSessionsBtn");
      if (manageSessionsBtn) {
        manageSessionsBtn.addEventListener("click", () => {
          window.dispatchEvent(new Event("sync_show_sessions"));
        });
      }

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
            Logger.debug("[SyncUI] regenerateShareCode() 回傳結果", {
              result,
              type: typeof result,
              keys: result ? Object.keys(result) : "null"
            });
            if (result) {
              const newShareCode = result.shareCode;
              Logger.debug("[SyncUI] 從結果中提取新分享代碼", { newShareCode });
              this.currentShareCode = newShareCode;

              const shareDisplayCode =
                document.getElementById("shareDisplayCode");
              if (shareDisplayCode) {
                shareDisplayCode.textContent = newShareCode;
              }

              Logger.debug("[SyncUI] 重新產生分享代碼成功", { newShareCode });

              const remainingTime = result.remainingTime || 300;
              this.startShareQRCountdown(remainingTime);

              window.dispatchEvent(
                new CustomEvent("sync_generate_qr", {
                  detail: {
                    shareCode: newShareCode,
                    role: this.core.syncClient.role,
                    isShareCode: true
                  }
                })
              );

              this.showStatus("success", "已重新產生分享代碼");
            }
          } catch (error) {
            Logger.error("[SyncUI] 重新產生分享代碼失敗:", error);
            this.showStatus(
              "error",
              "重新產生分享代碼失敗",
              error && error.message
            );
          } finally {
            regenerateShareCodeBtn.disabled = false;
            regenerateShareCodeBtn.style.opacity = "1";
          }
        });
      }

      const copyShareLinkBtn = document.getElementById("copyShareLinkBtn");
      if (copyShareLinkBtn) {
        copyShareLinkBtn.addEventListener("click", async () => {
          const shareCode =
            document.getElementById("shareDisplayCode")?.textContent;
          if (!shareCode || shareCode === "-") {
            this.showStatus("error", "沒有分享代碼");
            return;
          }

          try {
            const shareUrl = this.core.generateQRContent(
              shareCode,
              this.core.syncClient?.role || window.SyncManager?.ROLE?.VIEWER
            );

            await navigator.clipboard.writeText(shareUrl);

            this.showStatus("success", "已複製分享連結");

            const originalHTML = copyShareLinkBtn.innerHTML;
            copyShareLinkBtn.innerHTML =
              "<svg class=\"sync-icon sync-icon-checkmark\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z\"/></svg>";
            copyShareLinkBtn.classList.add("copied");

            setTimeout(() => {
              copyShareLinkBtn.innerHTML = originalHTML;
              copyShareLinkBtn.classList.remove("copied");
            }, 2000);
          } catch (error) {
            Logger.debug("複製分享連結失敗:", error);
            this.showStatus(
              "error",
              "分享連結複製失敗",
              error && error.message
            );
          }
        });
      }
    } catch (error) {
      Logger.error("[SyncManagerUI] 事件監聽器設定失敗:", error);
    }
  }

  // ========== 驗證方法 ==========
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
      statusDiv.innerHTML =
        "<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"></line><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"></line></svg>";
      createBtn.disabled = true;
    } else if (code.length === 9) {
      statusDiv.className = "sync-code-validation-indicator valid";
      statusDiv.innerHTML =
        "<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"20,6 9,17 4,12\"></polyline></svg>";
      createBtn.disabled = false;
    }
  }

  // ========== 業務邏輯 - 工作階段操作 ==========
  /**
   * 處理建立工作階段
   */
  async handleCreateSession() {
    const input = document.getElementById("createCodeInput");
    const code = input.value.trim();

    if (code.length !== 9) {
      this.showStatus("error", "請輸入有效代碼");
      return;
    }

    this.showStatus("info", "建立中...");

    try {
      const result = await this.core.createSession(code);
      const sessionId = result.sessionId;

      this.showStatus("success", "建立成功");
      this.updateIndicator();
      this.updateUIState();
      this.updateConnectedSessionInfo();

      const shareDisplayCode = document.getElementById("shareDisplayCode");
      if (shareDisplayCode) {
        shareDisplayCode.textContent = "點擊「產生分享代碼」按鈕";
      }

      this.currentQRRole = window.SyncManager?.ROLE?.VIEWER;

      window.dispatchEvent(
        new CustomEvent("sync_session_created", {
          detail: { sessionId }
        })
      );

      input.value = "";

      Logger.info("[SyncManagerUI] 工作階段建立成功", { sessionId });
    } catch (error) {
      this.showStatus("error", "建立工作階段失敗", error && error.message);
      Logger.error("[SyncManagerUI] 建立工作階段失敗:", error);
    }
  }

  /**
   * 處理產生分享代碼
   */
  async handleGenerateShareCode() {
    this.showStatus("info", "產生中...");

    try {
      const result = await this.core.generateShareCode();
      this.currentShareCode = result.shareCode;

      this.showStatus("success", "分享代碼已產生");

      const shareDisplayCode = document.getElementById("shareDisplayCode");
      if (shareDisplayCode) {
        shareDisplayCode.textContent = result.shareCode;
      }

      const qrRoleButtons =
        this.controlPanel.querySelectorAll(".sync-qr-role-btn");
      qrRoleButtons.forEach((btn) => {
        if (btn.dataset.role === window.SyncManager?.ROLE?.VIEWER) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });

      Logger.info("[SyncManagerUI] 分享代碼已產生", {
        shareCode: result.shareCode
      });
    } catch (error) {
      this.showStatus("error", "產生失敗", error && error.message);
      Logger.error("[SyncManagerUI] 產生分享代碼失敗:", error);
    }
  }

  /**
   * 處理加入工作階段
   */
  async handleJoinSession() {
    const input = document.getElementById("sessionCodeInput");
    const code = input.value.trim().toUpperCase();

    Logger.debug("[SyncUI] 使用者嘗試加入工作階段，分享代碼:", code);

    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      Logger.warn(
        "[SyncUI] 分享代碼格式錯誤 - 長度:",
        code.length,
        "內容:",
        code
      );
      this.showStatus("error", "請輸入有效之分享代碼");
      return;
    }

    const savedRole = localStorage.getItem("sync_preferred_role");
    const activeRoleBtn = this.controlPanel.querySelector(
      ".sync-role-btn.active"
    );
    let role = activeRoleBtn
      ? activeRoleBtn.dataset.role
      : window.SyncManager?.ROLE?.VIEWER;

    if (savedRole) {
      role = savedRole;
      const roleButtons = this.controlPanel.querySelectorAll(".sync-role-btn");
      roleButtons.forEach((btn) => {
        if (btn.dataset.role === savedRole) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });
      Logger.debug("[SyncUI] 使用儲存的角色偏好:", role);
    }

    this.showStatus("info", "加入中...");

    try {
      await this.core.joinSessionByShareCode(code, role);

      const roleText = window.SyncManager?.getRoleText(role);
      this.showStatus("success", `加入成功（${roleText}）`);
      this.updateIndicator();
      this.updateUIState();
      this.updateConnectedSessionInfo();

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

      if (this.currentShareCode) {
        window.dispatchEvent(
          new CustomEvent("sync_generate_qr", {
            detail: { shareCode: this.currentShareCode, role }
          })
        );
      }

      input.value = "";
    } catch (error) {
      this.showStatus("error", error.message || "加入工作階段失敗");
    }
  }

  /**
   * 處理退出工作階段（手動觸發）
   */
  async handleDisconnect() {
    const sessionId = this.core.currentSessionId || this.core.getSessionId?.();

    if (!sessionId) {
      this.showStatus("error", "未連線到任何工作階段");
      return;
    }

    if (!confirm("確定要退出工作階段嗎？")) {
      return;
    }

    try {
      this.showStatus("info", "正在退出工作階段...");

      if (this.qrCountdownInterval) {
        clearInterval(this.qrCountdownInterval);
        this.qrCountdownInterval = null;
      }

      localStorage.removeItem("sync_session_backup");

      if (this.core.syncClient) {
        await this.core.syncClient.disconnect();
      }

      this.core.currentSessionId = null;
      this.core.currentShareCode = null;
      this.core.currentRole = null;

      await new Promise((resolve) => setTimeout(resolve, 100));

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

      this.updateIndicator();
      this.updateUIState();

      this.showStatus("success", "已退出工作階段");

      setTimeout(() => {
        this.hidePanel();
      }, 1500);
    } catch (error) {
      this.showStatus("error", "退出工作階段失敗", error && error.message);
      Logger.error("Disconnect error:", error);
    }
  }

  // ========== 業務邏輯 - 分享代碼管理 ==========
  /**
   * 初始化分享代碼和 QR Code
   */
  async initializeShareCode() {
    Logger.debug("[SyncUI] 開始初始化分享代碼和 QR Code ");

    this.sharePanelOpened = true;

    let shareCode = this.currentShareCode;
    Logger.debug("[SyncUI] 目前分享代碼", { shareCode });

    if (shareCode) {
      Logger.debug("[SyncUI] 使用現有分享代碼立即產生QR", { shareCode });

      const shareDisplayCode = document.getElementById("shareDisplayCode");
      if (shareDisplayCode) {
        shareDisplayCode.textContent = shareCode;
      }

      Logger.debug("[SyncUI] 並行啟動 QR Code 產生", { shareCode });
      window.dispatchEvent(
        new CustomEvent("sync_generate_qr", {
          detail: {
            shareCode: shareCode,
            role:
              this.core.syncClient?.role ||
              window.SyncManager?.ROLE?.VIEWER ||
              "viewer",
            isShareCode: true
          }
        })
      );

      this.validateAndRefreshShareCodeInBackground(shareCode);
    } else {
      Logger.debug("[SyncUI] 無現有分享代碼，需要產生新的");
      await this.regenerateAndDisplayShareCode();
    }
  }

  /**
   * 在背景驗證分享代碼
   */
  async validateAndRefreshShareCodeInBackground(shareCode) {
    try {
      Logger.debug("[SyncUI] 背景驗證分享代碼", { shareCode });
      const shareCodeInfo = await this.core.getShareCodeInfo(shareCode);

      const isValid = !shareCodeInfo.used && !shareCodeInfo.expired;

      if (isValid) {
        Logger.debug("[SyncUI] 分享代碼驗證有效，啟動倒計時", {
          remainingTime: shareCodeInfo.remainingTime
        });
        this.startShareQRCountdown(shareCodeInfo.remainingTime);
      } else {
        Logger.debug(
          "[SyncUI] 分享代碼無效（已使用或已過期），重新產生新的代碼",
          {
            used: shareCodeInfo.used,
            expired: shareCodeInfo.expired
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
   */
  updateShareCodeStatus(statusText, statusClass) {
    const shareDisplayCode = document.getElementById("shareDisplayCode");
    if (shareDisplayCode) {
      shareDisplayCode.classList.remove(
        "share-code-valid",
        "share-code-used",
        "share-code-expired"
      );
      shareDisplayCode.classList.add(`share-code-${statusClass}`);
      const code =
        this.currentShareCode ||
        shareDisplayCode.textContent.replace(/\s*\([^)]*\)$/, "");
      shareDisplayCode.textContent = `${code} (${statusText})`;
    }

    const statusIndicator = document.getElementById("shareCodeStatusIndicator");
    if (statusIndicator) {
      statusIndicator.className = `share-code-status-indicator status-${statusClass}`;
      statusIndicator.textContent = statusText;
    }
  }

  /**
   * 重新產生分享代碼並顯示
   */
  async regenerateAndDisplayShareCode() {
    try {
      if (!this.core.syncClient) {
        throw new Error("SyncClient 未初始化");
      }

      Logger.debug("[SyncUI] 透過 SyncClient 請求產生新分享代碼");

      const result = await this.core.generateShareCode();

      const shareCode = result.shareCode;
      Logger.debug("[SyncUI] 成功產生新分享代碼", { shareCode });

      this.currentShareCode = shareCode;

      const shareDisplayCode = document.getElementById("shareDisplayCode");
      if (shareDisplayCode) {
        shareDisplayCode.textContent = shareCode;
      }

      Logger.debug("[SyncUI] 並行啟動 QR Code 產生（新代碼）", { shareCode });
      window.dispatchEvent(
        new CustomEvent("sync_generate_qr", {
          detail: {
            shareCode: shareCode,
            role:
              this.core.syncClient?.role ||
              window.SyncManager?.ROLE?.VIEWER ||
              "viewer",
            isShareCode: true
          }
        })
      );

      this.startShareQRCountdown(300);
    } catch (error) {
      Logger.error("[SyncUI] 產生新分享代碼失敗:", error);
      throw error;
    }
  }

  /**
   * 啟動分享 QR Code 倒數計時
   */
  startShareQRCountdown(remainingTime = null) {
    Logger.debug("[SyncUI] 開始分享 QR Code 倒數計時", { remainingTime });

    const countdownElement = document.getElementById("shareQRCountdown");
    if (!countdownElement) {
      Logger.warn("[SyncUI] 找不到倒數計時元素 (shareQRCountdown)");
      return;
    }

    if (this.qrCountdownInterval) {
      clearInterval(this.qrCountdownInterval);
    }

    let currentTime = remainingTime !== null ? remainingTime : 300;
    Logger.debug("[SyncUI] 使用倒數時間", {
      currentTime,
      provided: remainingTime !== null
    });

    const updateCountdown = async () => {
      if (currentTime <= 0) {
        Logger.debug("[SyncUI] 分享 QR Code 倒數結束，已過期");
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

    updateCountdown();
    this.qrCountdownInterval = setInterval(updateCountdown, 1000);
  }

  // ========== UI 更新方法 ==========
  /**
   * 更新膠囊指示器
   */
  updateIndicator() {
    if (!this.capsuleIndicator) {
      Logger.warn(
        "[SyncManagerUI] capsuleIndicator 不存在，UI 初始化可能失敗或未執行",
        {
          hasCore: !!this.core,
          timestamp: new Date().toISOString()
        }
      );
      return;
    }

    const status = this.core.getStatusText();
    const isConnected = this.core.isConnected();

    this.capsuleIndicator.classList.remove(
      "offline",
      "online",
      "idle",
      "viewer",
      "operator"
    );

    if (isConnected && status !== window.SyncManager?.STATUS?.OFFLINE) {
      this.capsuleIndicator.classList.add("online", status);
    } else {
      this.capsuleIndicator.classList.add("offline", status);
    }

    const textMap = {
      offline:
        window.SyncManager?.getStatusText(
          window.SyncManager?.STATUS?.OFFLINE
        ) || "已離線",
      idle:
        window.SyncManager?.getStatusText(window.SyncManager?.STATUS?.IDLE) ||
        "未同步",
      viewer:
        window.SyncManager?.getStatusText(window.SyncManager?.ROLE?.VIEWER) ||
        "僅檢視",
      operator:
        window.SyncManager?.getStatusText(window.SyncManager?.ROLE?.OPERATOR) ||
        "同步中"
    };

    const statusText = this.capsuleIndicator.querySelector(".sync-status-text");
    if (statusText) {
      statusText.textContent = textMap[status] || "已離線";
    }

    this.updateUIState();
  }

  /**
   * 更新UI狀態
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
      }
    } catch (error) {
      Logger.warn("[SyncManagerUI] updateUIState 錯誤:", error);
    }
  }

  /**
   * 更新已連線狀態下的工作階段資訊
   */
  updateConnectedSessionInfo() {
    try {
      const sessionId = this.core.getSessionId();
      const role = this.core.syncClient?.role || "-";
      const status = this.core.getStatusText();

      const statusTextMap = {
        offline:
          window.SyncManager?.getStatusText(
            window.SyncManager?.STATUS?.OFFLINE
          ) || "已離線",
        idle:
          window.SyncManager?.getStatusText(window.SyncManager?.STATUS?.IDLE) ||
          "未同步",
        viewer:
          window.SyncManager?.getStatusText(window.SyncManager?.ROLE?.VIEWER) ||
          "僅檢視",
        operator:
          window.SyncManager?.getStatusText(
            window.SyncManager?.ROLE?.OPERATOR
          ) || "同步中"
      };

      const sessionIdSpan = document.getElementById(
        "connectedDisplaySessionId"
      );
      const roleSpan = document.getElementById("connectedDisplayRole");
      const statusSpan = document.getElementById("connectedDisplayStatus");

      if (sessionIdSpan) {
        sessionIdSpan.textContent = sessionId || "-";
      }
      if (roleSpan) {
        roleSpan.textContent = window.SyncManager?.getRoleText(role);
      }
      if (statusSpan) {
        const statusMap = {
          viewer:
            window.SyncManager?.getStatusText(
              window.SyncManager?.ROLE?.VIEWER
            ) || "僅檢視",
          operator:
            window.SyncManager?.getStatusText(
              window.SyncManager?.ROLE?.OPERATOR
            ) || "同步中"
        };
        statusSpan.textContent =
          statusMap[role] || statusTextMap[status] || status;
      }
    } catch (error) {
      Logger.warn("[SyncManagerUI] updateConnectedSessionInfo 錯誤:", error);
    }
  }

  /**
   * 更新頁面切換按鈕的 active 狀態
   */
  updatePageToggleButtonState() {
    const currentPath = window.location.pathname;
    let currentPage = "panel";

    const experimentPath =
      window.SyncManager?.getPagePath(window.SyncManager?.PAGE?.EXPERIMENT) ||
      "experiment.html";
    if (currentPath.includes(experimentPath)) {
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

  // ========== UI 顯示方法 ==========
  /**
   * 顯示狀態訊息
   */
  showStatus(type, message, errorDetail) {
    const statusElement = document.getElementById("syncStatusMessage");
    if (!statusElement) {
      return;
    }

    statusElement.className = `sync-status-message ${type}`;

    let displayMessage = message;
    if (type === "error" && errorDetail) {
      const full = String(errorDetail);
      const truncated = full.length > 140 ? full.slice(0, 140) + "…" : full;
      displayMessage = `${message}: ${truncated}`;
      statusElement.title = full;
    } else {
      statusElement.title = "";
    }

    statusElement.textContent = displayMessage;
    statusElement.style.display = "block";

    if (type !== "success") {
      setTimeout(() => {
        if (statusElement && statusElement.textContent === displayMessage) {
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

    if (this.capsuleIndicator) {
      this.capsuleIndicator.style.display = "none";
    }

    this.controlPanel.classList.add("active");

    this.updatePageToggleButtonState();

    this.updateUIState();
  }

  /**
   * 隱藏控制面板
   */
  hidePanel() {
    this.controlPanel.classList.remove("active");

    if (this.capsuleIndicator) {
      this.capsuleIndicator.style.display = "";
    }
  }

  // ========== 清理方法 ==========
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
