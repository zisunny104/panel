/**
 * experiment.js
 * 實驗 API 路由
 *
 * 對應舊 PHP: experiment-hub.php, experiment-id-hub.php
 */

import express from "express";
import { ExperimentService } from "../services/ExperimentService.js";

const router = express.Router();

/**
 * POST /api/experiment/id
 * 建立實驗 ID（需驗證 createCode）
 *
 * Request Body:
 * {
 *   "createCode": "113151006",
 *   "sessionId": "ABC123" (可選),
 *   "clientId": "CLIENT_xxx",
 *   "data": { "participantName": "測試", ... } (可選)
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "experimentId": "EXP20260109ABCD",
 *   "id": "EXP_1736409600000_abc123",
 *   "createdAt": 1736409600,
 *   "message": "實驗 ID 建立成功"
 * }
 */
router.post("/id", (req, res) => {
  const { createCode, sessionId, clientId, data } = req.body;

  // 驗證必要欄位
  if (!createCode) {
    return res.status(400).json({
      success: false,
      message: "缺少建立代碼 (createCode)",
    });
  }

  if (!clientId) {
    return res.status(400).json({
      success: false,
      message: "缺少客戶端 ID (clientId)",
    });
  }

  // 建立實驗 ID
  const result = ExperimentService.createExperimentId(
    createCode,
    sessionId,
    clientId,
    data,
  );

  if (result.success) {
    res.status(201).json(result);
  } else {
    res.status(400).json(result);
  }
});

/**
 * GET /api/experiment/id
 * 查詢實驗 ID
 *
 * Query Parameters:
 * - experimentId: 實驗 ID
 * - sessionId: 工作階段 ID（查詢該 session 的所有實驗）
 *
 * Response (單一實驗):
 * {
 *   "success": true,
 *   "experiment": {
 *     "id": "EXP_1736409600000_abc123",
 *     "experimentId": "EXP20260109ABCD",
 *     "sessionId": "ABC123",
 *     "createdAt": 1736409600,
 *     "data": { ... }
 *   }
 * }
 *
 * Response (多個實驗):
 * {
 *   "success": true,
 *   "experiments": [ ... ],
 *   "count": 3
 * }
 */
router.get("/id", (req, res) => {
  const { experimentId, sessionId } = req.query;

  // 情況 1: 查詢特定實驗
  if (experimentId) {
    const experiment = ExperimentService.getExperimentById(experimentId);

    if (experiment) {
      return res.json({
        success: true,
        experiment,
      });
    } else {
      return res.status(404).json({
        success: false,
        message: "實驗 ID 不存在",
      });
    }
  }

  // 情況 2: 查詢工作階段的所有實驗
  if (sessionId) {
    const experiments = ExperimentService.getExperimentsBySession(sessionId);

    return res.json({
      success: true,
      experiments,
      count: experiments.length,
    });
  }

  // 缺少查詢參數
  return res.status(400).json({
    success: false,
    message: "缺少查詢參數 (experimentId 或 sessionId)",
  });
});

/**
 * DELETE /api/experiment/id
 * 刪除實驗 ID
 *
 * Query Parameters:
 * - experimentId: 要刪除的實驗 ID
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "實驗 ID 已刪除"
 * }
 */
router.delete("/id", (req, res) => {
  const { experimentId } = req.query;

  if (!experimentId) {
    return res.status(400).json({
      success: false,
      message: "缺少實驗 ID (experimentId)",
    });
  }

  const result = ExperimentService.deleteExperimentId(experimentId);

  if (result.success) {
    res.json(result);
  } else {
    res.status(404).json(result);
  }
});

/**
 * PUT /api/experiment/id
 * 更新實驗資料
 *
 * Request Body:
 * {
 *   "experimentId": "EXP20260109ABCD",
 *   "data": { "participantName": "新名稱", ... }
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "實驗資料已更新",
 *   "data": { ... }
 * }
 */
router.put("/id", (req, res) => {
  const { experimentId, data } = req.body;

  if (!experimentId) {
    return res.status(400).json({
      success: false,
      message: "缺少實驗 ID (experimentId)",
    });
  }

  if (!data) {
    return res.status(400).json({
      success: false,
      message: "缺少更新資料 (data)",
    });
  }

  const result = ExperimentService.updateExperimentData(experimentId, data);

  if (result.success) {
    res.json(result);
  } else {
    res.status(404).json(result);
  }
});

/**
 * GET /api/experiment/list
 * 列出所有實驗（支援分頁）
 *
 * Query Parameters:
 * - page: 頁碼（預設 1）
 * - pageSize: 每頁數量（預設 20）
 *
 * Response:
 * {
 *   "success": true,
 *   "experiments": [ ... ],
 *   "total": 50,
 *   "page": 1,
 *   "pageSize": 20,
 *   "totalPages": 3
 * }
 */
router.get("/list", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 20;

  const result = ExperimentService.listExperiments(page, pageSize);

  res.json({
    success: true,
    ...result,
  });
});

/**
 * POST /api/experiment/validate
 * 驗證實驗 ID 是否存在
 *
 * Request Body:
 * {
 *   "experimentId": "EXP20260109ABCD"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "valid": true,
 *   "experimentId": "EXP20260109ABCD"
 * }
 */
router.post("/validate", (req, res) => {
  const { experimentId } = req.body;

  if (!experimentId) {
    return res.status(400).json({
      success: false,
      message: "缺少實驗 ID (experimentId)",
    });
  }

  const valid = ExperimentService.validateExperimentId(experimentId);

  res.json({
    success: true,
    valid,
    experimentId,
  });
});

export default router;
