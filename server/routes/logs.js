/**
 * logs.js
 * 日誌 API 路由
 *
 * 對應舊 PHP: experiment-log-api.php
 */

import express from "express";
import { LogService } from "../services/LogService.js";

const router = express.Router();

/**
 * POST /api/logs/batch
 * 批次儲存日誌
 *
 * Request Body:
 * {
 *   "experimentId": "EXP20260109ABCD",
 *   "logs": [
 *     { "timestamp": 1736409600000, "type": "action", "data": {...} },
 *     { "timestamp": 1736409601000, "type": "state", "data": {...} }
 *   ]
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "已儲存 2 筆日誌",
 *   "file": "EXP20260109ABCD.jsonl",
 *   "size": 1024,
 *   "logsCount": 2
 * }
 */
router.post("/batch", (req, res) => {
  const { experimentId, logs } = req.body;

  const result = LogService.saveBatchLogs(experimentId, logs);

  if (result.success) {
    res.status(201).json(result);
  } else {
    res.status(400).json(result);
  }
});

/**
 * POST /api/logs/finalize
 * 完成實驗
 *
 * Request Body:
 * {
 *   "experimentId": "EXP20260109ABCD",
 *   "metadata": {
 *     "subjectName": "測試者",
 *     "duration": 120000
 *   }
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "實驗已完成",
 *   "filePath": "EXP20260109ABCD.jsonl",
 *   "size": 2048
 * }
 */
router.post("/finalize", (req, res) => {
  const { experimentId, metadata } = req.body;

  const result = LogService.finalizeExperiment(experimentId, metadata);

  if (result.success) {
    res.json(result);
  } else {
    res.status(404).json(result);
  }
});

/**
 * GET /api/logs/experiments
 * 列出所有實驗日誌
 *
 * Response:
 * {
 *   "success": true,
 *   "experiments": [
 *     {
 *       "experimentId": "EXP20260109ABCD",
 *       "filename": "EXP20260109ABCD.jsonl",
 *       "size": 2048,
 *       "createdAt": 1736409600,
 *       "modifiedAt": 1736409720
 *     }
 *   ],
 *   "count": 1
 * }
 */
router.get("/experiments", (req, res) => {
  const experiments = LogService.listExperiments();

  res.json({
    success: true,
    experiments,
    count: experiments.length,
  });
});

/**
 * GET /api/logs/:id/jsonl
 * 下載 JSONL 檔案
 *
 * Response: JSONL 檔案
 */
router.get("/:id/jsonl", (req, res) => {
  const { id } = req.params;

  const filepath = LogService.getJsonlFilePath(id);

  if (!filepath) {
    return res.status(404).json({
      success: false,
      message: "日誌檔案不存在",
    });
  }

  // 設定下載標頭
  res.download(filepath, `${id}.jsonl`, (error) => {
    if (error) {
      console.error("[LogsAPI] 下載檔案失敗:", error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: "下載失敗",
        });
      }
    }
  });
});

/**
 * GET /api/logs/:id/content
 * 取得 JSONL 內容（JSON 格式）
 *
 * Response:
 * {
 *   "success": true,
 *   "experimentId": "EXP20260109ABCD",
 *   "logs": [ {...}, {...} ],
 *   "count": 100
 * }
 */
router.get("/:id/content", (req, res) => {
  const { id } = req.params;

  const result = LogService.getJsonlContent(id);

  if (result.success) {
    res.json(result);
  } else {
    res.status(404).json(result);
  }
});

/**
 * GET /api/logs/:id/stats
 * 取得日誌統計資訊
 *
 * Response:
 * {
 *   "success": true,
 *   "experimentId": "EXP20260109ABCD",
 *   "stats": {
 *     "totalLogs": 100,
 *     "types": { "action": 50, "state": 50 },
 *     "timeRange": { "first": 1736409600000, "last": 1736409720000 }
 *   }
 * }
 */
router.get("/:id/stats", (req, res) => {
  const { id } = req.params;

  const result = LogService.getLogStats(id);

  if (result.success) {
    res.json(result);
  } else {
    res.status(404).json(result);
  }
});

/**
 * DELETE /api/logs/:id
 * 刪除日誌檔案
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "日誌已刪除",
 *   "experimentId": "EXP20260109ABCD"
 * }
 */
router.delete("/:id", (req, res) => {
  const { id } = req.params;

  const result = LogService.deleteLog(id);

  if (result.success) {
    res.json(result);
  } else {
    res.status(404).json(result);
  }
});

/**
 * POST /api/logs/batch/delete
 * 批次刪除日誌
 *
 * Request Body:
 * {
 *   "experimentIds": ["EXP20260109ABCD", "EXP20260108WXYZ"]
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "deleted": ["EXP20260109ABCD"],
 *   "deletedCount": 1,
 *   "failed": [{ "experimentId": "EXP20260108WXYZ", "reason": "..." }],
 *   "failedCount": 1,
 *   "message": "已刪除 1 個日誌，1 個失敗"
 * }
 */
router.post("/batch/delete", (req, res) => {
  const { experimentIds } = req.body;

  const result = LogService.deleteBatchLogs(experimentIds);

  res.json(result);
});

export default router;
