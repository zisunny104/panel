/**
 * SyncManager Sessions - 工作階段管理UI
 * 負責檢視和管理所有工作階段
 */

import { UIModal } from "../ui/modal.js";
import { SYNC_EVENTS } from "../constants/index.js";
import { Logger } from "../core/console-manager.js";

export class SyncManagerSessions {
  constructor(core, config = {}) {
    this.core = core;
    this.syncManager = config.syncManager || null;
    this.timeSyncManager = config.timeSyncManager || core?.timeSyncManager || null;
    this.roleConfig = config.roleConfig || this.syncManager?.ROLE || {
      OPERATOR: "operator",
      VIEWER: "viewer",
    };
    this.indicatorManager = config.indicatorManager || null;
    this.sessionsPanel = null;
    this.sessionsModal = null;
    this.sessionsData = [];
    this.expandedCards = new Set();
    this.selectedSessions = new Set();
  }

  formatDateTime(timestampMs) {
    if (this.timeSyncManager?.formatDateTime) {
      return this.timeSyncManager.formatDateTime(timestampMs);
    }
    return new Date(timestampMs).toLocaleString();
  }

  getRoleText(role) {
    return this.syncManager?.getRoleText?.(role) || role;
  }

  getApiUrl() {
    const protocol = window.location.protocol;
    const host = window.location.host;

    const basePath = this.getApiBasePath();

    return `${protocol}//${host}${basePath}`;
  }

  getApiBasePath() {
    const pathname = window.location.pathname;

    let basePath = pathname;
    if (!basePath.endsWith("/")) {
      basePath = basePath.substring(0, basePath.lastIndexOf("/") + 1);
    }

    if (!basePath.endsWith("/")) {
      basePath += "/";
    }

    return basePath + "api";
  }

  initialize() {
    window.addEventListener(SYNC_EVENTS.SHOW_SESSIONS, () => {
      this.showSessionsPanel();
    });

    window.addEventListener(SYNC_EVENTS.SESSION_CREATED, () => {
      if (this.sessionsPanel && document.body.contains(this.sessionsPanel)) {
        this.refreshSessionsList();
      }
    });

    window.addEventListener(SYNC_EVENTS.SESSION_INVALID, (event) => {
      const { reason, originalError } = event.detail;

      Logger.info("工作階段失效，重新載入列表", {
        reason,
        originalError,
      });

      if (this.sessionsPanel && document.body.contains(this.sessionsPanel)) {
        this.refreshSessionsList();
      }
    });
  }

  async showSessionsPanel() {
    if (this.sessionsModal) {
      this.sessionsModal.close();
    }

    await this.loadSessionsData();

    const modalHtml = `
      <div class="modal-overlay sync-sessions-overlay active" id="syncSessionsPanel">
        <div class="modal-container sync-sessions-ui">
          <div class="modal-header">
            <h2 class="modal-title">工作階段管理</h2>
            <button class="modal-close-btn" title="關閉">×</button>
          </div>

          <div class="modal-body">
            <div class="sync-sessions-actions">
              <button id="refreshSessionsBtn" class="sync-action-btn">重新整理</button>
              <button id="stopAllActiveSessionsBtn" class="sync-action-btn sync-action-btn-warning">結束所有活動中工作階段</button>
              <button id="clearAllSessionsBtn" class="sync-action-btn sync-action-btn-danger">刪除所有工作階段</button>
            </div>

            <div class="sync-sessions-batch-actions">
              <div class="sync-batch-controls">
                <label class="sync-batch-checkbox">
                  <input type="checkbox" id="selectAllSessions">
                  全選
                </label>
                <button id="selectNoDataSessionsBtn" class="sync-batch-select-btn">選取無同步資料</button>
                <button id="selectSingleClientSessionsBtn" class="sync-batch-select-btn">選取單一裝置</button>
              </div>
              <div class="sync-batch-operations">
                <button id="downloadSelectedSessionsBtn" class="sync-batch-op-btn sync-batch-op-download" disabled>下載選取工作階段</button>
                <button id="deleteSelectedSessionsBtn" class="sync-batch-op-btn sync-batch-op-delete" disabled>刪除選取工作階段</button>
              </div>
            </div>

            <div id="sessionsList" class="sync-sessions-list scrollbar-gray">
              ${this.renderSessionsList()}
            </div>
          </div>
        </div>
      </div>
    `;

    this.sessionsModal = new UIModal({
      id: "syncSessionsPanel",
      html: modalHtml,
    });
    this.sessionsModal.open();
    this.sessionsPanel = this.sessionsModal.modalEl;

    this.bindEvents();
  }

  async loadSessionsData() {
    try {
      const apiUrl = this.getApiUrl();
      const response = await fetch(`${apiUrl}/sync/sessions`);
      const data = await response.json();

      if (data.success) {
        this.sessionsData = data.data || [];
      } else {
        Logger.warn("載入工作階段資料失敗:", data.message);
        this.sessionsData = [];
      }
    } catch (error) {
      Logger.warn("載入工作階段資料錯誤:", error);
      this.sessionsData = [];
    }
  }

  async refreshSessionsList() {
    try {
      await this.loadSessionsData();
      const sessionsList = this.sessionsPanel?.querySelector("#sessionsList");
      if (sessionsList) {
        sessionsList.innerHTML = this.renderSessionsList();
      }
    } catch (error) {
      Logger.error("重新整理工作階段列表錯誤:", error);
    }
  }

  renderSessionsList() {
    if (this.sessionsData.length === 0) {
      return `
        <div class="sync-sessions-empty">
          目前沒有工作階段
        </div>
      `;
    }

    return this.sessionsData
      .map((session) => this.renderSessionCard(session))
      .join("");
  }

  renderSessionCard(session) {
    const isExpanded = this.expandedCards.has(session.id);
    const createdTime = this.formatDateTime(session.created * 1000);
    const lastActivity = this.formatDateTime(session.lastActivity * 1000);
    const isActive = Date.now() / 1000 - session.lastActivity < 600;

    return `
      <div class="sync-session-card ${
        isExpanded ? "expanded" : ""
      }" data-session-id="${session.id}">
        <div class="sync-session-header">
          <div class="sync-session-selection">
            <input type="checkbox" class="session-checkbox" data-session-id="${
              session.id
            }">
          </div>
          <div class="sync-session-info">
            <div class="sync-card-label">工作階段 ${session.id}</div>
            <div class="sync-card-hint">
              建立時間: ${createdTime} |
              最後活動: ${lastActivity} |
              裝置數量: ${session.clients?.length || 0}/${session.maxClients}
            </div>
          </div>
          <div class="sync-session-card-status">
            <span class="sync-session-status ${
              isActive ? "active" : "inactive"
            }">${isActive ? "活動中" : "閒置中"}</span>
            <span class="sync-session-expand-icon">${
              isExpanded ? "▼" : "▶"
            }</span>
          </div>
        </div>

        <div class="sync-session-details">
        </div>
      </div>
    `;
  }

  formatSyncState(state) {
    if (typeof state === "string") {
      try {
        state = JSON.parse(state);
      } catch (error) {
        Logger.debug("解析同步狀態失敗:", error);
        return '<span class="sync-state-empty">資料格式錯誤</span>';
      }
    }

    if (!state || typeof state !== "object") {
      return '<span class="sync-state-empty">無資料</span>';
    }

    const formatValue = (value, indent = 0) => {
      const indentStr = "  ".repeat(indent);

      if (value === null) {
        return '<span class="sync-state-null">null</span>';
      }

      if (typeof value === "boolean") {
        return `<span class="sync-state-boolean">${value}</span>`;
      }

      if (typeof value === "number") {
        return `<span class="sync-state-number">${value}</span>`;
      }

      if (typeof value === "string") {
        if (value.length > 50) {
          return `<span class="sync-state-string">"${value.substring(
            0,
            47,
          )}..."</span>`;
        }
        return `<span class="sync-state-string">"${value}"</span>`;
      }

      if (Array.isArray(value)) {
        if (value.length === 0) {
          return '<span class="sync-state-array">[]</span>';
        }

        const items = value
          .slice(0, 5)
          .map((item) => formatValue(item, indent + 1));
        const remaining =
          value.length > 5 ? ` ... 還有 ${value.length - 5} 個項目` : "";

        return `<span class="sync-state-array">[
${indentStr}  ${items.join(`,\n${indentStr}  `)}${remaining}
${indentStr}]</span>`;
      }

      if (typeof value === "object") {
        const entries = Object.entries(value);
        if (entries.length === 0) {
          return '<span class="sync-state-object">{}</span>';
        }

        const formattedEntries = entries
          .slice(0, 10)
          .map(
            ([key, val]) =>
              `${indentStr}  <span class="sync-state-key">"${key}"</span>: ${formatValue(
                val,
                indent + 1,
              )}`,
          );

        const remaining =
          entries.length > 10
            ? `\n${indentStr}  ... 還有 ${entries.length - 10} 個欄位`
            : "";

        return `<span class="sync-state-object">{
${formattedEntries.join(",\n")}${remaining}
${indentStr}}</span>`;
      }

      return `<span class="sync-state-unknown">${String(value)}</span>`;
    };

    return `<div class="sync-state-formatted">${formatValue(state)}</div>`;
  }

  renderSessionDetails(session) {
    const shareCodeInfo = (() => {
      if (!session.shareCodes || session.shareCodes.length === 0) {
        return '<div class="sync-session-info sync-session-info-no-code">無分享代碼</div>';
      }

      const sortedCodes = [...session.shareCodes].sort(
        (a, b) => b.createdAt - a.createdAt,
      );

      const codeList = sortedCodes
        .map((code) => {
          const status = code.used
            ? "已使用"
            : code.expiresAt < Date.now() / 1000
              ? "已過期"
              : "有效";
          const statusClass = code.used
            ? "used"
            : code.expiresAt < Date.now() / 1000
              ? "expired"
              : "active";

          const createdTime = this.formatDateTime(code.createdAt * 1000);
          const expiresTime = this.formatDateTime(code.expiresAt * 1000);
          const usedTime = code.usedAt
            ? this.formatDateTime(code.usedAt * 1000)
            : null;

          return `
          <div class="sync-share-code-item ${statusClass}">
            <div class="sync-share-code-header">
              <strong>代碼:</strong> ${code.code}
              <span class="sync-share-code-status ${statusClass}">${status}</span>
            </div>
            <div class="sync-share-code-details">
              <small>
                建立: ${createdTime}
                ${code.createdBy ? ` (由 ${code.createdBy})` : ""}
                <br>
                到期: ${expiresTime}
                ${
                  code.used && usedTime
                    ? `<br>使用: ${usedTime} (由 ${code.usedBy})`
                    : ""
                }
              </small>
            </div>
          </div>
        `;
        })
        .join("");

      return `
        <div class="sync-session-info sync-session-share-codes">
          <strong>分享代碼歷史 (${session.shareCodes.length} 個):</strong>
          <div class="sync-share-codes-list">
            ${codeList}
          </div>
        </div>
      `;
    })();

    const clientsList =
      session.clients && session.clients.length > 0
        ? session.clients
            .map((client) => {
              const joinedTime = this.formatDateTime(client.joinedAt * 1000);
              const lastActivityTime = this.formatDateTime(
                client.lastActivity * 1000,
              );
              return `
        <div class="sync-session-client ${client.role}">
          <div><strong>裝置ID:</strong> ${client.id}</div>
          <div><strong>角色:</strong> ${this.getRoleText(client.role)}</div>
          <div><strong>加入時間:</strong> ${joinedTime}</div>
          <div><strong>最後活動:</strong> ${lastActivityTime}</div>
        </div>
      `;
            })
            .join("")
        : '<div class="sync-session-no-clients">無裝置</div>';

    const stateInfo = session.state
      ? (() => {
          let parsedState = session.state;
          if (typeof session.state === "string") {
            try {
              parsedState = JSON.parse(session.state);
            } catch (error) {
              Logger.debug("解析同步狀態失敗:", error);
              parsedState = null;
            }
          }

          const fieldCount =
            parsedState && typeof parsedState === "object"
              ? Object.keys(parsedState).length
              : 0;

          return `<div class="sync-session-state-toggle" data-session-id="${
            session.id
          }">
        <div class="sync-session-state-header">
          <strong>同步狀態:</strong> 有同步資料 (${fieldCount} 個欄位)
          <span class="sync-state-expand-icon">▶</span>
        </div>
        <div class="sync-session-state-details is-hidden">
          ${this.formatSyncState(session.state)}
        </div>
      </div>`;
        })()
      : '<div class="sync-session-info sync-session-info-no-state">無同步資料</div>';

    return `
      ${shareCodeInfo}
      ${stateInfo}
      <div>
        <strong>已連線裝置:</strong>
        <div class="sync-session-clients">
          ${clientsList}
        </div>
      </div>
      <div class="sync-session-buttons-container">
        <div class="sync-session-action-row">
          <button class="sync-delete-session-btn" data-session-id="${session.id}">刪除</button>
        </div>
      </div>
    `;
  }

  bindEvents() {
    const closeBtn = this.sessionsPanel.querySelector(".modal-close-btn");
    closeBtn.addEventListener("click", () => {
      this.sessionsModal?.close();
      this.sessionsModal = null;
      this.sessionsPanel = null;
    });

    const refreshBtn = this.sessionsPanel.querySelector("#refreshSessionsBtn");
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "載入中...";

      await this.loadSessionsData();
      const sessionsList = this.sessionsPanel.querySelector("#sessionsList");
      sessionsList.innerHTML = this.renderSessionsList();

      refreshBtn.disabled = false;
      refreshBtn.textContent = "重新整理";
    });

    const clearAllBtn = this.sessionsPanel.querySelector(
      "#clearAllSessionsBtn",
    );
    clearAllBtn.addEventListener("click", async () => {
      if (!confirm("確定要刪除所有工作階段嗎？此操作無法還原。")) {
        return;
      }

      clearAllBtn.disabled = true;
      clearAllBtn.textContent = "刪除中...";

      try {
        const response = await fetch(
          `${this.getApiUrl()}/sync/sessions/clear`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          },
        );
        const data = await response.json();

        if (data.success) {
          this.sessionsData = [];
          this.expandedCards.clear();

          const sessionsList =
            this.sessionsPanel.querySelector("#sessionsList");
          sessionsList.innerHTML = `
            <div class="sync-sessions-empty">
              目前沒有工作階段
            </div>
          `;
        } else {
          if (this.indicatorManager) {
            this.indicatorManager.showStatus(
              "error",
              "刪除失敗: " + data.message,
            );
          } else {
            alert("刪除失敗: " + data.message);
          }
        }
      } catch (error) {
        Logger.error("刪除所有工作階段錯誤:", error);
        if (this.indicatorManager) {
          this.indicatorManager.showStatus(
            "error",
            "刪除失敗: " + (error.message || ""),
          );
        } else {
          alert("刪除失敗: " + error.message);
        }
      }

      clearAllBtn.disabled = false;
      clearAllBtn.textContent = "刪除所有工作階段";
    });

    const stopAllActiveBtn = this.sessionsPanel.querySelector(
      "#stopAllActiveSessionsBtn",
    );
    stopAllActiveBtn.addEventListener("click", async () => {
      const activeSessions = this.sessionsData.filter((session) => {
        const isActive = Date.now() / 1000 - session.lastActivity < 600;
        return isActive;
      });

      if (activeSessions.length === 0) {
        if (this.indicatorManager) {
          this.indicatorManager.showStatus(
            "info",
            "目前沒有活動中的工作階段",
          );
        } else {
          alert("目前沒有活動中的工作階段");
        }
        return;
      }

      if (
        !confirm(`確定要結束所有 ${activeSessions.length} 個活動中工作階段嗎？`)
      ) {
        return;
      }

      stopAllActiveBtn.disabled = true;
      stopAllActiveBtn.textContent = "處理中...";

      try {
        if (this.indicatorManager) {
          this.indicatorManager.showStatus(
            "success",
            `已結束 ${activeSessions.length} 個活動中工作階段`,
          );
        } else {
          alert(`已結束 ${activeSessions.length} 個活動中工作階段`);
        }
        await this.refreshSessionsList();
      } catch (error) {
        Logger.error("結束活動中工作階段錯誤:", error);
        alert("操作失敗: " + error.message);
      }

      stopAllActiveBtn.disabled = false;
      stopAllActiveBtn.textContent = "結束所有活動中工作階段";
    });

    const selectAllCheckbox =
      this.sessionsPanel.querySelector("#selectAllSessions");
    selectAllCheckbox.addEventListener("change", (event) => {
      const isChecked = event.target.checked;
      const checkboxes =
        this.sessionsPanel.querySelectorAll(".session-checkbox");

      checkboxes.forEach((checkbox) => {
        checkbox.checked = isChecked;
        const sessionId = checkbox.dataset.sessionId;
        if (isChecked) {
          this.selectedSessions.add(sessionId);
        } else {
          this.selectedSessions.delete(sessionId);
        }
      });

      this.updateBatchOperationButtons();
    });

    const selectNoDataBtn = this.sessionsPanel.querySelector(
      "#selectNoDataSessionsBtn",
    );
    selectNoDataBtn.addEventListener("click", () => {
      const checkboxes =
        this.sessionsPanel.querySelectorAll(".session-checkbox");

      checkboxes.forEach((checkbox) => {
        const sessionId = checkbox.dataset.sessionId;
        const session = this.sessionsData.find((s) => s.id === sessionId);

        if (
          session &&
          (!session.state || Object.keys(session.state).length === 0)
        ) {
          checkbox.checked = true;
          this.selectedSessions.add(sessionId);
        } else {
          checkbox.checked = false;
          this.selectedSessions.delete(sessionId);
        }
      });

      this.updateSelectAllCheckbox();
      this.updateBatchOperationButtons();
    });

    const selectSingleClientBtn = this.sessionsPanel.querySelector(
      "#selectSingleClientSessionsBtn",
    );
    selectSingleClientBtn.addEventListener("click", () => {
      const checkboxes =
        this.sessionsPanel.querySelectorAll(".session-checkbox");

      checkboxes.forEach((checkbox) => {
        const sessionId = checkbox.dataset.sessionId;
        const session = this.sessionsData.find((s) => s.id === sessionId);

        if (session && (!session.clients || session.clients.length <= 1)) {
          checkbox.checked = true;
          this.selectedSessions.add(sessionId);
        } else {
          checkbox.checked = false;
          this.selectedSessions.delete(sessionId);
        }
      });

      this.updateSelectAllCheckbox();
      this.updateBatchOperationButtons();
    });

    const downloadSelectedBtn = this.sessionsPanel.querySelector(
      "#downloadSelectedSessionsBtn",
    );
    downloadSelectedBtn.addEventListener("click", () => {
      if (this.selectedSessions.size === 0) {
        if (this.indicatorManager) {
          this.indicatorManager.showStatus(
            "info",
            "請先選取要下載的工作階段",
          );
        } else {
          alert("請先選取要下載的工作階段");
        }
        return;
      }

      const selectedData = this.sessionsData.filter((session) =>
        this.selectedSessions.has(session.id),
      );

      const dataStr = JSON.stringify(selectedData, null, 2);
      const dataBlob = new Blob([dataStr], { type: "application/json" });

      const link = document.createElement("a");
      link.href = URL.createObjectURL(dataBlob);
      link.download = `sessions_backup_${
        new Date().toISOString().split("T")[0]
      }.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      if (this.indicatorManager) {
        this.indicatorManager.showStatus(
          "success",
          `已下載 ${this.selectedSessions.size} 個工作階段的資料`,
        );
      } else {
        alert(`已下載 ${this.selectedSessions.size} 個工作階段的資料`);
      }
    });

    const deleteSelectedBtn = this.sessionsPanel.querySelector(
      "#deleteSelectedSessionsBtn",
    );
    deleteSelectedBtn.addEventListener("click", async () => {
      if (this.selectedSessions.size === 0) {
        if (this.indicatorManager) {
          this.indicatorManager.showStatus(
            "info",
            "請先選取要刪除的工作階段",
          );
        } else {
          alert("請先選取要刪除的工作階段");
        }
        return;
      }

      if (
        !confirm(
          `確定要刪除選取的 ${this.selectedSessions.size} 個工作階段嗎？此操作無法還原。`,
        )
      ) {
        return;
      }

      deleteSelectedBtn.disabled = true;
      deleteSelectedBtn.textContent = "刪除中...";

      try {
        const deletePromises = Array.from(this.selectedSessions).map(
          (sessionId) =>
            fetch(`${this.getApiUrl()}/sync/session/${sessionId}`, {
              method: "DELETE",
            }).then((response) => response.json()),
        );

        const results = await Promise.all(deletePromises);
        const successCount = results.filter((result) => result.success).length;
        const failCount = results.length - successCount;

        this.sessionsData = this.sessionsData.filter(
          (session) => !this.selectedSessions.has(session.id),
        );

        this.selectedSessions.clear();

        await this.refreshSessionsList();

        if (failCount === 0) {
          if (this.indicatorManager) {
            this.indicatorManager.showStatus(
              "success",
              `成功刪除 ${successCount} 個工作階段`,
            );
          } else {
            alert(`成功刪除 ${successCount} 個工作階段`);
          }
        } else {
          if (this.indicatorManager) {
            this.indicatorManager.showStatus(
              "warning",
              `刪除完成：成功 ${successCount} 個，失敗 ${failCount} 個`,
            );
          } else {
            alert(`刪除完成：成功 ${successCount} 個，失敗 ${failCount} 個`);
          }
        }
      } catch (error) {
        Logger.error("批次刪除工作階段錯誤:", error);
        if (this.indicatorManager) {
          this.indicatorManager.showStatus(
            "error",
            "批次刪除失敗: " + (error.message || ""),
          );
        } else {
          alert("批次刪除失敗: " + error.message);
        }
      }

      deleteSelectedBtn.disabled = false;
      deleteSelectedBtn.textContent = "刪除選取工作階段";
      this.updateBatchOperationButtons();
    });

    this.sessionsPanel.addEventListener("click", (event) => {
      if (event.target.classList.contains("session-checkbox")) {
        const sessionId = event.target.dataset.sessionId;
        if (event.target.checked) {
          this.selectedSessions.add(sessionId);
        } else {
          this.selectedSessions.delete(sessionId);
        }
        this.updateSelectAllCheckbox();
        this.updateBatchOperationButtons();
        return;
      }

      if (event.target.classList.contains("sync-delete-session-btn")) {
        const sessionId = event.target.dataset.sessionId;

        (async () => {
          if (!confirm(`確定要刪除工作階段 ${sessionId} 嗎？`)) {
            return;
          }

          event.target.disabled = true;
          event.target.textContent = "刪除中...";

          try {
            const response = await fetch(
              `${this.getApiUrl()}/sync/session/${sessionId}`,
              {
                method: "DELETE",
              },
            );
            const data = await response.json();

            if (data.success) {
              this.sessionsData = this.sessionsData.filter(
                (session) => session.id !== sessionId,
              );
              this.expandedCards.delete(sessionId);

              const card = event.target.closest(".sync-session-card");
              if (card) {
                card.remove();
              }

              if (this.sessionsData.length === 0) {
                const sessionsList =
                  this.sessionsPanel.querySelector("#sessionsList");
                sessionsList.innerHTML = `
                  <div class="sync-sessions-empty">
                    目前沒有工作階段
                  </div>
                `;
              }
              if (this.indicatorManager) {
                this.indicatorManager.showStatus(
                  "success",
                  `工作階段 ${sessionId} 已刪除`,
                );
              }
            } else {
              if (this.indicatorManager) {
                this.indicatorManager.showStatus(
                  "error",
                  "刪除失敗: " + data.message,
                );
              } else {
                alert("刪除失敗: " + data.message);
              }
              event.target.disabled = false;
              event.target.textContent = "刪除";
            }
          } catch (error) {
            Logger.error("刪除工作階段錯誤:", error);
            alert("刪除失敗: " + error.message);
            event.target.disabled = false;
            event.target.textContent = "刪除";
          }
        })();
        return;
      }

      if (event.target.closest(".sync-session-header")) {
        const card = event.target.closest(".sync-session-card");
        const sessionId = card.dataset.sessionId;

        if (sessionId) {
          const session = this.sessionsData.find((s) => s.id === sessionId);
          if (!session) return;

          const isExpanded = this.expandedCards.has(sessionId);
          const detailsElement = card.querySelector(".sync-session-details");

          if (isExpanded) {
            this.expandedCards.delete(sessionId);
            card.classList.remove("expanded");
            if (detailsElement) {
              detailsElement.innerHTML = "";
            }
          } else {
            this.expandedCards.add(sessionId);
            card.classList.add("expanded");
            if (detailsElement) {
              detailsElement.innerHTML = this.renderSessionDetails(session);
            }
          }
        }
        return;
      }

      if (event.target.closest(".sync-session-state-header")) {
        const stateToggle = event.target.closest(".sync-session-state-toggle");
        const stateDetails = stateToggle.querySelector(
          ".sync-session-state-details",
        );
        const expandIcon = stateToggle.querySelector(".sync-state-expand-icon");

        if (stateDetails && expandIcon) {
          const isExpanded = !stateDetails.classList.contains("is-hidden");
          if (isExpanded) {
            stateDetails.classList.add("is-hidden");
            expandIcon.textContent = "▶";
          } else {
            stateDetails.classList.remove("is-hidden");
            expandIcon.textContent = "▼";
          }
        }
        return;
      }
    });
  }

  updateSelectAllCheckbox() {
    const selectAllCheckbox =
      this.sessionsPanel?.querySelector("#selectAllSessions");
    const checkboxes =
      this.sessionsPanel?.querySelectorAll(".session-checkbox");

    if (!selectAllCheckbox || !checkboxes) return;

    const checkedCount = this.sessionsPanel.querySelectorAll(
      ".session-checkbox:checked",
    ).length;
    const totalCount = checkboxes.length;

    selectAllCheckbox.checked = checkedCount === totalCount && totalCount > 0;
    selectAllCheckbox.indeterminate =
      checkedCount > 0 && checkedCount < totalCount;
  }

  updateBatchOperationButtons() {
    const downloadBtn = this.sessionsPanel?.querySelector(
      "#downloadSelectedSessionsBtn",
    );
    const deleteBtn = this.sessionsPanel?.querySelector(
      "#deleteSelectedSessionsBtn",
    );

    const hasSelection = this.selectedSessions.size > 0;

    if (downloadBtn) {
      downloadBtn.disabled = !hasSelection;
    }
    if (deleteBtn) {
      deleteBtn.disabled = !hasSelection;
    }
  }
}
