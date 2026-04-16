const resolveFromPage = (path) => new URL(path, window.location.href).href;

const fetchAppVersion = async () => {
  try {
    const response = await fetch(resolveFromPage("data/config.json"), {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const config = await response.json();
    return config?.version || null;
  } catch (error) {
    return null;
  }
};

const applyVersionedAssets = (version) => {
  const withVersion = (url) => {
    const absolute = new URL(url, window.location.href);
    absolute.searchParams.set("v", version);
    return absolute.href;
  };

  document.querySelectorAll("[data-versioned]").forEach((el) => {
    const attr = el.tagName === "LINK" ? "href" : "src";
    const base = el.getAttribute(attr);
    if (!base) return;
    el.setAttribute(attr, withVersion(base));
  });
};

const STORAGE_SCHEMA_VERSION = "2026-04-16-record-cleanup-v1";

const cleanupLegacyBrowserState = async () => {
  const schemaKey = "panel_storage_schema_version";
  const currentSchemaVersion = window.localStorage?.getItem(schemaKey);
  if (currentSchemaVersion === STORAGE_SCHEMA_VERSION) return;

  await new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase("ExperimentLogsDB");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });

  [
    "loggerMinimized",
    "sync_session_backup",
    "sync_session_id",
    "sync_client_id",
    "sync_preferred_role",
    "preferredCameraId",
    "preferredCameraLabel",
  ].forEach((key) => window.localStorage?.removeItem(key));

  window.localStorage?.setItem(schemaKey, STORAGE_SCHEMA_VERSION);
};

export const bootstrapPage = async ({ entryModules = [] } = {}) => {
  await cleanupLegacyBrowserState();

  const version = (await fetchAppVersion()) || String(Date.now());
  window.__APP_VERSION = version;

  applyVersionedAssets(version);

  if (!Array.isArray(entryModules) || entryModules.length === 0) {
    return;
  }

  // 保留第一個模組的順序（通常是 Logger），其餘模組改為平行載入以縮短啟動時間。
  const [firstModule, ...remainingModules] = entryModules;
  await import(resolveFromPage(firstModule));

  if (remainingModules.length > 0) {
    await Promise.all(
      remainingModules.map((modulePath) => import(resolveFromPage(modulePath))),
    );
  }
};

export default bootstrapPage;
