// console-manager.js - 統一的日誌管理模塊

class Logger {
  static LOG_LEVEL = "debug"; // 'debug', 'info', 'warn', 'error', 'none'

  /**
   * 取得呼叫者的檔案資訊
   */
  static getCallerInfo() {
    try {
      const error = new Error();
      const stack = error.stack;
      if (!stack) return { file: "unknown", line: 0 };

      // 解析堆疊追蹤
      const stackLines = stack.split("\n");
      // 找到Logger以外的第一個呼叫者
      for (let i = 0; i < stackLines.length; i++) {
        const line = stackLines[i];
        if (line.includes("console-manager.js") || line.includes("Logger.")) {
          continue;
        }
        // 匹配檔案路徑和行號
        const match =
          line.match(/\/([^\/]+\.js):(\d+)/) ||
          line.match(/([^\s]+\.js):(\d+)/) ||
          line.match(/\/([^\/]+\.js)\?/) ||
          line.match(/([^\s]+\.js)\?/);
        if (match) {
          return {
            file: match[1],
            line: match[2] || 0,
          };
        }
      }
      return { file: "unknown", line: 0 };
    } catch (e) {
      return { file: "unknown", line: 0 };
    }
  }

  /**
   * 格式化日誌訊息
   */
  static formatMessage(level, ...args) {
    const caller = this.getCallerInfo();
    // 使用本機時間而不是UTC時間
    const now = new Date();
    const timestamp = now.toLocaleTimeString("en-GB", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }); // HH:MM:SS 格式的本機時間
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${caller.file}:${
      caller.line
    }]`;

    return [prefix, ...args];
  }

  /**
   * 設定日誌等級
   */
  static setLogLevel(level) {
    const validLevels = ["debug", "info", "warn", "error", "none"];
    if (validLevels.includes(level)) {
      this.LOG_LEVEL = level;
      console.log(`日誌等級設定為: ${level}`);
    } else {
      console.warn(
        `無效的日誌等級: ${level}。有效值: ${validLevels.join(", ")}`
      );
    }
  }

  /**
   * 檢查是否應該輸出日誌
   */
  static shouldLog(level) {
    const levels = ["debug", "info", "warn", "error", "none"];
    const currentLevelIndex = levels.indexOf(this.LOG_LEVEL);
    const messageLevelIndex = levels.indexOf(level);

    return messageLevelIndex >= currentLevelIndex;
  }

  /**
   * Debug 日誌 - 只在 debug 模式或日誌等級允許時輸出
   */
  static debug(...args) {
    if (this.shouldLog("debug")) {
      console.debug(...this.formatMessage("debug", ...args));
    }
  }

  /**
   * 資訊日誌 - 根據日誌等級控制
   */
  static info(...args) {
    if (this.shouldLog("info")) {
      console.info(...this.formatMessage("info", ...args));
    }
  }

  /**
   * 警告日誌 - 始終輸出（重要警告）
   */
  static warn(...args) {
    console.warn(...this.formatMessage("warn", ...args));
  }

  /**
   * 錯誤日誌 - 始終輸出（重要錯誤）
   */
  static error(...args) {
    console.error(...this.formatMessage("error", ...args));
  }

  /**
   * 強制輸出日誌（繞過等級控制，緊急情況使用）
   */
  static forceLog(...args) {
    // 直接使用 console.log，繞過等級控制
    console.log("[FORCE]", ...args);
  }

  /**
   * 強制輸出錯誤（緊急錯誤）
   */
  static forceError(...args) {
    console.error("[FORCE ERROR]", ...args);
  }

  /**
   * 取得目前設定狀態
   */
  static getStatus() {
    return {
      logLevel: this.LOG_LEVEL,
      shouldLogDebug: this.shouldLog("debug"),
      shouldLogInfo: this.shouldLog("info"),
      shouldLogWarn: this.shouldLog("warn"),
      shouldLogError: this.shouldLog("error"),
    };
  }
}

window.Logger = Logger;

window.ConsoleManager = Logger;
