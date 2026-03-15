/**
 * Global Services Manager - Abstraction layer for global object access
 *
 * Reduces repeated defensive checks like:
 * - if (window.logger?.logAction)
 * - if (window.configManager?.updateUserSetting)
 * - if (window.panelPageManager?.setExperimentPanelButtonColor)
 *
 * Usage: GlobalServices.logger.logAction("Event") instead of checking window.logger existence
 */
class GlobalServices {
  static #services = {};

  /**
   * Register a global service
   * @param {string} name - Service name (e.g., 'logger', 'configManager')
   * @param {Object} service - The actual service instance from window
   */
  static registerService(name, service) {
    this.#services[name] = service;
  }

  /**
   * Get a service with null-safe proxy
   * @param {string} name
   * @returns {Object} Proxy that safely calls methods
   */
  static getService(name) {
    return (
      this.#services[name] ||
      new Proxy(
        {},
        {
          get: () => () => {
            console.warn(`Service "${name}" not initialized`);
            return null;
          },
        },
      )
    );
  }

  /**
   * Initialize all standard services from window
   * Call this when all global objects are ready
   */
  static initializeFromWindow() {
    if (typeof window === "undefined") return;

    // Register standard services that exist
    if (window.logger) this.registerService("logger", window.logger);
    if (window.configManager)
      this.registerService("configManager", window.configManager);
    if (window.panelPageManager)
      this.registerService("panelPageManager", window.panelPageManager);
    if (window.mediaManager)
      this.registerService("mediaManager", window.mediaManager);
    if (window.buttonManager)
      this.registerService("buttonManager", window.buttonManager);
    if (window.experiment)
      this.registerService("experiment", window.experiment);
    if (window.panelManager)
      this.registerService("panelManager", window.panelManager);
  }

  /**
   * Logger service - Safe logging operations
   * Replaces multiple: if (window.logger?.logAction(...))
   */
  static get logger() {
    return {
      logAction: (
        action,
        category,
        value,
        subaction = false,
        isError = false,
      ) => {
        window.logger?.logAction?.(action, category, value, subaction, isError);
      },
      logError: (message, error) => {
        window.logger?.logError?.(message, error);
      },
      logNavigation: (source, target) => {
        window.logger?.logNavigation?.(source, target);
      },
      logInteraction: (element, action) => {
        window.logger?.logInteraction?.(element, action);
      },
    };
  }

  /**
   * Config manager service - Safe configuration updates
   * Replaces multiple: if (window.configManager?.updateUserSetting(...))
   */
  static get configManager() {
    return {
      updateUserSetting: (key, value) => {
        window.configManager?.updateUserSetting?.(key, value);
      },
      getUserSetting: (key, defaultValue) => {
        return window.configManager?.userSettings?.[key] ?? defaultValue;
      },
      getAllSettings: () => {
        return window.configManager?.userSettings ?? {};
      },
      setSetting: (key, value) => {
        window.configManager?.setSetting?.(key, value);
      },
    };
  }

  /**
   * Panel page manager service
   */
  static get panelPageManager() {
    return {
      setExperimentPanelButtonColor: (color) => {
        window.panelPageManager?.setExperimentPanelButtonColor?.(color);
      },
      updateExperimentStatus: (status) => {
        window.panelPageManager?.updateExperimentStatus?.(status);
      },
      getExperimentStatus: () => {
        return window.panelPageManager?.experimentStatus;
      },
    };
  }

  /**
   * Media manager service
   */
  static get mediaManager() {
    return {
      setMediaVolume: (volume) => {
        window.mediaManager?.setMediaVolume?.(volume);
      },
      getMediaFiles: () => {
        return window.mediaManager?.mediaFiles ?? [];
      },
      playMedia: (file) => {
        window.mediaManager?.playMedia?.(file);
      },
      stopMedia: () => {
        window.mediaManager?.stopMedia?.();
      },
    };
  }

  /**
   * Button manager service
   */
  static get buttonManager() {
    return {
      updateExperimentButtonStyles: () => {
        window.buttonManager?.updateExperimentButtonStyles?.();
      },
      updateButtonState: (buttonId, state) => {
        window.buttonManager?.updateButtonState?.(buttonId, state);
      },
    };
  }

  /**
   * Experiment service
   */
  static get experiment() {
    return {
      updateHighlightVisibility: () => {
        window.experiment?.updateHighlightVisibility?.();
      },
      getCurrentState: () => {
        return window.experiment?.currentState;
      },
      getScenario: () => {
        return window.experiment?.scenario;
      },
    };
  }

  /**
   * Panel manager service
   */
  static get panelManager() {
    return {
      openPanel: (panelName) => {
        window.panelManager?.openPanel?.(panelName);
      },
      closePanel: (panelName) => {
        window.panelManager?.closePanel?.(panelName);
      },
      togglePanel: (panelName) => {
        window.panelManager?.togglePanel?.(panelName);
      },
    };
  }

  /**
   * Check if a service is available
   * @param {string} serviceName
   * @returns {boolean}
   */
  static isServiceAvailable(serviceName) {
    return typeof this[serviceName] !== "undefined";
  }

  /**
   * Wait for a service to become available
   * @param {string} serviceName
   * @param {number} timeoutMs - Max time to wait (default 5000ms)
   * @returns {Promise<boolean>}
   */
  static async waitForService(serviceName, timeoutMs = 5000) {
    const startTime = Date.now();
    while (!this.isServiceAvailable(serviceName)) {
      if (Date.now() - startTime > timeoutMs) {
        console.warn(
          `Service "${serviceName}" did not become available within ${timeoutMs}ms`,
        );
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return true;
  }
}

// Initialize from window when script loads
if (typeof window !== "undefined") {
  // Try to initialize immediately
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      GlobalServices.initializeFromWindow();
    });
  } else {
    // If already loaded, initialize immediately
    GlobalServices.initializeFromWindow();
  }

  // Also retry when window properties change
  window.addEventListener("load", () => {
    GlobalServices.initializeFromWindow();
  });
}

// Export for use in modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = GlobalServices;
}
