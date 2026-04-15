/**
 * recordViewFilter - 實驗日誌列表篩選 UI mixin
 *
 * 提供記錄數、耗時與時間區間的篩選操作，並與 UIPopover 整合。
 * 作為 mixin 混入 RecordView。
 */

import { UIPopover } from "../ui/popover.js";

export const recordViewFilter = {
  /**
   * 產生單一篩選區塊的 HTML
   * @param {Object} opts
   * @param {string} opts.title        - 區塊標題
   * @param {string} opts.minValueId   - 最小值標籤的元素 ID
   * @param {string} opts.maxValueId   - 最大值標籤的元素 ID
   * @param {string} opts.minRangeId   - 最小值滑桿的元素 ID
   * @param {string} opts.maxRangeId   - 最大值滑桿的元素 ID
   * @param {string} opts.slidersId    - 滑桿容器的元素 ID
   * @param {string|number} opts.minValue - 初始最小值顯示文字
   * @param {string|number} opts.maxValue - 初始最大值顯示文字
   * @returns {string} HTML 字串
   */
  _renderFilterBlock({ title, minValueId, maxValueId, minRangeId, maxRangeId, slidersId, minValue, maxValue }) {
    return `
      <div class="log-filter-block">
        <div class="log-filter-title">${title}</div>
        <div class="log-filter-range">
          <div class="log-filter-values">
            <span id="${minValueId}">${minValue}</span>
            <span class="log-filter-sep">~</span>
            <span id="${maxValueId}">${maxValue}</span>
          </div>
          <div class="log-filter-sliders" id="${slidersId}">
            <input id="${minRangeId}" class="range-min" type="range" min="0" max="0" value="0" step="1">
            <input id="${maxRangeId}" class="range-max" type="range" min="0" max="0" value="0" step="1">
          </div>
        </div>
      </div>
    `;
  },

  /** 切換篩選面板的開關狀態 */
  toggleLogFilter() {
    if (!document.getElementById("logFilterPopover")) return;
    this._ensureLogFilterBindings();
    this._ensureLogFilterPopover();
    this.logFilterPopover?.toggle();
  },

  /** 套用目前篩選條件並重新渲染日誌列表 */
  applyLogFilter() {
    this._closeLogFilter();
    if (this._allExperiments) this.displayExperimentLogs(this._allExperiments);
  },

  /** 全選目前篩選結果中的所有日誌 */
  selectFilteredLogs() {
    const filtered = this._applyLogFilters(this._allExperiments || []);
    filtered.forEach((exp) => {
      if (!exp?.filename) return;
      this.selectedLogs.add(exp.filename);
      const checkbox = document.getElementById(`log-${exp.filename}`);
      if (checkbox) checkbox.checked = true;
    });
    this.updateDeleteButton();
  },

  /** 重置所有篩選條件為初始值，並重新渲染日誌列表 */
  resetLogFilter() {
    const maxAvailable = this.logCountFilter?.maxAvailable ?? 0;
    this.logCountFilter.min = 0;
    this.logCountFilter.max = maxAvailable;
    this.durationFilter.min = 0;
    this.durationFilter.max = this.durationFilter?.maxAvailable ?? 0;
    if (this.timeFilter?.minAvailable !== null) {
      this.timeFilter.min = this.timeFilter.minAvailable;
      this.timeFilter.max = this.timeFilter.maxAvailable;
    }
    this._updateLogFilterBounds(this._allExperiments || []);
    this._closeLogFilter();
    if (this._allExperiments) this.displayExperimentLogs(this._allExperiments);
  },

  /**
   * 判斷是否有任何篩選條件非預設值（即篩選已啟用）
   * @returns {boolean}
   */
  _isLogFilterActive() {
    const maxAvailable = this.logCountFilter?.maxAvailable ?? 0;
    const min = this.logCountFilter?.min ?? 0;
    const max = this.logCountFilter?.max ?? maxAvailable;
    const durationMax = this.durationFilter?.maxAvailable ?? 0;
    const durationMin = this.durationFilter?.min ?? 0;
    const durationMaxValue = this.durationFilter?.max ?? durationMax;
    const timeMinAvailable = this.timeFilter?.minAvailable ?? null;
    const timeMaxAvailable = this.timeFilter?.maxAvailable ?? null;
    const timeMin = this.timeFilter?.min ?? timeMinAvailable;
    const timeMax = this.timeFilter?.max ?? timeMaxAvailable;

    return (
      min > 0 || (maxAvailable > 0 && max < maxAvailable) ||
      durationMin > 0 || (durationMax > 0 && durationMaxValue < durationMax) ||
      (timeMinAvailable !== null && timeMaxAvailable !== null &&
        (timeMin > timeMinAvailable || timeMax < timeMaxAvailable))
    );
  },

  /**
   * 根據目前篩選條件過濾實驗陣列
   * @param {Array} experiments - 待篩選的實驗物件陣列
   * @returns {Array} 符合條件的實驗陣列
   */
  _applyLogFilters(experiments) {
    if (!Array.isArray(experiments)) return [];
    const countMin = this.logCountFilter?.min ?? 0;
    const countMax = this.logCountFilter?.max ??
      (Number.isFinite(this.logCountFilter?.maxAvailable) ? this.logCountFilter.maxAvailable : Number.MAX_SAFE_INTEGER);
    const durationMin = this.durationFilter?.min ?? 0;
    const durationMax = this.durationFilter?.max ??
      (Number.isFinite(this.durationFilter?.maxAvailable) ? this.durationFilter.maxAvailable : Number.MAX_SAFE_INTEGER);
    const timeMin = this.timeFilter?.min ?? (this.timeFilter?.minAvailable ?? Number.MIN_SAFE_INTEGER);
    const timeMax = this.timeFilter?.max ?? (this.timeFilter?.maxAvailable ?? Number.MAX_SAFE_INTEGER);

    return experiments.filter((exp) => {
      const count = Number(exp?.logCount || 0);
      const duration = this._getExperimentDurationSeconds(exp);
      const time = this._getExperimentStartTimeMs(exp);
      return count >= countMin && count <= countMax &&
        duration >= durationMin && duration <= durationMax &&
        time >= timeMin && time <= timeMax;
    });
  },

  _ensureLogFilterBindings() {
    if (this._filterUiReady) return;
    const minRange = document.getElementById("logFilterMinRange");
    const maxRange = document.getElementById("logFilterMaxRange");
    if (!minRange || !maxRange) return;

    const bind = (id, type, source) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", () => this._handleLogFilterRangeInput(type, source));
    };

    bind("logFilterMinRange", "count", "min");
    bind("logFilterMaxRange", "count", "max");
    bind("logFilterDurationMinRange", "duration", "min");
    bind("logFilterDurationMaxRange", "duration", "max");
    bind("logFilterTimeMinRange", "time", "min");
    bind("logFilterTimeMaxRange", "time", "max");

    this._filterUiReady = true;
  },

  _handleLogFilterRangeInput(type, source) {
    const configMap = {
      count: { minId: "logFilterMinRange", maxId: "logFilterMaxRange", filter: this.logCountFilter },
      duration: { minId: "logFilterDurationMinRange", maxId: "logFilterDurationMaxRange", filter: this.durationFilter },
      time: { minId: "logFilterTimeMinRange", maxId: "logFilterTimeMaxRange", filter: this.timeFilter },
    };

    const config = configMap[type];
    if (!config) return;

    const minRange = document.getElementById(config.minId);
    const maxRange = document.getElementById(config.maxId);
    if (!minRange || !maxRange) return;

    if (source === "min") { minRange.style.zIndex = "3"; maxRange.style.zIndex = "2"; }
    else { minRange.style.zIndex = "2"; maxRange.style.zIndex = "3"; }

    let min = parseInt(minRange.value, 10);
    let max = parseInt(maxRange.value, 10);

    if (source === "min" && min > max) { max = min; maxRange.value = String(max); }
    if (source === "max" && max < min) { min = max; minRange.value = String(min); }

    config.filter.min = min;
    config.filter.max = max;
    this._updateLogFilterValueLabels();
  },

  /**
   * 根據實驗資料更新篩選器的可用範圍與滑桿 DOM 屬性
   * @param {Array} experiments - 完整實驗物件陣列
   */
  _updateLogFilterBounds(experiments) {
    const maxAvailable = Array.isArray(experiments)
      ? experiments.reduce((max, exp) => Math.max(max, Number(exp?.logCount || 0)), 0)
      : 0;
    const maxDuration = Array.isArray(experiments)
      ? experiments.reduce((max, exp) => Math.max(max, this._getExperimentDurationSeconds(exp)), 0)
      : 0;
    const timeBounds = Array.isArray(experiments) && experiments.length
      ? experiments.reduce((bounds, exp) => {
          const time = this._getExperimentStartTimeMs(exp);
          if (Number.isFinite(time)) {
            bounds.min = bounds.min === null ? time : Math.min(bounds.min, time);
            bounds.max = bounds.max === null ? time : Math.max(bounds.max, time);
          }
          return bounds;
        }, { min: null, max: null })
      : { min: null, max: null };

    this.logCountFilter.maxAvailable = maxAvailable;
    this.durationFilter.maxAvailable = maxDuration;
    this.timeFilter.minAvailable = timeBounds.min;
    this.timeFilter.maxAvailable = timeBounds.max;

    if (this.logCountFilter.max === null) this.logCountFilter.max = maxAvailable;
    if (this.durationFilter.max === null) this.durationFilter.max = maxDuration;
    if (this.timeFilter.min === null && timeBounds.min !== null) this.timeFilter.min = timeBounds.min;
    if (this.timeFilter.max === null && timeBounds.max !== null) this.timeFilter.max = timeBounds.max;

    if (this.logCountFilter.max > maxAvailable) this.logCountFilter.max = maxAvailable;
    if (this.durationFilter.max > maxDuration) this.durationFilter.max = maxDuration;
    if (this.logCountFilter.min > this.logCountFilter.max) this.logCountFilter.min = this.logCountFilter.max;
    if (this.durationFilter.min > this.durationFilter.max) this.durationFilter.min = this.durationFilter.max;
    if (this.timeFilter.min !== null && this.timeFilter.max !== null &&
        this.timeFilter.min > this.timeFilter.max) {
      this.timeFilter.min = this.timeFilter.max;
    }

    const setSlider = (minId, maxId, minVal, maxVal, currentMin, currentMax) => {
      const minEl = document.getElementById(minId);
      const maxEl = document.getElementById(maxId);
      if (!minEl || !maxEl) return;
      minEl.min = String(minVal); minEl.max = String(maxVal); minEl.value = String(currentMin ?? minVal);
      maxEl.min = String(minVal); maxEl.max = String(maxVal); maxEl.value = String(currentMax ?? maxVal);
    };

    setSlider("logFilterMinRange", "logFilterMaxRange", 0, maxAvailable,
      this.logCountFilter.min, this.logCountFilter.max);
    setSlider("logFilterDurationMinRange", "logFilterDurationMaxRange", 0, maxDuration,
      this.durationFilter.min, this.durationFilter.max);

    const minTime = timeBounds.min ?? 0;
    const maxTime = timeBounds.max ?? 0;
    setSlider("logFilterTimeMinRange", "logFilterTimeMaxRange", minTime, maxTime,
      this.timeFilter.min, this.timeFilter.max);

    this._updateLogFilterValueLabels();
  },

  _updateLogFilterValueLabels() {
    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setText("logFilterMinValue", this.logCountFilter.min ?? 0);
    setText("logFilterMaxValue", this.logCountFilter.max ?? 0);
    setText("logFilterDurationMinValue",
      this.timeSyncManager?.formatDurationText(this.durationFilter.min ?? 0));
    setText("logFilterDurationMaxValue",
      this.timeSyncManager?.formatDurationText(this.durationFilter.max ?? 0));
    setText("logFilterTimeMinValue", this._formatFilterDateTime(this.timeFilter.min));
    setText("logFilterTimeMaxValue", this._formatFilterDateTime(this.timeFilter.max));

    this._updateRangeFill("logFilterCountSliders",
      this.logCountFilter.min, this.logCountFilter.max, 0, this.logCountFilter.maxAvailable);
    this._updateRangeFill("logFilterDurationSliders",
      this.durationFilter.min, this.durationFilter.max, 0, this.durationFilter.maxAvailable);
    this._updateRangeFill("logFilterTimeSliders",
      this.timeFilter.min, this.timeFilter.max,
      this.timeFilter.minAvailable, this.timeFilter.maxAvailable);
  },

  _updateRangeFill(sliderId, min, max, minBound, maxBound) {
    const container = document.getElementById(sliderId);
    if (!container || !Number.isFinite(minBound) || !Number.isFinite(maxBound)) return;
    const range = maxBound - minBound;
    if (range <= 0) return;
    const safeMin = Number.isFinite(min) ? min : minBound;
    const safeMax = Number.isFinite(max) ? max : maxBound;
    const start = Math.max(0, Math.min(100, ((safeMin - minBound) / range) * 100));
    const end = Math.max(0, Math.min(100, ((safeMax - minBound) / range) * 100));
    container.style.setProperty("--range-start", `${start}%`);
    container.style.setProperty("--range-end", `${end}%`);
  },

  _getExperimentDurationSeconds(exp) {
    if (!exp) return 0;
    if (Number.isFinite(exp.durationSeconds)) return exp.durationSeconds;
    const seconds = Math.max(0, Math.round((Number(exp.endTime || 0) - Number(exp.startTime || 0)) / 1000));
    return Number.isFinite(seconds) ? seconds : 0;
  },

  _getExperimentStartTimeMs(exp) {
    const time = Number(exp?.startTime || 0);
    return Number.isFinite(time) ? time : 0;
  },

  _formatFilterDateTime(value) {
    if (!Number.isFinite(value)) return "--";
    return this.timeSyncManager?.formatDateTimeWithPreset(value, "logFilter");
  },

  /**
   * 組合篩選結果的摘要文字（顯示於列表頂部）
   * @param {number} filteredCount - 篩選後數量
   * @param {number} totalCount    - 全部數量
   * @returns {string}
   */
  _buildLogFilterSummaryText(filteredCount, totalCount) {
    const parts = [];
    if (this.logCountFilter?.min > 0 ||
        (this.logCountFilter?.maxAvailable > 0 && this.logCountFilter?.max < this.logCountFilter?.maxAvailable)) {
      parts.push(`記錄數 ${this.logCountFilter.min}~${this.logCountFilter.max}`);
    }
    if (this.durationFilter?.min > 0 ||
        (this.durationFilter?.maxAvailable > 0 && this.durationFilter?.max < this.durationFilter?.maxAvailable)) {
      parts.push(`花費時間 ${this.timeSyncManager?.formatDurationText(this.durationFilter.min)}~${this.timeSyncManager?.formatDurationText(this.durationFilter.max)}`);
    }
    if (this.timeFilter?.minAvailable !== null && this.timeFilter?.maxAvailable !== null &&
        (this.timeFilter?.min > this.timeFilter?.minAvailable ||
         this.timeFilter?.max < this.timeFilter?.maxAvailable)) {
      parts.push(`實驗時間 ${this._formatFilterDateTime(this.timeFilter.min)}~${this._formatFilterDateTime(this.timeFilter.max)}`);
    }
    const label = parts.length ? parts.join(" / ") : "篩選條件";
    return `${label} (${filteredCount}/${totalCount})`;
  },

  _ensureLogFilterPopover() {
    if (this.logFilterPopover) return;
    const popoverEl = document.getElementById("logFilterPopover");
    const anchorEl = document.getElementById("logFilterToggleBtn");
    if (!popoverEl || !anchorEl) return;
    this.logFilterPopover = new UIPopover({ popoverEl, anchorEl, placement: "right-start", offset: 8 });
  },

  _closeLogFilter() {
    this.logFilterPopover?.close();
  },
};
