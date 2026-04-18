/**
 * BoardGestureUtils - 實驗手勢標記與統計工具
 *
 * 提供手勢標記、步驟切換與統計相關的共用函式。
 */

import { SYNC_DATA_TYPES } from "../constants/index.js";

export const createBoardGestureUtils = function (deps) {
  const {
    pageManager,
    timerManager,
    syncClient,
    syncCore,
    recordManager,
  } = deps;

  const setActiveGestureCard = function (idx, { forceScroll = false } = {}) {
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

      if (forceScroll) {
        currentCard.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

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
  };

  const activateGestureStep = function (idx) {
    setActiveGestureCard(idx);

    if (timerManager) {
      const currentIdx = timerManager.currentActiveIndex;
      if (currentIdx !== null && currentIdx !== idx) {
        const currentState = timerManager.timerStates?.[currentIdx];
        if (currentState?.running) {
            timerManager.toggleIndexedTimer(currentIdx, { logPause: false });
        }
      }
      const nextState = timerManager.timerStates?.[idx];
      if (!nextState?.running) {
          timerManager.toggleIndexedTimer(idx, { logPause: false });
      }
    }
  };

  const focusGestureStep = function (idx) {
    setActiveGestureCard(idx, { forceScroll: true });
  };

  const markGesture = function (idx, status, gestureName) {
    const timerValue =
      document.getElementById(`timer-display-${idx}`)?.textContent ||
      "00:00.000";

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

    if (recordManager) {
      const gestureType =
        status === "correct" ? "t" : status === "uncertain" ? "n" : "f";
      const currentGesture = pageManager?.currentCombination?.gestures?.[idx];
      const stepId = currentGesture?.step_id || null;
      recordManager.logAction("gesture_marked", idx, stepId);
      recordManager.logGestureAttempt(idx, gestureType, stepId);
    }
  };

  const goToNextStep = function (idx, gestureName) {
    const timerValue =
      document.getElementById(`timer-display-${idx}`)?.textContent ||
      "00:00.000";

    if (timerManager?.timerStates?.[idx]?.running) {
      timerManager.toggleIndexedTimer(idx);
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

    if (recordManager) {
      const currentGesture = pageManager?.currentCombination?.gestures?.[idx];
      const stepId = currentGesture?.step_id || null;
      recordManager.logAction("next_step", idx, stepId);
      recordManager.logGestureStepEnd(idx, stepId);
    }

    const totalGestures = pageManager?.currentCombination?.gestures?.length || 0;
    const isLastStep = idx + 1 >= totalGestures;

    if (!isLastStep) {
      focusGestureStep(idx + 1);
    }

    if (isLastStep) {
      const currentCard = document.getElementById(`gesture-card-${idx}`);
      if (currentCard) {
        currentCard.classList.remove(
          "gesture-card-active",
          "gesture-card-current",
        );
        currentCard.classList.add("gesture-card-inactive");
      }

      const scrollToExperimentControls = () => {
        const experimentControls = document.getElementById(
          "experimentControlsContainer",
        );
        if (experimentControls) {
          experimentControls.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }

        const fallbackSection = document.querySelector(
          ".left-panel .input-section",
        );
        if (fallbackSection) {
          fallbackSection.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }
      };

      // 最後一步完成後，回到實驗控制區。
      setTimeout(scrollToExperimentControls, 300);

      if (recordManager) {
        recordManager
          .flushPendingLogs()
          .then(() => {
            Logger.info("手勢步驟日誌已同步 flush");
          })
          .catch((error) => {
            Logger.error("日誌發送失敗", error);
          });
      }
    }
  };

  const resetGestureSequence = function () {
    document.querySelectorAll("[id^='gesture-card-']").forEach((card) => {
      card.classList.remove("gesture-card-active", "gesture-card-current");
      card.classList.add("gesture-card-inactive");
    });

    const rightPanel = document.querySelector(".right-panel");
    if (rightPanel) {
      rightPanel.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return { activateGestureStep, markGesture, goToNextStep, resetGestureSequence };
};
