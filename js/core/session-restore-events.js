import { SYNC_EVENTS, SYNC_DATA_TYPES } from "../constants/index.js";

function pickRestoredExperimentId(snapshot) {
  const experimentState = snapshot?.experimentState;
  const topState = snapshot?.state;

  const candidate =
    experimentState?.experimentId ||
    experimentState?.registeredExperimentId ||
    topState?.experimentId ||
    topState?.registeredExperimentId ||
    null;

  if (typeof candidate !== "string") return null;
  const normalized = candidate.trim();
  return normalized || null;
}

function pickRestoredParticipantName(snapshot) {
  const experimentState = snapshot?.experimentState;
  const topState = snapshot?.state;

  const candidate =
    experimentState?.participantName ||
    topState?.participantName ||
    null;

  if (typeof candidate !== "string") return null;
  const normalized = candidate.trim();
  return normalized || null;
}

/**
 * Translate a session snapshot into restore-friendly state update events.
 * This keeps transport modules clean and lets consumers decide what to restore.
 */
function dispatchSessionRestoreEvents(detail, { includePowerState = false } = {}) {
  const snapshot = detail || {};

  const experimentState = snapshot.experimentState;
  let restoredType = null;
  if (experimentState && typeof experimentState === "object" && experimentState.type) {
    restoredType = experimentState.type;
    window.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.STATE_UPDATE, {
        detail: {
          ...experimentState,
          _sessionRestore: true,
        },
      }),
    );
  }

  const restoredExperimentId = pickRestoredExperimentId(snapshot);
  if (
    restoredExperimentId &&
    restoredType !== SYNC_DATA_TYPES.EXPERIMENT_ID_UPDATE
  ) {
    window.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.STATE_UPDATE, {
        detail: {
          type: SYNC_DATA_TYPES.EXPERIMENT_ID_UPDATE,
          experimentId: restoredExperimentId,
          clientId: experimentState?.clientId || snapshot?.state?.clientId,
          timestamp: Date.now(),
          source: "session_restore",
          _sessionRestore: true,
        },
      }),
    );
  }

  const restoredParticipantName = pickRestoredParticipantName(snapshot);
  if (
    restoredParticipantName &&
    restoredType !== SYNC_DATA_TYPES.PARTICIPANT_NAME_UPDATE
  ) {
    window.dispatchEvent(
      new CustomEvent(SYNC_EVENTS.STATE_UPDATE, {
        detail: {
          type: SYNC_DATA_TYPES.PARTICIPANT_NAME_UPDATE,
          participantName: restoredParticipantName,
          clientId: experimentState?.clientId || snapshot?.state?.clientId,
          timestamp: Date.now(),
          source: "session_restore",
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
