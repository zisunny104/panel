/**
 * SyncManager UI - 同步面板 UI 介面管理
 * 負責膠囊指示器、控制面板、按鈕與輸入框
 */

import { SYNC_EVENTS } from "../constants/index.js";
import { UIModal } from "../ui/modal.js";
import { Logger } from "../core/console-manager.js";

export class SyncManagerUI {
  constructor(core, config = {}) {
    this.core = core;
    this.syncManager = config.syncManager || null;
    this.roleConfig = config.roleConfig || this.syncManager?.ROLE || {
      VIEWER: "viewer",
      OPERATOR: "operator",
      LOCAL: "local",
    };
    this.pageConfig = config.pageConfig || this.syncManager?.PAGE || {
      PANEL: "panel",
      BOARD: "board",
    };
    this.statusConfig = config.statusConfig || this.syncManager?.STATUS || {
      IDLE: "idle",
      OFFLINE: "offline",
      VIEWER: "viewer",
      OPERATOR: "operator",
    };
    this.qrManager = config.qrManager || null;
    this.indicatorManager = config.indicatorManager || null;
    this.capsuleIndicator = null;
    this.controlPanel = null;
    this.controlPanelModal = null;
    this.statusElement = null;
    this.currentQRRole = this.roleConfig.VIEWER;
    this.currentShareCode = null;
    this.initialized = false;
    this.sharePanelOpened = false;
    this.eventListeners = []; // 記錄全域事件監聽器
    this.domListeners = []; // 記錄 DOM 元素事件監聽器
    this._windowListenersBound = false;
  }

  getRoleText(role) {
    return this.syncManager?.getRoleText?.(role) || role;
  }

  getStatusText(status) {
    return this.syncManager?.getStatusText?.(status) || status;
  }

  getPageName(pageKey) {
    return this.syncManager?.getPageName?.(pageKey) || pageKey;
  }

  getPagePath(pageKey) {
    return this.syncManager?.getPagePath?.(pageKey) || pageKey;
  }

  /**
   * 初始化 UI
   */
  initialize() {
    if (this.initialized) {
      Logger.debug("[SyncManagerUI.initialize] 已初始化，跳過");
      return;
    }

    const initStart = performance.now();

    Logger.debug("[SyncManagerUI.initialize] 開始初始化");
    try {
      this.createCapsuleIndicator();
      this.setupEventListeners();
      this.updateIndicator();

      setTimeout(() => {
        this.updateUIState();
      }, 0);

      this.initialized = true;

      const duration = performance.now() - initStart;
      Logger.debug(
        `[SyncManagerUI.initialize] 完成 (<orange>${duration.toFixed(0)} ms</orange>)`,
      );
      Logger.debug(
        `UI 初始化完成 (<orange>${duration.toFixed(0)} ms</orange>)`,
      );
    } catch (error) {
      Logger.error("UI 初始化失敗", error);
    }
  }

  createCapsuleIndicator() {
    Logger.debug("[SyncManagerUI.createCapsuleIndicator] 開始建立膠囊指示器");
    if (this.indicatorManager) {
      this.capsuleIndicator = this.indicatorManager.createCapsuleIndicator(
        () => {
          Logger.debug(
            `[SyncManagerUI] 膠囊指示器被點擊，initialized=${this.initialized}`,
          );
          if (!this.initialized) {
            this.showStatus("error", "同步面板尚未初始化");
            Logger.error(
              "[SyncManagerUI] <red>同步面板尚未初始化</red>",
            );
            return;
          }
          Logger.debug("[SyncManagerUI] 呼叫 showPanel()");
          this.showPanel();
        },
      );
      Logger.debug("[SyncManagerUI.createCapsuleIndicator] 完成");
    } else {
      Logger.debug("[SyncManagerUI.createCapsuleIndicator] indicatorManager 不存在");
    }
  }

  createControlPanel() {
    Logger.debug("[SyncManagerUI.createControlPanel] 開始建立控制面板，this.controlPanelModal存在=" + (this.controlPanelModal ? "是" : "否"));
    const modalHtml = this._renderControlPanelModal();

    if (this.controlPanelModal) {
      Logger.debug("[SyncManagerUI.createControlPanel] 關閉既存的 controlPanelModal");
      this.controlPanelModal.close();
    }

    this.controlPanelModal = new UIModal({
      id: "syncControlPanel",
      html: modalHtml,
    });
    this.controlPanelModal.open();
    this.controlPanel = this.controlPanelModal.modalEl;

    this.setupEventListeners();

    // 將 indicator 狀態訊息容器掛載到 modal 面板內
    if (this.indicatorManager && this.controlPanel) {
      const panelContent = this.controlPanel.querySelector(
        ".sync-panel-content",
      );
      if (panelContent) {
        this.indicatorManager.attachToPanel(panelContent);
      }
    }
  }

  _renderControlPanelModal() {
    return `
      <div class="modal-overlay active" id="syncControlPanel">
        <div class="modal-container sync-control-panel">
          ${this._renderControlPanelHeader()}
          <div class="modal-body">
            <div class="sync-panel-content">
              ${this._renderConnectionSection()}
              ${this._renderConnectedSection()}
              <div id="syncStatusMessage"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _renderControlPanelHeader() {
    return `
      <div class="modal-header">
        <h2 class="modal-title">同步面板</h2>
        <div class="sync-page-toggle-group">
          <button class="sync-page-toggle-btn sync-page-panel" data-page="${this.pageConfig.PANEL}"><span class="btn-text-split"></span></button>
          <button class="sync-page-toggle-btn sync-page-experiment" data-page="${this.pageConfig.BOARD}"><span class="btn-text-split"></span></button>
        </div>
        <button class="modal-close-btn" title="關閉">×</button>
      </div>
    `;
  }

  _renderConnectionSection() {
    return `
      <div id="syncConnectionSection" class="sync-connection-section">
        <div class="sync-create-join-container">
          <div class="sync-create-section">
            <h3>建立工作階段</h3>
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
            <div class="sync-join-header">
              <span class="sync-join-title">加入工作階段</span>
              <div class="sync-ch-role-group">
                <button class="sync-ch-role-btn active" data-role="operator">操作者</button>
                <button class="sync-ch-role-btn" data-role="viewer">檢視者</button>
              </div>
            </div>

            <div class="sync-quick-channel-buttons sync-quick-channel-buttons--inline">
              <button class="sync-channel-btn" data-channel="A">公開 A</button>
              <button class="sync-channel-btn" data-channel="B">公開 B</button>
              <button class="sync-channel-btn" data-channel="C">公開 C</button>
            </div>

            <div class="sync-join-method-divider"></div>

            <div class="sync-join-input-group">
              <input type="text"
                     id="sessionCodeInput"
                     placeholder="輸入分享代碼"
                     maxlength="8">
              <button id="joinSessionBtn">加入</button>
            </div>

            <div class="sync-join-method-divider"></div>

            <button class="sync-scan-btn" id="scanQrBtn">掃描 QR Code</button>
          </div>
        </div>
      </div>
    `;
  }

  _renderConnectedSection() {
    return `
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
          <div class="sync-client-id-display">
            <span class="sync-client-id-label">客戶端ID</span>
            <span class="sync-client-id-value" id="connectedDisplayClientId">-</span>
          </div>
          <div class="sync-session-buttons-container">
            <div class="sync-session-share-row">
              <button id="shareSessionToggleBtn" class="sync-share-toggle-btn">
                分享此工作階段
              </button>
              <div id="shareSessionContent" class="sync-share-content hidden">
                <h3>分享此工作階段</h3>

                <div class="sync-share-code-display">
                  <span class="sync-share-code-label">分享代碼:</span>
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
    `;
  }

  /**
   * 新增並記錄全域視窗事件監聽器
   * @param {string} eventType - 事件類型
   * @param {Function} handler - 事件處理函數
   */
  addWindowListener(eventType, handler) {
    window.addEventListener(eventType, handler);
    this.eventListeners.push({ target: window, event: eventType, handler });
  }

  /**
   * 新增並記錄 DOM 元素事件監聽器
   * @param {HTMLElement} element - DOM 元素
   * @param {string} eventType - 事件類型
   * @param {Function} handler - 事件處理函數
   */
  addDOMListener(element, eventType, handler) {
    if (element) {
      element.addEventListener(eventType, handler);
      this.domListeners.push({ element, event: eventType, handler });
    }
  }

  setupEventListeners() {
    try {
      this._resetDomListeners();

      // 記錄全域視窗事件監聽器
      if (!this._windowListenersBound) {
        this.addWindowListener(SYNC_EVENTS.SESSION_JOINED, (event) => {
          const detail = event.detail || {};
          const { shareCode } = detail;
          if (shareCode) {
            this.currentShareCode = shareCode;
          }
        });

        this.addWindowListener(SYNC_EVENTS.CONNECTED, (event) => {
          this.updateUIState();
          this.updateIndicator();
          this.updateConnectedSessionInfo();
        });

        this.addWindowListener(SYNC_EVENTS.DISCONNECTED, (event) => {
          this.updateUIState();
          this.updateIndicator();
        });

        this.addWindowListener(SYNC_EVENTS.SERVER_STATUS_CHANGED, (event) => {
          const { online, previousOnline } = event.detail;

          this.updateIndicator();

          if (previousOnline && !online) {
            this.showStatus("error", "伺服器已離線");
          } else if (!previousOnline && online) {
            this.showStatus("success", "伺服器已連線");
          }
        });

        this.addWindowListener(SYNC_EVENTS.SESSION_INVALID, (event) => {
          const { reason, originalError } = event.detail;

          Logger.warn("工作階段失效", { reason, originalError });

          if (reason === "session_not_found") {
            this.showStatus(
              "error",
              "工作階段已失效，請重新加入或建立新工作階段",
            );
          } else {
            this.showStatus("error", "工作階段連線異常");
          }

          this.updateIndicator();
          this.updateConnectedSessionInfo();
        });

        this._windowListenersBound = true;
      }

      if (!this.controlPanel) {
        Logger.debug("[SyncManagerUI] 控制面板尚未建立，略過 DOM 事件綁定");
        return;
      }

      const closeBtn = this.controlPanel.querySelector(".modal-close-btn");
      if (closeBtn) {
        this.addDOMListener(closeBtn, "click", () => this.hidePanel());
      }

      const pageToggleButtons = this.controlPanel.querySelectorAll(
        ".sync-page-toggle-btn",
      );
      if (pageToggleButtons.length > 0) {
        const panelBtn = this.controlPanel.querySelector("[data-page='panel']");
        const experimentBtn = this.controlPanel.querySelector(
          "[data-page='board']",
        );

        const panelName = this.getPageName(this.pageConfig.PANEL);
        const experimentName = this.getPageName(this.pageConfig.BOARD);

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
          this.addDOMListener(btn, "click", () => {
            const targetPage = btn.dataset.page;
            const basePath = window.location.pathname.substring(
              0,
              window.location.pathname.lastIndexOf("/") + 1,
            );

            let targetUrl;
            if (targetPage === this.pageConfig.PANEL) {
              targetUrl = basePath.endsWith("/") ? basePath : basePath + "/";
            } else if (targetPage === this.pageConfig.BOARD) {
              const experimentPath = this.getPagePath(this.pageConfig.BOARD);
              targetUrl = basePath + experimentPath;
            }

            window.location.href = targetUrl;
          });
        });
      }

      this.addDOMListener(this.controlPanel, "click", (e) => {
        if (e.target === this.controlPanel) {
          this.hidePanel();
        }
      });

      const createCodeInput = document.getElementById("createCodeInput");
      const createBtn = document.getElementById("createSessionBtn");

      this.addDOMListener(createCodeInput, "input", (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, "");
        this.validateCreateCode(e.target.value);
      });

      this.addDOMListener(createCodeInput, "keypress", (e) => {
        if (e.key === "Enter" && createCodeInput.value.length === 9) {
          this.handleCreateSession();
        }
      });

      this.addDOMListener(createBtn, "click", () => {
        if (createCodeInput.value.length === 9) {
          this.handleCreateSession();
        }
      });

      const qrRoleButtons =
        this.controlPanel.querySelectorAll(".sync-qr-role-btn");
      qrRoleButtons.forEach((btn) => {
        this.addDOMListener(btn, "click", () => {
          qrRoleButtons.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          this.currentQRRole = btn.dataset.role;

          const sessionId = this.core.getSessionId();
          if (sessionId) {
            window.dispatchEvent(
              new CustomEvent(SYNC_EVENTS.GENERATE_QR, {
                detail: { sessionId, role: this.currentQRRole },
              }),
            );
          }
        });
      });

      const roleCard = document.getElementById("roleCard");
      if (roleCard) {
        this.addDOMListener(roleCard, "click", () => {
          try {
            const currentRole =
              this.core.syncClient?.role || this.roleConfig.VIEWER;
            const newRole =
              currentRole === this.roleConfig.OPERATOR
                ? this.roleConfig.VIEWER
                : this.roleConfig.OPERATOR;

            if (this.core.syncClient) {
              this.core.syncClient.role = newRole;
              this.core.syncClient.saveRole(newRole);
            }

            try {
              localStorage.setItem("sync_preferred_role", newRole);
            } catch (error) {
              Logger.warn("無法儲存角色到快取:", error);
            }

            this.updateConnectedSessionInfo();

            this.showStatus(
              "info",
              `角色已切換為: ${this.getStatusText(newRole)}`,
            );
          } catch (error) {
            Logger.error("角色切換失敗:", error);
            this.showStatus("error", "角色切換失敗", error && error.message);
          }
        });
      }

      const joinBtn = document.getElementById("joinSessionBtn");
      this.addDOMListener(joinBtn, "click", () => this.handleJoinSession());

      // 公開頻道按鈕 - 點一下直接進入頻道
      const channelBtns =
        this.controlPanel.querySelectorAll(".sync-channel-btn");
      channelBtns.forEach((btn) => {
        this.addDOMListener(btn, "click", () => {
          const channel = btn.dataset.channel;
          this.handleJoinChannel(channel);
        });
      });

      // 公開頻道角色切換
      const chRoleBtns =
        this.controlPanel.querySelectorAll(".sync-ch-role-btn");
      chRoleBtns.forEach((btn) => {
        this.addDOMListener(btn, "click", () => {
          chRoleBtns.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
        });
      });

      const sessionCodeInput = document.getElementById("sessionCodeInput");
      this.addDOMListener(sessionCodeInput, "keypress", (e) => {
        if (e.key === "Enter") {
          this.handleJoinSession();
        }
      });

      const scanBtn = document.getElementById("scanQrBtn");
      this.addDOMListener(scanBtn, "click", () => {
        window.dispatchEvent(new CustomEvent(SYNC_EVENTS.START_QR_SCAN));
      });

      const shareSessionToggleBtn = document.getElementById(
        "shareSessionToggleBtn",
      );
      const shareSessionContent = document.getElementById(
        "shareSessionContent",
      );
      const shareSessionCollapseBtn = document.getElementById(
        "shareSessionCollapseBtn",
      );

      if (shareSessionToggleBtn && shareSessionContent) {
        this.addDOMListener(shareSessionToggleBtn, "click", () => {
          shareSessionContent.classList.remove("hidden");
          shareSessionToggleBtn.classList.add("hidden");

          this.initializeShareCode();
        });
      }

      if (shareSessionCollapseBtn && shareSessionContent) {
        this.addDOMListener(shareSessionCollapseBtn, "click", () => {
          shareSessionContent.classList.add("hidden");
          if (shareSessionToggleBtn) {
            shareSessionToggleBtn.classList.remove("hidden");
          }

          this.qrManager?.stopQRCodeCountdown?.();
        });
      }

      const copyShareCodeBtn = document.getElementById("copyShareCodeBtn");
      if (copyShareCodeBtn) {
        this.addDOMListener(copyShareCodeBtn, "click", () => {
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
                alert("複製失敗，請手動複製");
              });
          }
        });
      }

      const disconnectBtn = document.getElementById("disconnectBtn");
      if (disconnectBtn) {
        this.addDOMListener(disconnectBtn, "click", () => {
          this.handleDisconnect();
        });
      }

      const manageSessionsBtn = document.getElementById("manageSessionsBtn");
      if (manageSessionsBtn) {
        this.addDOMListener(manageSessionsBtn, "click", () => {
          window.dispatchEvent(new CustomEvent(SYNC_EVENTS.SHOW_SESSIONS));
        });
      }

      const regenerateShareCodeBtn = document.getElementById(
        "regenerateShareCodeBtn",
      );
      if (regenerateShareCodeBtn) {
        this.addDOMListener(regenerateShareCodeBtn, "click", async () => {
          regenerateShareCodeBtn.disabled = true;
          regenerateShareCodeBtn.style.opacity = "0.5";
          try {
            const result = await this.core.syncClient.regenerateShareCode();
            if (result) {
              const newShareCode = result.shareCode;
              this.currentShareCode = newShareCode;

              const shareDisplayCode =
                document.getElementById("shareDisplayCode");
              if (shareDisplayCode) {
                shareDisplayCode.textContent = newShareCode;
              }

              const remainingTime = result.remainingTime || 300;
              this.qrManager?.startQRCodeCountdown?.(
                remainingTime,
                "shareQRCountdown",
              );

              window.dispatchEvent(
                new CustomEvent(SYNC_EVENTS.GENERATE_QR, {
                  detail: {
                    shareCode: newShareCode,
                    role: this.core.syncClient.role,
                    isShareCode: true,
                  },
                }),
              );

              this.showStatus("success", "已重新產生分享代碼");
            }
          } catch (error) {
            Logger.error("[SyncUI] 重新產生分享代碼失敗:", error);
            this.showStatus(
              "error",
              "重新產生分享代碼失敗",
              error && error.message,
            );
          } finally {
            regenerateShareCodeBtn.disabled = false;
            regenerateShareCodeBtn.style.opacity = "1";
          }
        });
      }

      const copyShareLinkBtn = document.getElementById("copyShareLinkBtn");
      if (copyShareLinkBtn) {
        this.addDOMListener(copyShareLinkBtn, "click", async () => {
          const shareCode =
            document.getElementById("shareDisplayCode")?.textContent;
          if (!shareCode || shareCode === "-") {
            this.showStatus("error", "沒有分享代碼");
            return;
          }

          try {
            const shareUrl = this.core.generateQRContent(
              shareCode,
              this.core.syncClient?.role || this.roleConfig.VIEWER,
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
            this.showStatus(
              "error",
              "分享連結複製失敗",
              error && error.message,
            );
          }
        });
      }
    } catch (error) {
      Logger.error("事件監聽器設定失敗:", error);
    }
  }

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

      this.currentQRRole = this.roleConfig.VIEWER;

      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.SESSION_CREATED, {
          detail: { sessionId },
        }),
      );

      input.value = "";

      Logger.info("[SyncUI] 工作階段建立成功", { sessionId });
    } catch (error) {
      this.showStatus("error", "建立工作階段失敗", error && error.message);
      Logger.error("[SyncUI] 建立工作階段失敗:", error);
    }
  }

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
        if (btn.dataset.role === this.roleConfig.VIEWER) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });

      Logger.info("[SyncUI] 分享代碼已產生", {
        shareCode: result.shareCode,
      });
    } catch (error) {
      this.showStatus("error", "產生失敗", error && error.message);
      Logger.error("[SyncUI] 產生分享代碼失敗:", error);
    }
  }

  async handleJoinSession() {
    const input = document.getElementById("sessionCodeInput");
    const code = input.value.trim().toUpperCase();

    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      this.showStatus("error", "請輸入有效之分享代碼");
      return;
    }

    const savedRole = localStorage.getItem("sync_preferred_role");
    const activeRoleBtn = this.controlPanel.querySelector(
      ".sync-ch-role-btn.active",
    );
    let role = activeRoleBtn
      ? activeRoleBtn.dataset.role
      : this.roleConfig.OPERATOR;

    if (savedRole) {
      role = savedRole;
      const chRoleBtns =
        this.controlPanel.querySelectorAll(".sync-ch-role-btn");
      chRoleBtns.forEach((btn) => {
        if (btn.dataset.role === savedRole) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });
    }

    this.showStatus("info", "加入中...");

    try {
      await this.core.joinSessionByShareCode(code, role);

      const roleText = this.getRoleText(role);
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
          new CustomEvent(SYNC_EVENTS.GENERATE_QR, {
            detail: { shareCode: this.currentShareCode, role },
          }),
        );
      }

      input.value = "";
    } catch (error) {
      this.showStatus("error", error.message || "加入工作階段失敗");
    }
  }

  async handleJoinChannel(channelName) {
    const activeRoleBtn = this.controlPanel.querySelector(
      ".sync-ch-role-btn.active",
    );
    const role = activeRoleBtn
      ? activeRoleBtn.dataset.role
      : this.roleConfig.OPERATOR;

    const roleText = this.getRoleText(role) || role;
    this.showStatus("info", `加入頻道 ${channelName}…`);

    // 按鈕載入狀態
    const allBtns = this.controlPanel.querySelectorAll(".sync-channel-btn");
    allBtns.forEach((b) => (b.disabled = true));

    try {
      await this.core.joinPublicChannel(channelName, role);

      this.showStatus("success", `頻道 ${channelName} 加入成功（${roleText}）`);
      this.updateIndicator();
      this.updateUIState();
      this.updateConnectedSessionInfo();
    } catch (error) {
      this.showStatus("error", error.message || `加入頻道 ${channelName} 失敗`);
      Logger.error("[SyncUI] 加入公開頻道失敗:", error);
    } finally {
      allBtns.forEach((b) => (b.disabled = false));
    }
  }

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

      this.qrManager?.stopQRCodeCountdown?.();

      localStorage.removeItem("sync_session_backup");

      if (this.core.syncClient) {
        await this.core.syncClient.disconnect();
      }

      this.core.currentSessionId = null;
      this.core.currentShareCode = null;
      this.core.currentRole = null;

      await new Promise((resolve) => setTimeout(resolve, 100));

      const shareSessionContent = document.getElementById(
        "shareSessionContent",
      );
      const shareSessionToggleBtn = document.getElementById(
        "shareSessionToggleBtn",
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

  async initializeShareCode() {
    Logger.debug("開始初始化分享代碼和 QR Code ");

    this.sharePanelOpened = true;

    let shareCode = this.currentShareCode;

    if (shareCode) {
      const shareDisplayCode = document.getElementById("shareDisplayCode");
      if (shareDisplayCode) {
        shareDisplayCode.textContent = shareCode;
      }

      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.GENERATE_QR, {
          detail: {
            shareCode: shareCode,
            role:
              this.core.syncClient?.role ||
              this.roleConfig.VIEWER ||
              "viewer",
            isShareCode: true,
          },
        }),
      );

      this.validateAndRefreshShareCodeInBackground(shareCode);
    } else {
      await this.regenerateAndDisplayShareCode();
    }
  }

  async validateAndRefreshShareCodeInBackground(shareCode) {
    try {
      const shareCodeInfo = await this.core.getShareCodeInfo(shareCode);

      const isValid = !shareCodeInfo.used && !shareCodeInfo.expired;

      if (isValid) {
        this.qrManager?.startQRCodeCountdown?.(
          shareCodeInfo.remainingTime,
          "shareQRCountdown",
        );
      } else {
        await this.regenerateAndDisplayShareCode();
      }
    } catch (error) {
      Logger.warn("背景驗證分享代碼失敗，將重新產生", error);
      await this.regenerateAndDisplayShareCode();
    }
  }

  updateShareCodeStatus(statusText, statusClass) {
    const shareDisplayCode = document.getElementById("shareDisplayCode");
    if (shareDisplayCode) {
      shareDisplayCode.classList.remove(
        "share-code-valid",
        "share-code-used",
        "share-code-expired",
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

      const result = await this.core.generateShareCode();

      const shareCode = result.shareCode;
      this.currentShareCode = shareCode;

      const shareDisplayCode = document.getElementById("shareDisplayCode");
      if (shareDisplayCode) {
        shareDisplayCode.textContent = shareCode;
      }

      window.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.GENERATE_QR, {
          detail: {
            shareCode: shareCode,
            role:
              this.core.syncClient?.role ||
              this.roleConfig.VIEWER ||
              "viewer",
            isShareCode: true,
          },
        }),
      );

      this.qrManager?.startQRCodeCountdown?.(300, "shareQRCountdown");
    } catch (error) {
      Logger.error("產生新分享代碼失敗:", error);
      throw error;
    }
  }

  /**
   * 更新膠囊指示器
   */
  updateIndicator() {
    if (!this.capsuleIndicator) {
      Logger.warn("capsuleIndicator 不存在，UI 初始化可能失敗或未執行", {
        hasCore: !!this.core,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const status = this.core.getStatusText();
    const isConnected = this.core.isConnected();

    const oldStatusText =
      this.capsuleIndicator.querySelector(".sync-status-text")?.textContent;

    this.capsuleIndicator.classList.remove(
      "offline",
      "online",
      "idle",
      "viewer",
      "operator",
    );

    if (isConnected && status !== this.statusConfig.OFFLINE) {
      this.capsuleIndicator.classList.add("online", status);
    } else {
      this.capsuleIndicator.classList.add("offline", status);
    }

    const textMap = {
      offline: this.getStatusText(this.statusConfig.OFFLINE),
      idle: this.getStatusText(this.statusConfig.IDLE),
      viewer: this.getStatusText(this.roleConfig.VIEWER),
      operator: this.getStatusText(this.roleConfig.OPERATOR),
    };

    const statusText = this.capsuleIndicator.querySelector(".sync-status-text");
    if (statusText) {
      statusText.textContent = textMap[status] || "已離線";
    }

    // 發送帶顏色的 debug log
    this.logIndicatorStatusChange(status, textMap[status], oldStatusText);

    this.updateUIState();
  }

  logIndicatorStatusChange(status, displayText, oldDisplayText) {
    // 定義狀態對應的顏色代碼
    const colorMap = {
      offline: "red", // 未連線：紅色
      idle: "orange", // 未同步：橙色
      viewer: "blue", // 檢視者：藍色
      operator: "green", // 同步中：綠色
    };

    const color = colorMap[status] || "gray";
    const coloredText = `<${color}>${displayText}</${color}>`;

    // 如果狀態有變更，記錄變更
    if (displayText !== oldDisplayText) {
      Logger.debug(`指示器狀態: ${oldDisplayText || "初始"} → ${coloredText}`, {
        status,
        isConnected: this.core.isConnected(),
        serverOnline: this.core.syncClient?.serverOnline,
        connectionAttempted: this.core.syncClient?.connectionAttempted,
        timestamp: new Date().toISOString(),
      });
    } else {
      // 即使狀態沒變，也記錄目前狀態（用於初始化確認）
      Logger.debug(`指示器狀態: ${coloredText}`, {
        status,
        isConnected: this.core.isConnected(),
        serverOnline: this.core.syncClient?.serverOnline,
        connectionAttempted: this.core.syncClient?.connectionAttempted,
      });
    }
  }

  /**
   * 更新UI狀態
   */
  updateUIState() {
    try {
      const connectionSection = document.getElementById(
        "syncConnectionSection",
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
      Logger.warn("updateUIState 錯誤:", error);
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
        offline: this.getStatusText(this.statusConfig.OFFLINE),
        idle: this.getStatusText(this.statusConfig.IDLE),
        viewer: this.getStatusText(this.roleConfig.VIEWER),
        operator: this.getStatusText(this.roleConfig.OPERATOR),
      };

      const sessionIdSpan = document.getElementById(
        "connectedDisplaySessionId",
      );
      const roleSpan = document.getElementById("connectedDisplayRole");
      const statusSpan = document.getElementById("connectedDisplayStatus");

      if (sessionIdSpan) {
        sessionIdSpan.textContent = sessionId || "-";
      }
      if (roleSpan) {
        roleSpan.textContent = this.getRoleText(role);
      }
      if (statusSpan) {
        const statusMap = {
          viewer: this.getStatusText(this.roleConfig.VIEWER),
          operator: this.getStatusText(this.roleConfig.OPERATOR),
        };
        statusSpan.textContent =
          statusMap[role] || statusTextMap[status] || status;
      }

      const clientIdEl = document.getElementById("connectedDisplayClientId");
      if (clientIdEl) {
        clientIdEl.textContent = this.core.syncClient?.clientId || "-";
      }

      // 公開頻道不支援分享代碼，隱藏整列分享按鈕
      const isPublicChannel = sessionId && sessionId.startsWith("__CH_");
      const shareRow = this.controlPanel?.querySelector(
        ".sync-session-share-row",
      );
      if (shareRow) {
        shareRow.style.display = isPublicChannel ? "none" : "";
      }
    } catch (error) {
      Logger.warn("updateConnectedSessionInfo 錯誤:", error);
    }
  }

  /**
   * 更新頁面切換按鈕的 active 狀態
   */
  updatePageToggleButtonState() {
    const currentPath = window.location.pathname;
    let currentPage = "panel";

    const experimentPath = this.getPagePath(this.pageConfig.BOARD);
    if (currentPath.includes(experimentPath)) {
      currentPage = "board";
    }

    const pageToggleButtons = this.controlPanel.querySelectorAll(
      ".sync-page-toggle-btn",
    );
    pageToggleButtons.forEach((btn) => {
      if (btn.dataset.page === currentPage) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  showStatus(type, message, errorDetail) {
    if (this.indicatorManager) {
      this.indicatorManager.showStatus(type, message || "", 5000);
      return;
    }
  }

  showPanel() {
    Logger.debug("[SyncManagerUI.showPanel] 開始打開面板，controlPanel存在=" + (this.controlPanel ? "是" : "否") + "，在DOM中=" + (this.controlPanel && document.body.contains(this.controlPanel) ? "是" : "否"));
    if (!this.controlPanel || !document.body.contains(this.controlPanel)) {
      Logger.debug("[SyncManagerUI.showPanel] controlPanel不存在或不在DOM中，呼叫 createControlPanel()");
      this.createControlPanel();
      this.setupEventListeners();
    }

    if (this.capsuleIndicator) {
      this.capsuleIndicator.classList.add("is-hidden");
    }

    this.controlPanel?.classList.add("active");
    Logger.debug("[SyncManagerUI.showPanel] 已新增 active class");

    this.updatePageToggleButtonState();

    this.updateUIState();
    Logger.debug("[SyncManagerUI.showPanel] 完成");
  }

  hidePanel() {
    this.controlPanel?.classList.remove("active");
    this.controlPanelModal?.close();
    this.controlPanel = null;
    this._resetDomListeners();

    if (this.capsuleIndicator?.classList.contains("is-hidden")) {
      this.capsuleIndicator.classList.remove("is-hidden");
    }
  }

  _resetDomListeners() {
    this.domListeners.forEach(({ element, event, handler }) => {
      element?.removeEventListener(event, handler);
    });
    this.domListeners = [];
  }

  /**
   * 清理資源
   */
  cleanup() {
    // 移除記錄的全域事件監聽器
    this.eventListeners.forEach(({ target, event, handler }) => {
      target.removeEventListener(event, handler);
    });

    // 移除記錄的 DOM 事件監聽器
    this.domListeners.forEach(({ element, event, handler }) => {
      element?.removeEventListener(event, handler);
    });

    // 移除 DOM 元素
    this.capsuleIndicator?.remove();
    this.controlPanel?.remove();
    this.controlPanelModal?.close();
    this.controlPanel = null;

    Logger.debug("SyncManagerUI 清理完成");
  }
}
