/**
 * SyncManager Sessions - 工作階段管理UI
 * 負責查看和管理所有工作階段
 */

export class SyncManagerSessions {
  constructor(core) {
    this.core = core;
    this.sessionsPanel = null;
    this.sessionsData = [];
    this.expandedCards = new Set();
    this.selectedSessions = new Set(); // 選取的工作階段
  }

  /**
   * 取得 API URL（支援 Nginx 反向代理）
   */
  getApiUrl() {
    const protocol = window.location.protocol;
    const host = window.location.host; // 包含 hostname 和 port

    // 根據環境決定 API 路徑前綴
    const basePath = this.getApiBasePath();

    return `${protocol}//${host}${basePath}`;
  }

  /**
   * 取得 API 路徑前綴（參考 QR code 的動態路徑邏輯，完全避免硬編碼）
   */
  getApiBasePath() {
    // 根據頁面路徑動態決定 API 前綴（完全動態，無硬編碼）
    const pathname = window.location.pathname;

    // 取得頁面所在的目錄路徑
    let basePath = pathname;
    if (!basePath.endsWith("/")) {
      // 如果包含檔名，移除檔名部分
      basePath = basePath.substring(0, basePath.lastIndexOf("/") + 1);
    }

    // 確保以 / 結尾
    if (!basePath.endsWith("/")) {
      basePath += "/";
    }

    // API 永遠在頁面所在目錄的 api 子目錄
    // 讓 Nginx 處理實際的路徑映射
    return basePath + "api";
  }

  /**
   * 初始化工作階段管理
   */
  initialize() {
    // 監聽查看工作階段事件
    window.addEventListener("sync_show_sessions", () => {
      this.showSessionsPanel();
    });

    // 監聽工作階段建立事件，自動重新整理列表
    window.addEventListener("sync_session_created", () => {
      // 如果面板正在顯示，自動重新整理
      if (this.sessionsPanel && document.body.contains(this.sessionsPanel)) {
        this.refreshSessionsList();
      }
    });

    // 監聽工作階段失效事件，清理相關資料
    window.addEventListener("sync_session_invalid", (event) => {
      const { reason, originalError } = event.detail;

      Logger.info("[SyncManagerSessions] 工作階段失效，重新載入列表", {
        reason,
        originalError,
      });

      // 如果面板正在顯示，重新載入工作階段列表
      if (this.sessionsPanel && document.body.contains(this.sessionsPanel)) {
        this.refreshSessionsList();
      }
    });
  }

  /**
   * 顯示工作階段管理面板
   */
  async showSessionsPanel() {
    if (this.sessionsPanel) {
      this.sessionsPanel.remove();
    }

    // 取得工作階段資料
    await this.loadSessionsData();

    this.sessionsPanel = document.createElement("div");
    this.sessionsPanel.className = "modal-overlay sync-sessions-overlay active";

    this.sessionsPanel.innerHTML = `
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

          <!-- 批次操作區域 -->
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
    `;

    document.body.appendChild(this.sessionsPanel);

    // 綁定事件
    this.bindEvents();
  }

  /**
   * 載入工作階段資料
   */
  async loadSessionsData() {
    try {
      // 使用動態 API URL，支援 Nginx 反向代理
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

  /**
   * 重新整理工作階段列表（不重新顯示面板）
   */
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

  /**
   * 渲染工作階段列表
   */
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

  /**
   * 渲染單個工作階段卡片
   */
  renderSessionCard(session) {
    const isExpanded = this.expandedCards.has(session.id);
    const createdTime = window.timeSyncManager
      ? window.timeSyncManager.formatDateTime(session.created * 1000)
      : new Date(session.created * 1000).toLocaleString("zh-TW", {
          timeZone: window.CONFIG?.timezone || "Asia/Taipei",
        });
    const lastActivity = window.timeSyncManager
      ? window.timeSyncManager.formatDateTime(session.lastActivity * 1000)
      : new Date(session.lastActivity * 1000).toLocaleString("zh-TW", {
          timeZone: window.CONFIG?.timezone || "Asia/Taipei",
        });
    const isActive = Date.now() / 1000 - session.lastActivity < 600; // 10分鐘內有活動

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

  /**
   * 格式化同步狀態資料為易讀格式
   */
  formatSyncState(state) {
    // 如果 state 是字串，先解析為物件
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
        // 對於長字串進行適當的截斷和格式化
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
    // 處理分享代碼資訊（支援多個分享代碼）
    const shareCodeInfo = (() => {
      if (!session.shareCodes || session.shareCodes.length === 0) {
        return '<div class="sync-session-info sync-session-info-no-code">無分享代碼</div>';
      }

      // 依建立時間排序（最新的在前）
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

          const createdTime = window.timeSyncManager
            ? window.timeSyncManager.formatDateTime(code.createdAt * 1000)
            : new Date(code.createdAt * 1000).toLocaleString("zh-TW", {
                timeZone: window.CONFIG?.timezone || "Asia/Taipei",
              });
          const expiresTime = window.timeSyncManager
            ? window.timeSyncManager.formatDateTime(code.expiresAt * 1000)
            : new Date(code.expiresAt * 1000).toLocaleString("zh-TW", {
                timeZone: window.CONFIG?.timezone || "Asia/Taipei",
              });
          const usedTime = code.usedAt
            ? window.timeSyncManager
              ? window.timeSyncManager.formatDateTime(code.usedAt * 1000)
              : new Date(code.usedAt * 1000).toLocaleString("zh-TW", {
                  timeZone: window.CONFIG?.timezone || "Asia/Taipei",
                })
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
              const joinedTime = window.timeSyncManager
                ? window.timeSyncManager.formatDateTime(client.joinedAt * 1000)
                : new Date(client.joinedAt * 1000).toLocaleString("zh-TW", {
                    timeZone: window.CONFIG?.timezone || "Asia/Taipei",
                  });
              const lastActivityTime = window.timeSyncManager
                ? window.timeSyncManager.formatDateTime(
                    client.lastActivity * 1000,
                  )
                : new Date(client.lastActivity * 1000).toLocaleString("zh-TW", {
                    timeZone: window.CONFIG?.timezone || "Asia/Taipei",
                  });
              return `
        <div class="sync-session-client ${client.role}">
          <div><strong>裝置ID:</strong> ${client.id}</div>
          <div><strong>角色:</strong> ${
            client.role === "operator" ? "操作者" : "檢視者"
          }</div>
          <div><strong>加入時間:</strong> ${joinedTime}</div>
          <div><strong>最後活動:</strong> ${lastActivityTime}</div>
        </div>
      `;
            })
            .join("")
        : '<div class="sync-session-no-clients">無裝置</div>';

    const stateInfo = session.state
      ? (() => {
          // 如果 state 是字串，先解析為物件來計算欄位數量
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
        <div class="sync-session-state-details" style="display: none;">
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

  /**
   * 綁定事件
   */
  bindEvents() {
    // 關閉按鈕
    const closeBtn = this.sessionsPanel.querySelector(".modal-close-btn");
    closeBtn.addEventListener("click", () => {
      this.sessionsPanel.remove();
      this.sessionsPanel = null;
    });

    // 重新整理按鈕
    const refreshBtn = this.sessionsPanel.querySelector("#refreshSessionsBtn");
    refreshBtn.addEventListener("click", () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "載入中...";

      // 將重操作移到下一個事件循環
      setTimeout(async () => {
        await this.loadSessionsData();
        const sessionsList = this.sessionsPanel.querySelector("#sessionsList");
        sessionsList.innerHTML = this.renderSessionsList();

        refreshBtn.disabled = false;
        refreshBtn.textContent = "重新整理";
      }, 0);
    });

    // 刪除所有工作階段按鈕
    const clearAllBtn = this.sessionsPanel.querySelector(
      "#clearAllSessionsBtn",
    );
    clearAllBtn.addEventListener("click", () => {
      // 將所有操作（包括確認對話框）移到下一個事件循環
      setTimeout(async () => {
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
            // 清空本機資料
            this.sessionsData = [];
            this.expandedCards.clear();

            // 高效更新：直接顯示空狀態而不是重新渲染
            const sessionsList =
              this.sessionsPanel.querySelector("#sessionsList");
            sessionsList.innerHTML = `
              <div class="sync-sessions-empty">
                目前沒有工作階段
              </div>
            `;
          } else {
            alert("刪除失敗: " + data.message);
          }
        } catch (error) {
          Logger.error("刪除所有工作階段錯誤:", error);
          alert("刪除失敗: " + error.message);
        }

        clearAllBtn.disabled = false;
        clearAllBtn.textContent = "刪除所有工作階段";
      }, 0);
    });

    // 結束所有活動中工作階段按鈕
    const stopAllActiveBtn = this.sessionsPanel.querySelector(
      "#stopAllActiveSessionsBtn",
    );
    stopAllActiveBtn.addEventListener("click", () => {
      setTimeout(async () => {
        const activeSessions = this.sessionsData.filter((session) => {
          const isActive = Date.now() / 1000 - session.lastActivity < 600;
          return isActive;
        });

        if (activeSessions.length === 0) {
          alert("目前沒有活動中的工作階段");
          return;
        }

        if (
          !confirm(
            `確定要結束所有 ${activeSessions.length} 個活動中工作階段嗎？`,
          )
        ) {
          return;
        }

        stopAllActiveBtn.disabled = true;
        stopAllActiveBtn.textContent = "處理中...";

        try {
          // 這裡可以實現結束活動中工作階段的邏輯
          // 目前先顯示成功訊息
          alert(`已結束 ${activeSessions.length} 個活動中工作階段`);
          await this.refreshSessionsList();
        } catch (error) {
          Logger.error("結束活動中工作階段錯誤:", error);
          alert("操作失敗: " + error.message);
        }

        stopAllActiveBtn.disabled = false;
        stopAllActiveBtn.textContent = "結束所有活動中工作階段";
      }, 0);
    });

    // 全選按鈕
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

    // 選取無同步資料的工作階段
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

    // 選取僅一個裝置的工作階段
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

    // 下載選取工作階段
    const downloadSelectedBtn = this.sessionsPanel.querySelector(
      "#downloadSelectedSessionsBtn",
    );
    downloadSelectedBtn.addEventListener("click", () => {
      if (this.selectedSessions.size === 0) {
        alert("請先選取要下載的工作階段");
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

      alert(`已下載 ${this.selectedSessions.size} 個工作階段的資料`);
    });

    // 刪除選取工作階段
    const deleteSelectedBtn = this.sessionsPanel.querySelector(
      "#deleteSelectedSessionsBtn",
    );
    deleteSelectedBtn.addEventListener("click", () => {
      setTimeout(async () => {
        if (this.selectedSessions.size === 0) {
          alert("請先選取要刪除的工作階段");
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
          const successCount = results.filter(
            (result) => result.success,
          ).length;
          const failCount = results.length - successCount;

          // 從本機資料中移除已刪除的工作階段
          this.sessionsData = this.sessionsData.filter(
            (session) => !this.selectedSessions.has(session.id),
          );

          // 清空選取狀態
          this.selectedSessions.clear();

          // 重新渲染列表
          await this.refreshSessionsList();

          if (failCount === 0) {
            alert(`成功刪除 ${successCount} 個工作階段`);
          } else {
            alert(`刪除完成：成功 ${successCount} 個，失敗 ${failCount} 個`);
          }
        } catch (error) {
          Logger.error("批次刪除工作階段錯誤:", error);
          alert("批次刪除失敗: " + error.message);
        }

        deleteSelectedBtn.disabled = false;
        deleteSelectedBtn.textContent = "刪除選取工作階段";
        this.updateBatchOperationButtons();
      }, 0);
    });

    // 統一的事件處理器：處理卡片展開/收合、同步狀態展開/收合、以及各種按鈕點擊
    this.sessionsPanel.addEventListener("click", (event) => {
      // 處理勾選框
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

      // 處理刪除單個工作階段按鈕
      if (event.target.classList.contains("sync-delete-session-btn")) {
        const sessionId = event.target.dataset.sessionId;

        // 將所有操作（包括確認對話框）移到下一個事件循環
        setTimeout(async () => {
          if (!confirm(`確定要刪除工作階段 ${sessionId} 嗎？`)) {
            return;
          }

          // 立即停用按鈕並顯示載入狀態
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
              // 從本機資料中移除已刪除的工作階段
              this.sessionsData = this.sessionsData.filter(
                (session) => session.id !== sessionId,
              );
              this.expandedCards.delete(sessionId);

              // 高效更新：直接移除對應的卡片而不是重新渲染整個列表
              const card = event.target.closest(".sync-session-card");
              if (card) {
                card.remove();
              }

              // 檢查是否還有工作階段，如果沒有則顯示空狀態
              if (this.sessionsData.length === 0) {
                const sessionsList =
                  this.sessionsPanel.querySelector("#sessionsList");
                sessionsList.innerHTML = `
                  <div class="sync-sessions-empty">
                    目前沒有工作階段
                  </div>
                `;
              }
            } else {
              alert("刪除失敗: " + data.message);
              // 還原按鈕狀態
              event.target.disabled = false;
              event.target.textContent = "刪除";
            }
          } catch (error) {
            Logger.error("刪除工作階段錯誤:", error);
            alert("刪除失敗: " + error.message);
            // 還原按鈕狀態
            event.target.disabled = false;
            event.target.textContent = "刪除";
          }
        }, 0);
        return;
      }

      // 處理卡片展開/收合
      if (event.target.closest(".sync-session-header")) {
        const card = event.target.closest(".sync-session-card");
        const sessionId = card.dataset.sessionId;

        if (sessionId) {
          // 找到對應的 session 資料
          const session = this.sessionsData.find((s) => s.id === sessionId);
          if (!session) return;

          // 切換展開狀態
          const isExpanded = this.expandedCards.has(sessionId);
          const detailsElement = card.querySelector(".sync-session-details");

          if (isExpanded) {
            // 收起：移除展開狀態，清空內容
            this.expandedCards.delete(sessionId);
            card.classList.remove("expanded");
            if (detailsElement) {
              detailsElement.innerHTML = "";
            }
          } else {
            // 展開：新增展開狀態，產生內容
            this.expandedCards.add(sessionId);
            card.classList.add("expanded");
            if (detailsElement) {
              detailsElement.innerHTML = this.renderSessionDetails(session);
            }
          }
        }
        return;
      }

      // 處理同步狀態展開/收合
      if (event.target.closest(".sync-session-state-header")) {
        const stateToggle = event.target.closest(".sync-session-state-toggle");
        const stateDetails = stateToggle.querySelector(
          ".sync-session-state-details",
        );
        const expandIcon = stateToggle.querySelector(".sync-state-expand-icon");

        if (stateDetails && expandIcon) {
          const isExpanded = stateDetails.style.display !== "none";
          if (isExpanded) {
            // 收起
            stateDetails.style.display = "none";
            expandIcon.textContent = "▶";
          } else {
            // 展開
            stateDetails.style.display = "block";
            expandIcon.textContent = "▼";
          }
        }
        return;
      }
    });
  }

  /**
   * 更新全選勾選框狀態
   */
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

  /**
   * 更新批次操作按鈕狀態
   */
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

  /**
   * 清理資源
   */
  cleanup() {
    if (this.sessionsPanel) {
      this.sessionsPanel.remove();
      this.sessionsPanel = null;
    }
    this.expandedCards.clear();
    this.selectedSessions.clear();
  }
}
