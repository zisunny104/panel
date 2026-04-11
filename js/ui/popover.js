/**
 * UIPopover - 通用彈出層元件
 *
 * 管理定位、開關與外部點擊關閉。
 */

export class UIPopover {
  constructor({ popoverEl, anchorEl, placement = "right-start", offset = 8 }) {
    this.popoverEl =
      typeof popoverEl === "string"
        ? document.getElementById(popoverEl)
        : popoverEl;
    this.anchorEl =
      typeof anchorEl === "string"
        ? document.getElementById(anchorEl)
        : anchorEl;
    this.placement = placement;
    this.offset = offset;
    this._outsideHandler = null;
  }

  toggle() {
    if (!this.popoverEl || !this.anchorEl) return;
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    if (!this.popoverEl || !this.anchorEl) return;
    this.popoverEl.classList.remove("is-hidden");
    this.popoverEl.setAttribute("aria-hidden", "false");
    if ("inert" in this.popoverEl) {
      this.popoverEl.inert = false;
    }
    this.updatePosition();
    this._bindOutsideClick();
  }

  close() {
    if (!this.popoverEl) return;
    if (this.popoverEl.contains(document.activeElement)) {
      this.anchorEl?.focus?.();
    }
    this.popoverEl.classList.add("is-hidden");
    this.popoverEl.setAttribute("aria-hidden", "true");
    if ("inert" in this.popoverEl) {
      this.popoverEl.inert = true;
    }
    this._unbindOutsideClick();
  }

  isOpen() {
    return this.popoverEl && !this.popoverEl.classList.contains("is-hidden");
  }

  updatePosition() {
    if (!this.popoverEl || !this.anchorEl) return;

    const rect = this.anchorEl.getBoundingClientRect();
    const popoverWidth = this.popoverEl.offsetWidth || 240;
    const popoverHeight = this.popoverEl.offsetHeight || 160;
    const padding = this.offset;

    let left = rect.right + padding;
    let top = rect.top;

    const maxLeft = window.innerWidth - popoverWidth - padding;
    const maxTop = window.innerHeight - popoverHeight - padding;

    if (left > maxLeft) {
      left = Math.max(padding, rect.left - popoverWidth - padding);
    }

    if (top > maxTop) {
      top = Math.max(padding, maxTop);
    }

    this.popoverEl.style.left = `${left}px`;
    this.popoverEl.style.top = `${top}px`;
  }

  destroy() {
    this._unbindOutsideClick();
    this.popoverEl = null;
    this.anchorEl = null;
  }

  _bindOutsideClick() {
    if (this._outsideHandler) return;
    this._outsideHandler = (event) => {
      if (!this.isOpen()) return;
      if (this.popoverEl.contains(event.target)) return;
      if (this.anchorEl.contains(event.target)) return;
      this.close();
    };
    document.addEventListener("click", this._outsideHandler);
  }

  _unbindOutsideClick() {
    if (!this._outsideHandler) return;
    document.removeEventListener("click", this._outsideHandler);
    this._outsideHandler = null;
  }
}
