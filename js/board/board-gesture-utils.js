// experiment-gesture-utils.js - 實驗手勢標記和統計工具函式

// ============ 手勢標記功能 ============

/**
 * 標記手勢執行結果
 * @param {number} idx - 步驟索引
 * @param {string} status - 標記狀態：'correct', 'uncertain', 'incorrect'
 * @param {string} gestureName - 手勢名稱
 */
const markGesture = function (idx, status, gestureName) {
  const timestamp = new Date().toISOString();
  const timerValue =
    document.getElementById(`timer-display-${idx}`)?.textContent || "00:00.000";

  // 更新統計資料
  if (
    window.app &&
    window.app.gestureStats &&
    window.app.gestureStats[gestureName]
  ) {
    if (status === "correct") {
      window.app.gestureStats[gestureName].correct++;
    } else if (status === "uncertain") {
      window.app.gestureStats[gestureName].uncertain++;
    } else if (status === "incorrect") {
      window.app.gestureStats[gestureName].incorrect++;
    }
    window.app.renderGestureCountList();
  }

  // 廣播手勢標記到其他裝置
  if (window.syncManager?.core?.isConnected?.()) {
    window.syncManager.core
      .syncState({
        type: window.SYNC_DATA_TYPES.GESTURE_MARKED,
        clientId: window.syncManager?.clientId,
        stepIndex: idx,
        gestureName: gestureName,
        markStatus: status,
        timerValue: timerValue,
        timestamp: timestamp,
      })
      .catch((error) => {
        Logger.warn("同步手勢標記失敗:", error);
      });
  }

  // 視覺回饋（500ms 時效粗邊框，以 CSS class 控制避免 inline style 競爭）
  const card = document.getElementById(`timer-card-${idx}`);
  if (card) {
    // 移除既有的標記 class（避免快速連點時動畫重複疊加）
    card.classList.remove(
      "timer-card-marked-correct",
      "timer-card-marked-uncertain",
      "timer-card-marked-incorrect",
      "timer-card-pressed",
    );
    // force reflow 讓動畫能重新觸發
    void card.offsetWidth;

    const markedClass = `timer-card-marked-${status}`;
    card.classList.add(markedClass);
    setTimeout(() => card.classList.remove(markedClass), 500);
  }

  // 如果有 logger，記錄到日誌系統
  if (window.logger) {
    window.logger.logAction("gesture_marked", "experiment", {
      step: idx,
      gesture: gestureName,
      status: status,
      timer: timerValue,
      timestamp: timestamp,
    });
  }

  // 使用實驗日誌管理器記錄手勢嘗試
  if (window.experimentLogManager) {
    // 轉換狀態: correct -> 't', uncertain -> 'n', incorrect -> 'f'
    const gestureType =
      status === "correct" ? "t" : status === "uncertain" ? "n" : "f";
    // 取得目前手勢的 step_id
    const currentGesture = window.app?.currentCombination?.gestures?.[idx];
    const stepId = currentGesture?.step_id || null;
    window.experimentLogManager.logGestureAttempt(idx, gestureType, stepId);
  }
};

// 暴露到 window 供 HTML 使用
window.markGesture = markGesture;

/**
 * 進行下一步（自動停止計時）
 * @param {number} idx - 目前步驟索引
 * @param {string} gestureName - 手勢名稱
 */
const goToNextStep = function (idx, gestureName) {
  const timerValue =
    document.getElementById(`timer-display-${idx}`)?.textContent || "00:00.000";

  // 停止計時器（透過公開 API，避免直接操作內部狀態）
  const mgr = window.experimentTimerManager;
  if (mgr?.timerStates?.[idx]?.running) {
    mgr.toggleIndexedTimer(idx);
  }

  // 更新完成計數
  if (
    window.app &&
    window.app.gestureStats &&
    window.app.gestureStats[gestureName]
  ) {
    window.app.gestureStats[gestureName].completed++;
    window.app.renderGestureCountList();
  }

  // 廣播下一步動作到其他裝置
  if (window.syncManager?.core?.isConnected?.()) {
    window.syncManager.core
      .syncState({
        type: window.SYNC_DATA_TYPES.GESTURE_STEP_COMPLETED,
        clientId: window.syncManager?.clientId,
        stepIndex: idx,
        gestureName: gestureName,
        timerValue: timerValue,
        timestamp: new Date().toISOString(),
      })
      .catch((error) => {
        Logger.warn("同步下一步動作失敗:", error);
      });
  }

  // 如果有 logger，記錄到日誌系統
  if (window.logger) {
    window.logger.logAction("next_step", "experiment", {
      from_step: idx,
      gesture: gestureName,
      final_timer: timerValue,
      timestamp: new Date().toISOString(),
    });
  }

  // 使用實驗日誌管理器記錄步驟結束
  if (window.experimentLogManager) {
    // 取得目前手勢的 step_id
    const currentGesture = window.app?.currentCombination?.gestures?.[idx];
    const stepId = currentGesture?.step_id || null;
    window.experimentLogManager.logGestureStepEnd(idx, stepId);
  }

  // 檢查是否為最後一個步驟
  const totalGestures = window.app?.currentCombination?.gestures?.length || 0;
  const isLastStep = idx + 1 >= totalGestures;

  if (isLastStep) {
    // 最後一個步驟，結束實驗
    const currentCard = document.getElementById(`gesture-card-${idx}`);
    if (currentCard) {
      currentCard.classList.remove(
        "gesture-card-active",
        "gesture-card-current",
      );
      currentCard.classList.add("gesture-card-inactive");
    }

    // 發送所有待發送的日誌
    if (window.experimentLogManager) {
      window.experimentLogManager
        .flushAll()
        .then(() => {
          Logger.info("所有日誌已發送完成");

          // 先滾動到第一個卡片（手勢序列開始）
          const firstCard = document.getElementById("gesture-card-0");
          if (firstCard) {
            firstCard.scrollIntoView({ behavior: "smooth", block: "center" });

            // 300ms 後滾動到實驗設定區塊
            setTimeout(() => {
              // 找實驗設定區塊 - 通常是左面板的第一個 input-section
              const experimentSection = document.querySelector(
                ".left-panel .input-section",
              );
              if (experimentSection) {
                experimentSection.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }
            }, 300);
          }
        })
        .catch((error) => {
          Logger.error("日誌發送失敗:", error);
        });
    }

    // 延遲1秒後自動停止實驗
    setTimeout(() => {
      if (window.app && window.app.experimentRunning) {
        window.app.stopExperiment(false);
      }
    }, 1000);
    return;
  }

  // 視覺轉換效果
  const currentCard = document.getElementById(`gesture-card-${idx}`);
  const nextCard = document.getElementById(`gesture-card-${idx + 1}`);

  // 移除目前卡片的浮起效果與目前標示
  if (currentCard) {
    currentCard.classList.remove("gesture-card-active", "gesture-card-current");
    currentCard.classList.add("gesture-card-inactive");
  }

  // 新增下一個卡片的浮起效果與目前標示
  if (nextCard) {
    nextCard.scrollIntoView({ behavior: "smooth", block: "center" });
    nextCard.classList.remove("gesture-card-inactive");
    nextCard.classList.add("gesture-card-active", "gesture-card-current");
  }
};

// 暴露到 window 供 HTML 使用
window.goToNextStep = goToNextStep;
