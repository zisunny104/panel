/**
 * ExperimentFlowManager - 實驗流程管理器
 *
 * 負責實驗生命週期控制（開始、暫停、繼續、停止、完成）、
 * 步驟與單元進度管理，並發布流程事件供其他模組訂閱。
 * 與 ExperimentTimerManager 和 UI 層互動以驅動實驗進行。
 */

import { buildActionSequenceFromUnits } from "../core/data-loader.js";
import {
  SYNC_EVENTS,
  EXPERIMENT_FLOW_STATE,
  EXPERIMENT_FLOW_EVENTS,
  EXPERIMENT_FLOW_DOM_EVENTS,
} from "../constants/index.js";
import { Logger } from "../core/console-manager.js";
import { EventEmitter } from "../core/event-emitter.js";

class ExperimentFlowManager extends EventEmitter {
  static STATE = EXPERIMENT_FLOW_STATE;
  static EVENT = EXPERIMENT_FLOW_EVENTS;

  constructor({
    hubManager = null,
    combinationManager = null,
    actionHandler = null,
    uiManager = null,
    stateManager = null,
    actionsMap = null,
    unitsData = null,
  } = {}) {
    super();
    this.hubManager = hubManager;
    this.combinationManager = combinationManager;
    this.actionHandler = actionHandler;
    this.uiManager = uiManager;
    this.stateManager = stateManager;
    this.actionsMap = actionsMap;
    this.unitsData = unitsData;

    this._localFlowState = {
      state: ExperimentFlowManager.STATE.IDLE,
      isRunning: false,
      isPaused: false,
      locked: false,
      currentUnitIndex: 0,
      currentStepIndex: 0,
      loadedUnits: [],
      completedUnits: new Set(),
      deferCompletion: false,
    };

    this.autoProgressTimer = null;
    this.pausedByVisibility = false;

    this._setupVisibilityHandler();
    Logger.debug("ExperimentFlowManager 初始化完成");
  }

  _setupVisibilityHandler() {
    document.addEventListener(EXPERIMENT_FLOW_DOM_EVENTS.VISIBILITY_CHANGE, () => {
      if (document.hidden) {
        if (this.isRunning && !this.isPaused) {
          this.pausedByVisibility = true;
          this.pauseExperiment();
        }
      } else {
        if (this.pausedByVisibility && this.isRunning && this.isPaused) {
          this.pausedByVisibility = false;
          this.resumeExperiment();
        }
      }
    });
  }

  /**
   * 建構後 inject dependencies（用於延後綁定情境）
   */
  injectDependencies({
    hubManager,
    combinationManager,
    actionHandler,
    uiManager,
    stateManager,
    actionsMap,
    unitsData,
  } = {}) {
    if (hubManager) this.hubManager = hubManager;
    if (combinationManager) this.combinationManager = combinationManager;
    if (actionHandler) this.actionHandler = actionHandler;
    if (uiManager) this.uiManager = uiManager;
    if (stateManager) {
      if (this.stateManager !== stateManager) {
        const snapshot = this._snapshotFlowState();
        this.stateManager = stateManager;
        Object.assign(this.stateManager, snapshot);
      }
    }
    if (actionsMap) this.actionsMap = actionsMap;
    if (unitsData) this.unitsData = unitsData;
    return this;
  }

  _getFlowStateStore() {
    return this.stateManager || this._localFlowState;
  }

  _snapshotFlowState() {
    const store = this._getFlowStateStore();
    return {
      state: store.state,
      isRunning: store.isRunning,
      isPaused: store.isPaused,
      locked: store.locked,
      currentUnitIndex: store.currentUnitIndex,
      currentStepIndex: store.currentStepIndex,
      loadedUnits: Array.isArray(store.loadedUnits) ? [...store.loadedUnits] : [],
      completedUnits: store.completedUnits instanceof Set ? new Set(store.completedUnits) : new Set(),
      deferCompletion: store.deferCompletion,
    };
  }

  get state() {
    return this._getFlowStateStore().state;
  }

  set state(value) {
    this._getFlowStateStore().state = value;
  }

  get isRunning() {
    return this._getFlowStateStore().isRunning;
  }

  set isRunning(value) {
    this._getFlowStateStore().isRunning = Boolean(value);
  }

  get isPaused() {
    return this._getFlowStateStore().isPaused;
  }

  set isPaused(value) {
    this._getFlowStateStore().isPaused = Boolean(value);
  }

  get locked() {
    return this._getFlowStateStore().locked;
  }

  set locked(value) {
    this._getFlowStateStore().locked = Boolean(value);
  }

  get currentUnitIndex() {
    return this._getFlowStateStore().currentUnitIndex;
  }

  set currentUnitIndex(value) {
    this._getFlowStateStore().currentUnitIndex = Number(value) || 0;
  }

  get currentStepIndex() {
    return this._getFlowStateStore().currentStepIndex;
  }

  set currentStepIndex(value) {
    this._getFlowStateStore().currentStepIndex = Number(value) || 0;
  }

  get loadedUnits() {
    const store = this._getFlowStateStore();
    if (!Array.isArray(store.loadedUnits)) {
      store.loadedUnits = [];
    }
    return store.loadedUnits;
  }

  set loadedUnits(value) {
    this._getFlowStateStore().loadedUnits = Array.isArray(value) ? value : [];
  }

  get completedUnits() {
    const store = this._getFlowStateStore();
    if (!(store.completedUnits instanceof Set)) {
      store.completedUnits = new Set();
    }
    return store.completedUnits;
  }

  set completedUnits(value) {
    this._getFlowStateStore().completedUnits = value instanceof Set ? value : new Set();
  }

  get deferCompletion() {
    return this._getFlowStateStore().deferCompletion;
  }

  set deferCompletion(value) {
    this._getFlowStateStore().deferCompletion = Boolean(value);
  }

  /**
   * 開始實驗
   */
  async startExperiment(options = {}) {
    const broadcast = options.broadcast !== false;
    if (this.isRunning) {
      Logger.warn("實驗已在進行中");
      return false;
    }

    try {
      Logger.info("開始實驗");

      if (options.units) {
        this.loadedUnits = options.units;
      } else if (this.combinationManager?.getLoadedUnits) {
        this.loadedUnits = this.combinationManager.getLoadedUnits();
      }

      if (this.loadedUnits.length === 0) {
        throw new Error("沒有可用的單元");
      }

      this.currentUnitIndex = 0;
      this.currentStepIndex = 0;
      this.completedUnits.clear();

      if (this.actionHandler) {
        const unitIds =
          this.loadedUnits.length > 0
            ? this.loadedUnits
            : this.combinationManager?.getLoadedUnits?.() || [];
        const actionsMap = this.actionsMap || new Map();
        const unitsData = this.unitsData || [];
        const combo =
          this.combinationManager?.getCurrentCombination?.() || null;
        const powerOptions = combo?.powerOptions || {};
        const includeStartup =
          typeof powerOptions.includeStartup === "boolean"
            ? powerOptions.includeStartup
            : true;
        const includeShutdown =
          typeof powerOptions.includeShutdown === "boolean"
            ? powerOptions.includeShutdown
            : true;
        const actionSequence = buildActionSequenceFromUnits(
          unitIds,
          actionsMap,
          unitsData,
          {
            includeStartup,
            includeShutdown,
          },
        );

        if (actionSequence && actionSequence.length > 0) {
          this.actionHandler.initializeSequence(actionSequence);
          Logger.debug("已初始化 action 序列", {
            actionCount: actionSequence.length,
          });
        }
      }

      this.isRunning = true;
      this.isPaused = false;
      this.state = ExperimentFlowManager.STATE.RUNNING;
      this.locked = true;
      this.emit(ExperimentFlowManager.EVENT.LOCKED, { locked: true });

      const startData = {
        units: [...this.loadedUnits],
        timestamp: new Date().toISOString(),
        source: options.source || "local",
        broadcast,
      };
      this.emit(ExperimentFlowManager.EVENT.STARTED, startData);

      this.emit(ExperimentFlowManager.EVENT.STATE_CHANGED, {
        oldState: ExperimentFlowManager.STATE.IDLE,
        newState: this.state,
      });

      if (broadcast) {
        document.dispatchEvent(
          new CustomEvent(SYNC_EVENTS.EXPERIMENT_STARTED, {
            detail: startData,
          }),
        );
      }

      Logger.debug("實驗已開始", {
        unitCount: this.loadedUnits.length,
      });

      return true;
    } catch (error) {
      Logger.error("開始實驗失敗", error);
      this.emit(ExperimentFlowManager.EVENT.ERROR, {
        type: "start_failed",
        error,
      });
      return false;
    }
  }

  /**
   * 暫停實驗
   */
  pauseExperiment(options = {}) {
    const broadcast = options.broadcast !== false;
    if (!this.isRunning) {
      Logger.warn("實驗未進行，無法暫停");
      return false;
    }

    if (this.isPaused) {
      Logger.warn("實驗已暫停");
      return false;
    }

    Logger.info("暫停實驗");

    this.isPaused = true;
    this.state = ExperimentFlowManager.STATE.PAUSED;
    this.locked = true;
    this.emit(ExperimentFlowManager.EVENT.LOCKED, { locked: true });

    const pauseData = {
      currentUnit: this.currentUnitIndex,
      currentStep: this.currentStepIndex,
      timestamp: new Date().toISOString(),
      source: options.source || "local",
      broadcast,
    };
    this.emit(ExperimentFlowManager.EVENT.PAUSED, pauseData);

    this.emit(ExperimentFlowManager.EVENT.STATE_CHANGED, {
      oldState: ExperimentFlowManager.STATE.RUNNING,
      newState: this.state,
    });

    if (broadcast) {
      document.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.EXPERIMENT_PAUSED, {
          detail: pauseData,
        }),
      );
    }

    return true;
  }

  /**
   * 繼續實驗
   */
  resumeExperiment(options = {}) {
    const broadcast = options.broadcast !== false;
    if (!this.isRunning) {
      Logger.warn("實驗未進行，無法繼續");
      return false;
    }

    if (!this.isPaused) {
      Logger.warn("實驗未暫停");
      return false;
    }

    Logger.info("繼續實驗");

    this.isPaused = false;
    this.state = ExperimentFlowManager.STATE.RUNNING;
    this.locked = true;
    this.emit(ExperimentFlowManager.EVENT.LOCKED, { locked: true });

    const resumeData = {
      currentUnit: this.currentUnitIndex,
      currentStep: this.currentStepIndex,
      timestamp: new Date().toISOString(),
      source: options.source || "local",
      broadcast,
    };
    this.emit(ExperimentFlowManager.EVENT.RESUMED, resumeData);

    this.emit(ExperimentFlowManager.EVENT.STATE_CHANGED, {
      oldState: ExperimentFlowManager.STATE.PAUSED,
      newState: this.state,
    });

    if (broadcast) {
      document.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.EXPERIMENT_RESUMED, {
          detail: resumeData,
        }),
      );
    }

    return true;
  }

  /**
   * 停止實驗
   */
  stopExperiment(reason = "manual", options = {}) {
    const broadcast = options.broadcast !== false;
    if (!this.isRunning) {
      Logger.warn("實驗未進行，無法停止");
      return false;
    }

    Logger.info("停止實驗", { reason });

    const oldState = this.state;
    this.isRunning = false;
    this.isPaused = false;
    this.state = ExperimentFlowManager.STATE.STOPPED;
    this.locked = false;
    this.emit(ExperimentFlowManager.EVENT.UNLOCKED, { locked: false });

    const stopData = {
      reason,
      broadcast,
      currentUnit: this.currentUnitIndex,
      currentStep: this.currentStepIndex,
      completedUnits: this.completedUnits.size,
      timestamp: new Date().toISOString(),
      source: options.source || "local",
    };
    this.emit(ExperimentFlowManager.EVENT.STOPPED, stopData);

    this.emit(ExperimentFlowManager.EVENT.STATE_CHANGED, {
      oldState,
      newState: this.state,
    });

    if (broadcast) {
      document.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.EXPERIMENT_STOPPED, {
          detail: stopData,
        }),
      );
    }

    return true;
  }

  /**
   * 完成實驗
   */
  completeExperiment(options = {}) {
    const broadcast = options.broadcast !== false;
    if (!this.isRunning) {
      Logger.warn("實驗未進行，無法標記為完成");
      return false;
    }

    Logger.info("實驗完成");

    const oldState = this.state;
    this.isRunning = false;
    this.isPaused = false;
    this.state = ExperimentFlowManager.STATE.COMPLETED;
    this.locked = false;
    this.emit(ExperimentFlowManager.EVENT.UNLOCKED, { locked: false });

    const completedData = {
      totalUnits: this.loadedUnits.length,
      completedUnits: this.completedUnits.size,
      reason: "completed",
      broadcast,
      timestamp: new Date().toISOString(),
      source: options.source || "local",
    };

    this.emit(ExperimentFlowManager.EVENT.COMPLETED, completedData);

    this.emit(ExperimentFlowManager.EVENT.STATE_CHANGED, {
      oldState,
      newState: this.state,
    });

    if (broadcast) {
      document.dispatchEvent(
        new CustomEvent(SYNC_EVENTS.EXPERIMENT_STOPPED, {
          detail: completedData,
        }),
      );
    }

    return true;
  }

  /**
   * 重置實驗
   */
  resetExperiment() {
    Logger.info("重置實驗");

    const oldState = this.state;

    this.isRunning = false;
    this.isPaused = false;
    this.state = ExperimentFlowManager.STATE.IDLE;
    this.currentUnitIndex = 0;
    this.currentStepIndex = 0;
    this.completedUnits.clear();
    this.locked = false;
    this.emit(ExperimentFlowManager.EVENT.UNLOCKED, { locked: false });

    if (oldState !== this.state) {
      this.emit(ExperimentFlowManager.EVENT.STATE_CHANGED, {
        oldState,
        newState: this.state,
      });
    }

    Logger.debug("實驗已重置");
  }

  /**
   * 前進到下一步
   */
  nextStep() {
    if (!this.isRunning || this.isPaused) {
      Logger.warn("實驗未進行或已暫停，無法前進");
      return false;
    }

    const currentUnit = this.getCurrentUnit();
    if (!currentUnit) {
      Logger.warn("沒有目前單元");
      return false;
    }

    const oldStepIndex = this.currentStepIndex;

    if (this.currentStepIndex < currentUnit.steps.length - 1) {
      this.currentStepIndex++;

      this.emit(ExperimentFlowManager.EVENT.STEP_CHANGED, {
        unitIndex: this.currentUnitIndex,
        oldStepIndex,
        newStepIndex: this.currentStepIndex,
        step: this.getCurrentStep(),
      });

      Logger.debug("前進到下一步", {
        unit: this.currentUnitIndex,
        step: this.currentStepIndex,
      });

      return true;
    } else {
      return this.nextUnit();
    }
  }

  /**
   * 取得目前步驟
   */
  getCurrentStep() {
    const unit = this.getCurrentUnit();
    if (!unit) return null;
    return unit.steps[this.currentStepIndex] || null;
  }

  /**
   * 前進到下一個單元
   */
  nextUnit() {
    if (!this.isRunning) {
      Logger.warn("實驗未進行，無法前進到下一單元");
      return false;
    }

    this.markUnitAsCompleted(this.currentUnitIndex);

    const oldUnitIndex = this.currentUnitIndex;

    if (this.currentUnitIndex < this.loadedUnits.length - 1) {
      this.currentUnitIndex++;
      this.currentStepIndex = 0;

      this.emit(ExperimentFlowManager.EVENT.UNIT_CHANGED, {
        oldUnitIndex,
        newUnitIndex: this.currentUnitIndex,
        unit: this.getCurrentUnit(),
      });

      Logger.debug("前進到下一單元", {
        unit: this.currentUnitIndex,
      });

      return true;
    } else {
      Logger.info("所有單元已完成");
      if (this.deferCompletion) {
        Logger.debug("完成已延後，等待手動結束");
        return false;
      }

      this.completeExperiment();
      return false;
    }
  }

  setDeferCompletion(shouldDefer) {
    this.deferCompletion = Boolean(shouldDefer);
  }

  /**
   * 設定目前單元
   */
  setCurrentUnit(unitIndex) {
    if (unitIndex < 0 || unitIndex >= this.loadedUnits.length) {
      Logger.warn("單元索引超出範圍", unitIndex);
      return false;
    }

    const oldUnitIndex = this.currentUnitIndex;
    this.currentUnitIndex = unitIndex;
    this.currentStepIndex = 0;

    if (oldUnitIndex !== unitIndex) {
      this.emit(ExperimentFlowManager.EVENT.UNIT_CHANGED, {
        oldUnitIndex,
        newUnitIndex: unitIndex,
        unit: this.getCurrentUnit(),
      });
    }

    Logger.debug("目前單元已設定", unitIndex);
    return true;
  }

  /**
   * 取得目前單元
   */
  getCurrentUnit() {
    return this.getUnitAt(this.currentUnitIndex);
  }

  /**
   * 取得指定索引的單元
   */
  getUnitAt(index) {
    if (index < 0 || index >= this.loadedUnits.length) {
      return null;
    }

    const unitId = this.loadedUnits[index];
    const unitsData = this.unitsData;

    if (Array.isArray(unitsData) && unitsData.length > 0) {
      return unitsData.find((u) => u.unit_id === unitId) || null;
    }

    return null;
  }

  /**
   * 取得單元列表
   */
  getUnitList() {
    return [...this.loadedUnits];
  }

  /**
   * 標記單元為完成
   */
  markUnitAsCompleted(unitIndex) {
    this.completedUnits.add(unitIndex);

    this.emit(ExperimentFlowManager.EVENT.UNIT_COMPLETED, {
      unitIndex,
      unit: this.getUnitAt(unitIndex),
      completedCount: this.completedUnits.size,
      totalCount: this.loadedUnits.length,
    });

    Logger.debug("單元已標記為完成", {
      unitIndex,
      progress: `${this.completedUnits.size}/${this.loadedUnits.length}`,
    });
  }

  /**
   * 檢查單元是否已完成
   */
  isUnitCompleted(unitIndex) {
    return this.completedUnits.has(unitIndex);
  }

  /**
   * 檢查實驗是否完成
   */
  isExperimentCompleted() {
    return this.state === ExperimentFlowManager.STATE.COMPLETED;
  }

  /**
   * 檢查實驗是否已停止
   */
  isExperimentStopped() {
    return this.state === ExperimentFlowManager.STATE.STOPPED;
  }

  /**
   * 取得目前狀態
   */
  getState() {
    return this.state;
  }

  /**
   * 取得進度資訊
   */
  getProgress() {
    return {
      currentUnitIndex: this.currentUnitIndex,
      currentStepIndex: this.currentStepIndex,
      totalUnits: this.loadedUnits.length,
      completedUnits: this.completedUnits.size,
      currentUnit: this.getCurrentUnit(),
      currentStep: this.getCurrentStep(),
      percentage:
        this.loadedUnits.length > 0
          ? Math.round(
              (this.completedUnits.size / this.loadedUnits.length) * 100,
            )
          : 0,
    };
  }

  /**
   * 銷毀管理器
   */
  destroy() {
    this.stopExperiment("destroy");
    this.clearListeners();
    this.loadedUnits = [];
    this.completedUnits.clear();
    Logger.debug("ExperimentFlowManager 已銷毀");
  }
}

export default ExperimentFlowManager;
export { ExperimentFlowManager };
