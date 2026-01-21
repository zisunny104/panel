/**
 * 心跳檢測路由
 */
import express from "express";
import { getDatabase } from "../database/connection.js";
import { HTTP_STATUS } from "../config/constants.js";

const router = express.Router();

/**
 * GET /api/health
 * 心跳檢測端點 - 驗證伺服器和資料庫狀態
 */
router.get("/", (req, res) => {
  try {
    // 測試資料庫連線
    const db = getDatabase();
    const result = db.prepare("SELECT 1 as test").get();

    if (!result || result.test !== 1) {
      throw new Error("資料庫查詢失敗");
    }

    res.status(HTTP_STATUS.OK).json({
      status: "ok",
      timestamp: Math.floor(Date.now() / 1000),
      database: "connected",
      message: "伺服器執行正常",
    });
  } catch (error) {
    console.error("心跳檢測失敗:", error.message);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({
      status: "error",
      message: "伺服器或資料庫異常",
      error: error.message,
    });
  }
});

export default router;
