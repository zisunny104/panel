/**
 * LogService.js
 * 實驗日誌管理服務
 *
 * 功能：
 * 1. 批次儲存日誌（JSONL 格式）
 * 2. 完成實驗（確認日誌檔案）
 * 3. 列出實驗日誌
 * 4. 讀取/下載 JSONL 內容
 * 5. 刪除日誌檔案
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 日誌檔案目錄
const LOGS_DIR = path.join(__dirname, "../../runtime/experiment-data");

export class LogService {
  /**
   * 確保日誌目錄存在
   */
  static ensureLogsDirectory() {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
  }

  /**
   * 批次儲存日誌（JSONL 格式）
   * @param {string} experimentId - 實驗 ID
   * @param {Array} logs - 日誌陣列
   * @returns {object} { success, message, file }
   */
  static saveBatchLogs(experimentId, logs) {
    this.ensureLogsDirectory();

    if (!experimentId) {
      return {
        success: false,
        message: "缺少實驗 ID",
      };
    }

    if (!Array.isArray(logs) || logs.length === 0) {
      return {
        success: false,
        message: "日誌資料必須是非空陣列",
      };
    }

    try {
      const filename = `${experimentId}.jsonl`;
      const filepath = path.join(LOGS_DIR, filename);

      // 將每個日誌物件轉換為 JSON 字串，並用換行符分隔
      const jsonlContent =
        logs.map((log) => JSON.stringify(log)).join("\n") + "\n";

      // 附加到檔案（如果檔案已存在）
      fs.appendFileSync(filepath, jsonlContent, "utf8");

      // 取得檔案資訊
      const stats = fs.statSync(filepath);

      return {
        success: true,
        message: `已儲存 ${logs.length} 筆日誌`,
        file: filename,
        size: stats.size,
        logsCount: logs.length,
      };
    } catch (error) {
      console.error("[LogService] 儲存日誌失敗:", error);
      return {
        success: false,
        message: "檔案寫入錯誤：" + error.message,
      };
    }
  }

  /**
   * 完成實驗（確認日誌檔案存在）
   * @param {string} experimentId - 實驗 ID
   * @param {object} metadata - 實驗元資料（可選）
   * @returns {object} { success, message, filePath }
   */
  static finalizeExperiment(experimentId, metadata = {}) {
    this.ensureLogsDirectory();

    if (!experimentId) {
      return {
        success: false,
        message: "缺少實驗 ID",
      };
    }

    try {
      const filename = `${experimentId}.jsonl`;
      const filepath = path.join(LOGS_DIR, filename);

      // 檢查檔案是否存在
      if (!fs.existsSync(filepath)) {
        return {
          success: false,
          message: "日誌檔案不存在",
        };
      }

      // 如果有元資料，附加到檔案末尾
      if (Object.keys(metadata).length > 0) {
        const metadataLine =
          JSON.stringify({
            type: "metadata",
            timestamp: Date.now(),
            ...metadata,
          }) + "\n";

        fs.appendFileSync(filepath, metadataLine, "utf8");
      }

      // 取得檔案資訊
      const stats = fs.statSync(filepath);

      return {
        success: true,
        message: "實驗已完成",
        filePath: filename,
        size: stats.size,
      };
    } catch (error) {
      console.error("[LogService] 完成實驗失敗:", error);
      return {
        success: false,
        message: "檔案操作錯誤：" + error.message,
      };
    }
  }

  /**
   * 列出所有實驗日誌
   * @returns {Array} 日誌檔案列表
   */
  static listExperiments() {
    this.ensureLogsDirectory();

    try {
      const files = fs.readdirSync(LOGS_DIR);
      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

      const experiments = jsonlFiles.map((filename) => {
        const filepath = path.join(LOGS_DIR, filename);
        const stats = fs.statSync(filepath);
        const experimentId = filename.replace(".jsonl", "");

        return {
          experimentId,
          filename,
          size: stats.size,
          createdAt: Math.floor(stats.birthtimeMs / 1000),
          modifiedAt: Math.floor(stats.mtimeMs / 1000),
        };
      });

      // 依修改時間排序（最新的在前）
      experiments.sort((a, b) => b.modifiedAt - a.modifiedAt);

      return experiments;
    } catch (error) {
      console.error("[LogService] 列出實驗失敗:", error);
      return [];
    }
  }

  /**
   * 讀取 JSONL 內容
   * @param {string} experimentId - 實驗 ID
   * @returns {object} { success, logs, message }
   */
  static getJsonlContent(experimentId) {
    this.ensureLogsDirectory();

    if (!experimentId) {
      return {
        success: false,
        message: "缺少實驗 ID",
      };
    }

    try {
      const filename = `${experimentId}.jsonl`;
      const filepath = path.join(LOGS_DIR, filename);

      if (!fs.existsSync(filepath)) {
        return {
          success: false,
          message: "日誌檔案不存在",
        };
      }

      // 讀取檔案內容
      const content = fs.readFileSync(filepath, "utf8");

      // 解析 JSONL（每行一個 JSON）
      const lines = content.split("\n").filter((line) => line.trim() !== "");
      const logs = lines.map((line, index) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          console.error(`[LogService] 解析第 ${index + 1} 行失敗:`, error);
          return { error: "Parse error", line: index + 1 };
        }
      });

      return {
        success: true,
        experimentId,
        logs,
        count: logs.length,
      };
    } catch (error) {
      console.error("[LogService] 讀取 JSONL 失敗:", error);
      return {
        success: false,
        message: "檔案讀取錯誤：" + error.message,
      };
    }
  }

  /**
   * 取得 JSONL 檔案路徑（用於下載）
   * @param {string} experimentId - 實驗 ID
   * @returns {string|null} 檔案路徑或 null
   */
  static getJsonlFilePath(experimentId) {
    this.ensureLogsDirectory();

    const filename = `${experimentId}.jsonl`;
    const filepath = path.join(LOGS_DIR, filename);

    if (fs.existsSync(filepath)) {
      return filepath;
    }

    return null;
  }

  /**
   * 刪除日誌檔案
   * @param {string} experimentId - 實驗 ID
   * @returns {object} { success, message }
   */
  static deleteLog(experimentId) {
    this.ensureLogsDirectory();

    if (!experimentId) {
      return {
        success: false,
        message: "缺少實驗 ID",
      };
    }

    try {
      const filename = `${experimentId}.jsonl`;
      const filepath = path.join(LOGS_DIR, filename);

      if (!fs.existsSync(filepath)) {
        return {
          success: false,
          message: "日誌檔案不存在",
        };
      }

      fs.unlinkSync(filepath);

      return {
        success: true,
        message: "日誌已刪除",
        experimentId,
      };
    } catch (error) {
      console.error("[LogService] 刪除日誌失敗:", error);
      return {
        success: false,
        message: "檔案刪除錯誤：" + error.message,
      };
    }
  }

  /**
   * 批次刪除日誌檔案
   * @param {Array<string>} experimentIds - 實驗 ID 陣列
   * @returns {object} { success, deleted, failed, message }
   */
  static deleteBatchLogs(experimentIds) {
    if (!Array.isArray(experimentIds) || experimentIds.length === 0) {
      return {
        success: false,
        message: "缺少實驗 ID 列表",
      };
    }

    const results = {
      deleted: [],
      failed: [],
    };

    experimentIds.forEach((experimentId) => {
      const result = this.deleteLog(experimentId);
      if (result.success) {
        results.deleted.push(experimentId);
      } else {
        results.failed.push({ experimentId, reason: result.message });
      }
    });

    return {
      success: true,
      deleted: results.deleted,
      deletedCount: results.deleted.length,
      failed: results.failed,
      failedCount: results.failed.length,
      message: `已刪除 ${results.deleted.length} 個日誌，${results.failed.length} 個失敗`,
    };
  }

  /**
   * 取得日誌統計資訊
   * @param {string} experimentId - 實驗 ID
   * @returns {object} { success, stats, message }
   */
  static getLogStats(experimentId) {
    const result = this.getJsonlContent(experimentId);

    if (!result.success) {
      return result;
    }

    const { logs } = result;

    // 統計資訊
    const stats = {
      totalLogs: logs.length,
      types: {},
      timeRange: {
        first: null,
        last: null,
      },
    };

    // 統計類型分布和時間範圍
    logs.forEach((log) => {
      if (log.type) {
        stats.types[log.type] = (stats.types[log.type] || 0) + 1;
      }

      if (log.timestamp) {
        if (!stats.timeRange.first || log.timestamp < stats.timeRange.first) {
          stats.timeRange.first = log.timestamp;
        }
        if (!stats.timeRange.last || log.timestamp > stats.timeRange.last) {
          stats.timeRange.last = log.timestamp;
        }
      }
    });

    return {
      success: true,
      experimentId,
      stats,
    };
  }
}
