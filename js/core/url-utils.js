/**
 * URL Utilities
 *
 * 提供共用的 API URL / API base path 計算邏輯，避免在多個模組中重複實作。
 */
export function getApiBasePath() {
  const pathname = window.location.pathname;
  let basePath = pathname;
  if (!basePath.endsWith("/")) {
    basePath = basePath.substring(0, basePath.lastIndexOf("/") + 1);
  }
  return `${basePath}api`;
}

export function getApiUrl() {
  return `${window.location.origin}${getApiBasePath()}`;
}
