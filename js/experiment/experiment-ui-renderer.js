/**
 * ExperimentUIRenderer - UI 通用工具方法與元件渲染層
 *
 * 提供按鈕/元素的啟停、鎖定、高亮、顯示隱藏、CSS 類別操作，
 * 以及組合選擇器、單元面板、實驗控制面板的 HTML 渲染與事件綁定。
 *
 * 本類別作為 ExperimentUIManager 的基底，所有方法透過 `this` 存取
 * UIManager 的 state、elements、config、timerManager 等屬性。
 */

import ExperimentControlsDom from "./experiment-controls-dom.js";
import { Logger } from "../core/console-manager.js";

class ExperimentUIRenderer extends ExperimentControlsDom {
  // ==========================================
  // 輔助方法
  // ==========================================

  /**
   * 取得 DOM 元素（接受 HTMLElement 或 CSS 選擇器字串）
   * @param {string|HTMLElement} elementOrSelector
   * @returns {HTMLElement|null}
   */
  _getElement(elementOrSelector) {
    if (elementOrSelector instanceof HTMLElement) return elementOrSelector;
    if (typeof elementOrSelector === "string") {
      return document.querySelector(elementOrSelector);
    }
    Logger.warn("無效的元素或選擇器:", elementOrSelector);
    return null;
  }

  /**
   * 發出 ui-manager 自訂事件（冒泡至 window）
   * @param {string} eventName
   * @param {Object} data
   */
  _emit(eventName, data = {}) {
    window.dispatchEvent(
      new CustomEvent(`ui-manager:${eventName}`, { detail: data, bubbles: true }),
    );
  }

  // ==========================================
  // 事件監聽器管理
  // ==========================================

  on(eventName, handler) {
    window.addEventListener(`ui-manager:${eventName}`, handler);
    if (!this.listeners.has(eventName)) this.listeners.set(eventName, []);
    this.listeners.get(eventName).push(handler);
    return () => this.off(eventName, handler);
  }

  off(eventName, handler) {
    window.removeEventListener(`ui-manager:${eventName}`, handler);
    if (this.listeners.has(eventName)) {
      const handlers = this.listeners.get(eventName);
      const i = handlers.indexOf(handler);
      if (i > -1) handlers.splice(i, 1);
    }
  }

  // ==========================================
  // 按鈕狀態管理
  // ==========================================

  enableButton(buttonOrSelector) {
    const btn = this._getElement(buttonOrSelector);
    if (!btn) return;
    btn.disabled = false;
    btn.classList.remove("disabled", "experiment-disabled");
    this.state.lockedElements.delete(btn);
    this._emit("button-enabled", { button: btn, selector: buttonOrSelector });
  }

  disableButton(buttonOrSelector, reason = "") {
    const btn = this._getElement(buttonOrSelector);
    if (!btn) return;
    btn.disabled = true;
    btn.classList.add("disabled");
    if (reason) btn.title = reason;
    this._emit("button-disabled", { button: btn, selector: buttonOrSelector, reason });
  }

  lockButton(buttonOrSelector) {
    const btn = this._getElement(buttonOrSelector);
    if (!btn) return;
    btn.disabled = true;
    btn.classList.add("experiment-disabled");
    this.state.lockedElements.add(btn);
    this._emit("button-locked", { button: btn, selector: buttonOrSelector });
  }

  unlockButton(buttonOrSelector) {
    const btn = this._getElement(buttonOrSelector);
    if (!btn) return;
    btn.disabled = false;
    btn.classList.remove("experiment-disabled");
    this.state.lockedElements.delete(btn);
    this._emit("button-unlocked", { button: btn, selector: buttonOrSelector });
  }

  enableButtons(buttons) { buttons.forEach((b) => this.enableButton(b)); }
  disableButtons(buttons, reason = "") { buttons.forEach((b) => this.disableButton(b, reason)); }
  lockButtons(buttons) { buttons.forEach((b) => this.lockButton(b)); }
  unlockButtons(buttons) { buttons.forEach((b) => this.unlockButton(b)); }

  // ==========================================
  // 按鈕高亮管理
  // ==========================================

  highlightButton(buttonOrSelector, highlightType = "primary") {
    if (!this.state.visualHintsEnabled) return;
    const btn = this._getElement(buttonOrSelector);
    if (!btn) return;
    const classMap = {
      primary: "next-step-highlight",
      secondary: "next-step-highlight-secondary",
      shift: "next-step-highlight-shift",
    };
    btn.classList.add(classMap[highlightType] || classMap.primary);
    this.state.highlightedButtons.add(btn);
    this._emit("button-highlighted", { button: btn, selector: buttonOrSelector, highlightType });
  }

  unhighlightButton(buttonOrSelector) {
    const btn = this._getElement(buttonOrSelector);
    if (!btn) return;
    btn.classList.remove("next-step-highlight", "next-step-highlight-secondary", "next-step-highlight-shift");
    this.state.highlightedButtons.delete(btn);
    this._emit("button-unhighlighted", { button: btn, selector: buttonOrSelector });
  }

  highlightPowerButton(enable) {
    const area = this.elements.get("powerSwitchArea");
    if (!area) { Logger.warn("找不到電源開關區域"); return; }
    if (enable && this.state.visualHintsEnabled) {
      area.classList.add("next-step-highlight");
    } else {
      area.classList.remove("next-step-highlight");
    }
    this._emit("power-button-highlighted", { enable: !!enable });
  }

  highlightButtons(buttonConfigs) {
    buttonConfigs.forEach(({ selector, type }) => this.highlightButton(selector, type));
  }

  clearAllHighlights() {
    const area = this.elements.get("powerSwitchArea");
    if (area) area.classList.remove("next-step-highlight");
    document.querySelectorAll(".button-overlay").forEach((btn) => {
      btn.classList.remove("next-step-highlight", "next-step-highlight-secondary", "next-step-highlight-shift");
    });
    this.state.highlightedButtons.clear();
    this._emit("all-highlights-cleared");
  }

  // ==========================================
  // 視覺提示控制
  // ==========================================

  setVisualHintsEnabled(enabled) {
    this.state.visualHintsEnabled = enabled;
    if (enabled) {
      document.body.classList.add("visual-hints-enabled");
      this._emit("visual-hints-enabled");
    } else {
      document.body.classList.remove("visual-hints-enabled");
      this.clearAllHighlights();
      this._emit("visual-hints-disabled");
    }
    Logger.debug(`視覺提示已${enabled ? "啟用" : "停用"}`);
  }

  isVisualHintsEnabled() { return this.state.visualHintsEnabled; }

  updateHighlightVisibility() {
    const toggle = this.elements.get("visualHintsToggle");
    const enabled = !!(toggle && toggle.checked);
    this.setVisualHintsEnabled(enabled);
    if (enabled) this._emit("highlight-visibility-updated", { enabled });
  }

  // ==========================================
  // UI 元件更新
  // ==========================================

  updatePauseIndicator(isPaused) {
    const el = this.elements.get("pauseIndicator");
    if (!el) return;
    try {
      if (isPaused) this.showElement(el, "block");
      else this.hideElement(el);
    } catch (e) {}
    el.textContent = isPaused ? "⏸ 暫停中" : "";
    this._emit("pause-indicator-updated", { isPaused });
  }

  updateTimerDisplay(timeText) {
    const el = this.elements.get("experimentTimer");
    if (!el) return;
    el.textContent = `花費時間：${timeText}`;
    this._emit("timer-display-updated", { timeText });
  }

  updateProgressBar(current, total) {
    const pct = total > 0 ? (current / total) * 100 : 0;
    const bar = document.querySelector(".experiment-progress-bar");
    if (bar) {
      bar.style.width = `${pct}%`;
      bar.textContent = `${current} / ${total}`;
    }
    this._emit("progress-bar-updated", { current, total, percentage: pct });
  }

  updateStepIndicator(currentStep, totalSteps) {
    const el = document.querySelector(".step-indicator");
    if (!el) return;
    el.textContent = `步驟 ${currentStep + 1} / ${totalSteps}`;
    this._emit("step-indicator-updated", { currentStep, totalSteps });
  }

  updateUnitIndicator(currentUnit, totalUnits, unitName = "") {
    const el = document.querySelector(".unit-indicator");
    if (!el) return;
    el.textContent = unitName
      ? `單元 ${currentUnit + 1} / ${totalUnits}: ${unitName}`
      : `單元 ${currentUnit + 1} / ${totalUnits}`;
    this._emit("unit-indicator-updated", { currentUnit, totalUnits, unitName });
  }

  // ==========================================
  // 元件顯示/隱藏
  // ==========================================

  showElement(elementOrSelector, displayType = "block") {
    const el = this._getElement(elementOrSelector);
    if (!el) return;
    el.classList.remove("is-hidden");
    this.state.hiddenElements.delete(el);
    this._emit("element-shown", { element: el, selector: elementOrSelector });
  }

  hideElement(elementOrSelector) {
    const el = this._getElement(elementOrSelector);
    if (!el) return;
    el.classList.add("is-hidden");
    this.state.hiddenElements.add(el);
    this._emit("element-hidden", { element: el, selector: elementOrSelector });
  }

  toggleElement(elementOrSelector, displayType = "block") {
    const el = this._getElement(elementOrSelector);
    if (!el) return;
    el.classList.contains("is-hidden")
      ? this.showElement(el, displayType)
      : this.hideElement(el);
  }

  showElements(elements, displayType = "block") {
    elements.forEach((el) => this.showElement(el, displayType));
  }

  hideElements(elements) {
    elements.forEach((el) => this.hideElement(el));
  }

  // ==========================================
  // CSS 類別管理
  // ==========================================

  addClass(elementOrSelector, classNames) {
    const el = this._getElement(elementOrSelector);
    if (!el) return;
    const classes = Array.isArray(classNames) ? classNames : [classNames];
    el.classList.add(...classes);
    this._emit("class-added", { element: el, selector: elementOrSelector, classNames });
  }

  removeClass(elementOrSelector, classNames) {
    const el = this._getElement(elementOrSelector);
    if (!el) return;
    const classes = Array.isArray(classNames) ? classNames : [classNames];
    el.classList.remove(...classes);
    this._emit("class-removed", { element: el, selector: elementOrSelector, classNames });
  }

  toggleClass(elementOrSelector, className, force = undefined) {
    const el = this._getElement(elementOrSelector);
    if (!el) return;
    const result = el.classList.toggle(className, force);
    this._emit("class-toggled", { element: el, selector: elementOrSelector, className, added: result });
    return result;
  }

  hasClass(elementOrSelector, className) {
    const el = this._getElement(elementOrSelector);
    return el ? el.classList.contains(className) : false;
  }

  // ==========================================
  // 實驗面板開關
  // ==========================================

  openExperimentPanel() {
    const panel = this.elements.get("experimentPanel");
    if (panel) { this.showElement(panel, "block"); this._emit("experiment-panel-opened"); }
  }

  closeExperimentPanel() {
    const panel = this.elements.get("experimentPanel");
    if (panel) { this.hideElement(panel); this._emit("experiment-panel-closed"); }
  }

  // ==========================================
  // 按鈕動畫
  // ==========================================

  showButtonPressAnimation(buttonOrSelector) {
    const btn = this._getElement(buttonOrSelector);
    if (!btn) return;
    btn.classList.add("button-pressed");
    setTimeout(() => btn.classList.remove("button-pressed"), this.config.highlightDuration);
    this._emit("button-press-animation-shown", { button: btn, selector: buttonOrSelector });
  }

  blinkButton(buttonOrSelector, times = 3, interval = 500) {
    const btn = this._getElement(buttonOrSelector);
    if (!btn) return;
    let count = 0;
    const id = setInterval(() => {
      btn.classList.toggle("button-blink");
      if (++count >= times * 2) { clearInterval(id); btn.classList.remove("button-blink"); }
    }, interval);
    this._emit("button-blink-started", { button: btn, selector: buttonOrSelector, times });
  }

  // ==========================================
  // 渲染輔助：面板隱藏時延遲渲染
  // ==========================================

  /**
   * 若容器的 .experiment-panel 祖先目前是 display:none，
   * 透過 MutationObserver 等它可見後再執行 renderFn。
   * 否則立即執行。
   * @param {HTMLElement} containerEl
   * @param {Function} renderFn - 實際渲染函式，回傳 containerEl
   * @returns {HTMLElement}
   */
  _renderWhenVisible(containerEl, renderFn) {
    const ancestor = containerEl.closest(".experiment-panel");
    if (ancestor && window.getComputedStyle(ancestor).display === "none") {
      const mo = new MutationObserver((_, obs) => {
        if (window.getComputedStyle(ancestor).display !== "none") {
          obs.disconnect();
          renderFn();
        }
      });
      mo.observe(ancestor, { attributes: true, attributeFilter: ["style", "class"] });
      return containerEl;
    }
    return renderFn();
  }

  /** @private 解析容器（字串選擇器或元素） */
  _resolveContainer(container, logLevel = "error") {
    const el = typeof container === "string" ? document.querySelector(container) : container;
    if (!el) Logger[logLevel]("找不到容器元素:", container);
    return el;
  }

  // ==========================================
  // 單元面板：組合套用（勾選 + 排序）
  // ==========================================

  /**
   * 將組合的單元選取狀態與排序同步到 DOM。
   * 若 .experiment-units-list 尚不存在（Panel 延遲渲染），
   * 透過 MutationObserver 等面板可見後再執行。
   *
   * @param {string}   containerSelector - 單元面板容器選擇器
   * @param {string[]} unitIds           - 目標單元 ID 排序（僅含選取項）
   * @param {Object}   [meta]            - 僅供偵錯（combinationName 等）
   * @returns {boolean} 是否立即套用
   */
  applyUnitCombinationToPanel(containerSelector, unitIds, meta = {}) {
    const apply = () => {
      const unitList = document.querySelector(
        `${containerSelector} .experiment-units-list`,
      );
      if (!unitList) return false;

      const pendingObserver = this._unitListSyncObservers?.get(containerSelector);
      if (pendingObserver) {
        pendingObserver.disconnect();
        this._unitListSyncObservers.delete(containerSelector);
      }

      // 取消全部勾選
      unitList
        .querySelectorAll("li:not(.power-option-card) input[type=\"checkbox\"]")
        .forEach((cb) => { cb.checked = false; });

      // 勾選目標單元
      unitList.querySelectorAll("li:not(.power-option-card)").forEach((li) => {
        if (unitIds.includes(li.dataset.unitId)) {
          const cb = li.querySelector("input[type=\"checkbox\"]");
          if (cb) cb.checked = true;
        }
      });

      // 比對目前 DOM 順序，若前段已選區塊不一致才重排
      const domOrder = Array.from(unitList.querySelectorAll("li[data-unit-id]"))
        .map((li) => li.dataset.unitId);
      const selectedPrefix = domOrder.slice(0, unitIds.length);
      const needsReorder = JSON.stringify(selectedPrefix) !== JSON.stringify(unitIds);

      Logger.debug(
        `【<cyan>排序追蹤</cyan>】<yellow>套用組合</yellow> DOM[${domOrder.join("→")}] 目標前綴[${unitIds.join("→")}] ${needsReorder ? "⚠需調整" : "✓相同"}`,
        { ...meta, domOrder, unitIds, needsReorder },
      );

      if (needsReorder) {
        this._reorderUnitList(unitList, unitIds);
        const after = Array.from(unitList.querySelectorAll("li[data-unit-id]"))
          .map((li) => li.dataset.unitId);
        Logger.debug(`【<cyan>排序追蹤</cyan>】<green>排序完成</green> DOM[${after.join("→")}]`);
      }

      return true;
    };

    if (apply()) return true;

    // DOM 尚未就緒：等待清單節點出現後再套用，避免只在可見性變更時才重試。
    const containerEl = document.querySelector(containerSelector);
    if (!containerEl) {
      setTimeout(() => {
        if (!apply()) Logger.debug("重試後仍然找不到單元列表元素");
      }, 100);
      return false;
    }

    if (!this._unitListSyncObservers) {
      this._unitListSyncObservers = new Map();
    }

    const prev = this._unitListSyncObservers.get(containerSelector);
    if (prev) prev.disconnect();

    let retries = 0;
    const maxRetries = 10;
    const observer = new MutationObserver(() => {
      if (apply()) return;

      retries += 1;
      if (retries >= maxRetries) {
        observer.disconnect();
        this._unitListSyncObservers.delete(containerSelector);
        Logger.warn("單元列表延遲就緒逾時，停止等待", {
          containerSelector,
          retries,
        });
      }
    });

    observer.observe(containerEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    this._unitListSyncObservers.set(containerSelector, observer);

    // 立即再排一次微任務，覆蓋「本輪 render 尾端才插入單元清單」情境。
    queueMicrotask(() => {
      apply();
    });

    return false;
  }

  /** @private 依照 unitIds 順序重排 unitList 的 li 元素 */
  _reorderUnitList(unitList, unitIds) {
    const startupCard = unitList.querySelector(".startup-card");
    const shutdownCard = unitList.querySelector(".shutdown-card");
    const normalItems = Array.from(unitList.querySelectorAll("li:not(.power-option-card)"));
    const selected = unitIds
      .map((id) => normalItems.find((li) => li.dataset.unitId === id))
      .filter(Boolean);
    const unselected = normalItems.filter((li) => !unitIds.includes(li.dataset.unitId));
    const frag = document.createDocumentFragment();
    if (startupCard) frag.appendChild(startupCard);
    selected.forEach((li) => frag.appendChild(li));
    unselected.forEach((li) => frag.appendChild(li));
    if (shutdownCard) frag.appendChild(shutdownCard);
    unitList.innerHTML = "";
    unitList.appendChild(frag);
  }

  // ==========================================
  // 組合選擇器渲染
  // ==========================================

  renderCombinationSelector(container, combinations, options = {}) {
    const containerEl = this._resolveContainer(container);
    if (!containerEl) return null;

    return this._renderWhenVisible(containerEl, () => {
      const config = {
        showTitle: options.showTitle !== false,
        title: options.title || "單元組合",
        activeId: options.activeId || null,
        onSelect: options.onSelect || null,
        ...options,
      };

      const comboHtml = (combo) => `
        <li class="combination-item ${combo.id === config.activeId ? "active" : ""}"
            data-combination-id="${combo.id}">
          <div class="combo-name">${combo.name}</div>
          <div class="combo-desc">${combo.description || ""}</div>
        </li>`;

      if (containerEl.tagName === "UL") {
        containerEl.innerHTML = combinations.map(comboHtml).join("");
      } else {
        containerEl.innerHTML = `
          <div class="combination-selector-section experiment-ui-card">
            ${config.showTitle ? `<h3>${config.title}</h3>` : ""}
            <ul class="experiment-default-list">${combinations.map(comboHtml).join("")}</ul>
          </div>`;
      }

      Logger.debug("renderCombinationSelector: containerTag", {
        tag: containerEl.tagName, showTitle: config.showTitle, title: config.title,
      });

      if (config.onSelect) {
        const items = containerEl.querySelectorAll(".combination-item");
        items.forEach((item) => {
          item.addEventListener("click", () => {
            items.forEach((i) => i.classList.remove("active"));
            item.classList.add("active");
            config.onSelect(item.dataset.combinationId);
          });
        });
      }

      Logger.debug("組合選擇器已渲染", { count: combinations.length });
      return containerEl;
    });
  }

  updateCombinationSelection(container, activeId) {
    const containerEl = this._resolveContainer(container, "warn");
    if (!containerEl) return;
    containerEl.querySelectorAll(".combination-item").forEach((i) => i.classList.remove("active"));
    containerEl.querySelector(`[data-combination-id="${activeId}"]`)?.classList.add("active");
    Logger.debug("組合選擇器選中狀態已更新", { activeId });
  }

  // ==========================================
  // 單元面板渲染
  // ==========================================

  renderUnitsPanel(container, units, unitIds = null, options = {}) {
    const containerEl = this._resolveContainer(container);
    if (!containerEl) return null;

    return this._renderWhenVisible(containerEl, () => {
      const config = {
        showHeader: options.showHeader !== false,
        headerTitle: options.headerTitle || "實驗單元",
        showSelectAll: options.showSelectAll !== false,
        showPowerOptions: options.showPowerOptions !== false,
        includeStartup: options.includeStartup !== false,
        includeShutdown: options.includeShutdown !== false,
        enableSorting: options.enableSorting !== false,
        onUnitToggle: options.onUnitToggle || null,
        onReorder: options.onReorder || null,
        ...options,
      };

      // 依 unitIds 排序與勾選
      let displayUnits;
      if (unitIds && Array.isArray(unitIds)) {
        const all = units.map((u) => ({ ...u, checked: unitIds.includes(u.unit_id || u.id) }));
        const inOrder = unitIds.map((id) => all.find((u) => (u.unit_id || u.id) === id)).filter(Boolean);
        const rest = all.filter((u) => !unitIds.includes(u.unit_id || u.id));
        displayUnits = [...inOrder, ...rest];
        Logger.debug("設定單元勾選狀態:", { total: units.length, preselected: unitIds.length, unitIds });
      } else {
        displayUnits = units.map((u) => ({ ...u, checked: false }));
      }

      const startupCard = config.showPowerOptions && config.includeStartup ? `
        <li class="power-option-card startup-card">
          <label class="unit-checkbox">
            <input type="checkbox" id="includeStartup" checked disabled data-perma-disabled="true">
          </label>
          <div class="unit-sort">
            <div class="power-option-title">機器開機</div>
            <div class="power-option-subtitle">POWER_ON • 開始實驗前先開機</div>
          </div>
        </li>` : "";

      const shutdownCard = config.showPowerOptions && config.includeShutdown ? `
        <li class="power-option-card shutdown-card">
          <label class="unit-checkbox">
            <input type="checkbox" id="includeShutdown" checked disabled data-perma-disabled="true">
          </label>
          <div class="unit-sort">
            <div class="power-option-title">機器關機</div>
            <div class="power-option-subtitle">POWER_OFF • 完成關機才結束實驗</div>
          </div>
        </li>` : "";

      const unitItems = displayUnits.map((unit, index) => {
        const id = unit.unit_id || unit.id;
        const sortControls = config.enableSorting ? `
          <div class="unit-controls">
            <button class="unit-sort-btn unit-up-btn ${index === 0 ? "disabled" : ""}"
                    title="上移" ${index === 0 ? "disabled" : ""}>▲</button>
            <button class="unit-sort-btn unit-down-btn ${index === displayUnits.length - 1 ? "disabled" : ""}"
                    title="下移" ${index === displayUnits.length - 1 ? "disabled" : ""}>▼</button>
            <span class="unit-drag-handle" title="拖曳排序">⋮⋮</span>
          </div>` : "";
        return `
          <li data-unit-id="${id}">
            <label class="unit-checkbox">
              <input type="checkbox" name="unitCheckbox" value="${id}" ${unit.checked !== false ? "checked" : ""}>
            </label>
            <div class="unit-sort">
              <div class="unit-info-title">${unit.unit_name || unit.title || unit.name || "未命名單元"}</div>
              <div class="unit-info-subtitle">${id} • ${unit.stepCount || unit.steps?.length || 0} 步驟</div>
            </div>
            ${sortControls}
          </li>`;
      }).join("");

      containerEl.innerHTML = `
        <div class="experiment-panel-units experiment-ui-card">
          ${config.showHeader ? `
            <div class="units-header">
              <span>${config.headerTitle}</span>
              ${config.showSelectAll ? `
                <label class="select-all-checkbox">
                  <input type="checkbox" id="selectAllUnits" checked><span>全選</span>
                </label>` : ""}
            </div>` : ""}
          <div class="units-list-container">
            <ul class="experiment-units-list">
              ${startupCard}${unitItems}${shutdownCard}
            </ul>
          </div>
        </div>`;

      // 綁定全選
      if (config.showSelectAll) {
        containerEl.querySelector("#selectAllUnits")?.addEventListener("change", (e) => {
          containerEl.querySelectorAll("input[name=\"unitCheckbox\"]")
            .forEach((cb) => (cb.checked = e.target.checked));
          config.onUnitToggle?.({ type: "select-all", checked: e.target.checked });
        });
      }

      // 綁定單元切換
      if (config.onUnitToggle) {
        containerEl.querySelectorAll("input[name=\"unitCheckbox\"]").forEach((cb) => {
          cb.addEventListener("change", (e) => config.onUnitToggle({
            type: "unit", unitId: e.target.value, checked: e.target.checked,
          }));
        });
      }

      // 綁定排序按鈕
      if (config.enableSorting && config.onReorder) {
        const unitList = containerEl.querySelector(".experiment-units-list");
        const moveUnit = (btn, dir) => {
          const li = btn.closest("li");
          const items = Array.from(unitList.querySelectorAll("li[data-unit-id]"));
          const idx = items.indexOf(li);
          if (dir === "up" && idx > 0) {
            items[idx - 1].before(li);
          } else if (dir === "down" && idx < items.length - 1) {
            items[idx + 1].after(li);
          } else return;
          this._updateSortButtonStates(containerEl);
          config.onReorder({ unitId: li.dataset.unitId, direction: dir });
        };
        containerEl.querySelectorAll(".unit-up-btn").forEach((b) =>
          b.addEventListener("click", (e) => moveUnit(e.currentTarget, "up")));
        containerEl.querySelectorAll(".unit-down-btn").forEach((b) =>
          b.addEventListener("click", (e) => moveUnit(e.currentTarget, "down")));
      }

      if (config.enableSorting) this._setupUnitDragAndDrop(containerEl, config);

      Logger.debug(
        `【<cyan>排序追蹤</cyan>】<green>渲染完成</green> HTML順序[${displayUnits.map((u) => u.unit_id || u.id).join("→")}]`,
        { count: displayUnits.length, displayOrder: displayUnits.map((u) => u.unit_id || u.id) },
      );
      return containerEl;
    });
  }

  _updateSortButtonStates(containerEl) {
    const items = Array.from(
      containerEl.querySelector(".experiment-units-list")?.querySelectorAll("li[data-unit-id]") ?? [],
    );
    items.forEach((item, index) => {
      const up = item.querySelector(".unit-up-btn");
      const down = item.querySelector(".unit-down-btn");
      if (up) { up.disabled = index === 0; up.classList.toggle("disabled", index === 0); }
      if (down) {
        const last = index === items.length - 1;
        down.disabled = last;
        down.classList.toggle("disabled", last);
      }
    });
  }

  _setupUnitDragAndDrop(containerEl, config) {
    const unitList = containerEl.querySelector(".experiment-units-list");
    if (!unitList) return;

    let draggedLi = null;
    let placeholder = null;

    unitList.querySelectorAll("li:not(.power-option-card) .unit-drag-handle").forEach((handle) => {
      handle.addEventListener("mousedown", (e) => { e.preventDefault(); startDrag(handle, e.clientX, e.clientY); });
      handle.addEventListener("touchstart", (e) => {
        e.preventDefault();
        const t = e.touches[0];
        startDrag(handle, t.clientX, t.clientY);
      });
    });

    const startDrag = (handle, x, y) => {
      draggedLi = handle.closest("li");
      if (!draggedLi) return;

      placeholder = Object.assign(document.createElement("li"), { className: "drag-placeholder" });
      placeholder.style.height = `${draggedLi.offsetHeight}px`;

      const origStyle = draggedLi.style.cssText;
      draggedLi.setAttribute("data-original-style", origStyle);
      Object.assign(draggedLi.style, {
        position: "fixed", zIndex: "1000", pointerEvents: "none",
        width: `${draggedLi.offsetWidth}px`,
        left: `${x - draggedLi.offsetWidth / 2}px`,
        top: `${y - draggedLi.offsetHeight / 2}px`,
      });
      draggedLi.classList.add("dragging");
      handle.classList.add("dragging-handle");
      draggedLi.after(placeholder);

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onDrop);
      document.addEventListener("touchmove", onTouchMove, { passive: false });
      document.addEventListener("touchend", onDrop);
    };

    const onMove = (e) => draggedLi && updatePos(e.clientX, e.clientY);
    const onTouchMove = (e) => {
      if (!draggedLi) return;
      e.preventDefault();
      const t = e.touches[0];
      updatePos(t.clientX, t.clientY);
    };

    const updatePos = (x, y) => {
      draggedLi.style.left = `${x - draggedLi.offsetWidth / 2}px`;
      draggedLi.style.top = `${y - draggedLi.offsetHeight / 2}px`;

      const items = Array.from(unitList.children).filter(
        (i) => !i.classList.contains("power-option-card") && i !== draggedLi && i !== placeholder,
      );
      const insertBefore = items.find((i) => {
        const r = i.getBoundingClientRect();
        return y < r.top + r.height / 2;
      }) ?? null;

      const startup = unitList.querySelector(".startup-card");
      const shutdown = unitList.querySelector(".shutdown-card");

      if (insertBefore) {
        unitList.insertBefore(placeholder, insertBefore === startup ? startup.nextSibling : insertBefore);
      } else {
        unitList.insertBefore(placeholder, shutdown ?? null);
      }
    };

    const onDrop = () => {
      if (!draggedLi || !placeholder) return;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onDrop);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onDrop);

      draggedLi.classList.remove("dragging");
      draggedLi.style.cssText = draggedLi.getAttribute("data-original-style") || "";
      draggedLi.removeAttribute("data-original-style");
      draggedLi.querySelector(".unit-drag-handle")?.classList.remove("dragging-handle");
      placeholder.before(draggedLi);
      placeholder.remove();

      this._updateSortButtonStates(containerEl);

      if (config.onReorder) {
        const allItems = Array.from(unitList.querySelectorAll("li[data-unit-id]"));
        config.onReorder({ unitId: draggedLi.dataset.unitId, newIndex: allItems.indexOf(draggedLi) });
      }

      draggedLi = null;
      placeholder = null;
    };

    Logger.debug("單元拖曳功能已啟用");
  }

  // ==========================================
  // 實驗控制面板渲染
  // ==========================================

  renderExperimentControls(container, options = {}) {
    const containerEl = this._resolveContainer(container);
    if (!containerEl) return null;

    return this._renderWhenVisible(containerEl, () => {
      const config = {
        showExperimentId: options.showExperimentId !== false,
        showParticipantName: options.showParticipantName !== false,
        showTimer: options.showTimer !== false,
        experimentId: options.experimentId || "",
        participantName: options.participantName || "",
        onStart: options.onStart || null,
        onPause: options.onPause || null,
        onStop: options.onStop || null,
        onRegenerateId: options.onRegenerateId || null,
        ...options,
      };

      containerEl.innerHTML = `
        <div class="experiment-panel-actions" id="experimentPanelActions">
          <div class="input-section">
            ${config.showExperimentId ? `
              <div class="form-group">
                <label for="experimentIdInput">實驗ID:</label>
                <div class="experiment-id-group">
                  <input type="text" id="experimentIdInput" class="form-input"
                         maxlength="10" placeholder="載入中..." value="${config.experimentId}">
                  <button id="regenerateIdButton" class="btn-secondary" title="重新產生實驗ID">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                         stroke-linecap="round" stroke-linejoin="round" class="icon-sm">
                      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                      <path d="M21 3v5h-5"></path>
                      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
                      <path d="M3 21v-5h5"></path>
                    </svg>
                  </button>
                </div>
              </div>` : ""}
            ${config.showParticipantName ? `
              <div class="form-group">
                <label for="participantNameInput">受試者名稱:</label>
                <input type="text" id="participantNameInput" class="form-input"
                       placeholder="受試者名稱" value="${config.participantName}">
              </div>` : ""}
            <div class="form-group experiment-control-group">
              <div class="experiment-control-header">
                <span class="experiment-control-title">實驗控制</span>
                ${config.showTimer ? "<div id=\"experimentTimer\" class=\"experiment-timer\">00:00.000</div>" : ""}
              </div>
              <div id="experimentIdRow" class="experiment-start-row">
                <button id="startExperimentBtn" class="experiment-start-btn btn-success">▶ 開始實驗</button>
              </div>
              <div id="experimentControlButtons" class="experiment-control-buttons is-hidden">
                <button id="pauseExperimentBtn" class="experiment-pause-btn btn-primary">⏸ 暫停</button>
                <button id="stopExperimentBtn" class="experiment-stop-btn btn-danger">⏹ 停止</button>
              </div>
            </div>
          </div>
        </div>`;

      // 開始按鈕
      if (config.onStart) {
        containerEl.querySelector("#startExperimentBtn")?.addEventListener("click", () => {
          this.hideElement(containerEl.querySelector("#experimentIdRow"));
          this.showElement(containerEl.querySelector("#experimentControlButtons"), "flex");
          if (config.showTimer) this.startExperimentTimer();
          config.onStart();
        });
      }

      // 暫停/繼續按鈕
      if (config.onPause) {
        containerEl.querySelector("#pauseExperimentBtn")?.addEventListener("click", (e) => {
          e.preventDefault();
          const btn = e.currentTarget;
          btn.dataset.isPaused === "true" ? config.onResume?.() : config.onPause();
        });
      }

      // 停止按鈕
      if (config.onStop) {
        containerEl.querySelector("#stopExperimentBtn")?.addEventListener("click", () => {
          const pauseBtn = containerEl.querySelector("#pauseExperimentBtn");
          if (pauseBtn) {
            pauseBtn.textContent = "⏸ 暫停";
            pauseBtn.classList.replace("btn-secondary", "btn-primary");
            pauseBtn.dataset.isPaused = "false";
          }
          this.showElement(containerEl.querySelector("#experimentIdRow"), "flex");
          this.hideElement(containerEl.querySelector("#experimentControlButtons"));
          if (config.showTimer) {
            const timerEl = containerEl.querySelector("#experimentTimer");
            if (timerEl) timerEl.textContent = "00:00.000";
          }
          config.onStop();
        });
      }

      // 重新產生 ID 按鈕
      if (config.onRegenerateId) {
        containerEl.querySelector("#regenerateIdButton")?.addEventListener("click", config.onRegenerateId);
      }

      Logger.debug("實驗控制面板已渲染");
      this._emit("experiment-controls-rendered");
      return containerEl;
    });
  }
}

export default ExperimentUIRenderer;
export { ExperimentUIRenderer };
