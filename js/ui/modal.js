/**
 * UIModal - 通用彈窗元件
 *
 * 管理基本的掛載與移除，保留事件與內容由呼叫端處理。
 */

export class UIModal {
  constructor({ id, html }) {
    this.id = id;
    this.html = html;
    this.modalEl = null;
  }

  open() {
    if (!this.id || !this.html) return;

    const existing = document.getElementById(this.id);
    if (existing) {
      existing.remove();
    }

    document.body.insertAdjacentHTML("beforeend", this.html);
    this.modalEl = document.getElementById(this.id);
    if (this.modalEl) {
      this.modalEl.style.display = "flex";
    }
  }

  close() {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
      return;
    }

    const existing = this.id ? document.getElementById(this.id) : null;
    if (existing) {
      existing.remove();
    }
  }
}
