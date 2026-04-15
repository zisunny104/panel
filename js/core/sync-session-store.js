/**
 * SyncSessionStore
 *
 * Very small adapter for sync session persistence.
 * Keep all storage details out of sync modules.
 */

function safeGet(storage, key) {
  try {
    return storage?.getItem?.(key) || null;
  } catch {
    return null;
  }
}

function safeSet(storage, key, value) {
  try {
    storage?.setItem?.(key, value);
  } catch {
    // noop: persistence is best-effort
  }
}

function safeRemove(storage, key) {
  try {
    storage?.removeItem?.(key);
  } catch {
    // noop: persistence is best-effort
  }
}

function createSyncSessionStore({
  session = window.sessionStorage,
  local = window.localStorage,
} = {}) {
  return {
    load() {
      const sessionId =
        safeGet(session, "sync_sessionId") ||
        safeGet(session, "sync_session_id") ||
        safeGet(local, "sync_session_id");

      const clientId =
        safeGet(session, "sync_clientId") ||
        safeGet(session, "sync_client_id") ||
        safeGet(local, "sync_client_id");

      const role =
        safeGet(session, "sync_role") || safeGet(local, "sync_preferred_role");

      return {
        sessionId: sessionId || null,
        clientId: clientId || null,
        role: role || null,
      };
    },

    save({ sessionId, clientId, role } = {}) {
      safeSet(session, "sync_sessionId", sessionId || "");
      safeSet(session, "sync_clientId", clientId || "");
      safeSet(session, "sync_role", role || "local");
    },

    clear() {
      safeRemove(session, "sync_sessionId");
      safeRemove(session, "sync_clientId");
      safeRemove(session, "sync_role");

      // legacy keys cleanup
      safeRemove(session, "sync_session_id");
      safeRemove(session, "sync_client_id");
      safeRemove(local, "sync_session_id");
      safeRemove(local, "sync_client_id");
      safeRemove(local, "sync_preferred_role");
      safeRemove(local, "sync_session_backup");
    },
  };
}

export { createSyncSessionStore };
