/**
 * 日誌類型常數管理
 * 統一定義所有日誌類型，避免硬寫字符串散落各地
 */

export const LOG_TYPES = {
  // 實驗級事件
  EXP_START: "exp_start",
  EXP_END: "exp_end",
  EXP_PAUSE: "exp_pause",
  EXP_RESUME: "exp_resume",

  // 手勢步驟事件
  GESTURE_STEP_START: "gesture_step_start",
  GESTURE_STEP_END: "gesture_step_end",
  GESTURE_STEP_PAUSE: "gesture_step_pause",
  GESTURE_ATTEMPT: "gesture_attempt",

  // 其他事件
  ACTION: "action",
};

/**
 * 日誌類型的中文標籤
 */
export const LOG_TYPE_LABELS = {
  [LOG_TYPES.EXP_START]: "實驗開始",
  [LOG_TYPES.EXP_END]: "實驗結束",
  [LOG_TYPES.EXP_PAUSE]: "實驗暫停",
  [LOG_TYPES.EXP_RESUME]: "實驗繼續",
  [LOG_TYPES.GESTURE_STEP_START]: "步驟開始",
  [LOG_TYPES.GESTURE_STEP_END]: "步驟結束",
  [LOG_TYPES.GESTURE_STEP_PAUSE]: "步驟暫停",
  [LOG_TYPES.GESTURE_ATTEMPT]: "手勢嘗試",
  [LOG_TYPES.ACTION]: "動作",
};

/**
 * 手勢嘗試類型 (g_type)
 */
export const GESTURE_ATTEMPT_TYPES = {
  TRUE: "t", // 成功/正確
  FALSE: "f", // 失敗/錯誤
  UNKNOWN: "n", // 未判斷
};

export const GESTURE_ATTEMPT_TYPE_LABELS = {
  [GESTURE_ATTEMPT_TYPES.TRUE]: "成功",
  [GESTURE_ATTEMPT_TYPES.FALSE]: "失敗",
  [GESTURE_ATTEMPT_TYPES.UNKNOWN]: "未判斷",
};
