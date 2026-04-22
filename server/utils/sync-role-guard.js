import { ROLE } from "../config/constants.js";
const CLIENT_TYPE = { PANEL: "panel", BOARD: "board" };

export function normalizeClientType(clientType) {
  if (!clientType || typeof clientType !== "string") return null;
  const normalized = clientType.trim().toLowerCase();
  return Object.values(CLIENT_TYPE).includes(normalized) ? normalized : null;
}

export function findOperatorConflict(
  sessionManager,
  sessionId,
  clientType,
  currentClientId = null,
) {
  if (!sessionManager || !sessionId || !clientType) return null;

  const clients = sessionManager.getClients(sessionId) || [];
  return (
    clients.find(
      (client) =>
        client.role === ROLE.OPERATOR &&
        client.clientId !== currentClientId &&
        client.clientType === clientType,
    ) || null
  );
}
