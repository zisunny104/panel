/**
 * ExperimentFlowManager - 實驗流程管理器
 *
 * 負責實驗生命週期控制（開始、暫停、恢復、停止、完成）、
 * 步驟與單元進度管理，並發布流程事件供其他模組訂閱。
 * 與 ExperimentTimerManager 和 UI 層互動以驅動實驗進行。
 */

class ExperimentFlowManager {
  /**
   * 實驗狀態常數
   */
  static STATE = {
    IDLE: "idle", // 閒置（未開始）
    RUNNING: "running", // 進行中
    PAUSED: "paused", // 暫停
    STOPPED: "stopped", // 已停止
    COMPLETED: "completed", // 已完成
  };

  /**
   * 事件類型常數
   */
  static EVENT = {
    STARTED: "flow:started",
    PAUSED: "flow:paused",
    RESUMED: "flow:resumed",
    STOPPED: "flow:stopped",
    COMPLETED: "flow:completed",
    LOCKED: "flow:locked",
    UNLOCKED: "flow:unlocked",
    PARTICIPANT_EDIT: "flow:participant_edit",
    STEP_CHANGED: "flow:step_changed",
    UNIT_CHANGED: "flow:unit_changed",
    UNIT_COMPLETED: "flow:unit_completed",
    STATE_CHANGED: "flow:state_changed",
    ERROR: "flow:error",
  };

  constructor(config = {}) {
    // 配置
    this.config = {
      enableAutoProgress: config.enableAutoProgress !== false,
      stepTimeout: config.stepTimeout || null,
      ...config,
    };

    // 狀態
    this.state = ExperimentFlowManager.STATE.IDLE;
    this.isRunning = false;
    this.isPaused = false;
    // locked 表示是否禁止變更實驗ID或組合（RUNNING 或 PAUSED 時為 true）
    this.locked = false;

    // 進度追蹤
    this.currentUnitIndex = 0;
    this.currentStepIndex = 0;
    this.loadedUnits = [];
    this.completedUnits = new Set();

    // 依賴注入
    this.dependencies = {
      hubManager: null,
      combinationManager: null,
      actionHandler: null,
      uiManager: null,
    };

    // 事件監聽器
    this.eventListeners = new Map();

    // 自動推進計時器
    this.autoProgressTimer = null;

    Logger.debug("ExperimentFlowManager 初始化完成");
  }

  // ==================== 依賴注入 ====================

  /**
   * 注入 HubManager
   */
  injectHubManager(hubManager) {
    this.dependencies.hubManager = hubManager;
    Logger.debug("HubManager 已注入");
    return this;
  }

  /**
   * 注入 CombinationManager
   */
  injectCombinationManager(combinationManager) {
    this.dependencies.combinationManager = combinationManager;
    Logger.debug("CombinationManager 已注入");
    return this;
  }

  /**
   * 注入 ActionHandler
   */
  injectActionHandler(actionHandler) {
    this.dependencies.actionHandler = actionHandler;
    Logger.debug("ActionHandler 已注入");
    return this;
  }

  /**
   * 注入 UIManager
   */
  injectUIManager(uiManager) {
    this.dependencies.uiManager = uiManager;
    Logger.debug("UIManager 已注入");
    return this;
  }

  /**
   * 取得依賴
   */
  getDependency(name) {
    return this.dependencies[name];
  }

  // ==================== 生命週期管理 ====================

  /**
   * 開始實驗
   */
  async startExperiment(options = {}) {
    if (this.isRunning) {
      Logger.warn("實驗已在進行中");
      return false;
    }

    try {
      Logger.info("開始實驗");

      // 載入單元列表
      if (options.units) {
        this.loadedUnits = options.units;
      } else if (this.dependencies.combinationManager) {
        this.loadedUnits =
          this.dependencies.combinationManager.getLoadedUnits();
      }

      if (this.loadedUnits.length === 0) {
        throw new Error("沒有可用的單元");
      }

      // 重置進度
      this.currentUnitIndex = 0;
      this.currentStepIndex = 0;
      this.completedUnits.clear();

      // 更新狀態
      this.isRunning = true;
      this.isPaused = false;
      this.state = ExperimentFlowManager.STATE.RUNNING;
      // 鎖定變更（禁止變更 experimentId/組合）
      this.locked = true;
      this.emit(ExperimentFlowManager.EVENT.LOCKED, { locked: true });
      // 在進行中不允許修改受試者名稱
      this.emit(ExperimentFlowManager.EVENT.PARTICIPANT_EDIT, {
        allowed: false,
      });

      // 觸發內部事件
      const startData = {
        units: [...this.loadedUnits],
        timestamp: new Date().toISOString(),
      };
      this.emit(ExperimentFlowManager.EVENT.STARTED, startData);

      this.emit(ExperimentFlowManager.EVENT.STATE_CHANGED, {
        oldState: ExperimentFlowManager.STATE.IDLE,
        newState: this.state,
      });

      // 廣播 DOM 事件供同步橋接器使用
      if (typeof window !== "undefined" && window.SYNC_EVENTS) {
        document.dispatchEvent(
          new CustomEvent(window.SYNC_EVENTS.EXPERIMENT_STARTED, {
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
  pauseExperiment() {
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
    // 保持鎖定（仍禁止變更 experimentId/組合），但允許編輯受試者名稱
    this.locked = true;
    this.emit(ExperimentFlowManager.EVENT.LOCKED, { locked: true });
    this.emit(ExperimentFlowManager.EVENT.PARTICIPANT_EDIT, { allowed: true });

    // 清除自動推進計時器
    this.clearAutoProgress();

    const pauseData = {
      currentUnit: this.currentUnitIndex,
      currentStep: this.currentStepIndex,
      timestamp: new Date().toISOString(),
    };
    this.emit(ExperimentFlowManager.EVENT.PAUSED, pauseData);

    this.emit(ExperimentFlowManager.EVENT.STATE_CHANGED, {
      oldState: ExperimentFlowManager.STATE.RUNNING,
      newState: this.state,
    });

    // 廣播 DOM 事件供同步橋接器使用
    if (typeof window !== "undefined" && window.SYNC_EVENTS) {
      document.dispatchEvent(
        new CustomEvent(window.SYNC_EVENTS.EXPERIMENT_PAUSED, {
          detail: pauseData,
        }),
      );
    }

    return true;
  }

  /**
   * 恢復實驗
   */
  resumeExperiment() {
    if (!this.isRunning) {
      Logger.warn("實驗未進行，無法恢復");
      return false;
    }

    if (!this.isPaused) {
      Logger.warn("實驗未暫停");
      return false;
    }

    Logger.info("恢復實驗");

    this.isPaused = false;
    this.state = ExperimentFlowManager.STATE.RUNNING;
    // 重新鎖定並禁止修改受試者名稱
    this.locked = true;
    this.emit(ExperimentFlowManager.EVENT.LOCKED, { locked: true });
    this.emit(ExperimentFlowManager.EVENT.PARTICIPANT_EDIT, { allowed: false });

    const resumeData = {
      currentUnit: this.currentUnitIndex,
      currentStep: this.currentStepIndex,
      timestamp: new Date().toISOString(),
    };
    this.emit(ExperimentFlowManager.EVENT.RESUMED, resumeData);

    this.emit(ExperimentFlowManager.EVENT.STATE_CHANGED, {
      oldState: ExperimentFlowManager.STATE.PAUSED,
      newState: this.state,
    });

    // 廣播 DOM 事件供同步橋接器使用
    if (typeof window !== "undefined" && window.SYNC_EVENTS) {
      document.dispatchEvent(
        new CustomEvent(window.SYNC_EVENTS.EXPERIMENT_RESUMED, {
          detail: resumeData,
        }),
      );
    }

    return true;
  }

  /**
   * 停止實驗
   */
  stopExperiment(reason = "manual") {
    if (!this.isRunning) {
      Logger.warn("實驗未進行，無法停止");
      return false;
    }

    Logger.info("停止實驗", { reason });

    const oldState = this.state;
    this.isRunning = false;
    this.isPaused = false;
    this.state = ExperimentFlowManager.STATE.STOPPED;
    // 解鎖並禁止受試者名稱編輯
    this.locked = false;
    this.emit(ExperimentFlowManager.EVENT.UNLOCKED, { locked: false });
    this.emit(ExperimentFlowManager.EVENT.PARTICIPANT_EDIT, { allowed: false });

    // 清除自動推進計時器
    this.clearAutoProgress();

    const stopData = {
      reason,
      currentUnit: this.currentUnitIndex,
      currentStep: this.currentStepIndex,
      completedUnits: this.completedUnits.size,
      timestamp: new Date().toISOString(),
    };
    this.emit(ExperimentFlowManager.EVENT.STOPPED, stopData);

    this.emit(ExperimentFlowManager.EVENT.STATE_CHANGED, {
      oldState,
      newState: this.state,
    });

    // 廣播 DOM 事件供同步橋接器使用
    if (typeof window !== "undefined" && window.SYNC_EVENTS) {
      document.dispatchEvent(
        new CustomEvent(window.SYNC_EVENTS.EXPERIMENT_STOPPED, {
          detail: stopData,
        }),
      );
    }

    return true;
  }

  /**
   * 完成實驗
   */
  completeExperiment() {
    if (!this.isRunning) {
      Logger.warn("實驗未進行，無法標記為完成");
      return false;
    }

    Logger.info("實驗完成");

    const oldState = this.state;
    this.isRunning = false;
    this.isPaused = false;
    this.state = ExperimentFlowManager.STATE.COMPLETED;
    // 解鎖並禁止受試者名稱編輯
    this.locked = false;
    this.emit(ExperimentFlowManager.EVENT.UNLOCKED, { locked: false });
    this.emit(ExperimentFlowManager.EVENT.PARTICIPANT_EDIT, { allowed: false });

    // 清除自動推進計時器
    this.clearAutoProgress();

    this.emit(ExperimentFlowManager.EVENT.COMPLETED, {
      totalUnits: this.loadedUnits.length,
      completedUnits: this.completedUnits.size,
      timestamp: new Date().toISOString(),
    });

    this.emit(ExperimentFlowManager.EVENT.STATE_CHANGED, {
      oldState,
      newState: this.state,
    });

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
    // 解鎖並禁止受試者名稱編輯
    this.locked = false;
    this.emit(ExperimentFlowManager.EVENT.UNLOCKED, { locked: false });
    this.emit(ExperimentFlowManager.EVENT.PARTICIPANT_EDIT, { allowed: false });

    this.clearAutoProgress();

    if (oldState !== this.state) {
      this.emit(ExperimentFlowManager.EVENT.STATE_CHANGED, {
        oldState,
        newState: this.state,
      });
    }

    Logger.debug("實驗已重置");
  }

  // ==================== 步驟流程控制 ====================

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

    // 檢查是否還有下一步
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
      // 目前單元已完成
      return this.nextUnit();
    }
  }

  /**
   * 後退到上一步
   */
  prevStep() {
    if (!this.isRunning) {
      Logger.warn("實驗未進行，無法後退");
      return false;
    }

    const oldStepIndex = this.currentStepIndex;

    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;

      this.emit(ExperimentFlowManager.EVENT.STEP_CHANGED, {
        unitIndex: this.currentUnitIndex,
        oldStepIndex,
        newStepIndex: this.currentStepIndex,
        step: this.getCurrentStep(),
      });

      Logger.debug("後退到上一步", {
        unit: this.currentUnitIndex,
        step: this.currentStepIndex,
      });

      return true;
    } else if (this.currentUnitIndex > 0) {
      // 回到上一個單元的最後一步
      return this.prevUnit();
    }

    Logger.warn("已經是第一步");
    return false;
  }

  /**
   * 跳到指定步驟
   */
  jumpToStep(unitIndex, stepIndex) {
    if (!this.isRunning) {
      Logger.warn("實驗未進行，無法跳轉");
      return false;
    }

    if (unitIndex < 0 || unitIndex >= this.loadedUnits.length) {
      Logger.warn("單元索引超出範圍", unitIndex);
      return false;
    }

    const unit = this.getUnitAt(unitIndex);
    if (!unit || stepIndex < 0 || stepIndex >= unit.steps.length) {
      Logger.warn("步驟索引超出範圍", stepIndex);
      return false;
    }

    const oldUnitIndex = this.currentUnitIndex;
    const oldStepIndex = this.currentStepIndex;

    this.currentUnitIndex = unitIndex;
    this.currentStepIndex = stepIndex;

    if (oldUnitIndex !== unitIndex) {
      this.emit(ExperimentFlowManager.EVENT.UNIT_CHANGED, {
        oldUnitIndex,
        newUnitIndex: unitIndex,
        unit: this.getCurrentUnit(),
      });
    }

    this.emit(ExperimentFlowManager.EVENT.STEP_CHANGED, {
      unitIndex,
      oldStepIndex,
      newStepIndex: stepIndex,
      step: this.getCurrentStep(),
    });

    Logger.debug("已跳轉到指定步驟", { unitIndex, stepIndex });
    return true;
  }

  /**
   * 取得目前步驟
   */
  getCurrentStep() {
    const unit = this.getCurrentUnit();
    if (!unit) return null;
    return unit.steps[this.currentStepIndex] || null;
  }

  // ==================== 單元進度控制 ====================

  /**
   * 前進到下一個單元
   */
  nextUnit() {
    if (!this.isRunning) {
      Logger.warn("實驗未進行，無法前進到下一單元");
      return false;
    }

    // 標記目前單元為完成
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
      // 所有單元已完成
      Logger.info("所有單元已完成");

      // 【最後單元完成時的電源高亮】
      // 高亮電源開關，提示用戶進行關機流程
      if (
        typeof Logger !== "undefined" &&
        document.getElementById("powerSwitchArea")
      ) {
        const powerSwitchArea = document.getElementById("powerSwitchArea");
        if (powerSwitchArea) {
          powerSwitchArea.classList.add("next-step-highlight");
        }
        Logger.debug("最後單元已完成，高亮電源開關提示關機");
      }

      this.completeExperiment();
      return false;
    }
  }

  /**
   * 後退到上一個單元
   */
  prevUnit() {
    if (!this.isRunning) {
      Logger.warn("實驗未進行，無法後退到上一單元");
      return false;
    }

    const oldUnitIndex = this.currentUnitIndex;

    if (this.currentUnitIndex > 0) {
      this.currentUnitIndex--;

      // 跳到該單元的最後一步
      const unit = this.getCurrentUnit();
      this.currentStepIndex = unit.steps.length - 1;

      this.emit(ExperimentFlowManager.EVENT.UNIT_CHANGED, {
        oldUnitIndex,
        newUnitIndex: this.currentUnitIndex,
        unit: this.getCurrentUnit(),
      });

      Logger.debug("後退到上一單元", {
        unit: this.currentUnitIndex,
      });

      return true;
    }

    Logger.warn("已經是第一個單元");
    return false;
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

    // 從全域 _allUnits 取得單元資料
    if (window._allUnits) {
      return window._allUnits.find((u) => u.unit_id === unitId);
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

  // ==================== 狀態查詢 ====================

  /**
   * 檢查實驗是否進行中
   */
  isExperimentRunning() {
    return this.isRunning;
  }

  /**
   * 檢查實驗是否暫停
   */
  isExperimentPaused() {
    return this.isPaused;
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

  // ==================== 自動推進 ====================

  /**
   * 啟用自動推進
   */
  enableAutoProgress(delay = 3000) {
    if (!this.config.enableAutoProgress) {
      Logger.warn("自動推進功能已停用");
      return false;
    }

    this.clearAutoProgress();

    this.autoProgressTimer = setTimeout(() => {
      if (this.isRunning && !this.isPaused) {
        Logger.debug("自動推進到下一步");
        this.nextStep();
      }
    }, delay);

    return true;
  }

  /**
   * 停用自動推進
   */
  disableAutoProgress() {
    this.clearAutoProgress();
  }

  /**
   * 清除自動推進計時器
   */
  clearAutoProgress() {
    if (this.autoProgressTimer) {
      clearTimeout(this.autoProgressTimer);
      this.autoProgressTimer = null;
    }
  }

  // ==================== 事件通知 ====================

  /**
   * 註冊事件監聽器
   */
  on(eventType, callback) {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType).push(callback);
    return () => this.off(eventType, callback);
  }

  /**
   * 移除事件監聽器
   */
  off(eventType, callback) {
    if (!this.eventListeners.has(eventType)) return;

    const listeners = this.eventListeners.get(eventType);
    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }

  /**
   * 觸發事件
   */
  emit(eventType, data) {
    if (!this.eventListeners.has(eventType)) return;

    const listeners = this.eventListeners.get(eventType);
    listeners.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        Logger.error(`事件處理器錯誤 (${eventType})`, error);
      }
    });
  }

  /**
   * 清除所有事件監聽器
   */
  clearListeners(eventType = null) {
    if (eventType) {
      this.eventListeners.delete(eventType);
    } else {
      this.eventListeners.clear();
    }
  }

  // ==================== 工具方法 ====================

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

// 導出到全域
if (typeof window !== "undefined") {
  window.ExperimentFlowManager = ExperimentFlowManager;
}
