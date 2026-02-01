/**
 * IndicatorManager
 * 負責膠囊指示器與短暫狀態訊息（toast-like）顯示。
 * 提供簡潔、專責的 API 給 sync UI 與其他模組使用。
 */
class IndicatorManager {
  constructor() {
    this.capsule = null;
    this.statusContainer = null;
    this._initContainers();
  }

  _initContainers() {
    try {
      this.statusContainer = document.createElement("div");
      this.statusContainer.className = "indicator-status-container";
      this.statusContainer.setAttribute("aria-live", "polite");
      document.body.appendChild(this.statusContainer);
    } catch (e) {
      Logger.warn("IndicatorManager init failed", e);
    }
  }

  createCapsuleIndicator(onClickCallback) {
    if (this.capsule) return this.capsule;

    this.capsule = document.createElement("div");
    this.capsule.className = "sync-capsule-indicator idle";

    const idleText = window.SyncManager?.getStatusText?.("idle") || "未連線";
    this.capsule.innerHTML = `
      <div class="sync-status-indicator">
        <div class="sync-status-light"></div>
        <span class="sync-status-text">${idleText}</span>
      </div>`;

    const indicator = this.capsule.querySelector(".sync-status-indicator");
    if (indicator) {
      indicator.addEventListener("click", (e) => {
        if (typeof onClickCallback === "function") onClickCallback(e);
      });
    }

    document.body.appendChild(this.capsule);
    return this.capsule;
  }

  updateIndicator() {
    if (!this.capsule) return;

    try {
      const status = window.SyncManager?.getStatus?.() || "idle";
      const text = window.SyncManager?.getStatusText?.(status) || status;

      this.capsule.classList.remove("idle", "connected", "error", "connecting");
      this.capsule.classList.add(status || "idle");

      const textEl = this.capsule.querySelector(".sync-status-text");
      if (textEl) textEl.textContent = text;
    } catch (e) {
      Logger.warn("IndicatorManager.updateIndicator failed", e);
    }
  }

  /**
   * 顯示短暫狀態訊息（toast）
   * type: 'success' | 'error' | 'info' | 'warning'
   */
  showStatus(type, message, timeout = 4000) {
    if (!message) return;

    const msg = document.createElement("div");
    msg.className = `indicator-status ${type || "info"}`;
    msg.textContent = message;
    this.statusContainer.appendChild(msg);

    // screen-reader friendly
    msg.setAttribute("role", "status");

    setTimeout(() => {
      msg.classList.add("fade-out");
      setTimeout(() => msg.remove(), 300);
    }, timeout);
  }
}

// 單例放到 window，其他模組可直接使用 window.indicatorManager
try {
  window.indicatorManager = window.indicatorManager || new IndicatorManager();
} catch (e) {
  Logger.warn("Failed to instantiate IndicatorManager", e);
}
