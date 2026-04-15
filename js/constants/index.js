/**
 * Constants 統一入口
 * 集中管理所有常數，簡化 import 路徑
 */

import {
  RECORD_TYPES,
  RECORD_TYPE_LABELS,
  GESTURE_ATTEMPT_TYPES,
  GESTURE_ATTEMPT_TYPE_LABELS,
} from "./record-types-constants.js";

import {
  SYNC_EVENTS,
  SYNC_DATA_TYPES,
  getEventName,
  isSyncEvent,
  getAllSyncEvents,
} from "./sync-events-constants.js";

import { RECORD_SOURCES } from "./record-source-constants.js";

import { ACTION_IDS, ACTION_BUTTONS, ACTION_CONSTANTS } from "./action-constants.js";
import { POWER_BUTTON_STATES } from "./power-constants.js";

export {
  RECORD_TYPES,
  RECORD_TYPE_LABELS,
  GESTURE_ATTEMPT_TYPES,
  GESTURE_ATTEMPT_TYPE_LABELS,
  SYNC_EVENTS,
  SYNC_DATA_TYPES,
  getEventName,
  isSyncEvent,
  getAllSyncEvents,
  RECORD_SOURCES,
  ACTION_IDS,
  ACTION_BUTTONS,
  ACTION_CONSTANTS,
  POWER_BUTTON_STATES,
};

