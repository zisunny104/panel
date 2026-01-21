/**
 * 彩色日誌工具
 * 提供統一的日誌格式和顏色
 */

// ANSI 顏色代碼
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  // 前景色
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  // 背景色
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
};

/**
 * 格式化時間為 [YYYY-MM-DD HH:mm:ss] 格式
 */
function formatTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const date = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `[${year}-${month}-${date} ${hours}:${minutes}:${seconds}]`;
}

/**
 * 替換訊息中的分隔線 | 為黃色版本（暖色）
 */
function colorizeDelimiters(message) {
  return message.replace(
    /\|/g,
    `${colors.yellow}|${colors.reset}${colors.white}`,
  );
}

/**
 * 處理彩色標籤 - 將 <color>text</color> 轉換為帶 ANSI 碼的文字
 * 例: colorizeText('工作階段 <green>FVZ217</green>', colors.white)
 * 支援的顏色: red, green, yellow, blue, cyan, magenta, white, dim
 * @param {string} message - 訊息內容
 * @param {string} baseColor - 基礎顏色，彩色標籤結束後恢復為此顏色
 */
function colorizeText(message, baseColor = colors.white) {
  const colorMap = {
    red: colors.red,
    green: colors.green,
    yellow: colors.yellow,
    blue: colors.blue,
    cyan: colors.cyan,
    magenta: colors.magenta,
    white: colors.white,
    dim: colors.dim,
    bright: colors.bright,
  };

  return message.replace(/<(\w+)>(.*?)<\/\1>/g, (match, colorName, text) => {
    const colorCode = colorMap[colorName] || colors.white;
    return `${colorCode}${text}${colors.reset}${baseColor}`;
  });
}

/**
 * 日誌工具類
 */
export class Logger {
  /**
   * 資訊日誌 (藍色時間戳, 正常文字)
   * 支援 <color>text</color> 標籤進行局部著色
   */
  static info(message, ...args) {
    const timestamp = formatTimestamp();
    const delimited = colorizeDelimiters(message);
    const colorized = colorizeText(delimited, colors.white);
    console.log(
      `${colors.cyan}${timestamp}${colors.reset} ${colors.white}${colorized}${colors.reset}`,
      ...args,
    );
  }

  /**
   * 成功日誌 (綠色)
   * 支援 <color>text</color> 標籤進行局部著色
   */
  static success(message, ...args) {
    const timestamp = formatTimestamp();
    const delimited = colorizeDelimiters(message);
    const colorized = colorizeText(delimited, colors.green);
    console.log(
      `${colors.cyan}${timestamp}${colors.reset} ${colors.green}[成功] ${colorized}${colors.reset}`,
      ...args,
    );
  }

  /**
   * 警告日誌 (黃色)
   * 支援 <color>text</color> 標籤進行局部著色
   */
  static warn(message, ...args) {
    const timestamp = formatTimestamp();
    const delimited = colorizeDelimiters(message);
    const colorized = colorizeText(delimited);
    console.log(
      `${colors.cyan}${timestamp}${colors.reset} ${colors.yellow}[警告] ${colorized}${colors.reset}`,
      ...args,
    );
  }

  /**
   * 錯誤日誌 (紅色)
   * 支援 <color>text</color> 標籤進行局部著色
   */
  static error(message, ...args) {
    const timestamp = formatTimestamp();
    const delimited = colorizeDelimiters(message);
    const colorized = colorizeText(delimited, colors.red);
    console.error(
      `${colors.cyan}${timestamp}${colors.reset} ${colors.red}[錯誤] ${colorized}${colors.reset}`,
      ...args,
    );
  }

  /**
   * 調試日誌 (灰色)
   * 支援 <color>text</color> 標籤進行局部著色
   */
  static debug(message, ...args) {
    const timestamp = formatTimestamp();
    const delimited = colorizeDelimiters(message);
    const colorized = colorizeText(delimited, colors.dim);
    console.log(
      `${colors.cyan}${timestamp}${colors.reset} ${colors.dim}${colorized}${colors.reset}`,
      ...args,
    );
  }

  /**
   * HTTP 請求日誌 (方法顏色不同)
   */
  static http(method, path, status = null) {
    const timestamp = formatTimestamp();

    // URL 解碼處理中文字符
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(path);
    } catch (error) {
      // 如果解碼失敗，使用原始路徑
      decodedPath = path;
    }

    // 根據方法選擇顏色
    let methodColor = colors.white;
    if (method === "GET" || method === "HEAD") {
      methodColor = colors.cyan;
    } else if (method === "POST") {
      methodColor = colors.green;
    } else if (method === "PUT" || method === "PATCH") {
      methodColor = colors.yellow;
    } else if (method === "DELETE") {
      methodColor = colors.red;
    }

    // 根據狀態碼選擇顏色
    let statusColor = "";
    let statusText = "";
    if (status) {
      if (status >= 200 && status < 300) {
        statusColor = colors.green;
      } else if (status >= 300 && status < 400) {
        statusColor = colors.cyan;
      } else if (status >= 400 && status < 500) {
        statusColor = colors.yellow;
      } else if (status >= 500) {
        statusColor = colors.red;
      }
      statusText = ` ${statusColor}${status}${colors.reset}`;
    }

    console.log(
      `${colors.cyan}${timestamp}${colors.reset} ${methodColor}${method}${colors.reset} ${decodedPath}${statusText}`,
    );
  }

  /**
   * 連線狀態日誌 (洋紅色)
   * 支援 <color>text</color> 標籤進行局部著色
   */
  static connection(message, ...args) {
    const timestamp = formatTimestamp();
    const delimited = colorizeDelimiters(message);
    const colorized = colorizeText(delimited);
    console.log(
      `${colors.cyan}${timestamp}${colors.reset} ${colors.magenta}${colorized}${colors.reset}`,
      ...args,
    );
  }

  /**
   * 統計日誌 - 標籤+數值格式 (白色標籤 + 亮青色數值，黃色分隔線)
   * 支援 <color>text</color> 標籤進行局部著色，異常值用黃色標示
   * 例: stats('連線', 2, '工作階段', 1)
   */
  static stats(...args) {
    const timestamp = formatTimestamp();

    // 組合標籤和數值
    let output = `${colors.cyan}${timestamp}${colors.reset}`;

    for (let i = 0; i < args.length; i += 2) {
      if (i > 0) {
        output += ` ${colors.yellow}|${colors.reset}`;
      }

      const label = args[i];
      const value = args[i + 1];

      // 處理標籤中的彩色標籤
      const colorizedLabel = colorizeText(label);
      // 標籤用白色，數值用亮青色（與時間戳色調一致）
      output += ` ${colors.white}${colorizedLabel}${colors.reset} ${colors.cyan}${colors.bright}${value}${colors.reset}`;
    }

    console.log(output);
  }

  /**
   * 帶標籤的事件日誌 - 純著色輸出，不參與格式化
   * 調用方負責組織和格式化訊息
   * 支援 <color>text</color> 標籤進行局部著色
   * 例: event('green', '+', '房間建立 | <cyan>FVZ217</cyan>')
   */
  static event(color, symbol, message) {
    const timestamp = formatTimestamp();
    const colorCode = colors[color] || colors.white;
    const delimited = colorizeDelimiters(message);
    const colorized = colorizeText(delimited);
    console.log(
      `${colors.cyan}${timestamp}${colors.reset} ${colorCode}${symbol}${colors.reset} ${colors.white}${colorized}${colors.reset}`,
    );
  }
}

export default Logger;
