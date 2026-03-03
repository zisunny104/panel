/**
 * IndicatorManager - 膠囊指示器與狀態訊息管理器
 *
 * 負責建立、管理膠囊指示器（支援 idle/connected/error/connecting 等狀態）
 * 與短暫狀態訊息（toast），支援 success/error/info/warning 四種類型。
 * 以單例形式暴露至 window.indicatorManager 供各模組使用。
 */
class IndicatorManager {
  constructor() {
    this.capsule = null;
    this.statusContainer = null;
    this._initContainers();
  }

  _initContainers() {
    this.statusContainer = document.createElement("div");
    this.statusContainer.className = "indicator-status-container";
    this.statusContainer.setAttribute("aria-live", "polite");
  }

  /**
   * 將狀態容器掛載到指定的面板容器中
   * @param {HTMLElement} panelContent - modal 面板的內容區域
   */
  attachToPanel(panelContent) {
    if (!this.statusContainer || !panelContent) return;
    // 確保移到正確的父元素下
    panelContent.appendChild(this.statusContainer);
    Logger.debug("IndicatorManager: statusContainer 已掛載至面板");
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
    if (!message || !this.statusContainer) return;

    // 若尚未掛載到 DOM，暫時附加到 body 作為備援
    if (!this.statusContainer.parentNode) {
      document.body.appendChild(this.statusContainer);
    }

    ":" + String(now.getSeconds()).padStart(2, "0");

    const msg = document.createElement("div");
    msg.className = `indicator-status ${type || "info"}`;
    msg.innerHTML = `<span class="indicator-status-time">${ts}</span> ${this._escapeHtml(message)}`;
    this.statusContainer.appendChild(msg);

    // screen-reader friendly
    msg.setAttribute("role", "status");

    setTimeout(() => {
      msg.classList.add("fade-out");
      setTimeout(() => msg.remove(), 300);
    }, timeout);
  }

  /** 防止 XSS */
  _escapeHtml(str) {
    const el = document.createElement("span");
    el.textContent = str;
    return el.innerHTML;
  }
}

// 單例暴露到 window，其他模組可直接使用 window.indicatorManager
window.indicatorManager = window.indicatorManager || new IndicatorManager();
