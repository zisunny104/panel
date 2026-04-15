import { SYNC_EVENTS, SYNC_DATA_TYPES } from "../constants/index.js";

/**
 * Translate a session snapshot into restore-friendly state update events.
 * This keeps transport modules clean and lets consumers decide what to restore.
 */
function dispatchSessionRestoreEvents(detail, { includePowerState = false } = {}) {
  const snapshot = detail || {};

  const experimentState = snapshot.experimentState;
  if (experimentState && typeof experimentState === "object" && experimentState.type) {
    window.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.STATE_UPDATE, {
        detail: {
          ...experimentState,
          _sessionRestore: true,
        },
      }),
    );
  }

  if (!includePowerState) {
    return;
  }

  const powerSnapshot = snapshot.state;
  if (
    powerSnapshot &&
    typeof powerSnapshot === "object" &&
    typeof powerSnapshot.powerState === "boolean"
  ) {
    window.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.STATE_UPDATE, {
        detail: {
          type: SYNC_DATA_TYPES.POWER_STATE_UPDATE,
          clientId: powerSnapshot.clientId,
          timestamp: Date.now(),
          powerState: powerSnapshot.powerState,
          isPowerVideoPlaying:
            typeof powerSnapshot.isPowerVideoPlaying === "boolean"
              ? powerSnapshot.isPowerVideoPlaying
              : false,
          _sessionRestore: true,
        },
      }),
    );
  }
}

export { dispatchSessionRestoreEvents };
