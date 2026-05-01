/**
 * IndicatorManager - 膠囊指示器與狀態訊息管理器
 *
 * 負責建立、管理膠囊指示器（支援 idle/connected/error/connecting 等狀態）
 * 與短暫狀態訊息（toast），支援 success/error/info/warning 四種類型。
 */
import { Logger } from "../core/console-manager.js";

class IndicatorManager {
  constructor() {
    this.capsule = null;
    this.statusContainer = null;
    this.getStatus = () => "idle";
    this.getStatusText = (status) => status;
    this.maxStatusMessages = 100;
    this.pendingStatusQueue = [];
    this._initContainers();
  }

  updateDependencies({ getStatus, getStatusText } = {}) {
    if (typeof getStatus === "function") {
      this.getStatus = getStatus;
    }
    if (typeof getStatusText === "function") {
      this.getStatusText = getStatusText;
    }
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
    this._flushPendingStatuses();
    Logger.debug("IndicatorManager: statusContainer 已掛載至面板");
  }

  createCapsuleIndicator(onClickCallback) {
    if (this.capsule) return this.capsule;

    this.capsule = document.createElement("div");
    this.capsule.className = "sync-capsule-indicator idle";

    const idleText = this.getStatusText?.("idle") || "未連線";
    this.capsule.innerHTML = `
      <div class="sync-status-indicator">
        <div class="sync-status-light"></div>
        <span class="sync-status-text">${idleText}</span>
      </div>`;

    const indicator = this.capsule.querySelector(".sync-status-indicator");
    if (indicator && typeof onClickCallback === "function") {
      indicator.addEventListener("click", onClickCallback);
    }

    document.body.appendChild(this.capsule);
    return this.capsule;
  }

  updateIndicator() {
    if (!this.capsule) return;

    try {
      const status = this.getStatus?.() || "idle";
      const text = this.getStatusText?.(status) || status;

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
  showStatus(type, message, _timeout = 4000) {
    if (!message || !this.statusContainer) return;

    // 若尚未掛載到面板，先暫存，避免訊息直接跳到畫面上。
    if (!this.statusContainer.parentNode) {
      this.pendingStatusQueue.push({ type, message });
      const overflow = this.pendingStatusQueue.length - this.maxStatusMessages;
      if (overflow > 0) {
        this.pendingStatusQueue.splice(0, overflow);
      }
      return;
    }

    this._appendStatusMessage(type, message);
  }

  _flushPendingStatuses() {
    if (!this.statusContainer?.parentNode || this.pendingStatusQueue.length === 0) {
      return;
    }

    const queued = this.pendingStatusQueue.splice(0);
    queued.forEach(({ type, message }) => {
      this._appendStatusMessage(type, message);
    });
  }

  _appendStatusMessage(type, message) {
    if (!message || !this.statusContainer) return;

    const ts = new Date().toTimeString().slice(0, 8);

    const msg = document.createElement("div");
    msg.className = `indicator-status ${type || "info"}`;
    msg.innerHTML = `<span class="indicator-status-time">${ts}</span> ${this._escapeHtml(message)}`;
    this.statusContainer.appendChild(msg);

    // 讓最新訊息維持在可視區底部
    requestAnimationFrame(() => {
      this.statusContainer.scrollTop = this.statusContainer.scrollHeight;
    });

    // screen-reader friendly
    msg.setAttribute("role", "status");

    // 保留訊息作為可捲動的歷史紀錄，不自動移除。
    // 只在超過上限時，移除最舊的訊息以避免無限制成長。
    const overflow = this.statusContainer.children.length - this.maxStatusMessages;
    if (overflow > 0) {
      for (let i = 0; i < overflow; i += 1) {
        const firstChild = this.statusContainer.firstElementChild;
        if (!firstChild) break;
        firstChild.remove();
      }
    }
  }

  /** 防止 XSS */
  _escapeHtml(str) {
    const el = document.createElement("span");
    el.textContent = str;
    return el.innerHTML;
  }
}

export { IndicatorManager };
