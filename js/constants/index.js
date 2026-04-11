/**
 * Constants 統一入口
 * 集中管理所有常數，簡化 import 路徑
 */

import {
  LOG_TYPES,
  LOG_TYPE_LABELS,
  GESTURE_ATTEMPT_TYPES,
  GESTURE_ATTEMPT_TYPE_LABELS,
} from "./log-types-constants.js";

import {
  SYNC_EVENTS,
  SYNC_DATA_TYPES,
  getEventName,
  isSyncEvent,
  getAllSyncEvents,
} from "./sync-events-constants.js";

import { LOG_SOURCES } from "./log-source-constants.js";

import { ACTION_IDS, ACTION_BUTTONS, ACTION_CONSTANTS } from "./action-constants.js";
import { POWER_BUTTON_STATES } from "./power-constants.js";

export {
  LOG_TYPES,
  LOG_TYPE_LABELS,
  GESTURE_ATTEMPT_TYPES,
  GESTURE_ATTEMPT_TYPE_LABELS,
  SYNC_EVENTS,
  SYNC_DATA_TYPES,
  getEventName,
  isSyncEvent,
  getAllSyncEvents,
  LOG_SOURCES,
  ACTION_IDS,
  ACTION_BUTTONS,
  ACTION_CONSTANTS,
  POWER_BUTTON_STATES,
};
