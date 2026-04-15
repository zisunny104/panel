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
    const joiner = url.includes("?") ? "&" : "?";
    return `${url}${joiner}v=${encodeURIComponent(version)}`;
  };

  document.querySelectorAll("[data-versioned]").forEach((el) => {
    const attr = el.tagName === "LINK" ? "href" : "src";
    const base = el.getAttribute(attr);
    if (!base) return;
    el.setAttribute(attr, withVersion(base));
  });
};

export const bootstrapPage = async ({ entryModules = [] } = {}) => {
  const version = (await fetchAppVersion()) || String(Date.now());
  window.__APP_VERSION = version;

  applyVersionedAssets(version);

  for (const modulePath of entryModules) {
    await import(resolveFromPage(modulePath));
  }
};

export default bootstrapPage;
