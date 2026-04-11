/**
 * BoardSyncDispatcher - 遠端同步事件轉發
 *
 * 將 remote_state 依 type 轉成對應的本機事件。
 */

import { LOG_SOURCES, SYNC_EVENTS, SYNC_DATA_TYPES } from "../constants/index.js";

export function dispatchRemoteSync(detail) {
  if (!detail) return;

  if (detail.type === SYNC_DATA_TYPES.EXPERIMENT_STARTED) {
    window.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.REMOTE_EXPERIMENT_STARTED, {
        detail,
      }),
    );
    return;
  }

  if (detail.type === SYNC_DATA_TYPES.EXPERIMENT_PAUSED) {
    window.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.REMOTE_EXPERIMENT_PAUSED, {
        detail,
      }),
    );
    return;
  }

  if (detail.type === SYNC_DATA_TYPES.EXPERIMENT_RESUMED) {
    window.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.REMOTE_EXPERIMENT_RESUMED, {
        detail,
      }),
    );
    return;
  }

  if (detail.type === SYNC_DATA_TYPES.EXPERIMENT_STOPPED) {
    window.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.REMOTE_EXPERIMENT_STOPPED, {
        detail,
      }),
    );
    return;
  }

  if (detail.type === SYNC_DATA_TYPES.EXPERIMENT_ACTION) {
    window.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.REMOTE_EXPERIMENT_ACTION, {
        detail,
      }),
    );
    return;
  }

  if (detail.type === SYNC_DATA_TYPES.COMBINATION_SELECTED) {
    window.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.COMBINATION_SELECTED, {
        detail: {
          ...detail,
          source: LOG_SOURCES.REMOTE_SYNC,
        },
      }),
    );
    return;
  }

  if (detail.type === SYNC_DATA_TYPES.GESTURE_MARKED) {
    window.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.GESTURE_MARKED, {
        detail,
      }),
    );
    return;
  }

  window.dispatchEvent(
    new CustomEvent(SYNC_EVENTS.REMOTE_SYNC_EVENT, { detail }),
  );
}
