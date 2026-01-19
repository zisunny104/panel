/**
 * 同步路由 - 處理工作階段和分享代碼相關的HTTP請求
 */
import express from "express";
import SessionService from "../services/SessionService.js";
import ShareCodeService from "../services/ShareCodeService.js";
import { generateClientId } from "../utils/idGenerator.js";
import { HTTP_STATUS, ERROR_CODES } from "../config/constants.js";
import { query, execute } from "../database/connection.js";

const router = express.Router();

/**
 * POST /api/sync/session
 * 建立新的工作階段（建立者直接加入，不自動產生分享代碼）
 *
 * Request body: { createCode } (建立代碼，用於驗證 - 可選)
 * Response: { sessionId, clientId, role, created_at }
 */
router.post("/session", (req, res) => {
  const { createCode } = req.body;

  try {
    // 產生新的clientId（建立者的分頁ID）
    const clientId = generateClientId();

    // 建立工作階段（建立者自動成為 operator）
    const session = SessionService.createSession(clientId);

    // 回傳工作階段資訊（不包含分享代碼，需要時再呼叫 generate_share_code）
    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      data: {
        sessionId: session.sessionId,
        clientId: session.clientId,
        role: "operator", // 建立者預設為操作者
        created_at: session.created_at,
      },
    });
  } catch (error) {
    console.error("建立工作階段失敗:", error.message);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({
      success: false,
      error: ERROR_CODES.DATABASE_ERROR,
      message: "建立工作階段失敗",
    });
  }
});

/**
 * POST /api/sync/create_session
 * 建立新的工作階段（僅建立，不產生分享代碼）
 *
 * Request body: {} (可選的clientId，若無則自動產生)
 * Response: { sessionId, clientId, created_at }
 */
router.post("/create_session", (req, res) => {
  try {
    // 產生新的clientId（分頁級，每次重新整理產生）
    const clientId = generateClientId();

    const session = SessionService.createSession(clientId);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      data: session,
    });
  } catch (error) {
    console.error("建立工作階段失敗:", error.message);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({
      success: false,
      error: ERROR_CODES.DATABASE_ERROR,
      message: "建立工作階段失敗",
    });
  }
});

/**
 * POST /api/sync/generate_share_code
 * 產生分享代碼
 *
 * Request body: { sessionId, clientId }
 * Response: { share_code, session_id, expires_at }
 */
router.post("/generate_share_code", (req, res) => {
  const { sessionId, clientId } = req.body;

  if (!sessionId || !clientId) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: ERROR_CODES.INVALID_SESSION_ID,
      message: "缺少sessionId或clientId",
    });
  }

  try {
    // 驗證工作階段存在
    const session = SessionService.getSession(sessionId);
    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: ERROR_CODES.SESSION_NOT_FOUND,
        message: "工作階段不存在或已過期",
      });
    }

    // 產生分享代碼
    const codeData = ShareCodeService.generateCode(sessionId, clientId);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      data: codeData,
    });
  } catch (error) {
    console.error("產生分享代碼失敗:", error.message);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({
      success: false,
      error: ERROR_CODES.DATABASE_ERROR,
      message: "產生分享代碼失敗",
    });
  }
});

/**
 * POST /api/sync/join
 * 使用分享代碼加入工作階段
 *
 * Request body: { shareCode, role, clientId }
 * Response: { sessionId, clientId, role }
 */
router.post("/join", (req, res) => {
  const { shareCode, role, clientId } = req.body;

  if (!shareCode) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: ERROR_CODES.INVALID_SHARE_CODE,
      message: "缺少分享代碼",
    });
  }

  try {
    // 驗證分享代碼
    const validation = ShareCodeService.validateCode(shareCode);

    if (validation.error) {
      const statusMap = {
        [ERROR_CODES.INVALID_SHARE_CODE]: HTTP_STATUS.BAD_REQUEST,
        [ERROR_CODES.SHARE_CODE_NOT_FOUND]: HTTP_STATUS.NOT_FOUND,
        [ERROR_CODES.SHARE_CODE_EXPIRED]: HTTP_STATUS.NOT_FOUND,
      };

      return res
        .status(statusMap[validation.error] || HTTP_STATUS.BAD_REQUEST)
        .json({
          success: false,
          error: validation.error,
          message: "分享代碼無效、已過期或已使用",
        });
    }

    // 使用提供的clientId或產生新的
    const finalClientId = clientId || generateClientId();

    // 標記分享代碼為已使用
    ShareCodeService.markAsUsed(shareCode, finalClientId);

    // 更新工作階段最後活動時間
    SessionService.updateLastActive(validation.session_id);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        sessionId: validation.session_id,
        clientId: finalClientId,
        role: role || "viewer",
      },
    });
  } catch (error) {
    console.error("加入工作階段失敗:", error.message);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({
      success: false,
      error: ERROR_CODES.DATABASE_ERROR,
      message: "加入工作階段失敗",
    });
  }
});

/**
 * POST /api/sync/session/:sessionId/share-code
 * 為指定的工作階段產生分享代碼（RESTful 風格）
 *
 * Request body: { clientId }
 * Response: { shareCode, sessionId, expiresAt }
 */
router.post("/session/:sessionId/share-code", (req, res) => {
  const { sessionId } = req.params;
  const { clientId } = req.body;

  if (!clientId) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: ERROR_CODES.INVALID_REQUEST,
      message: "缺少clientId",
    });
  }

  try {
    // 驗證工作階段存在
    const session = SessionService.getSession(sessionId);
    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: ERROR_CODES.SESSION_NOT_FOUND,
        message: "工作階段不存在或已過期",
      });
    }

    // 產生分享代碼
    const codeData = ShareCodeService.generateCode(sessionId, clientId);

    // 回傳格式統一為 camelCase（前端預期格式）
    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      data: {
        shareCode: codeData.share_code,
        sessionId: codeData.session_id,
        expiresAt: codeData.expires_at,
      },
    });
  } catch (error) {
    console.error("產生分享代碼失敗:", error.message);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({
      success: false,
      error: ERROR_CODES.DATABASE_ERROR,
      message: "產生分享代碼失敗",
    });
  }
});

/**
 * GET /api/sync/session/:sessionId/validate
 * 驗證工作階段是否有效（用於重新整理後恢復連線）
 *
 * Query params: clientId
 * Response: { valid: boolean }
 */
router.get("/session/:sessionId/validate", (req, res) => {
  const { sessionId } = req.params;
  const { clientId } = req.query;

  if (!clientId) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: ERROR_CODES.INVALID_REQUEST,
      message: "缺少clientId",
    });
  }

  try {
    const session = SessionService.getSession(sessionId);

    if (!session) {
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: { valid: false },
      });
    }

    // 工作階段存在且有效
    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: { valid: true },
    });
  } catch (error) {
    console.error("驗證工作階段失敗:", error.message);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({
      success: false,
      error: ERROR_CODES.DATABASE_ERROR,
      message: "驗證工作階段失敗",
    });
  }
});

/**
 * GET /api/sync/session/:sessionId/clients
 * 取得工作階段中的所有客戶端（即時連線狀態）
 *
 * Response: { clients: [{clientId, role, joinedAt}, ...], clientCount: number }
 */
router.get("/session/:sessionId/clients", (req, res) => {
  const { sessionId } = req.params;

  try {
    // 先檢查工作階段是否存在於資料庫
    const session = SessionService.getSession(sessionId);
    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: ERROR_CODES.SESSION_NOT_FOUND,
        message: "工作階段不存在或已過期",
      });
    }

    // 從 RoomManager 取得即時連線的客戶端
    const roomManager = req.app.locals.roomManager;
    if (!roomManager) {
      // 如果 RoomManager 不可用，回傳空列表
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: {
          clients: [],
          clientCount: 0,
        },
      });
    }

    const members = roomManager.getMembers(sessionId);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        clients: members,
        clientCount: members.length,
      },
    });
  } catch (error) {
    console.error("取得客戶端列表失敗:", error.message);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({
      success: false,
      error: ERROR_CODES.DATABASE_ERROR,
      message: "取得客戶端列表失敗",
    });
  }
});

/**
 * GET /api/sync/session/:sessionId
 * 取得工作階段資訊
 */
router.get("/session/:sessionId", (req, res) => {
  const { sessionId } = req.params;

  try {
    const session = SessionService.getSession(sessionId);

    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: ERROR_CODES.SESSION_NOT_FOUND,
        message: "工作階段不存在或已過期",
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: session,
    });
  } catch (error) {
    console.error("查詢工作階段失敗:", error.message);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({
      success: false,
      error: ERROR_CODES.DATABASE_ERROR,
      message: "查詢工作階段失敗",
    });
  }
});

/**
 * GET /api/sync/sessions
 * 取得所有活動中的工作階段列表
 *
 * Response: { sessions: [...] }
 */
router.get("/sessions", (req, res) => {
  try {
    const sessions = SessionService.getActiveSessions();

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: sessions,
    });
  } catch (error) {
    console.error("查詢工作階段列表失敗:", error.message);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({
      success: false,
      error: ERROR_CODES.DATABASE_ERROR,
      message: "查詢工作階段列表失敗",
    });
  }
});

/**
 * DELETE /api/sync/session/:sessionId
 * 刪除指定的工作階段
 *
 * Response: { success: true }
 */
router.delete("/session/:sessionId", (req, res) => {
  const { sessionId } = req.params;

  try {
    // 刪除工作階段（SessionService 會連帶刪除相關的分享代碼）
    const deleted = execute(`DELETE FROM sessions WHERE session_id = ?`, [
      sessionId,
    ]);

    if (deleted.changes === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: ERROR_CODES.SESSION_NOT_FOUND,
        message: "工作階段不存在",
      });
    }

    // 同時刪除相關的分享代碼
    execute(`DELETE FROM share_codes WHERE session_id = ?`, [sessionId]);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: "工作階段已刪除",
    });
  } catch (error) {
    console.error("刪除工作階段失敗:", error.message);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({
      success: false,
      error: ERROR_CODES.DATABASE_ERROR,
      message: "刪除工作階段失敗",
    });
  }
});

/**
 * POST /api/sync/sessions/clear
 * 清除所有工作階段
 *
 * Response: { success: true, deletedCount: number }
 */
router.post("/sessions/clear", (req, res) => {
  try {
    // 取得所有工作階段
    const sessions = query(`SELECT session_id FROM sessions`);
    const sessionIds = sessions.map((s) => s.session_id);

    if (sessionIds.length === 0) {
      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: { deletedCount: 0 },
      });
    }

    // 刪除所有分享代碼
    execute(`DELETE FROM share_codes`);

    // 刪除所有工作階段
    const result = execute(`DELETE FROM sessions`);

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: { deletedCount: result.changes },
    });
  } catch (error) {
    console.error("清除所有工作階段失敗:", error.message);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({
      success: false,
      error: ERROR_CODES.DATABASE_ERROR,
      message: "清除所有工作階段失敗",
    });
  }
});

/**
 * POST /api/sync/heartbeat
 * 更新工作階段活動時間（保活）
 *
 * Request body: { sessionId }
 */
router.post("/heartbeat", (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: ERROR_CODES.INVALID_SESSION_ID,
      message: "缺少sessionId",
    });
  }

  try {
    const updated = SessionService.updateLastActive(sessionId);

    if (!updated) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: ERROR_CODES.SESSION_NOT_FOUND,
        message: "工作階段不存在",
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: "工作階段已更新",
    });
  } catch (error) {
    console.error("更新工作階段失敗:", error.message);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({
      success: false,
      error: ERROR_CODES.DATABASE_ERROR,
      message: "更新工作階段失敗",
    });
  }
});

/**
 * GET /api/sync/share-code/:code
 * 取得分享代碼資訊（用於檢查狀態，不會標記為已使用）
 *
 * Response: { sessionId, expired, used, expiresAt, createdAt }
 */
router.get("/share-code/:code", (req, res) => {
  const { code } = req.params;

  try {
    const codeInfo = ShareCodeService.getCodeInfo(code);

    if (codeInfo.error) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: codeInfo.error,
        message: "分享代碼無效",
      });
    }

    // 回傳格式統一為 camelCase
    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        sessionId: codeInfo.session_id,
        expired: codeInfo.expired,
        used: codeInfo.used,
        expiresAt: codeInfo.expires_at,
        createdAt: codeInfo.created_at,
      },
    });
  } catch (error) {
    console.error("取得分享代碼資訊失敗:", error.message);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({
      success: false,
      error: ERROR_CODES.DATABASE_ERROR,
      message: "取得分享代碼資訊失敗",
    });
  }
});

export default router;
