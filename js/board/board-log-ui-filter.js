/**
 * LogFilterPanel - 實驗日誌列表篩選 UI
 *
 * 提供記錄數、耗時與時間區間的篩選操作，並與 UIPopover 整合。
 */

import { UIPopover } from "../ui/popover.js";

export const logFilterPanel = {
  _renderFilterBlock({
    title,
    minValueId,
    maxValueId,
    minRangeId,
    maxRangeId,
    slidersId,
    minValue,
    maxValue,
  }) {
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

  toggleLogFilter() {
    const popover = document.getElementById("logFilterPopover");
    if (!popover) return;
    this._ensureLogFilterBindings();
    this._ensureLogFilterPopover();
    this.logFilterPopover?.toggle();
  },

  applyLogFilter() {
    this._closeLogFilter();
    if (this._allExperiments) {
      this.displayExperimentLogs(this._allExperiments);
    }
  },

  selectFilteredLogs() {
    const filtered = this._applyLogFilters(this._allExperiments || []);
    if (!filtered.length) return;

    filtered.forEach((exp) => {
      if (!exp?.filename) return;
      this.selectedLogs.add(exp.filename);
      const checkbox = document.getElementById(`log-${exp.filename}`);
      if (checkbox) {
        checkbox.checked = true;
      }
    });

    this.updateDeleteButton();
  },

  resetLogFilter() {
    const maxAvailable = this.logCountFilter?.maxAvailable ?? 0;
    this.logCountFilter.min = 0;
    this.logCountFilter.max = maxAvailable;
    const maxDuration = this.durationFilter?.maxAvailable ?? 0;
    this.durationFilter.min = 0;
    this.durationFilter.max = maxDuration;
    if (this.timeFilter?.minAvailable !== null) {
      this.timeFilter.min = this.timeFilter.minAvailable;
      this.timeFilter.max = this.timeFilter.maxAvailable;
    }
    this._updateLogFilterBounds(this._allExperiments || []);
    this._closeLogFilter();
    if (this._allExperiments) {
      this.displayExperimentLogs(this._allExperiments);
    }
  },

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

    const countActive = min > 0 || (maxAvailable > 0 && max < maxAvailable);
    const durationActive =
      durationMin > 0 ||
      (durationMax > 0 && durationMaxValue < durationMax);
    const timeActive =
      timeMinAvailable !== null &&
      timeMaxAvailable !== null &&
      (timeMin > timeMinAvailable || timeMax < timeMaxAvailable);

    return countActive || durationActive || timeActive;
  },

  _applyLogFilters(experiments) {
    if (!Array.isArray(experiments)) return [];
    const countMin = this.logCountFilter?.min ?? 0;
    const countMax =
      this.logCountFilter?.max ??
      (Number.isFinite(this.logCountFilter?.maxAvailable)
        ? this.logCountFilter.maxAvailable
        : Number.MAX_SAFE_INTEGER);
    const durationMin = this.durationFilter?.min ?? 0;
    const durationMax =
      this.durationFilter?.max ??
      (Number.isFinite(this.durationFilter?.maxAvailable)
        ? this.durationFilter.maxAvailable
        : Number.MAX_SAFE_INTEGER);
    const timeMin =
      this.timeFilter?.min ??
      (this.timeFilter?.minAvailable ?? Number.MIN_SAFE_INTEGER);
    const timeMax =
      this.timeFilter?.max ??
      (this.timeFilter?.maxAvailable ?? Number.MAX_SAFE_INTEGER);

    return experiments.filter((exp) => {
      const count = Number(exp?.logCount || 0);
      const duration = this._getExperimentDurationSeconds(exp);
      const time = this._getExperimentStartTimeMs(exp);
      return (
        count >= countMin &&
        count <= countMax &&
        duration >= durationMin &&
        duration <= durationMax &&
        time >= timeMin &&
        time <= timeMax
      );
    });
  },

  _ensureLogFilterBindings() {
    if (this._filterUiReady) return;
    const minRange = document.getElementById("logFilterMinRange");
    const maxRange = document.getElementById("logFilterMaxRange");
    const durationMinRange = document.getElementById(
      "logFilterDurationMinRange",
    );
    const durationMaxRange = document.getElementById(
      "logFilterDurationMaxRange",
    );
    const timeMinRange = document.getElementById("logFilterTimeMinRange");
    const timeMaxRange = document.getElementById("logFilterTimeMaxRange");
    if (!minRange || !maxRange) return;

    minRange.addEventListener("input", () => {
      this._handleLogFilterRangeInput("count", "min");
    });

    maxRange.addEventListener("input", () => {
      this._handleLogFilterRangeInput("count", "max");
    });

    if (durationMinRange && durationMaxRange) {
      durationMinRange.addEventListener("input", () => {
        this._handleLogFilterRangeInput("duration", "min");
      });
      durationMaxRange.addEventListener("input", () => {
        this._handleLogFilterRangeInput("duration", "max");
      });
    }

    if (timeMinRange && timeMaxRange) {
      timeMinRange.addEventListener("input", () => {
        this._handleLogFilterRangeInput("time", "min");
      });
      timeMaxRange.addEventListener("input", () => {
        this._handleLogFilterRangeInput("time", "max");
      });
    }

    this._filterUiReady = true;
  },

  _handleLogFilterRangeInput(type, source) {
    const configMap = {
      count: {
        minId: "logFilterMinRange",
        maxId: "logFilterMaxRange",
        filter: this.logCountFilter,
      },
      duration: {
        minId: "logFilterDurationMinRange",
        maxId: "logFilterDurationMaxRange",
        filter: this.durationFilter,
      },
      time: {
        minId: "logFilterTimeMinRange",
        maxId: "logFilterTimeMaxRange",
        filter: this.timeFilter,
      },
    };

    const config = configMap[type];
    if (!config) return;

    const minRange = document.getElementById(config.minId);
    const maxRange = document.getElementById(config.maxId);
    if (!minRange || !maxRange) return;

    if (source === "min") {
      minRange.style.zIndex = "3";
      maxRange.style.zIndex = "2";
    } else {
      minRange.style.zIndex = "2";
      maxRange.style.zIndex = "3";
    }

    let min = parseInt(minRange.value, 10);
    let max = parseInt(maxRange.value, 10);

    if (source === "min" && min > max) {
      max = min;
      maxRange.value = String(max);
    }

    if (source === "max" && max < min) {
      min = max;
      minRange.value = String(min);
    }

    config.filter.min = min;
    config.filter.max = max;
    this._updateLogFilterValueLabels();
  },

  _updateLogFilterBounds(experiments) {
    const maxAvailable = Array.isArray(experiments)
      ? experiments.reduce(
          (max, exp) => Math.max(max, Number(exp?.logCount || 0)),
          0,
        )
      : 0;
    const maxDuration = Array.isArray(experiments)
      ? experiments.reduce(
          (max, exp) => Math.max(max, this._getExperimentDurationSeconds(exp)),
          0,
        )
      : 0;
    const timeBounds = Array.isArray(experiments) && experiments.length
      ? experiments.reduce(
          (bounds, exp) => {
            const time = this._getExperimentStartTimeMs(exp);
            if (Number.isFinite(time)) {
              bounds.min = bounds.min === null ? time : Math.min(bounds.min, time);
              bounds.max = bounds.max === null ? time : Math.max(bounds.max, time);
            }
            return bounds;
          },
          { min: null, max: null },
        )
      : { min: null, max: null };

    this.logCountFilter.maxAvailable = maxAvailable;
    this.durationFilter.maxAvailable = maxDuration;
    this.timeFilter.minAvailable = timeBounds.min;
    this.timeFilter.maxAvailable = timeBounds.max;

    if (this.logCountFilter.max === null) {
      this.logCountFilter.max = maxAvailable;
    }
    if (this.durationFilter.max === null) {
      this.durationFilter.max = maxDuration;
    }
    if (this.timeFilter.min === null && timeBounds.min !== null) {
      this.timeFilter.min = timeBounds.min;
    }
    if (this.timeFilter.max === null && timeBounds.max !== null) {
      this.timeFilter.max = timeBounds.max;
    }

    if (this.logCountFilter.max > maxAvailable) {
      this.logCountFilter.max = maxAvailable;
    }
    if (this.durationFilter.max > maxDuration) {
      this.durationFilter.max = maxDuration;
    }
    if (this.logCountFilter.min > this.logCountFilter.max) {
      this.logCountFilter.min = this.logCountFilter.max;
    }
    if (this.durationFilter.min > this.durationFilter.max) {
      this.durationFilter.min = this.durationFilter.max;
    }
    if (
      this.timeFilter.min !== null &&
      this.timeFilter.max !== null &&
      this.timeFilter.min > this.timeFilter.max
    ) {
      this.timeFilter.min = this.timeFilter.max;
    }

    const minRange = document.getElementById("logFilterMinRange");
    const maxRange = document.getElementById("logFilterMaxRange");
    if (minRange && maxRange) {
      minRange.min = "0";
      minRange.max = String(maxAvailable);
      minRange.value = String(this.logCountFilter.min ?? 0);

      maxRange.min = "0";
      maxRange.max = String(maxAvailable);
      maxRange.value = String(this.logCountFilter.max ?? maxAvailable);
    }

    const durationMinRange = document.getElementById(
      "logFilterDurationMinRange",
    );
    const durationMaxRange = document.getElementById(
      "logFilterDurationMaxRange",
    );
    if (durationMinRange && durationMaxRange) {
      durationMinRange.min = "0";
      durationMinRange.max = String(maxDuration);
      durationMinRange.value = String(this.durationFilter.min ?? 0);

      durationMaxRange.min = "0";
      durationMaxRange.max = String(maxDuration);
      durationMaxRange.value = String(this.durationFilter.max ?? maxDuration);
    }

    const timeMinRange = document.getElementById("logFilterTimeMinRange");
    const timeMaxRange = document.getElementById("logFilterTimeMaxRange");
    if (timeMinRange && timeMaxRange) {
      const minTime = timeBounds.min ?? 0;
      const maxTime = timeBounds.max ?? 0;
      timeMinRange.min = String(minTime);
      timeMinRange.max = String(maxTime);
      timeMinRange.value = String(this.timeFilter.min ?? minTime);

      timeMaxRange.min = String(minTime);
      timeMaxRange.max = String(maxTime);
      timeMaxRange.value = String(this.timeFilter.max ?? maxTime);
    }

    this._updateLogFilterValueLabels();
  },

  _updateLogFilterValueLabels() {
    const minValue = document.getElementById("logFilterMinValue");
    const maxValue = document.getElementById("logFilterMaxValue");
    if (minValue) {
      minValue.textContent = this.logCountFilter.min ?? 0;
    }
    if (maxValue) {
      maxValue.textContent = this.logCountFilter.max ?? 0;
    }

    const durationMinValue = document.getElementById("logFilterDurationMinValue");
    const durationMaxValue = document.getElementById("logFilterDurationMaxValue");
    if (durationMinValue) {
      durationMinValue.textContent = this.timeSyncManager.formatDurationText(
        this.durationFilter.min ?? 0,
      );
    }
    if (durationMaxValue) {
      durationMaxValue.textContent = this.timeSyncManager.formatDurationText(
        this.durationFilter.max ?? 0,
      );
    }

    const timeMinValue = document.getElementById("logFilterTimeMinValue");
    const timeMaxValue = document.getElementById("logFilterTimeMaxValue");
    if (timeMinValue) {
      timeMinValue.textContent = this._formatFilterDateTime(
        this.timeFilter.min,
      );
    }
    if (timeMaxValue) {
      timeMaxValue.textContent = this._formatFilterDateTime(
        this.timeFilter.max,
      );
    }

    this._updateRangeFill(
      "logFilterCountSliders",
      this.logCountFilter.min,
      this.logCountFilter.max,
      0,
      this.logCountFilter.maxAvailable,
    );
    this._updateRangeFill(
      "logFilterDurationSliders",
      this.durationFilter.min,
      this.durationFilter.max,
      0,
      this.durationFilter.maxAvailable,
    );
    this._updateRangeFill(
      "logFilterTimeSliders",
      this.timeFilter.min,
      this.timeFilter.max,
      this.timeFilter.minAvailable,
      this.timeFilter.maxAvailable,
    );
  },

  _updateRangeFill(sliderId, min, max, minBound, maxBound) {
    const container = document.getElementById(sliderId);
    if (!container) return;
    if (!Number.isFinite(minBound) || !Number.isFinite(maxBound)) return;
    const range = maxBound - minBound;
    if (range <= 0) return;

    const safeMin = Number.isFinite(min) ? min : minBound;
    const safeMax = Number.isFinite(max) ? max : maxBound;

    const start = ((safeMin - minBound) / range) * 100;
    const end = ((safeMax - minBound) / range) * 100;
    const safeStart = Math.max(0, Math.min(100, start));
    const safeEnd = Math.max(0, Math.min(100, end));

    container.style.setProperty("--range-start", `${safeStart}%`);
    container.style.setProperty("--range-end", `${safeEnd}%`);
  },

  _getExperimentDurationSeconds(exp) {
    if (!exp) return 0;
    if (Number.isFinite(exp.durationSeconds)) return exp.durationSeconds;
    const start = Number(exp.startTime || 0);
    const end = Number(exp.endTime || 0);
    const seconds = Math.max(0, Math.round((end - start) / 1000));
    return Number.isFinite(seconds) ? seconds : 0;
  },

  _getExperimentStartTimeMs(exp) {
    const time = Number(exp?.startTime || 0);
    return Number.isFinite(time) ? time : 0;
  },

  _formatFilterDateTime(value) {
    if (!Number.isFinite(value)) return "--";
    return this.timeSyncManager.formatDateTimeWithPreset(value, "logFilter");
  },

  _buildLogFilterSummaryText(filteredCount, totalCount) {
    const parts = [];

    if (
      this.logCountFilter &&
      (this.logCountFilter.min > 0 ||
        (this.logCountFilter.maxAvailable > 0 &&
          this.logCountFilter.max < this.logCountFilter.maxAvailable))
    ) {
      parts.push(
        `記錄數 ${this.logCountFilter.min}~${this.logCountFilter.max}`,
      );
    }

    if (
      this.durationFilter &&
      (this.durationFilter.min > 0 ||
        (this.durationFilter.maxAvailable > 0 &&
          this.durationFilter.max < this.durationFilter.maxAvailable))
    ) {
      parts.push(
        `花費時間 ${this.timeSyncManager.formatDurationText(this.durationFilter.min)}~${this.timeSyncManager.formatDurationText(this.durationFilter.max)}`,
      );
    }

    if (
      this.timeFilter &&
      this.timeFilter.minAvailable !== null &&
      this.timeFilter.maxAvailable !== null &&
      (this.timeFilter.min > this.timeFilter.minAvailable ||
        this.timeFilter.max < this.timeFilter.maxAvailable)
    ) {
      parts.push(
        `實驗時間 ${this._formatFilterDateTime(this.timeFilter.min)}~${this._formatFilterDateTime(this.timeFilter.max)}`,
      );
    }

    const label = parts.length ? parts.join(" / ") : "篩選條件";
    return `${label} (${filteredCount}/${totalCount})`;
  },

  _ensureLogFilterPopover() {
    if (this.logFilterPopover) return;
    const popoverEl = document.getElementById("logFilterPopover");
    const anchorEl = document.getElementById("logFilterToggleBtn");
    if (!popoverEl || !anchorEl) return;

    this.logFilterPopover = new UIPopover({
      popoverEl,
      anchorEl,
      placement: "right-start",
      offset: 8,
    });
  },

  _closeLogFilter() {
    this.logFilterPopover?.close();
  },
};
