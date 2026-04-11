/**
 * LogModalPanel - 實驗日誌細節面板
 *
 * 管理日誌詳情、JSONL 預覽與受試者名稱更新。
 */

import { UIModal } from "../ui/modal.js";

export const logModalPanel = {
  /**
  * 顯示日誌詳細面板
   * @param {string} logId - 日誌檔案識別
   * @param {Object} stats - 日誌統計資料
   * @param {string} jsonlContent - JSONL 內容
   */
  showLogViewModal(logId, stats, jsonlContent) {
    if (this._logModal) {
      this._logModal.close();
    }

    const durationStr = this.timeSyncManager.formatDurationText(
      stats.totalDuration,
    );
    const startTimeStr = stats.startTime
      ? this.timeSyncManager.formatDateTimeWithPreset(
          stats.startTime,
          "logDetail",
        )
      : "未知";
    const endTimeStr = stats.endTime
      ? this.timeSyncManager.formatDateTimeWithPreset(
          stats.endTime,
          "logDetail",
        )
      : "未知";
    const experimentTimeStr = `${startTimeStr} — ${endTimeStr}`;
    const experimentTimeWithDuration =
      stats.totalDuration > 0
        ? `${experimentTimeStr} (${durationStr})`
        : experimentTimeStr;

    const formattedJsonl = this.formatJsonlForDisplay(jsonlContent);

    const modalHtml = this._renderLogViewModal({
      logId,
      stats,
      experimentTimeWithDuration,
      formattedJsonl,
    });

    this._logModal = new UIModal({ id: "logViewModal", html: modalHtml });
    this._logModal.open();

    this._bindLogModalActions(logId);
  },

  _renderLogViewModal({ logId, stats, experimentTimeWithDuration, formattedJsonl }) {
    return `
      <div class="modal-overlay active" id="logViewModal">
        <div class="modal-container modal-dialog modal-lg">
          ${this._renderLogModalHeader()}
          <div class="modal-body">
            <div class="log-view-container">
              ${this._renderMetadataSection({
                logId,
                stats,
                experimentTimeWithDuration,
              })}
              ${this._renderJsonlSection({ logId, formattedJsonl })}
            </div>
          </div>
          ${this._renderLogModalFooter(logId)}
        </div>
      </div>
    `;
  },

  _renderLogModalHeader() {
    return `
      <div class="modal-header">
        <h2 class="modal-title">日誌詳細資訊</h2>
        <button type="button" class="modal-close-btn" data-action="close-modal">×</button>
      </div>
    `;
  },

  _renderLogModalFooter(logId) {
    return `
      <div class="modal-footer">
        <button class="modal-btn modal-btn-secondary" data-action="close-modal">
          關閉
        </button>
        <button class="modal-btn modal-btn-primary" data-action="download-log" data-log-id="${logId}">
          下載
        </button>
      </div>
    `;
  },

  _renderMetadataSection({ logId, stats, experimentTimeWithDuration }) {
    return `
      <div class="experiment-metadata-section">
        <h3>實驗基本資料</h3>
        <div class="metadata-grid">
          ${this._renderExperimentIdItem(stats)}
          ${this._renderParticipantItem(logId, stats)}
          ${this._renderMetadataItem("實驗組合：", `<span class=\"metadata-value\">${this.escapeHtml(
            stats.experimentCombination || "N/A",
          )}</span>`)}
          ${this._renderMetadataItem("實驗時間：", `<span class=\"metadata-value\">${experimentTimeWithDuration}</span>`)}
        </div>
      </div>
    `;
  },

  _renderMetadataItem(label, innerHtml) {
    return `
      <div class="metadata-item">
        <span class="metadata-label">${label}</span>
        ${innerHtml}
      </div>
    `;
  },

  _renderExperimentIdItem(stats) {
    const expId = this.escapeHtml(stats.experimentId || "N/A");
    const expIdRaw = this.escapeHtml(stats.experimentId || "");
    return this._renderMetadataItem(
      "實驗ID：",
      `
        <div class="metadata-value-row">
          <span class="metadata-value">${expId}</span>
          <div class="metadata-actions">
            <button class="metadata-copy-btn" title="複製實驗ID" data-action="copy-text" data-copy-text="${expIdRaw}">
              <svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="10" height="10" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 6L9 17l-5-5"></path>
              </svg>
            </button>
          </div>
        </div>
      `,
    );
  },

  _renderParticipantItem(logId, stats) {
    const participantName = this.escapeHtml(stats.participantName || "");
    const safeLogId = this.escapeHtml(logId);
    return this._renderMetadataItem(
      "受試者名稱：",
      `
        <div class="metadata-value-row">
          <span class="metadata-value" id="modal-participant-display">${participantName}</span>
          <input type="text" id="modal-participant-input" class="metadata-edit-input"
            value="${participantName}"
            placeholder="輸入受試者名稱"
            style="display:none;">
          <div class="metadata-actions">
            <button class="btn btn-sm btn-secondary" id="modal-participant-edit-btn" data-action="edit-participant">✏️ 編輯</button>
            <button class="btn btn-sm btn-primary" id="modal-participant-save-btn" style="display:none;" data-action="save-participant" data-log-id="${safeLogId}">儲存</button>
            <button class="btn btn-sm btn-secondary" id="modal-participant-cancel-btn" style="display:none;" data-action="cancel-participant">取消</button>
          </div>
        </div>
      `,
    );
  },

  _renderJsonlSection({ logId, formattedJsonl }) {
    return `
      <div class="jsonl-section">
        <div class="jsonl-header">
          <h3>JSONL 原始碼</h3>
          <button class="btn-copy-jsonl" id="jsonl-copy-btn-${logId}" data-action="copy-jsonl" data-log-id="${logId}" title="複製 JSONL 內容">
            <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="11" y="11" width="10" height="10" rx="1" ry="1"></rect>
              <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"></path>
            </svg>
            複製
          </button>
        </div>
        <div class="jsonl-content" id="jsonl-content-${logId}">
          <pre>${this.escapeHtml(formattedJsonl)}</pre>
        </div>
      </div>
    `;
  },

  _bindLogModalActions(logId) {
    const modal = document.getElementById("logViewModal");
    if (!modal || modal.dataset.bound === "true") return;
    modal.dataset.bound = "true";

    modal.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action;
      const targetLogId = target.dataset.logId || logId;

      switch (action) {
        case "close-modal":
          this._logModal?.close();
          break;
        case "download-log":
          if (targetLogId) this.downloadLogById(targetLogId);
          break;
        case "copy-text":
          this.copyToClipboard(target.dataset.copyText || "", target);
          break;
        case "copy-jsonl":
          if (targetLogId) this.copyJsonlContent(targetLogId);
          break;
        case "edit-participant":
          this._openParticipantEdit();
          break;
        case "cancel-participant":
          this._cancelParticipantEdit();
          break;
        case "save-participant":
          this._saveParticipantEdit(target.dataset.logId || logId);
          break;
        default:
          break;
      }
    });
  },

  _openParticipantEdit() {
    const displayEl = document.getElementById("modal-participant-display");
    const inputEl = document.getElementById("modal-participant-input");
    const editBtn = document.getElementById("modal-participant-edit-btn");
    const saveBtn = document.getElementById("modal-participant-save-btn");
    const cancelBtn = document.getElementById("modal-participant-cancel-btn");
    if (!displayEl || !inputEl || !editBtn || !saveBtn || !cancelBtn) return;

    inputEl.style.display = "inline-block";
    displayEl.style.display = "none";
    editBtn.style.display = "none";
    saveBtn.style.display = "inline-block";
    cancelBtn.style.display = "inline-block";
  },

  _cancelParticipantEdit() {
    const displayEl = document.getElementById("modal-participant-display");
    const inputEl = document.getElementById("modal-participant-input");
    const editBtn = document.getElementById("modal-participant-edit-btn");
    const saveBtn = document.getElementById("modal-participant-save-btn");
    const cancelBtn = document.getElementById("modal-participant-cancel-btn");
    if (!displayEl || !inputEl || !editBtn || !saveBtn || !cancelBtn) return;

    inputEl.style.display = "none";
    displayEl.style.display = "";
    editBtn.style.display = "";
    saveBtn.style.display = "none";
    cancelBtn.style.display = "none";
    inputEl.value = displayEl.textContent || "";
  },

  _saveParticipantEdit(logId) {
    const inputEl = document.getElementById("modal-participant-input");
    if (!inputEl) return;
    this.updateParticipantName(logId, inputEl.value);
  },

  copyToClipboard(text, triggerEl) {
    if (!text) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        this._fallbackCopy(text);
      });
      this._setCopyState(triggerEl);
      return;
    }
    this._fallbackCopy(text);
    this._setCopyState(triggerEl);
  },

  _fallbackCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  },

  _setCopyState(triggerEl) {
    if (!triggerEl) return;
    triggerEl.classList.add("is-copied");
    if (triggerEl._copyTimer) {
      clearTimeout(triggerEl._copyTimer);
    }
    triggerEl._copyTimer = setTimeout(() => {
      triggerEl.classList.remove("is-copied");
      triggerEl._copyTimer = null;
    }, 1200);
  },

  /**
   * 格式化 JSONL 內容供顯示
   * @param {string} jsonlContent - JSONL 內容
   * @returns {string} 格式化後的內容
   */
  formatJsonlForDisplay(jsonlContent) {
    const lines = jsonlContent.trim().split("\n");
    return lines
      .map((line) => {
        try {
          const obj = JSON.parse(line);
          return JSON.stringify(obj, null, 2)
            .split("\n")
            .map((l, i, arr) => {
              if (l.length > 100) {
                return l.substring(0, 100) + "...";
              }
              return l;
            })
            .join("\n");
        } catch (e) {
          return line;
        }
      })
      .join("\n\n");
  },

  /**
   * 複製 JSONL 內容
   * @param {string} logId - 日誌檔案識別
   */
  async copyJsonlContent(logId) {
    try {
      const contentElement = document.getElementById(`jsonl-content-${logId}`);
      const copyButton = document.getElementById(`jsonl-copy-btn-${logId}`);

      if (!contentElement) {
        Logger.warn("無法找到 JSONL 內容元素");
        return;
      }

      if (!copyButton) {
        Logger.warn("無法找到複製按鈕");
        return;
      }

      const preElement = contentElement.querySelector("pre");
      if (!preElement) {
        Logger.warn("無法找到 pre 元素");
        return;
      }

      const text = preElement.textContent || preElement.innerText;

      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        Logger.debug("JSONL 內容已複製到剪貼板");

        const originalHTML = copyButton.innerHTML;
        copyButton.innerHTML = "✓ 已複製";
        copyButton.classList.add("btn-copy-success");
        setTimeout(() => {
          copyButton.classList.remove("btn-copy-success");
          copyButton.innerHTML = originalHTML;
        }, 2000);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);

        Logger.debug("JSONL 內容已用備用方法複製到剪貼板");

        const originalHTML = copyButton.innerHTML;
        copyButton.innerHTML = "✓ 已複製";
        copyButton.classList.add("btn-copy-success");
        setTimeout(() => {
          copyButton.classList.remove("btn-copy-success");
          copyButton.innerHTML = originalHTML;
        }, 2000);
      }
    } catch (error) {
      Logger.error("複製 JSONL 內容失敗:", error);

      const copyButton = document.getElementById(`jsonl-copy-btn-${logId}`);
      if (copyButton) {
        const originalHTML = copyButton.innerHTML;
        copyButton.innerHTML = "✕ 複製失敗";
        copyButton.classList.add("btn-copy-error");
        setTimeout(() => {
          copyButton.classList.remove("btn-copy-error");
          copyButton.innerHTML = originalHTML;
        }, 2000);
      }
    }
  },

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  },
};
