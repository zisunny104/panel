import { Logger } from "./console-manager.js";

export class EventEmitter {
  constructor() {
    this.eventListeners = new Map();
  }

  on(eventType, callback) {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType).push(callback);
    return () => this.off(eventType, callback);
  }

  off(eventType, callback) {
    if (!this.eventListeners.has(eventType)) return;
    const listeners = this.eventListeners.get(eventType);
    const index = listeners.indexOf(callback);
    if (index > -1) listeners.splice(index, 1);
  }

  emit(eventType, data) {
    if (!this.eventListeners.has(eventType)) return;
    const listeners = [...this.eventListeners.get(eventType)];
    for (const callback of listeners) {
      try {
        callback(data);
      } catch (error) {
        Logger.error(`事件處理器錯誤 (${eventType})`, error);
      }
    }
  }

  clearListeners(eventType = null) {
    if (eventType) {
      this.eventListeners.delete(eventType);
    } else {
      this.eventListeners.clear();
    }
  }
}
