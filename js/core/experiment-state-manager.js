/**
 * ExperimentStateManager - 本機實驗狀態管理器
 * 作為本機狀態的中樞，負責管理實驗ID、受試者名稱、組合等狀態
 * 與實驗中樞同步，確保本機狀態與遠端一致
 */

class ExperimentStateManager {
  constructor() {
    this.experimentId = null;
    this.subjectName = null;
    this.currentCombination = null;
    this.loadedUnits = [];
    this.isExperimentRunning = false;
    this.experimentPaused = false;
    this.experimentStartTime = null;
    this.experimentElapsed = 0;

    // 時間同步管理器
    this.timeSyncManager = window.timeSyncManager;

    // 事件監聽器
    this.listeners = new Map();

    // 從 sessionStorage 還原狀態快照
    this._restoreSnapshot();

    // 初始化同步
    this._setupSync();
  }

  /**
   * 設定同步處理器
   * @private
   */
  _setupSync() {
    // 監聽輸入框變化
    this._setupInputSync();

    // 監聽中樞狀態更新
    this._setupHubSync();
  }

  /**
   * 設定輸入框同步
   * @private
   */
  _setupInputSync() {
    // 實驗ID輸入框
    const experimentIdInput = document.getElementById("experimentIdInput");
    if (experimentIdInput) {
      experimentIdInput.addEventListener("input", (e) => {
        const newId = e.target.value.trim();
        if (newId !== this.experimentId) {
          this.setExperimentId(newId, "input");
        }
      });

      experimentIdInput.addEventListener("change", (e) => {
        const newId = e.target.value.trim();
        if (newId !== this.experimentId) {
          this.setExperimentId(newId, "input");
        }
      });

      // 初始化時從輸入框讀取
      if (experimentIdInput.value.trim() && !this.experimentId) {
        this.experimentId = experimentIdInput.value.trim();
      }
    }

    // 受試者名稱輸入框
    const subjectNameInput = document.getElementById("subjectName");
    if (subjectNameInput) {
      subjectNameInput.addEventListener("input", (e) => {
        const newName = e.target.value.trim();
        if (newName !== this.subjectName) {
          this.setSubjectName(newName, "input");
        }
      });

      subjectNameInput.addEventListener("change", (e) => {
        const newName = e.target.value.trim();
        if (newName !== this.subjectName) {
          this.setSubjectName(newName, "input");
        }
      });

      // 初始化時從輸入框讀取
      if (subjectNameInput.value.trim() && !this.subjectName) {
        this.subjectName = subjectNameInput.value.trim();
      }
    }
  }

  /**
   * 設定中樞同步
   * @private
   */
  _setupHubSync() {
    // 監聽中樞狀態更新事件
    document.addEventListener("hub_state_updated", (event) => {
      const { state } = event.detail;
      this.applyHubState(state);
    });

    // 監聽中樞實驗ID更新
    document.addEventListener("experiment_id_updated", (event) => {
      const { experimentId } = event.detail;
      this.setExperimentId(experimentId, "hub");
    });

    // 監聽中樞受試者名稱更新
    document.addEventListener("subject_name_updated", (event) => {
      const { subjectName } = event.detail;
      this.setSubjectName(subjectName, "hub");
    });
  }

  /**
   * 套用中樞狀態
   * @param {Object} state - 中樞狀態
   */
  applyHubState(state) {
    if (state.experimentId !== undefined) {
      this.setExperimentId(state.experimentId, "hub_state");
    }
    if (state.subjectName !== undefined) {
      this.setSubjectName(state.subjectName, "hub_state");
    }
    if (state.currentCombination !== undefined) {
      this.setCurrentCombination(state.currentCombination, "hub_state");
    }
    if (state.loadedUnits !== undefined) {
      this.loadedUnits = [...state.loadedUnits];
      this._emit("loadedUnitsChanged", this.loadedUnits);
    }
    if (state.isExperimentRunning !== undefined) {
      this.isExperimentRunning = state.isExperimentRunning;
      this._emit("experimentRunningChanged", this.isExperimentRunning);
    }
    if (state.experimentPaused !== undefined) {
      this.experimentPaused = state.experimentPaused;
      this._emit("experimentPausedChanged", this.experimentPaused);
    }
  }

  /**
   * 設定實驗ID
   * @param {string} experimentId - 新的實驗ID
   * @param {string} source - 更新來源
   */
  setExperimentId(experimentId, source = "unknown") {
    if (this.experimentId !== experimentId) {
      const oldId = this.experimentId;
      this.experimentId = experimentId;
      Logger.info(`實驗ID已更新 (${source}): ${experimentId}`);

      // 同步更新輸入框
      const experimentIdInput = document.getElementById("experimentIdInput");
      if (
        experimentIdInput &&
        experimentIdInput.value.trim() !== experimentId
      ) {
        experimentIdInput.value = experimentId;
      }

      // 同步更新日誌管理器
      if (window.experimentLogManager) {
        window.experimentLogManager.setExperimentId(experimentId, source);
      }

      // 分發事件
      this._emit("experimentIdChanged", { experimentId, oldId, source });
    }
  }

  /**
   * 取得實驗ID
   * @returns {string|null} 目前的實驗ID
   */
  getExperimentId() {
    return this.experimentId;
  }

  /**
   * 設定受試者名稱
   * @param {string} subjectName - 新的受試者名稱
   * @param {string} source - 更新來源
   */
  setSubjectName(subjectName, source = "unknown") {
    if (this.subjectName !== subjectName) {
      const oldName = this.subjectName;
      this.subjectName = subjectName;
      Logger.info(`受試者名稱已更新 (${source}): ${subjectName}`);

      // 同步更新輸入框
      const subjectNameInput = document.getElementById("subjectName");
      if (subjectNameInput && subjectNameInput.value.trim() !== subjectName) {
        subjectNameInput.value = subjectName;
      }

      // 分發事件
      this._emit("subjectNameChanged", { subjectName, oldName, source });
    }
  }

  /**
   * 取得受試者名稱
   * @returns {string|null} 目前的受試者名稱
   */
  getSubjectName() {
    return this.subjectName;
  }

  /**
   * 設定目前組合
   * @param {Object} combination - 新的組合
   * @param {string} source - 更新來源
   */
  setCurrentCombination(combination, source = "unknown") {
    if (
      JSON.stringify(this.currentCombination) !== JSON.stringify(combination)
    ) {
      const oldCombination = this.currentCombination;
      this.currentCombination = combination;
      Logger.info(
        `目前組合已更新 (${source}): ${combination?.combination_name || "null"}`
      );

      // 分發事件
      this._emit("currentCombinationChanged", {
        combination,
        oldCombination,
        source,
      });
    }
  }

  /**
   * 開始實驗
   */
  startExperiment() {
    if (!this.isExperimentRunning) {
      this.isExperimentRunning = true;
      // 使用統一的伺服器時間
      this.experimentStartTime = this.timeSyncManager?.isSynchronized()
        ? this.timeSyncManager.getServerTime()
        : Date.now();
      this.experimentPaused = false;
      Logger.info("實驗已開始");

      // 初始化日誌管理器
      if (window.experimentLogManager) {
        const defaultSubjectName =
          this.subjectName || `受試者_${this.experimentId}`;
        window.experimentLogManager.initialize(
          this.experimentId,
          defaultSubjectName
        );
        window.experimentLogManager.logExperimentStart();
      }

      this._emit("experimentStarted", {
        experimentId: this.experimentId,
        subjectName: this.subjectName,
        combination: this.currentCombination,
      });
    }
  }

  /**
   * 停止實驗
   */
  stopExperiment() {
    if (this.isExperimentRunning) {
      this.isExperimentRunning = false;
      this.experimentPaused = false;
      Logger.info("實驗已停止");

      // 記錄實驗結束
      if (window.experimentLogManager) {
        window.experimentLogManager.logExperimentEnd();
        window.experimentLogManager.flushAll();
      }

      this._emit("experimentStopped", {
        experimentId: this.experimentId,
        subjectName: this.subjectName,
      });
    }
  }

  /**
   * 暫停實驗
   */
  pauseExperiment() {
    if (this.isExperimentRunning && !this.experimentPaused) {
      this.experimentPaused = true;
      Logger.info("實驗已暫停");

      if (window.experimentLogManager) {
        window.experimentLogManager.logExperimentPause();
      }

      this._emit("experimentPaused", {
        experimentId: this.experimentId,
      });
    }
  }

  /**
   * 還原實驗
   */
  resumeExperiment() {
    if (this.isExperimentRunning && this.experimentPaused) {
      this.experimentPaused = false;
      Logger.info("實驗已還原");

      if (window.experimentLogManager) {
        window.experimentLogManager.logExperimentResume();
      }

      this._emit("experimentResumed", {
        experimentId: this.experimentId,
      });
    }
  }

  /**
   * 產生新的實驗ID
   */
  generateNewExperimentId() {
    const newId = RandomUtils.generateNewExperimentId();
    this.setExperimentId(newId, "generate");

    // 只在同步模式下註冊到中樞
    if (window.experimentHubManager?.isInSyncMode?.()) {
      Logger.debug(
        `[ExperimentStateManager] 同步模式，註冊實驗ID到中樞: ${newId}`
      );
      window.experimentHubManager.registerExperimentId(newId, "state_manager");
    } else {
      Logger.debug(
        `[ExperimentStateManager] 獨立模式，實驗ID僅存本機: ${newId}`
      );
    }

    return newId;
  }

  /**
   * 取得目前狀態
   */
  getCurrentState() {
    return {
      experimentId: this.experimentId,
      subjectName: this.subjectName,
      currentCombination: this.currentCombination,
      loadedUnits: this.loadedUnits,
      isExperimentRunning: this.isExperimentRunning,
      experimentPaused: this.experimentPaused,
      experimentStartTime: this.experimentStartTime,
      experimentElapsed: this.experimentElapsed,
    };
  }

  /**
   * 監聽狀態變化
   * @param {string} event - 事件名稱
   * @param {Function} callback - Callback函數
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  /**
   * 移除事件監聽
   * @param {string} event - 事件名稱
   * @param {Function} callback - Callback函數
   */
  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * 分發事件
   * @private
   */
  _emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          Logger.error(`事件Callback執行失敗 (${event}):`, error);
        }
      });
    }

    // 同時分發全域事件
    document.dispatchEvent(
      new CustomEvent(`state_${event}`, {
        detail: data,
      })
    );

    // 狀態變更後儲存快照
    this._saveSnapshot();
  }

  /**
   * 從 sessionStorage 還原狀態快照
   * @private
   */
  _restoreSnapshot() {
    try {
      const snapshot = sessionStorage.getItem("experiment_state_snapshot");
      if (snapshot) {
        const state = JSON.parse(snapshot);

        // 詳細記錄還原的內容
        const restoredFields = [];
        if (state.experimentId !== undefined) {
          this.experimentId = state.experimentId;
          restoredFields.push(`experimentId: ${state.experimentId}`);
        }
        if (state.subjectName !== undefined) {
          this.subjectName = state.subjectName;
          restoredFields.push(`subjectName: ${state.subjectName}`);
        }
        if (state.currentCombination !== undefined) {
          this.currentCombination = state.currentCombination;
          restoredFields.push(
            `currentCombination: ${state.currentCombination}`
          );
        }
        if (state.loadedUnits !== undefined) {
          this.loadedUnits = [...state.loadedUnits];
          restoredFields.push(`loadedUnits: [${state.loadedUnits.join(", ")}]`);
        }
        if (state.isExperimentRunning !== undefined) {
          this.isExperimentRunning = state.isExperimentRunning;
          restoredFields.push(
            `isExperimentRunning: ${state.isExperimentRunning}`
          );
        }
        if (state.experimentPaused !== undefined) {
          this.experimentPaused = state.experimentPaused;
          restoredFields.push(`experimentPaused: ${state.experimentPaused}`);
        }
        if (state.experimentStartTime !== undefined) {
          this.experimentStartTime = state.experimentStartTime;
          restoredFields.push(
            `experimentStartTime: ${
              state.experimentStartTime
                ? window.timeSyncManager.formatDateTime(
                    state.experimentStartTime
                  )
                : "未開始"
            }`
          );
        }
        if (state.experimentElapsed !== undefined) {
          this.experimentElapsed = state.experimentElapsed;
          restoredFields.push(
            `experimentElapsed: ${state.experimentElapsed}ms`
          );
        }

        if (restoredFields.length > 0) {
          Logger.info(`從快照還原狀態: ${restoredFields.join(", ")}`);
        } else {
          Logger.debug("從快照還原狀態 (無需還原字段)");
        }

        // 更新 UI 元素
        this._updateUIFromSnapshot();
      } else {
        Logger.debug("沒有快照可還原");
      }
    } catch (error) {
      Logger.error("還原狀態快照失敗:", error);
    }
  }

  /**
   * 儲存狀態快照到 sessionStorage
   * @private
   */
  _saveSnapshot() {
    try {
      const snapshot = this.getCurrentState();
      sessionStorage.setItem(
        "experiment_state_snapshot",
        JSON.stringify(snapshot)
      );

      // 詳細記錄儲存的內容
      const savedFields = [];
      if (snapshot.experimentId)
        savedFields.push(`experimentId: ${snapshot.experimentId}`);
      if (snapshot.subjectName)
        savedFields.push(`subjectName: ${snapshot.subjectName}`);
      if (snapshot.currentCombination)
        savedFields.push(`currentCombination: ${snapshot.currentCombination}`);
      if (snapshot.loadedUnits?.length)
        savedFields.push(`loadedUnits: [${snapshot.loadedUnits.join(", ")}]`);
      if (snapshot.isExperimentRunning !== undefined)
        savedFields.push(
          `isExperimentRunning: ${snapshot.isExperimentRunning}`
        );
      if (snapshot.experimentPaused !== undefined)
        savedFields.push(`experimentPaused: ${snapshot.experimentPaused}`);
      if (snapshot.experimentElapsed !== undefined)
        savedFields.push(`experimentElapsed: ${snapshot.experimentElapsed}ms`);

      Logger.debug(`已儲存實驗狀態快照: ${savedFields.join(", ")}`);
    } catch (error) {
      Logger.error("儲存狀態快照失敗:", error);
    }
  }

  /**
   * 從快照更新 UI 元素
   * @private
   */
  _updateUIFromSnapshot() {
    // 更新實驗ID輸入框
    const experimentIdInput = document.getElementById("experimentIdInput");
    if (experimentIdInput && this.experimentId) {
      experimentIdInput.value = this.experimentId;
    }

    // 更新受試者名稱輸入框
    const subjectNameInput = document.getElementById("subjectName");
    if (subjectNameInput && this.subjectName) {
      subjectNameInput.value = this.subjectName;
    }
  }
}

// 全域暴露
(function () {
  window.experimentStateManager = new ExperimentStateManager();
})();

// 如果作為 ES6 模塊導入，也提供匯出
if (typeof module !== "undefined" && module.exports) {
  module.exports = ExperimentStateManager;
}
