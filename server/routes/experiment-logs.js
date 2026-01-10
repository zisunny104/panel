/**
 * 實驗日誌 API 路由
 * 處理實驗日誌的儲存、列出、讀取、刪除
 */
import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 日誌檔案儲存路徑
const LOGS_DIR = path.join(__dirname, "../../runtime/experiment-data");

// 確保目錄存在
async function ensureLogDir() {
  try {
    await fs.access(LOGS_DIR);
  } catch {
    await fs.mkdir(LOGS_DIR, { recursive: true });
  }
}

/**
 * GET /api/experiment-logs/list
 * 列出所有日誌檔案
 */
router.get("/list", async (req, res) => {
  try {
    await ensureLogDir();

    const entries = await fs.readdir(LOGS_DIR);
    const files = [];

    for (const entry of entries) {
      if (entry.endsWith(".jsonl")) {
        const filepath = path.join(LOGS_DIR, entry);
        const stats = await fs.stat(filepath);

        files.push({
          filename: entry,
          size: stats.size,
          modified: stats.mtimeMs,
          path: `runtime/experiment-data/${entry}`,
        });
      }
    }

    // 按修改時間降序排列
    files.sort((a, b) => b.modified - a.modified);

    res.json({
      success: true,
      files,
      count: files.length,
    });
  } catch (error) {
    console.error("[ExperimentLogs] List error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/experiment-logs/save
 * 儲存日誌檔案
 */
router.post("/save", async (req, res) => {
  try {
    const { filename, content } = req.body;

    if (!filename || !content) {
      return res.status(400).json({
        success: false,
        error: "Missing filename or content",
      });
    }

    await ensureLogDir();

    // 防止路徑遍歷
    const safeFilename = path.basename(filename);
    const filepath = path.join(LOGS_DIR, safeFilename);

    // 寫入檔案
    await fs.writeFile(filepath, content, "utf8");

    const stats = await fs.stat(filepath);

    res.json({
      success: true,
      filename: safeFilename,
      size: stats.size,
      path: `runtime/experiment-data/${safeFilename}`,
    });
  } catch (error) {
    console.error("[ExperimentLogs] Save error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/experiment-logs/read/:filename
 * 讀取日誌檔案
 */
router.get("/read/:filename", async (req, res) => {
  try {
    const { filename } = req.params;

    if (!filename) {
      return res.status(400).json({
        success: false,
        error: "Missing filename",
      });
    }

    // 防止路徑遍歷
    const safeFilename = path.basename(filename);
    const filepath = path.join(LOGS_DIR, safeFilename);

    // 檢查檔案是否存在
    try {
      await fs.access(filepath);
    } catch {
      return res.status(404).json({
        success: false,
        error: `File not found: ${safeFilename}`,
      });
    }

    const content = await fs.readFile(filepath, "utf8");
    const stats = await fs.stat(filepath);

    res.json({
      success: true,
      filename: safeFilename,
      content,
      size: stats.size,
    });
  } catch (error) {
    console.error("[ExperimentLogs] Read error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/experiment-logs/delete/:filename
 * 刪除日誌檔案
 */
router.delete("/delete/:filename", async (req, res) => {
  try {
    const { filename } = req.params;

    if (!filename) {
      return res.status(400).json({
        success: false,
        error: "Missing filename",
      });
    }

    // 防止路徑遍歷
    const safeFilename = path.basename(filename);
    const filepath = path.join(LOGS_DIR, safeFilename);

    // 檢查檔案是否存在
    try {
      await fs.access(filepath);
    } catch {
      return res.status(404).json({
        success: false,
        error: `File not found: ${safeFilename}`,
      });
    }

    await fs.unlink(filepath);

    res.json({
      success: true,
      filename: safeFilename,
      message: "File deleted successfully",
    });
  } catch (error) {
    console.error("[ExperimentLogs] Delete error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
