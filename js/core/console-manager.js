/**
 * Logger - 統一的日誌管理模組
 * 支援多部分著色和手動顏色標記
 */

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

      const stackLines = stack.split("\n");
      for (let i = 0; i < stackLines.length; i++) {
        const line = stackLines[i];
        if (line.includes("console-manager.js") || line.includes("Logger.")) {
          continue;
        }
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
   * 格式化日誌訊息（支援多部分著色和顏色標記）
   */
  static formatMessage(level, ...args) {
    const caller = this.getCallerInfo();
    const now = new Date();
    const timestamp = now.toLocaleTimeString("en-GB", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const levelUpper = level.toUpperCase();
    const fileInfo = `${caller.file}:${caller.line}`;

    // 處理參數：物件保持為物件，字串處理顏色標記
    const objectArgs = [];
    let messageText = "";

    args.forEach((arg, index) => {
      if (typeof arg === "object" && arg !== null) {
        // 物件參數：使用佔位符並單獨儲存物件
        messageText += (index > 0 ? " " : "") + "%o";
        objectArgs.push(arg);
      } else {
        // 字串參數：正常處理
        messageText += (index > 0 ? " " : "") + String(arg);
      }
    });

    const { processedMessage, extraStyles } = this.processColorTags(
      messageText,
      level,
    );

    const colors = {
      timestamp: "#00cccc",
      level: this.getLevelColor(level),
      fileInfo: "#888888",
      message: this.getMessageColor(level),
    };

    let formatString = `%c[${timestamp}]%c [${levelUpper}]%c [${fileInfo}]%c`;
    const styles = [
      `color: ${colors.timestamp}; font-weight: bold;`,
      `color: ${colors.level}; font-weight: bold;`,
      `color: ${colors.fileInfo}; font-weight: normal;`,
    ];

    if (processedMessage) {
      formatString += ` ${processedMessage}`;
      styles.push(...extraStyles);
    }

    // 返回格式字串、樣式和物件參數
    return [formatString, ...styles, ...objectArgs];
  }

  /**
   * 取得日誌等級的顏色
   */
  static getLevelColor(level) {
    const levelColors = {
      debug: "#87ceeb",
      info: "#00ff88",
      warn: "#ffa500",
      error: "#ff6b6b",
    };
    return levelColors[level] || levelColors.info;
  }

  /**
   * 取得訊息部分的顏色
   */
  static getMessageColor(level) {
    const messageColors = {
      debug: "#b0b0b0",
      info: "#ffffff",
      warn: "#ffe4b5",
      error: "#ffcdd2",
    };
    return messageColors[level] || messageColors.info;
  }

  /**
   * 處理訊息中的顏色標記
   */
  static processColorTags(message, level) {
    const colorMap = {
      red: "#ff6b6b",
      green: "#00ff88",
      yellow: "#ffa500",
      blue: "#87ceeb",
      cyan: "#00cccc",
      magenta: "#ff00ff",
      white: "#ffffff",
      gray: "#888888",
      orange: "#ffaa00",
    };

    const baseColor = this.getMessageColor(level);
    const parts = [];
    const styles = [];
    let lastIndex = 0;
    let hasTags = false;

    // 總是在訊息開始處新增基礎樣式
    parts.push("");
    styles.push(`color: ${baseColor};`);

    // 匹配 <color>text</color> 標籤
    const tagRegex = /<(\w+)>(.*?)<\/\1>/g;
    let match;

    while ((match = tagRegex.exec(message)) !== null) {
      hasTags = true;
      const [fullMatch, colorName, text] = match;
      const tagColor = colorMap[colorName] || baseColor;

      // 新增標籤前的文字（使用目前樣式，已經是基礎顏色）
      if (match.index > lastIndex) {
        const textBefore = message.slice(lastIndex, match.index);
        parts.push(textBefore);
        // 不新增額外樣式，使用之前的基礎樣式
      }

      // 新增標籤內容的%c佔位符
      parts.push(`%c${text}%c`);
      styles.push(`color: ${tagColor}; font-weight: bold;`);
      styles.push(`color: ${baseColor};`); // 標籤結束後還原為基礎顏色

      lastIndex = match.index + fullMatch.length;
    }

    // 新增剩餘文字
    if (lastIndex < message.length) {
      parts.push(message.slice(lastIndex));
      // 不新增額外樣式，使用之前的基礎樣式
    } else if (!hasTags) {
      // 如果沒有標籤，新增整個訊息
      parts.push(message);
    }

    return {
      processedMessage: parts.join(""),
      extraStyles: styles,
    };
  }

  /**
   * 設定日誌等級
   */
  static setLogLevel(level) {
    const validLevels = ["debug", "info", "warn", "error", "none"];
    if (validLevels.includes(level)) {
      this.LOG_LEVEL = level;
      Logger.info(`日誌等級設定為: ${level}`);
    } else {
      console.warn(
        `無效的日誌等級: ${level}。有效值: ${validLevels.join(", ")}`,
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

  static debug(...args) {
    if (this.shouldLog("debug")) {
      console.debug(...this.formatMessage("debug", ...args));
    }
  }

  static info(...args) {
    if (this.shouldLog("info")) {
      console.info(...this.formatMessage("info", ...args));
    }
  }

  static warn(...args) {
    console.warn(...this.formatMessage("warn", ...args));
  }

  static error(...args) {
    console.error(...this.formatMessage("error", ...args));
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
