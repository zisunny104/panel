/**
 * ExperimentUtils - 實驗工具函數集合
 * 合併手勢和計時器相關的工具函數
 */

// ============ 計時器功能 ============
// 儲存每個計時器的狀態
window.timerStates = {};
window.timerIntervals = {};
window.longPressTimers = {};

/**
 * 格式化持續時間顯示：00:00.000
 * @param {number} ms - 毫秒數
 * @returns {string} - 格式化的時間字串
 */
window.formatDuration = function (ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = ms % 1000;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0",
  )}.${String(milliseconds).padStart(3, "0")}`;
};

/**
 * 切換計時器狀態（開始/暫停）
 * @param {number} idx - 計時器索引
 */
window.toggleTimer = function (idx) {
  // 如果正在長按或剛剛完成長按歸零，不執行切換
  if (window.longPressTimers[idx] || window.timerStates[idx]?.justReset) {
    // 清除 justReset 標記
    if (window.timerStates[idx]?.justReset) {
      window.timerStates[idx].justReset = false;
    }
    return;
  }

  const state = window.timerStates[idx] || {
    running: false,
    startTime: 0,
    elapsedTime: 0,
  };

  const card = document.getElementById(`timer-card-${idx}`);

  if (state.running) {
    // 暫停：停止計時並移除粗外框
    clearInterval(window.timerIntervals[idx]);
    state.running = false;
    state.elapsedTime += Date.now() - state.startTime;

    if (card) {
      card.style.outline = "none";
      card.style.outlineOffset = "0";
    }

    // 紀錄步驟暫停
    if (window.experimentLogManager) {
      const currentGesture = window.app?.currentCombination?.gestures?.[idx];
      const stepId = currentGesture?.step_id || null;
      window.experimentLogManager.logGestureStepPause(idx, stepId);
    }
  } else {
    // 開始：啟動計時並新增粗外框
    state.running = true;
    state.startTime = Date.now();

    if (card) {
      const computedStyle = window.getComputedStyle(card);
      const originalBorderColor = computedStyle.borderColor;
      card.setAttribute("data-original-border-color", originalBorderColor);

      // 使用 outline 避免內容位移，向內偏移模擬加粗邊框
      card.style.outline = `4px solid ${originalBorderColor}`;
      card.style.outlineOffset = "-2px";
    }

    // 啟動更新循環（每 10 毫秒更新一次）
    window.timerIntervals[idx] = setInterval(() => {
      const currentElapsed = state.elapsedTime + (Date.now() - state.startTime);
      const display = document.getElementById(`timer-display-${idx}`);
      if (display) {
        display.textContent = window.formatDuration(currentElapsed);
      }
    }, 10);

    // 紀錄步驟開始
    if (window.experimentLogManager) {
      const currentGesture = window.app?.currentCombination?.gestures?.[idx];
      const stepId = currentGesture?.step_id || null;
      window.experimentLogManager.logGestureStepStart(idx, stepId);
    }
  }

  window.timerStates[idx] = state;
};

/**
 * 長按開始（準備歸零）
 * @param {number} idx - 計時器索引
 */
window.timerLongPressStart = function (idx) {
  window.longPressTimers[idx] = setTimeout(() => {
    // 長按 1 秒後執行歸零
    window.resetTimer(idx);
  }, 1000);
};

/**
 * 長按結束
 * @param {number} idx - 計時器索引
 */
window.timerLongPressEnd = function (idx) {
  if (window.longPressTimers[idx]) {
    clearTimeout(window.longPressTimers[idx]);
    window.longPressTimers[idx] = null;
  }
};

/**
 * 歸零計時器
 * @param {number} idx - 計時器索引
 */
window.resetTimer = function (idx) {
  if (window.timerIntervals[idx]) {
    clearInterval(window.timerIntervals[idx]);
  }

  const card = document.getElementById(`timer-card-${idx}`);
  if (card) {
    card.style.outline = "none";
    card.style.outlineOffset = "0";
  }

  // 重置狀態，並設定 justReset 標記防止鬆開時立即重新啟動
  window.timerStates[idx] = {
    running: false,
    startTime: 0,
    elapsedTime: 0,
    justReset: true,
  };

  const display = document.getElementById(`timer-display-${idx}`);
  if (display) {
    display.textContent = "00:00.000";
  }
};

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
        type: window.SyncDataTypes.GESTURE_MARKED,
        step_index: idx,
        gesture_name: gestureName,
        mark_status: status,
        timer_value: timerValue,
        timestamp: timestamp,
      })
      .catch((error) => {
        Logger.warn("同步手勢標記失敗:", error);
      });
  }

  // 視覺回饋
  const card = document.getElementById(`timer-card-${idx}`);
  if (card) {
    const timerState = window.timerStates[idx];
    const originalBorderColor =
      card.getAttribute("data-original-border-color") ||
      window.getComputedStyle(card).borderColor;

    // 根據標記類型改變 outline 顏色
    if (status === "correct") {
      card.style.outline = "4px solid #4caf50";
    } else if (status === "uncertain") {
      card.style.outline = "4px solid #ff9800";
    } else if (status === "incorrect") {
      card.style.outline = "4px solid #f44336";
    }
    card.style.outlineOffset = "-2px";

    // 延遲後還原
    const delayTime = 500;
    setTimeout(() => {
      if (timerState?.running) {
        card.style.outline = `4px solid ${originalBorderColor}`;
        card.style.outlineOffset = "-2px";
      } else {
        card.style.outline = "none";
        card.style.outlineOffset = "0";
      }
    }, delayTime);
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

  // 停止計時器
  const state = window.timerStates[idx];
  if (state && state.running) {
    clearInterval(window.timerIntervals[idx]);
    state.running = false;
    state.elapsedTime += Date.now() - state.startTime;
    window.timerStates[idx] = state;
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
        type: window.SyncDataTypes.GESTURE_STEP_COMPLETED,
        step_index: idx,
        gesture_name: gestureName,
        timer_value: timerValue,
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
      currentCard.classList.remove("gesture-card-active");
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

  // 移除目前卡片的浮起效果
  if (currentCard) {
    currentCard.classList.remove("gesture-card-active");
    currentCard.classList.add("gesture-card-inactive");
  }

  // 新增下一個卡片的浮起效果
  if (nextCard) {
    nextCard.scrollIntoView({ behavior: "smooth", block: "center" });
    nextCard.classList.remove("gesture-card-inactive");
    nextCard.classList.add("gesture-card-active");

    // 邊框高亮效果
    const timerCard = nextCard.querySelector(`#timer-card-${idx + 1}`);
    if (timerCard) {
      timerCard.style.boxShadow = "0 0 0 3px #667eea";
      setTimeout(() => {
        timerCard.style.boxShadow = "";
      }, 800);
    }
  }
};

// 暴露到 window 供 HTML 使用
window.goToNextStep = goToNextStep;

// 所有函數已暴露到 window 物件，供 HTML 中的 onclick 屬性和其他模組使用
