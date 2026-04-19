/**
 * ExperimentControlsDom - 實驗控制面板 DOM 操作層
 *
 * 提供實驗執行期間需要的 DOM 讀寫操作：輸入框同步、
 * 電源選項 checkbox、單元清單讀取、控制按鈕狀態切換、
 * UI 鎖定與受試者名稱可編輯性。
 *
 * 此類別不使用任何管理器的內部狀態，所有方法皆為純
 * DOM 操作，供 ExperimentUIManager 透過繼承直接使用。
 */

import { Logger } from "../core/console-manager.js";

class ExperimentControlsDom {
  // ==========================================
  // 輸入框同步
  // ==========================================

  /**
   * 將實驗 ID 寫入輸入框（若元素存在）
   * @param {string} value
   */
  setExperimentIdInput(value) {
    const input = document.getElementById("experimentIdInput");
    if (input && input.value.trim() !== value) {
      input.value = value;
    }
  }

  /**
   * 將受試者名稱寫入輸入框（若元素存在）
   * @param {string} value
   */
  setParticipantNameInput(value) {
    const input = document.getElementById("participantNameInput");
    if (input && input.value.trim() !== value) {
      input.value = value;
    }
  }

  // ==========================================
  // 電源選項 checkbox
  // ==========================================

  /**
   * 從 UI 讀取電源選項 checkbox 狀態
   * @returns {{ includeStartup: boolean, includeShutdown: boolean }}
   */
  getPowerOptionsFromUi() {
    const includeStartup =
      document.getElementById("includeStartup")?.checked ?? true;
    const includeShutdown =
      document.getElementById("includeShutdown")?.checked ?? true;
    return { includeStartup, includeShutdown };
  }

  /**
   * 將電源選項寫入 UI checkbox 並永久鎖定
   * @param {{ includeStartup?: boolean, includeShutdown?: boolean }} options
   */
  applyPowerOptionsToUi(options = {}) {
    const startupCheckbox = document.getElementById("includeStartup");
    if (
      startupCheckbox &&
      typeof options.includeStartup === "boolean" &&
      startupCheckbox.checked !== options.includeStartup
    ) {
      startupCheckbox.checked = options.includeStartup;
    }
    if (startupCheckbox) {
      startupCheckbox.disabled = true;
      startupCheckbox.dataset.permaDisabled = "true";
    }

    const shutdownCheckbox = document.getElementById("includeShutdown");
    if (
      shutdownCheckbox &&
      typeof options.includeShutdown === "boolean" &&
      shutdownCheckbox.checked !== options.includeShutdown
    ) {
      shutdownCheckbox.checked = options.includeShutdown;
    }
    if (shutdownCheckbox) {
      shutdownCheckbox.disabled = true;
      shutdownCheckbox.dataset.permaDisabled = "true";
    }
  }

  /**
   * 綁定電源選項 checkbox 的 change 事件。
   * @param {Function} onChange - 值改變時的回呼（由 SystemManager 提供）
   */
  bindPowerOptionListeners(onChange) {
    const bind = (id) => {
      const cb = document.getElementById(id);
      if (!cb || cb._experimentSystemBound) return;
      cb._experimentSystemBound = true;
      cb.addEventListener("change", () => {
        if (cb.dataset.permaDisabled === "true") {
          cb.disabled = true;
          return;
        }
        onChange?.();
      });
    };
    bind("includeStartup");
    bind("includeShutdown");
  }

  // ==========================================
  // 單元清單讀取
  // ==========================================

  /**
   * 從單元清單 DOM 讀取 unit ID 列表。
   * @param {{ onlyChecked?: boolean, containerSelector?: string }} opts
   * @returns {string[]}
   */
  getUnitIdsFromUi({ onlyChecked = false, containerSelector = null } = {}) {
    const unitList = containerSelector
      ? document.querySelector(`${containerSelector} .experiment-units-list`)
      : document.querySelector(".experiment-units-list");
    if (!unitList) return [];

    const items = Array.from(unitList.querySelectorAll("li[data-unit-id]"));
    const filtered = onlyChecked
      ? items.filter((li) => li.querySelector("input[type=\"checkbox\"]")?.checked)
      : items;

    return filtered.map((li) => li.dataset.unitId).filter(Boolean);
  }

  // ==========================================
  // 實驗控制按鈕狀態切換
  // ==========================================

  /**
   * 更新實驗控制按鈕區塊為「實驗已開始」狀態
   * @param {string|null} containerSelector
   */
  updateExperimentControlsForStarted(containerSelector) {
    const container = containerSelector
      ? document.querySelector(containerSelector)
      : null;
    if (!container) return;
    const startRow = container.querySelector("#experimentIdRow");
    const controlBtns = container.querySelector("#experimentControlButtons");
    if (startRow) startRow.style.display = "none";
    if (controlBtns) controlBtns.style.display = "flex";
    const pauseBtn = container.querySelector("#pauseExperimentBtn");
    if (pauseBtn) {
      pauseBtn.textContent = "⏸ 暫停";
      pauseBtn.classList.remove("btn-secondary");
      pauseBtn.classList.add("btn-primary");
      pauseBtn.dataset.isPaused = "false";
    }
  }

  /**
   * 更新實驗控制按鈕區塊為「已暫停」狀態
   * @param {string|null} containerSelector
   */
  updateExperimentControlsForPaused(containerSelector) {
    const container = containerSelector
      ? document.querySelector(containerSelector)
      : null;
    if (!container) return;
    const pauseBtn = container.querySelector("#pauseExperimentBtn");
    if (pauseBtn) {
      pauseBtn.textContent = "⏯ 繼續";
      pauseBtn.classList.remove("btn-primary");
      pauseBtn.classList.add("btn-secondary");
      pauseBtn.dataset.isPaused = "true";
    }
  }

  /**
   * 更新實驗控制按鈕區塊為「已繼續」狀態
   * @param {string|null} containerSelector
   */
  updateExperimentControlsForResumed(containerSelector) {
    const container = containerSelector
      ? document.querySelector(containerSelector)
      : null;
    if (!container) return;
    const pauseBtn = container.querySelector("#pauseExperimentBtn");
    if (pauseBtn) {
      pauseBtn.textContent = "⏸ 暫停";
      pauseBtn.classList.remove("btn-secondary");
      pauseBtn.classList.add("btn-primary");
      pauseBtn.dataset.isPaused = "false";
    }
  }

  /**
   * 更新實驗控制按鈕區塊為「已停止」狀態
   * @param {string|null} containerSelector
   */
  updateExperimentControlsForStopped(containerSelector) {
    const container = containerSelector
      ? document.querySelector(containerSelector)
      : null;
    if (!container) return;
    const startRow = container.querySelector("#experimentIdRow");
    const controlBtns = container.querySelector("#experimentControlButtons");
    if (startRow) startRow.style.display = "block";
    if (controlBtns) controlBtns.style.display = "none";
  }

  // ==========================================
  // UI 鎖定與受試者名稱可編輯性
  // ==========================================

  /**
   * 鎖定或解鎖整體實驗 UI（組合選擇器、checkbox、排序按鈕等）
   * @param {boolean} locked
   * @param {{ combinationSelector?: string }} containers
   */
  setUILocked(locked, containers = {}) {
    if (containers.combinationSelector) {
      const container = document.querySelector(containers.combinationSelector);
      if (container) {
        container.style.pointerEvents = locked ? "none" : "";
        container.style.opacity = locked ? "0.6" : "";
      }
    }

    document.querySelectorAll(".combination-item").forEach((btn) => {
      btn.style.pointerEvents = locked ? "none" : "";
      btn.style.opacity = locked ? "0.5" : "";
    });

    const experimentIdInput = document.getElementById("experimentIdInput");
    if (experimentIdInput) experimentIdInput.disabled = locked;

    const regenerateIdBtn = document.getElementById("regenerateIdButton");
    if (regenerateIdBtn) regenerateIdBtn.disabled = locked;

    document
      .querySelectorAll(".unit-checkbox input[type=\"checkbox\"]")
      .forEach((cb) => {
        const isPermaDisabled =
          cb?.dataset?.permaDisabled === "true" ||
          cb?.id === "includeStartup" ||
          cb?.id === "includeShutdown";
        if (isPermaDisabled) {
          cb.disabled = true;
          cb.dataset.permaDisabled = "true";
          return;
        }
        cb.disabled = locked;
      });

    const selectAllBtn = document.getElementById("selectAllUnits");
    if (selectAllBtn) selectAllBtn.disabled = locked;

    document.querySelectorAll(".unit-sort-btn").forEach((btn) => {
      btn.disabled = locked;
      btn.style.pointerEvents = locked ? "none" : "";
      btn.style.opacity = locked ? "0.4" : "";
    });
    document.querySelectorAll(".unit-drag-handle").forEach((handle) => {
      handle.style.pointerEvents = locked ? "none" : "";
      handle.style.cursor = locked ? "default" : "";
      handle.style.opacity = locked ? "0.3" : "";
    });

    const experimentTimer = document.getElementById("experimentTimer");
    if (experimentTimer && locked) {
      experimentTimer.classList.remove("is-hidden");
    }

    Logger.debug(locked ? "UI 已鎖定" : "UI 已解鎖");
  }

  /**
   * 設定受試者名稱輸入框的可編輯狀態
   * @param {boolean} allowed
   */
  setParticipantEditAllowed(allowed) {
    const pInput = document.querySelector("#participantNameInput");
    if (pInput) {
      pInput.readOnly = !allowed;
      if (allowed) {
        pInput.classList.remove("experiment-disabled");
        pInput.removeAttribute("disabled");
      } else {
        pInput.classList.add("experiment-disabled");
        pInput.setAttribute("disabled", "true");
      }
    }
  }
}

export default ExperimentControlsDom;
export { ExperimentControlsDom };
