/**
 * ExperimentSimulator - 實驗流程模擬工具
 *
 * 用途：模擬完整的實驗流程（開始→步驟→動作→暫停/繼續→結束）
 * 獨立性：
 *   - 不修改任何主項目代碼
 *   - 透過模組匯入調用
 *   - 使用公開 API（boardPageManager 的公開方法）
 *   - 易於刪除，無後門依賴
 *
 * 使用示例：
 *   // 基本用法（使用目前頁面狀態）
 *   const sim = new ExperimentSimulator();
 *   sim.run();
 *
 *   // 若已掛載到 window（見檔案底部）
 *   new window.ExperimentSimulator().run()
 *
 *   // 自訂參數
 *   new ExperimentSimulator({
 *     experimentId: "EXP-2026-001",
 *     combinationId: "standard",
 *     participantName: "測試使用者",
 *     actionCount: 5,           // 完成前 N 個 action，若 null 則完成所有
 *     pauseAfterActions: 3,     // 第 3 個 action 後暫停
 *     actionIntervalMs: 1000,   // 每個 action 間的延遲（毫秒）
 *     verbose: true             // 詳細日誌
 *   })
 *
 * 注意：
 *   - 僅適用 board.html（實驗端）
 *   - 依賴 boardPageManager、ExperimentFlowManager
 *   - 廣播所有操作給其他設備（Panel 端會接收並同步）
 *   - 不是測試框架，只是使用者操作模擬
 */

import { boardPageManager } from "./board-page-manager.js";

class ExperimentSimulator {
  constructor(options = {}) {
    this.config = {
      experimentId: options.experimentId || "",
      combinationId: options.combinationId || "",
      participantName:
        options.participantName || "模擬測試",
      actionCount: options.actionCount || null, // null = 完成所有
      pauseAfterActions: options.pauseAfterActions || null,
      actionIntervalMs: options.actionIntervalMs || 800,
      autoStopCooldownMs: options.autoStopCooldownMs ?? 5000,
      verbose: options.verbose !== false, // 預設開啟日誌
    };

    this.state = {
      running: false,
      paused: false,
      completedActions: 0,
      totalActions: 0,
      startTime: null,
      currentStep: "idle", // idle|initializing|running|paused|stopping|completed|error
    };

    this._log("ExperimentSimulator 已建立");
  }

  /**
   * 內部日誌（僅當 verbose=true 時輸出）
   */
  _log(message, data = null) {
    if (!this.config.verbose) return;
    const timestamp = new Date().toLocaleTimeString("zh-TW");
    const prefix = "[ExperimentSimulator]";
    if (data) {
      Logger.debug(`${prefix} ${timestamp} - ${message}`, data);
    } else {
      Logger.debug(`${prefix} ${timestamp} - ${message}`);
    }
  }

  _getExternalState() {
    const bpm = boardPageManager;
    const flow = bpm?.experimentFlowManager;
    const stateManager = bpm?.experimentStateManager;
    const timerManager = bpm?.timerManager;
    const isRunning =
      flow?.isRunning ??
      stateManager?.isExperimentRunning ??
      bpm?.experimentRunning ??
      this.state.running;
    const isPaused =
      flow?.isPaused ??
      stateManager?.experimentPaused ??
      timerManager?.experimentPaused ??
      bpm?.experimentPaused ??
      this.state.paused;
    return { isRunning: !!isRunning, isPaused: !!isPaused };
  }

  async _waitForResume() {
    while (true) {
      const { isRunning, isPaused } = this._getExternalState();
      if (!isRunning) {
        this.state.running = false;
        this.state.currentStep = "stopping";
        return false;
      }
      if (!isPaused) {
        this.state.paused = false;
        this.state.currentStep = "running";
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  async _ensureExperimentActive() {
    const { isRunning, isPaused } = this._getExternalState();
    if (!isRunning) {
      this.state.running = false;
      this.state.currentStep = "stopping";
      this._log("偵測到實驗已停止，結束模擬");
      return false;
    }
    if (isPaused) {
      this.state.paused = true;
      this.state.currentStep = "paused";
      this._log("偵測到實驗已暫停，等待恢復...");
      return this._waitForResume();
    }
    return true;
  }

  async _waitIntervalWithPause(durationMs) {
    const start = Date.now();
    while (Date.now() - start < durationMs) {
      if (!(await this._ensureExperimentActive())) {
        return false;
      }
      const elapsed = Date.now() - start;
      const remaining = Math.max(durationMs - elapsed, 0);
      await new Promise((resolve) => setTimeout(resolve, Math.min(200, remaining)));
    }
    return true;
  }

  _ensureStepTimerRunning(gestureIndex) {
    const timerManager = boardPageManager?.timerManager;
    const isRunning = timerManager?.timerStates?.[gestureIndex]?.running;
    if (!isRunning) {
      const timerCard = document.getElementById(
        `timer-card-${gestureIndex}`,
      );
      if (timerCard) {
        timerCard.click();
        return;
      }
      if (timerManager?.toggleIndexedTimer) {
        timerManager.toggleIndexedTimer(gestureIndex);
      }
    }
  }

  /**
   * 驗證環境
   */
  _validateEnvironment() {
    const errors = [];

    if (!boardPageManager) {
      errors.push("boardPageManager 不可用（需在 board.html 中執行）");
    }

    if (!boardPageManager?.experimentFlowManager) {
      errors.push("experimentFlowManager 不可用");
    }

    if (!boardPageManager?.experimentSystemManager?.actionHandler) {
      errors.push("experimentActionHandler 不可用");
    }

    if (errors.length > 0) {
      Logger.error("[ExperimentSimulator] 環境檢查失敗：");
      errors.forEach((e) => Logger.error(`  - ${e}`));
      return false;
    }

    return true;
  }

  /**
   * 初始化實驗
   */
  async _initializeExperiment() {
    this._log("初始化實驗...");
    this.state.currentStep = "initializing";

    try {
      const bpm = boardPageManager;
      const { config } = this;
      if (!config.combinationId) {
        config.combinationId =
          bpm?.currentCombination?.combinationId ||
          bpm?.experimentSystemManager?.state?.currentCombination
            ?.combinationId ||
          "";
      }

      // 1. 設定實驗 ID（若提供）
      if (config.experimentId) {
        const expIdInput = document.getElementById("experimentIdInput");
        if (expIdInput) {
          expIdInput.value = config.experimentId;
          this._log("實驗 ID 已設定", { experimentId: config.experimentId });
        }
      }

      // 2. 設定受試者名稱
      const participantInput = document.getElementById("participantNameInput");
      if (participantInput) {
        participantInput.value = config.participantName;
        this._log("受試者名稱已設定", {
          participantName: config.participantName,
        });
      }

      // 3. 選擇組合（若提供且與現有不同）
      if (config.combinationId && bpm?.experimentSystemManager) {
        const currentCombo =
          bpm?.experimentCombinationManager?.getActiveCombination?.();
        if (!currentCombo || currentCombo.combinationId !== config.combinationId) {
          await bpm.experimentSystemManager.selectCombination(
            config.combinationId,
          );
          this._log("組合已選擇", { combinationId: config.combinationId });
          // 等待 UI 更新
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      // 4. 啟動實驗
      const started = await bpm.startExperiment();
      if (!started) {
        throw new Error("startExperiment returned false");
      }
      this._log("實驗已啟動");

      // 5. 取得總 action 數量（優先使用手勢序列）
      const actionHandler = boardPageManager?.experimentActionHandler;
      const activeCombination =
        bpm?.currentCombination ||
        bpm?.experimentSystemManager?.state?.currentCombination ||
        null;
      const gestureActionsCount =
        activeCombination?.gestures?.reduce(
          (sum, gesture) =>
            sum + (Array.isArray(gesture?.actions) ? gesture.actions.length : 0),
          0,
        ) || 0;
      this.state.totalActions =
        gestureActionsCount ||
        actionHandler?.currentActionSequence?.length ||
        0;
      this._log("Action 序列已載入", {
        total: this.state.totalActions,
        willComplete: config.actionCount || "全部",
      });

      return true;
    } catch (error) {
      this.state.currentStep = "error";
      this._log("初始化失敗", error);
      throw error;
    }
  }

  /**
   * 執行 action 模擬循環
   */
  async _runActionLoop() {
    this._log("開始 Action 循環...");
    this.state.currentStep = "running";
    this.state.running = true;
    this.state.startTime = Date.now();

    const bpm = boardPageManager;
    const actionHandler = bpm?.experimentActionHandler;
    const { config, state } = this;
    const actionsToDo = config.actionCount || state.totalActions;
    const activeCombination =
      boardPageManager?.currentCombination ||
      null;
    const gestures = activeCombination?.gestures || [];

    try {
      if (gestures.length === 0) {
        this._log("找不到手勢序列，改用 action-only 模式", {
          combinationId: activeCombination?.combinationId || null,
        });
        for (let i = 0; i < actionsToDo; i++) {
          if (!(await this._ensureExperimentActive())) {
            return false;
          }

          if (
            config.pauseAfterActions &&
            state.completedActions >= config.pauseAfterActions
          ) {
            this._log("到達暫停點，暫停實驗...", {
              completedActions: state.completedActions,
              pauseAfterActions: config.pauseAfterActions,
            });
            await this._pauseExperiment();
            this._log("等待 5 秒後自動繼續...");
            await new Promise((resolve) => setTimeout(resolve, 5000));
            this._log("繼續實驗");
            await this._resumeExperiment();
          }

          if (!state.running) {
            this._log("使用者中斷模擬");
            break;
          }

          const currentAction = actionHandler.getCurrentAction?.();
          if (!currentAction) {
            this._log("無法取得目前 action，結束循環");
            break;
          }

          const actionId =
            currentAction.action_id || currentAction.actionId || `ACTION_${i}`;

          this._log(`完成 action: ${actionId} (${i + 1}/${actionsToDo})`, {
            actionIndex: i,
            actionName: currentAction.action_name || actionId,
          });

          const actionButton = document.querySelector(
            `.action-button[data-action-id="${actionId}"]`,
          );
          const shouldUseButton = !!actionButton;
          if (shouldUseButton) {
            actionButton.click();
          } else if (bpm?.experimentLogManager) {
            const stepInfo = boardPageManager?.actionToStepMap?.get(actionId);
            bpm.experimentLogManager.logAction(
              actionId,
              null,
              stepInfo?.step_id || null,
            );
          }
          if (!shouldUseButton) {
            if (typeof actionHandler.handleCorrectAction === "function") {
              actionHandler.handleCorrectAction(actionId, {
                simulated: true,
              });
            } else if (typeof bpm.completeAction === "function") {
              bpm.completeAction(actionId);
            } else {
              this._log("警告：無可用的動作完成方法");
            }
          }

          state.completedActions++;

          if (i < actionsToDo - 1) {
            if (!(await this._waitIntervalWithPause(config.actionIntervalMs))) {
              return false;
            }
          }
        }
      } else {
        let simulatedActions = 0;
        for (let gestureIndex = 0; gestureIndex < gestures.length; gestureIndex++) {
          if (!(await this._ensureExperimentActive())) {
            return false;
          }

          const gesture = gestures[gestureIndex];
          const gestureName =
            gesture?.name || gesture?.gesture || `step_${gestureIndex}`;
          const actions = Array.isArray(gesture?.actions) ? gesture.actions : [];

          boardPageManager?.gestureUtils?.activateGestureStep?.(gestureIndex);

          this._ensureStepTimerRunning(gestureIndex);

          if (!(await this._waitIntervalWithPause(config.actionIntervalMs))) {
            return false;
          }

          if (
            config.pauseAfterActions &&
            state.completedActions >= config.pauseAfterActions
          ) {
            this._log("到達暫停點，暫停實驗...", {
              completedActions: state.completedActions,
              pauseAfterActions: config.pauseAfterActions,
            });
            await this._pauseExperiment();
            this._log("等待 5 秒後自動繼續...");
            await new Promise((resolve) => setTimeout(resolve, 5000));
            this._log("繼續實驗");
            await this._resumeExperiment();
          }

          if (!state.running) {
            this._log("使用者中斷模擬");
            break;
          }

          for (let actionIndex = 0; actionIndex < actions.length; actionIndex++) {
            if (!(await this._ensureExperimentActive())) {
              return false;
            }

            if (actionsToDo && simulatedActions >= actionsToDo) {
              this._log("已達指定 action 數量，停止模擬");
              return true;
            }

            const action = actions[actionIndex];
            const actionId =
              action?.action_id || action?.actionId || `ACTION_${simulatedActions}`;

            this._log(`完成 action: ${actionId} (${simulatedActions + 1}/${actionsToDo})`, {
              actionIndex: simulatedActions,
              actionName: action?.action_name || actionId,
            });

            const actionButton = document.querySelector(
              `.action-button[data-action-id="${actionId}"]`,
            );
            const shouldUseButton = !!actionButton;
            if (shouldUseButton) {
              actionButton.click();
            } else if (bpm?.experimentLogManager) {
              const stepInfo = boardPageManager?.actionToStepMap?.get(actionId);
              bpm.experimentLogManager.logAction(
                actionId,
                gestureIndex,
                stepInfo?.step_id || null,
              );
            }
            if (!shouldUseButton) {
              if (typeof actionHandler.handleCorrectAction === "function") {
                actionHandler.handleCorrectAction(actionId, {
                  simulated: true,
                });
              } else if (typeof bpm.completeAction === "function") {
                bpm.completeAction(actionId);
              } else {
                this._log("警告：無可用的動作完成方法");
              }
            }

            state.completedActions++;
            simulatedActions++;

            if (actionIndex < actions.length - 1) {
              if (!(await this._waitIntervalWithPause(config.actionIntervalMs))) {
                return false;
              }
            }
          }

          const markButton = document.querySelector(
            `#gesture-card-${gestureIndex} .gesture-action-btn.correct`,
          );
          if (markButton) {
            markButton.click();
          } else {
            boardPageManager?.gestureUtils?.markGesture?.(
              gestureIndex,
              "correct",
              gestureName,
            );
          }

          const nextButton = document.querySelector(
            `#gesture-card-${gestureIndex} .gesture-next-button`,
          );
          if (nextButton) {
            nextButton.style.transform = "scale(0.96)";
            nextButton.style.boxShadow = "0 0 8px rgba(0, 0, 0, 0.2)";
            setTimeout(() => {
              nextButton.style.transform = "";
              nextButton.style.boxShadow = "";
            }, 120);
            nextButton.click();
          } else {
            boardPageManager?.gestureUtils?.goToNextStep?.(
              gestureIndex,
              gestureName,
            );
          }

          if (gestureIndex < gestures.length - 1) {
            await new Promise((resolve) =>
              setTimeout(resolve, config.actionIntervalMs),
            );
          }
        }
      }

      return true;
    } catch (error) {
      this.state.currentStep = "error";
      this._log("Action 循環失敗", error);
      throw error;
    }
  }

  /**
   * 暫停實驗
   */
  async _pauseExperiment() {
    this._log("暫停實驗");
    this.state.currentStep = "paused";
    this.state.paused = true;

    const bpm = boardPageManager;
    if (typeof bpm.togglePauseExperiment === "function") {
      try {
        bpm.togglePauseExperiment();
      } catch (error) {
        this._log("暫停失敗", error);
      }
    }
  }

  /**
   * 繼續實驗
   */
  async _resumeExperiment() {
    this._log("繼續實驗");
    this.state.currentStep = "running";
    this.state.paused = false;

    const bpm = boardPageManager;
    if (typeof bpm.togglePauseExperiment === "function") {
      try {
        bpm.togglePauseExperiment();
      } catch (error) {
        this._log("繼續失敗", error);
      }
    }
  }

  /**
   * 停止實驗
   */
  async _stopExperiment() {
    this._log("停止實驗");
    this.state.currentStep = "stopping";

    const bpm = boardPageManager;
    if (typeof bpm.stopExperiment === "function") {
      try {
        await bpm.stopExperiment(false); // isManualStop = false（模擬完成）
      } catch (error) {
        this._log("停止失敗", error);
      }
    }

    this.state.running = false;
    this.state.currentStep = "completed";
  }

  /**
   * 輸出最終統計
   */
  _printSummary() {
    const duration = Date.now() - this.state.startTime;
    const durationSec = (duration / 1000).toFixed(2);
    const rate = (this.state.completedActions / durationSec).toFixed(2);

    const summary = `
========================================
  實驗模擬完成
========================================
  總耗時: ${durationSec} 秒
  完成 Action: ${this.state.completedActions} 個
  執行速度: ${rate} actions/秒
  組合 ID: ${this.config.combinationId || "未設定"}
  受試者: ${this.config.participantName}
========================================
    `;

    Logger.info(summary);
    this._log("模擬完成");
  }

  /**
   * 執行完整模擬
   */
  async run() {
    try {
      // 驗證環境
      if (!this._validateEnvironment()) {
        throw new Error("環境驗證失敗");
      }

      this._log("========#### 開始實驗模擬 ####========");
      this._log("配置參數", {
        experimentId: this.config.experimentId,
        combinationId: this.config.combinationId,
        participantName: this.config.participantName,
        actionCount: this.config.actionCount,
        pauseAfterActions: this.config.pauseAfterActions,
        actionIntervalMs: this.config.actionIntervalMs,
        autoStopCooldownMs: this.config.autoStopCooldownMs,
      });

      // 初始化
      await this._initializeExperiment();

      // 執行 action 循環
      await this._runActionLoop();

      // 停止實驗
      await this._stopExperiment();

      if (this.config.autoStopCooldownMs > 0) {
        this._log("自動停止冷卻", {
          cooldownMs: this.config.autoStopCooldownMs,
        });
        await new Promise((resolve) =>
          setTimeout(resolve, this.config.autoStopCooldownMs),
        );
      }

      // 輸出統計
      this._printSummary();

      this._log("========#### 模擬完成 ####========");
    } catch (error) {
      Logger.error(
        "[ExperimentSimulator] 模擬失敗:",
        error instanceof Error ? error.message : error,
      );
      this.state.currentStep = "error";
      this.state.running = false;
    }
  }

  /**
   * 停止正在運行的模擬
   */
  stop() {
    this._log("使用者請求停止模擬");
    this.state.running = false;
  }

  /**
   * 取得目前狀態
   */
  getStatus() {
    return {
      ...this.state,
      config: {
        ...this.config,
      },
      uptime: this.state.startTime
        ? Date.now() - this.state.startTime
        : null,
    };
  }
}

// ES6 模組匯出
export { ExperimentSimulator };

// Optional: expose for console use. Remove this block to disable global access.
if (typeof window !== "undefined") {
  window.ExperimentSimulator = ExperimentSimulator;
}
