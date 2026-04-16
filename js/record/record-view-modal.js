/**
 * recordViewModal - 實驗日誌細節面板 mixin
 *
 * 管理日誌詳情、JSONL 預覽與受試者名稱更新。
 * 作為 mixin 混入 RecordView。
 */

import { UIModal } from "../ui/modal.js";

export const recordViewModal = {
  /**
   * 開啟實驗日誌詳情 modal（含統計摘要、JSONL 預覽與受試者名稱編輯）
   * @param {string} recordId    - 實驗 ID 或 filename
   * @param {Object} stats       - 由 calculateRecordStatistics() 產生的統計物件
   * @param {string} jsonlContent - 原始 JSONL 字串
   */
  showRecordViewModal(recordId, stats, jsonlContent) {
    this._logModal?.close();

    const durationStr = this.timeSyncManager?.formatDurationText(stats.totalDuration);
    const fmt = (ts) => ts
      ? this.timeSyncManager?.formatDateTimeWithPreset(ts, "recordDetail")
      : "未知";
    const experimentTimeStr = `${fmt(stats.startTime)} — ${fmt(stats.endTime)}`;
    const experimentTimeWithDuration = stats.totalDuration > 0
      ? `${experimentTimeStr} (${durationStr})`
      : experimentTimeStr;

    const formattedJsonl = this.formatJsonlForDisplay(jsonlContent);

    this._logModal = new UIModal({
      id: "recordViewModal",
      html: this._renderRecordViewModal({ recordId, stats, experimentTimeWithDuration, formattedJsonl }),
    });
    this._logModal.open();
    this._bindRecordModalActions(recordId);
  },

  _renderRecordViewModal({ recordId, stats, experimentTimeWithDuration, formattedJsonl }) {
    return `
      <div class="modal-overlay active" id="recordViewModal">
        <div class="modal-container modal-dialog modal-lg">
          <div class="modal-header">
            <h2 class="modal-title">日誌詳細資訊</h2>
            <button type="button" class="modal-close-btn" data-action="close-modal">×</button>
          </div>
          <div class="modal-body">
            <div class="record-view-container">
              ${this._renderMetadataSection({ recordId, stats, experimentTimeWithDuration })}
              ${this._renderJsonlSection({ recordId, formattedJsonl })}
            </div>
          </div>
          <div class="modal-footer">
            <button class="modal-btn modal-btn-secondary" data-action="close-modal">關閉</button>
            <button class="modal-btn modal-btn-primary" data-action="download-record" data-record-id="${recordId}">下載</button>
          </div>
        </div>
      </div>`;
  },

  _renderMetadataSection({ recordId, stats, experimentTimeWithDuration }) {
    return `
      <div class="experiment-metadata-section">
        <h3>實驗基本資料</h3>
        <div class="metadata-grid">
          ${this._renderExperimentIdItem(stats)}
          ${this._renderParticipantItem(recordId, stats)}
          ${this._renderMetadataItem("實驗組合：",
            `<span class="metadata-value">${this.escapeHtml(stats.experimentCombination || "N/A")}</span>`)}
          ${this._renderMetadataItem("實驗時間：",
            `<span class="metadata-value">${experimentTimeWithDuration}</span>`)}
        </div>
      </div>`;
  },

  _renderMetadataItem(label, innerHtml) {
    return `<div class="metadata-item"><span class="metadata-label">${label}</span>${innerHtml}</div>`;
  },

  _renderExperimentIdItem(stats) {
    const expId = this.escapeHtml(stats.experimentId || "N/A");
    const expIdRaw = this.escapeHtml(stats.experimentId || "");
    return this._renderMetadataItem("實驗ID：", `
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
      </div>`);
  },

  _renderParticipantItem(recordId, stats) {
    const participantName = this.escapeHtml(stats.participantName || "");
    const safeRecordId = this.escapeHtml(recordId);
    return this._renderMetadataItem("受試者名稱：", `
      <div class="metadata-value-row">
        <span class="metadata-value" id="modal-participant-display">${participantName}</span>
        <input type="text" id="modal-participant-input" class="metadata-edit-input"
          value="${participantName}" placeholder="輸入受試者名稱" style="display:none;">
        <div class="metadata-actions">
          <button class="btn btn-sm btn-secondary" id="modal-participant-edit-btn" data-action="edit-participant">✏️ 編輯</button>
          <button class="btn btn-sm btn-primary" id="modal-participant-save-btn" style="display:none;" data-action="save-participant" data-record-id="${safeRecordId}">儲存</button>
          <button class="btn btn-sm btn-secondary" id="modal-participant-cancel-btn" style="display:none;" data-action="cancel-participant">取消</button>
        </div>
      </div>`);
  },

  _renderJsonlSection({ recordId, formattedJsonl }) {
    return `
      <div class="jsonl-section">
        <div class="jsonl-header">
          <h3>JSONL 原始碼</h3>
          <button class="btn-copy-jsonl" id="jsonl-copy-btn-${recordId}" data-action="copy-jsonl" data-record-id="${recordId}" title="複製 JSONL 內容">
            <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="11" y="11" width="10" height="10" rx="1" ry="1"></rect>
              <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"></path>
            </svg>
            複製
          </button>
        </div>
        <div class="jsonl-content" id="jsonl-content-${recordId}">
          <pre>${this.escapeHtml(formattedJsonl)}</pre>
        </div>
      </div>`;
  },

  _bindRecordModalActions(recordId) {
    const modal = document.getElementById("recordViewModal");
    if (!modal || modal.dataset.bound === "true") return;
    modal.dataset.bound = "true";

    modal.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action;
      const targetRecordId = target.dataset.recordId || recordId;

      switch (action) {
        case "close-modal": this._logModal?.close(); break;
        case "download-record": if (targetRecordId) this.downloadRecordById(targetRecordId); break;
        case "copy-text": this.copyToClipboard(target.dataset.copyText || "", target); break;
        case "copy-jsonl": if (targetRecordId) this.copyJsonlContent(targetRecordId); break;
        case "edit-participant": this._openParticipantEdit(); break;
        case "cancel-participant": this._cancelParticipantEdit(); break;
        case "save-participant": this._saveParticipantEdit(target.dataset.recordId || recordId); break;
      }
    });
  },

  _openParticipantEdit() {
    const show = (id, display) => { const el = document.getElementById(id); if (el) el.style.display = display; };
    show("modal-participant-display", "none");
    show("modal-participant-input", "inline-block");
    show("modal-participant-edit-btn", "none");
    show("modal-participant-save-btn", "inline-block");
    show("modal-participant-cancel-btn", "inline-block");
  },

  _cancelParticipantEdit() {
    const display = document.getElementById("modal-participant-display");
    const input = document.getElementById("modal-participant-input");
    if (input) input.style.display = "none";
    if (display) { display.style.display = ""; }
    const show = (id, display) => { const el = document.getElementById(id); if (el) el.style.display = display; };
    show("modal-participant-edit-btn", "");
    show("modal-participant-save-btn", "none");
    show("modal-participant-cancel-btn", "none");
    if (input && display) input.value = display.textContent || "";
  },

  _saveParticipantEdit(recordId) {
    const input = document.getElementById("modal-participant-input");
    if (input) this.updateParticipantName(recordId, input.value);
  },

  /**
   * 複製文字到剪貼簿，並短暫切換按鈕視覺狀態
   * @param {string}      text      - 要複製的文字
   * @param {HTMLElement} triggerEl - 觸發複製的按鈕元素
   */
  copyToClipboard(text, triggerEl) {
    if (!text || !navigator?.clipboard?.writeText) return;
    navigator.clipboard.writeText(text)
      .then(() => this._setCopyState(triggerEl))
      .catch(() => {});
  },

  _setCopyState(triggerEl) {
    if (!triggerEl) return;
    triggerEl.classList.add("is-copied");
    clearTimeout(triggerEl._copyTimer);
    triggerEl._copyTimer = setTimeout(() => {
      triggerEl.classList.remove("is-copied");
      triggerEl._copyTimer = null;
    }, 1200);
  },

  /**
   * 將 JSONL 字串格式化為易讀的多行 JSON 顯示（每行截斷至 100 字元）
   * @param {string} jsonlContent - 原始 JSONL 字串
   * @returns {string} 格式化後的字串
   */
  formatJsonlForDisplay(jsonlContent) {
    return jsonlContent.trim().split("\n").map((line) => {
      try {
        return JSON.stringify(JSON.parse(line), null, 2)
          .split("\n")
          .map((l) => l.length > 100 ? l.substring(0, 100) + "..." : l)
          .join("\n");
      } catch {
        return line;
      }
    }).join("\n\n");
  },

  /**
   * 複製指定日誌的 JSONL 預覽內容到剪貼簿
  * @param {string} recordId - 實驗 ID 或 filename（用於定位 DOM 元素）
   * @returns {Promise<void>}
   */
  async copyJsonlContent(recordId) {
    const contentEl = document.getElementById(`jsonl-content-${recordId}`);
    const copyBtn = document.getElementById(`jsonl-copy-btn-${recordId}`);
    if (!contentEl || !copyBtn) return;

    const text = contentEl.querySelector("pre")?.textContent || "";
    const setButtonState = (html, cls, revert) => {
      const original = copyBtn.innerHTML;
      copyBtn.innerHTML = html;
      copyBtn.classList.add(cls);
      setTimeout(() => { copyBtn.classList.remove(cls); copyBtn.innerHTML = revert || original; }, 2000);
    };

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = Object.assign(document.createElement("textarea"), {
          value: text,
          style: "position:fixed;opacity:0",
        });
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setButtonState("✓ 已複製", "btn-copy-success");
    } catch {
      setButtonState("✕ 複製失敗", "btn-copy-error");
    }
  },

  /**
   * 將字串中的 HTML 特殊字元轉義（防止 XSS）
   * @param {string} text - 原始字串
   * @returns {string} 轉義後的安全字串
   */
  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  },
};
