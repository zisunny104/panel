// js/panel/panel-action-manager.js - 面板動作管理器
// 專門用於主面板的 action-based 實驗邏輯
// 專門用於 index.html

/**
 * 面板動作管理器
 * 負責處理面板操作的動作序列管理
 */
class PanelActionManager {
  constructor() {
    this.currentActionSequence = [];
    this.currentActionIndex = 0;
    this.completedActions = new Set();
    this.actionsMap = new Map();
    this.actionToStepMap = new Map();
    this.isInitialized = false;

    Logger.debug("PanelActionManager 已建立");
  }

  /**
   * 從實驗管理器初始化動作序列
   * @returns {Promise<boolean>}
   */
  async initializeFromExperiment() {
    // 檢查必要的全域狀態
    if (!window.panelExperiment) {
      Logger.warn("實驗管理器不存在");
      return false;
    }

    if (!window._allUnits) {
      Logger.warn("單元資料未載入");
      return false;
    }

    if (!window.panelExperiment.isExperimentRunning) {
      Logger.warn("實驗未執行");
      return false;
    }

    try {
      // 取得目前實驗的單元列表
      const unitIds = window.panelExperiment.loadedUnits;
      if (!unitIds || unitIds.length === 0) {
        Logger.warn("未選擇任何單元");
        return false;
      }

      // 構建動作序列
      const allActionsMap = window._allUnitsActionsMap || new Map();
      const actionSequence = buildActionSequenceFromUnits(
        unitIds,
        allActionsMap,
        window._allUnits
      );

      if (actionSequence && actionSequence.length > 0) {
        this.currentActionSequence = actionSequence;
        this.actionsMap = allActionsMap;
        this.actionToStepMap = window._allUnitsActionToStepMap || new Map();
        this.currentActionIndex = 0;
        this.completedActions.clear();
        this.isInitialized = true;

        Logger.info(
          "動作序列已初始化，長度:",
          this.currentActionSequence.length
        );

        return true;
      }
    } catch (error) {
      Logger.error("動作序列初始化失敗:", error);
    }
    return false;
  }

  /**
   * 取得目前動作
   * @returns {Object|null}
   */
  getCurrentAction() {
    if (
      !this.isInitialized ||
      this.currentActionIndex >= this.currentActionSequence.length
    ) {
      return null;
    }
    return this.currentActionSequence[this.currentActionIndex];
  }

  /**
   * 檢查按鈕是否適用於目前動作
   * @param {string} buttonFunction - 按鈕功能
   * @returns {boolean}
   */
  isButtonValidForCurrentAction(buttonFunction) {
    const currentAction = this.getCurrentAction();
    return currentAction && currentAction.expected_button === buttonFunction;
  }

  /**
   * 完成目前動作並移到下一個
   * @returns {boolean}
   */
  completeCurrentAction() {
    const currentAction = this.getCurrentAction();
    if (currentAction) {
      this.completedActions.add(currentAction.action_id);
      this.currentActionIndex++;

      // 廣播動作完成事件給多螢幕同步系統
      if (window.syncManager && window.syncManager.core) {
        window.syncManager.core
          .syncState({
            type: "action_completed",
            source: "panel",
            device_id:
              window.syncManager?.core?.syncClient?.clientId ||
              "action_manager",
            action_id: currentAction.action_id,
            action_sequence_progress: {
              current: this.currentActionIndex,
              total: this.currentActionSequence.length,
              completed: Array.from(this.completedActions),
            },
            timestamp: new Date().toISOString(),
          })
          .catch((error) => {
            Logger.warn("廣播 action 完成失敗:", error);
          });
      }

      Logger.debug(
        "動作已完成:",
        currentAction.action_id,
        `(${this.currentActionIndex}/${this.currentActionSequence.length})`
      );

      //更新按鈕高亮和媒體顯示
      if (window.buttonManager) {
        window.buttonManager.updateMediaForCurrentAction();
      }

      return true;
    }
    return false;
  }

  /**
   * 重設動作序列
   */
  reset() {
    this.currentActionIndex = 0;
    this.completedActions.clear();
    this.isInitialized = false;
    Logger.debug("動作序列已重設");
  }

  /**
   * 取得進度資訊
   * @returns {Object}
   */
  getProgress() {
    return {
      current: this.currentActionIndex,
      total: this.currentActionSequence.length,
      completed: Array.from(this.completedActions),
      isComplete: this.currentActionIndex >= this.currentActionSequence.length,
    };
  }

  /**
   * 檢查按鈕是否符合指定動作的要求
   * @param {string} buttonId - 按鈕ID
   * @param {string} functionName - 功能名稱
   * @param {Object} action - 動作物件
   * @returns {boolean}
   */
  isButtonValidForAction(buttonId, functionName, action) {
    if (!action || !action.action_buttons) return false;

    // action_buttons 可能是字串或陣列
    const actionButtons = Array.isArray(action.action_buttons)
      ? action.action_buttons
      : action.action_buttons.split(",").map((s) => s.trim());

    // 檢查功能名稱是否符合
    return (
      actionButtons.includes(functionName) || actionButtons.includes(buttonId)
    );
  }
}

// 匯出給全域使用
window.PanelActionManager = PanelActionManager;

// 向後相容：也將 ActionManager 指向 PanelActionManager （會被 experiment 版本覆寫）
window.ActionManager = PanelActionManager;
