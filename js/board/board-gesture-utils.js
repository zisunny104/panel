/**
 * BoardGestureUtils - 實驗手勢標記與統計工具
 *
 * 提供手勢標記、步驟切換與統計相關的共用函式。
 */

import { SYNC_DATA_TYPES } from "../constants/index.js";

export const createBoardGestureUtils = function (deps) {
  const {
    app,
    timerManager,
    syncClient,
    syncCore,
    logger,
    experimentLogManager,
  } = deps;

  const activateGestureStep = function (idx) {
    const cards = document.querySelectorAll(
      ".gesture-card-active, .gesture-card-current",
    );
    cards.forEach((card) => {
      card.classList.remove("gesture-card-active", "gesture-card-current");
      card.classList.add("gesture-card-inactive");
    });

    const currentCard = document.getElementById(`gesture-card-${idx}`);
    if (currentCard) {
      currentCard.classList.remove("gesture-card-inactive");
      currentCard.classList.add("gesture-card-active", "gesture-card-current");

      const scrollContainer = document.querySelector(".right-panel");
      const containerRect = scrollContainer?.getBoundingClientRect();
      const cardRect = currentCard.getBoundingClientRect();
      const isOutOfView = containerRect
        ? cardRect.top < containerRect.top || cardRect.bottom > containerRect.bottom
        : cardRect.top < 0 || cardRect.bottom > window.innerHeight;

      if (isOutOfView) {
        currentCard.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }

    if (timerManager) {
      const currentIdx = timerManager.currentActiveIndex;
      if (currentIdx !== null && currentIdx !== idx) {
        const currentState = timerManager.timerStates?.[currentIdx];
        if (currentState?.running) {
          timerManager.toggleIndexedTimer(currentIdx);
        }
      }
      const nextState = timerManager.timerStates?.[idx];
      if (!nextState?.running) {
        timerManager.toggleIndexedTimer(idx);
      }
    }
  };

  const markGesture = function (idx, status, gestureName) {
    const timestamp = new Date().toISOString();
    const timerValue =
      document.getElementById(`timer-display-${idx}`)?.textContent ||
      "00:00.000";

    if (app?.gestureStats && app.gestureStats[gestureName]) {
      if (status === "correct") {
        app.gestureStats[gestureName].correct++;
      } else if (status === "uncertain") {
        app.gestureStats[gestureName].uncertain++;
      } else if (status === "incorrect") {
        app.gestureStats[gestureName].incorrect++;
      }
      app.renderGestureCountList();
    }

    const gestureMarkPayload = {
      type: SYNC_DATA_TYPES.GESTURE_MARKED,
      clientId: syncClient?.clientId,
      timestamp: Date.now(),
      stepIndex: idx,
      gestureName: gestureName,
      markStatus: status,
      timerValue: timerValue,
    };
    syncCore?.safeBroadcast?.(gestureMarkPayload).catch((error) => {
      Logger.warn("同步手勢標記失敗:", error);
    });

    const card = document.getElementById(`timer-card-${idx}`);
    if (card) {
      card.classList.remove(
        "timer-card-marked-correct",
        "timer-card-marked-uncertain",
        "timer-card-marked-incorrect",
        "timer-card-pressed",
      );
      void card.offsetWidth;

      const markedClass = `timer-card-marked-${status}`;
      card.classList.add(markedClass);
      setTimeout(() => card.classList.remove(markedClass), 500);
    }

    if (experimentLogManager) {
      const gestureType =
        status === "correct" ? "t" : status === "uncertain" ? "n" : "f";
      const currentGesture = app?.currentCombination?.gestures?.[idx];
      const stepId = currentGesture?.step_id || null;
      experimentLogManager.logAction("gesture_marked", idx, stepId);
      experimentLogManager.logGestureAttempt(idx, gestureType, stepId);
    }
  };

  const goToNextStep = function (idx, gestureName) {
    const timerValue =
      document.getElementById(`timer-display-${idx}`)?.textContent ||
      "00:00.000";

    if (timerManager?.timerStates?.[idx]?.running) {
      timerManager.toggleIndexedTimer(idx);
    }

    if (app?.gestureStats && app.gestureStats[gestureName]) {
      app.gestureStats[gestureName].completed++;
      app.renderGestureCountList();
    }

    const stepCompletedPayload = {
      type: SYNC_DATA_TYPES.GESTURE_STEP_COMPLETED,
      clientId: syncClient?.clientId,
      timestamp: Date.now(),
      stepIndex: idx,
      gestureName: gestureName,
      timerValue: timerValue,
    };
    syncCore?.safeBroadcast?.(stepCompletedPayload).catch((error) => {
      Logger.warn("同步下一步動作失敗:", error);
    });

    if (experimentLogManager) {
      const currentGesture = app?.currentCombination?.gestures?.[idx];
      const stepId = currentGesture?.step_id || null;
      experimentLogManager.logAction("next_step", idx, stepId);
      experimentLogManager.logGestureStepEnd(idx, stepId);
    }

    const totalGestures = app?.currentCombination?.gestures?.length || 0;
    const isLastStep = idx + 1 >= totalGestures;

    if (isLastStep) {
      const currentCard = document.getElementById(`gesture-card-${idx}`);
      if (currentCard) {
        currentCard.classList.remove(
          "gesture-card-active",
          "gesture-card-current",
        );
        currentCard.classList.add("gesture-card-inactive");
      }

      if (experimentLogManager) {
        experimentLogManager
          .flushAll()
          .then(() => {
            Logger.info("所有日誌已發送完成");

            const firstCard = document.getElementById("gesture-card-0");
            if (firstCard) {
              firstCard.scrollIntoView({ behavior: "smooth", block: "center" });

              setTimeout(() => {
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
            Logger.error("日誌發送失敗", error);
          });
      }
    }
  };

  return { activateGestureStep, markGesture, goToNextStep };
};
