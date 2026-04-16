/**
 * recordViewList - 實驗日誌列表渲染 mixin
 *
 * 負責列表顯示、選取狀態與批次按鈕控制。
 * 作為 mixin 混入 RecordView。
 */

export const recordViewList = {
  /**
   * 顯示實驗記錄列表
   * @param {Array} experiments
   */
  displayRecordList(records) {
    this.currentRecords = records;
    this._allRecords = records;
    this.selectedRecords.clear();

    this._ensureRecordFilterBindings();
    this._updateRecordFilterBounds(records);

    const container = document.getElementById("recordEntriesContainer");
    if (!container) return;

    if (records.length === 0) {
      container.innerHTML = `
        <div class="no-records">
          <div class="no-records-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
              <polyline points="14,2 14,8 20,8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10,9 9,9 8,9"></polyline>
            </svg>
          </div>
          <div class="no-records-text">目前沒有任何實驗日誌</div>
          <div class="no-records-hint">請確保已啟動伺服器並有進行過實驗</div>
        </div>`;
      return;
    }

    const filteredRecords = this._applyRecordFilters(records);

    if (filteredRecords.length === 0) {
      container.innerHTML = `
        <div class="record-filter-summary">
          <span>沒有符合篩選條件的日誌</span>
          <button class="btn-secondary" data-action="reset-filter">清除篩選</button>
        </div>`;
      return;
    }

    const filterSummary = this._isRecordFilterActive()
      ? `<div class="record-filter-summary">
           <span>${this._buildRecordFilterSummaryText(filteredRecords.length, records.length)}</span>
           <div class="record-filter-summary-actions">
             <button class="btn-secondary" data-action="select-filtered">全選篩選內容</button>
             <button class="btn-secondary" data-action="reset-filter">清除篩選</button>
           </div>
         </div>`
      : "";

    container.innerHTML = filterSummary + `
      <div class="records-list" role="list">
        ${filteredRecords.map((record) => this._renderRecordItem(record)).join("")}
      </div>`;

    this.updateDeleteButton();
  },

  /**
   * 產生單一實驗記錄項目的 HTML
   * @param {Object} exp - 實驗物件（含 filename、experimentId、logCount 等）
   * @returns {string} HTML 字串
   */
  _renderRecordItem(record) {
    const filename = record.filename ||
      `${record.experimentId}_${record.participantName}_experiment_record.jsonl`;
    const recordDate = record.startTime ? this.timeSyncManager?.formatDate(record.startTime) : "";

    return `
      <div class="record-item" data-record-id="${record.actualExperimentId || record.experimentId}">
        <div class="record-checkbox">
          <input type="checkbox" id="record-${record.filename}" data-record-id="${record.filename}">
          <label for="record-${record.filename}"></label>
        </div>
        <div class="record-details">
          <div class="record-filename">${filename}</div>
          <div class="record-meta">
            <span class="record-size">${record.logCount} 條記錄</span>
            ${recordDate ? `<span class="record-date">${recordDate}</span>` : ""}
          </div>
        </div>
        <div class="record-actions">
          <button class="btn btn-info btn-icon-only" data-action="view-record" data-record-id="${record.filename}" title="檢視">
            <svg class="icon-view" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
          <button class="btn btn-primary btn-icon-only" data-action="download-record" data-record-id="${record.filename}" title="下載">
            <svg class="icon-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 17V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V17"></path>
              <path d="M8 12L12 16L16 12"></path>
              <path d="M12 3V16"></path>
            </svg>
          </button>
          <button class="btn btn-danger btn-icon-only" data-action="delete-record" data-record-id="${record.filename}" title="刪除">
            <svg class="icon-delete" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3,6 5,6 21,6"></polyline>
              <path d="m19,6v14a2,2 0 0,1-2,2H7a2,2 0 0,1-2-2V6m3,0V4a2,2 0 0,1,2-2h4a2,2 0 0,1,2,2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
      </div>`;
  },

  /**
   * 切換指定記錄的選取狀態
   * @param {string} recordId - 記錄 filename
   */
  toggleRecordSelection(recordId) {
    if (this.selectedRecords.has(recordId)) this.selectedRecords.delete(recordId);
    else this.selectedRecords.add(recordId);
    this.updateDeleteButton();
  },

  /** 根據目前選取數量更新批次刪除與下載按鈕的顯示狀態 */
  updateDeleteButton() {
    const count = this.selectedRecords.size;
    const deleteBtn = document.getElementById("deleteSelectedRecordsBtn");
    const downloadBtn = document.getElementById("downloadSelectedRecordsBtn");
    if (deleteBtn) {
      deleteBtn.classList.toggle("is-hidden", count === 0);
      deleteBtn.title = count > 0 ? `刪除選取項目 (${count})` : "刪除選取項目";
      deleteBtn.setAttribute("aria-label", deleteBtn.title);
    }
    if (downloadBtn) downloadBtn.classList.toggle("is-hidden", count === 0);
  },
};
