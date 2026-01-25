/**
 * PanelExperimentUnits - 面板實驗單元管理器
 *
 * 負責單元載入、選擇、組合應用等單元相關功能
 * 專門處理實驗單元的資料管理和操作邏輯
 */
class PanelExperimentUnits {
  constructor(manager) {
    this.manager = manager; // 引用到主管理器
  }

  /**
   * 取得選擇的單元
   */
  getSelectedUnits() {
    const selectedUnits = [];
    const unitCheckboxes = document.querySelectorAll(
      "input[name=\"unitCheckbox\"]:checked"
    );

    unitCheckboxes.forEach((checkbox) => {
      const unitId = checkbox.value;
      const unit = this.findUnitById(unitId);
      if (unit) {
        selectedUnits.push(unit);
      }
    });

    return selectedUnits;
  }

  /**
   * 根據ID尋找單元
   */
  findUnitById(unitId) {
    if (!window.unitsData) {
      Logger.warn("unitsData 未載入");
      return null;
    }

    return window.unitsData.find((unit) => unit.unit_id === unitId);
  }

  /**
   * 開始第一個單元
   */
  startFirstUnit() {
    const firstUnit = this.manager.loadedUnits[0];
    if (!firstUnit) {
      Logger.warn("沒有第一個單元");
      return;
    }

    Logger.info(`開始第一個單元: ${firstUnit.unit_name}`);

    // 記錄日誌
    if (window.logger) {
      window.logger.logAction(
        `開始單元: ${firstUnit.unit_name}`,
        "unit_start",
        firstUnit.unit_id,
        false,
        false
      );
    }

    // 顯示單元媒體（如果有）
    if (firstUnit.media_path) {
      this.manager.displayMedia(firstUnit.media_path);
    }

    // 如果單元有自動開始的設定，開始執行步驟
    if (firstUnit.auto_start !== false) {
      // 延遲一下再開始第一步，確保媒體已載入
      setTimeout(() => {
        this.manager.flow.nextStep();
      }, 500);
    }
  }

  /**
   * 切換全選單元
   */
  toggleSelectAllUnits(checked) {
    const unitCheckboxes = document.querySelectorAll(
      "input[name=\"unitCheckbox\"]"
    );

    unitCheckboxes.forEach((checkbox) => {
      checkbox.checked = checked;
    });

    Logger.debug(`${checked ? "全選" : "取消全選"}所有單元`);

    // 更新UI
    this.manager.ui.updateUnitSelectionUI();
  }

  /**
   * 應用單元組合
   */
  applyUnitCombination(combination) {
    if (!combination) {
      Logger.warn("無效的組合");
      return;
    }

    Logger.debug(`應用單元組合: ${combination.combination_name}`);

    // 更新當前組合
    this.manager.currentCombination = combination;

    // 取得組合中的單元ID列表
    const unitIds = combination.units || [];

    // 更新UI中的單元選擇
    this.updateUnitSelectionForCombination(unitIds);

    // 記錄日誌
    if (window.logger) {
      window.logger.logAction(
        `套用組合: ${combination.combination_name}`,
        "combination_applied",
        combination.combination_id,
        false,
        false
      );
    }

    Logger.debug("單元組合應用完成");
  }

  /**
   * 根據組合更新單元選擇
   */
  updateUnitSelectionForCombination(unitIds) {
    // 取消所有單元的選擇
    const allCheckboxes = document.querySelectorAll(
      "input[name=\"unitCheckbox\"]"
    );
    allCheckboxes.forEach((checkbox) => {
      checkbox.checked = false;
    });

    // 選擇組合中的單元
    unitIds.forEach((unitId) => {
      const checkbox = document.querySelector(
        `input[name="unitCheckbox"][value="${unitId}"]`
      );
      if (checkbox) {
        checkbox.checked = true;
      }
    });

    // 更新全選checkbox狀態
    this.updateSelectAllCheckboxState();

    // 更新UI
    this.manager.ui.updateUnitSelectionUI();
  }

  /**
   * 從 scenarios.json 載入單元並渲染排序功能
   */
  async renderUnitList() {
    try {
      const data = await loadUnitsFromScenarios();
      const unitList = document.querySelector(".experiment-units-list");
      if (!unitList) return;

      // 清空列表
      unitList.innerHTML = "";

      // 首先新增開機卡片到最前面
      this.addStartupCard(unitList);

      if (data && Array.isArray(data.units)) {
        data.units.forEach((unit) => {
          const li = this.createUnitListItem(unit);
          unitList.appendChild(li);
        });

        // 新增關機卡片到底部
        this.addShutdownCard(unitList);

        this.enableUnitDragSort(unitList);
        this.updateSelectAllState();
        this.updateAllUnitButtonStates();
      } else {
        const errorLi = document.createElement("li");
        errorLi.style.color = "red";
        errorLi.textContent =
          "scenarios.json 格式錯誤，請確認內容為 { units: [...] }。";
        unitList.appendChild(errorLi);
      }
    } catch (err) {
      const unitList = document.querySelector(".experiment-units-list");
      if (unitList) {
        const errorLi = document.createElement("li");
        errorLi.style.color = "red";
        errorLi.textContent = err.message;
        unitList.appendChild(errorLi);
      }
    }
  }

  /** 新增開機卡片到列表頂部 */
  addStartupCard(unitList) {
    const startupCard = document.createElement("li");
    startupCard.className = "power-option-card startup-card";
    startupCard.innerHTML = `
            <label class="unit-checkbox">
                <input type="checkbox" id="includeStartup" checked>
            </label>
            <div class="unit-sort">
                <div class="power-option-title">機器開機</div>
                <div class="power-option-subtitle">POWER_ON • 開始實驗前先開機</div>
            </div>
        `;
    unitList.appendChild(startupCard);

    // 重新綁定開機選項事件
    const includeStartup = startupCard.querySelector("#includeStartup");
    if (includeStartup) {
      includeStartup.addEventListener("change", (e) => {
        this.manager.includeStartup = e.target.checked;
      });
    }
  }

  /** 新增關機卡片到列表底部 */
  addShutdownCard(unitList) {
    const shutdownCard = document.createElement("li");
    shutdownCard.className = "power-option-card shutdown-card";
    shutdownCard.innerHTML = `
            <label class="unit-checkbox">
                <input type="checkbox" id="includeShutdown" checked>
            </label>
            <div class="unit-sort">
                <div class="power-option-title">機器關機</div>
                <div class="power-option-subtitle">POWER_OFF • 完成關機才結束實驗</div>
            </div>
        `;
    unitList.appendChild(shutdownCard);

    // 重新綁定關機選項事件
    const includeShutdown = shutdownCard.querySelector("#includeShutdown");
    if (includeShutdown) {
      includeShutdown.addEventListener("change", (e) => {
        this.manager.includeShutdown = e.target.checked;
      });
    }
  }

  /** 建立單元列表項目 */
  createUnitListItem(unit) {
    const li = document.createElement("li");
    li.dataset.unitId = unit.unit_id;

    // 勾選框
    const label = document.createElement("label");
    label.className = "unit-checkbox";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "unitCheckbox";
    checkbox.value = unit.unit_id;
    checkbox.checked = true;
    checkbox.addEventListener("change", () => this.updateSelectAllState());
    label.appendChild(checkbox);
    li.appendChild(label);

    // 單元名稱
    const unitInfo = document.createElement("div");
    unitInfo.className = "unit-sort";
    unitInfo.innerHTML = `
            <div class="unit-info-title">${unit.unit_name || unit.unit_id}</div>
            <div class="unit-info-subtitle">${unit.unit_id} • ${
              unit.steps ? unit.steps.length : 0
            } 步驟</div>
        `;
    li.appendChild(unitInfo);

    // 控制按鈕組
    const controlsGroup = document.createElement("div");
    controlsGroup.className = "unit-controls";

    // 上移按鈕
    const upBtn = document.createElement("button");
    upBtn.className = "unit-sort-btn unit-up-btn";
    upBtn.title = "上移";
    upBtn.innerHTML = "▲";
    upBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.moveUnit(li, -1);
    });
    controlsGroup.appendChild(upBtn);

    // 下移按鈕
    const downBtn = document.createElement("button");
    downBtn.className = "unit-sort-btn unit-down-btn";
    downBtn.title = "下移";
    downBtn.innerHTML = "▼";
    downBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.moveUnit(li, 1);
    });
    controlsGroup.appendChild(downBtn);

    // 拖曳排序
    const dragHandle = document.createElement("span");
    dragHandle.className = "unit-drag-handle";
    dragHandle.title = "拖曳排序";
    dragHandle.innerHTML = "⋮⋮";
    dragHandle.style.cursor = "grab";
    controlsGroup.appendChild(dragHandle);

    li.appendChild(controlsGroup);

    this.updateUnitButtonStates(li);

    return li;
  }

  /** 上下移動單元 */
  moveUnit(li, direction) {
    const list = li.parentElement;

    // 取得所有普通單元項目（排除電源卡片）
    const normalItems = Array.from(list.children).filter(
      (item) => !item.classList.contains("power-option-card")
    );

    const idx = normalItems.indexOf(li);
    if (idx === -1) return; // 如果不是普通單元項目，則不處理

    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= normalItems.length) return;

    const targetItem = normalItems[newIdx];

    if (direction === -1) {
      // 上移：插入到目標項目之前
      list.insertBefore(li, targetItem);
    } else {
      // 下移：插入到目標項目之後
      list.insertBefore(li, targetItem.nextSibling);
    }

    this.updateAllUnitButtonStates();
    // 移除重複的單元移動日誌
  }

  /** 啟用拖曳排序功能 */
  enableUnitDragSort(unitList) {
    let draggedLi = null;
    let placeholder = null;

    // 只對普通單元項目啟用拖曳，排除電源卡片
    const handles = unitList.querySelectorAll(
      "li:not(.power-option-card) .unit-drag-handle"
    );
    handles.forEach((handle) => {
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        startDrag(handle, e.clientX, e.clientY);
      });
      handle.addEventListener("touchstart", (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        startDrag(handle, touch.clientX, touch.clientY);
      });
    });

    const startDrag = (handle, startX, startY) => {
      draggedLi = handle.closest("li");
      if (!draggedLi) return;
      placeholder = document.createElement("li");
      placeholder.className = "drag-placeholder";
      placeholder.style.height = `${draggedLi.offsetHeight}px`;
      const originalStyle = draggedLi.style.cssText;
      draggedLi.classList.add("dragging");
      draggedLi.style.position = "fixed";
      draggedLi.style.zIndex = "1000";
      draggedLi.style.pointerEvents = "none";
      draggedLi.style.width = `${draggedLi.offsetWidth}px`;
      draggedLi.style.left = `${startX - draggedLi.offsetWidth / 2}px`;
      draggedLi.style.top = `${startY - draggedLi.offsetHeight / 2}px`;
      draggedLi.setAttribute("data-original-style", originalStyle);
      draggedLi.parentNode.insertBefore(placeholder, draggedLi.nextSibling);
      handle.style.cursor = "grabbing";
      document.addEventListener("mousemove", onMouseDrag);
      document.addEventListener("mouseup", onMouseDrop);
      document.addEventListener("touchmove", onTouchDrag, { passive: false });
      document.addEventListener("touchend", onTouchDrop);
    };

    const onMouseDrag = (e) => {
      if (!draggedLi) return;
      updateDragPosition(e.clientX, e.clientY);
    };
    const onTouchDrag = (e) => {
      if (!draggedLi) return;
      e.preventDefault();
      const touch = e.touches[0];
      updateDragPosition(touch.clientX, touch.clientY);
    };
    const updateDragPosition = (clientX, clientY) => {
      draggedLi.style.left = `${clientX - draggedLi.offsetWidth / 2}px`;
      draggedLi.style.top = `${clientY - draggedLi.offsetHeight / 2}px`;

      // 只在普通單元項目之間進行排序，排除電源卡片
      const items = Array.from(unitList.children).filter(
        (item) => !item.classList.contains("power-option-card")
      );
      let insertBefore = null;

      for (let item of items) {
        if (item === draggedLi || item === placeholder) continue;
        const rect = item.getBoundingClientRect();
        const itemCenterY = rect.top + rect.height / 2;
        if (clientY < itemCenterY) {
          insertBefore = item;
          break;
        }
      }

      // 確保插入位置在開機卡片之後，關機卡片之前
      const startupCard = unitList.querySelector(".startup-card");
      const shutdownCard = unitList.querySelector(".shutdown-card");

      if (insertBefore) {
        // 如果插入位置是開機卡片之前，則插入到開機卡片之後
        if (insertBefore === startupCard) {
          unitList.insertBefore(placeholder, startupCard.nextSibling);
        } else {
          unitList.insertBefore(placeholder, insertBefore);
        }
      } else {
        // 如果沒有找到插入位置，插入到關機卡片之前
        if (shutdownCard) {
          unitList.insertBefore(placeholder, shutdownCard);
        } else {
          unitList.appendChild(placeholder);
        }
      }
    };
    const onMouseDrop = () => {
      endDrag();
    };
    const onTouchDrop = () => {
      endDrag();
    };
    const endDrag = () => {
      if (!draggedLi || !placeholder) return;
      document.removeEventListener("mousemove", onMouseDrag);
      document.removeEventListener("mouseup", onMouseDrop);
      document.removeEventListener("touchmove", onTouchDrag);
      document.removeEventListener("touchend", onTouchDrop);
      draggedLi.classList.remove("dragging");
      const originalStyle = draggedLi.getAttribute("data-original-style") || "";
      draggedLi.style.cssText = originalStyle;
      draggedLi.removeAttribute("data-original-style");
      placeholder.parentNode.insertBefore(draggedLi, placeholder);
      placeholder.remove();
      const handle = draggedLi.querySelector(".unit-drag-handle");
      if (handle) handle.style.cursor = "grab";
      // 移除拖曳排序日誌
      this.updateAllUnitButtonStates();
      draggedLi = null;
      placeholder = null;
    };
  }

  /** 全選/取消全選單元 */
  toggleSelectAllUnits(checked) {
    const unitList = document.querySelector(".experiment-units-list");
    if (!unitList) return;

    // 只對普通單元項目進行全選操作，排除電源卡片
    const normalItems = unitList.querySelectorAll("li:not(.power-option-card)");
    normalItems.forEach((li) => {
      const checkbox = li.querySelector("input[type=\"checkbox\"]");
      if (checkbox) {
        checkbox.checked = checked;
      }
    });

    // 移除全選操作日誌，這個操作不重要
  }

  /** 更新全選狀態 */
  updateSelectAllState() {
    const unitList = document.querySelector(".experiment-units-list");
    const selectAllCheckbox = document.getElementById("selectAllUnits");
    if (!unitList || !selectAllCheckbox) return;

    // 只考慮普通單元項目的勾選狀態，排除電源卡片
    const normalItems = unitList.querySelectorAll("li:not(.power-option-card)");
    const checkboxes = Array.from(normalItems)
      .map((li) => li.querySelector("input[type=\"checkbox\"]"))
      .filter((cb) => cb);
    const checkedBoxes = checkboxes.filter((cb) => cb.checked);

    if (checkboxes.length === 0) {
      selectAllCheckbox.indeterminate = false;
      selectAllCheckbox.checked = false;
    } else if (checkedBoxes.length === checkboxes.length) {
      selectAllCheckbox.indeterminate = false;
      selectAllCheckbox.checked = true;
    } else if (checkedBoxes.length > 0) {
      selectAllCheckbox.indeterminate = true;
      selectAllCheckbox.checked = false;
    } else {
      selectAllCheckbox.indeterminate = false;
      selectAllCheckbox.checked = false;
    }
  }

  /** 更新單個單元的按鈕狀態 */
  updateUnitButtonStates(li) {
    const list = li.parentElement;
    if (!list || li.classList.contains("power-option-card")) return;

    // 只考慮普通單元項目的位置
    const normalItems = Array.from(list.children).filter(
      (item) => !item.classList.contains("power-option-card")
    );

    const index = normalItems.indexOf(li);
    if (index === -1) return;

    const isFirst = index === 0;
    const isLast = index === normalItems.length - 1;
    const upBtn = li.querySelector(".unit-up-btn");
    const downBtn = li.querySelector(".unit-down-btn");
    if (upBtn) {
      upBtn.disabled = isFirst;
      upBtn.classList.toggle("disabled", isFirst);
    }
    if (downBtn) {
      downBtn.disabled = isLast;
      downBtn.classList.toggle("disabled", isLast);
    }
  }

  /** 更新所有單元的按鈕狀態 */
  updateAllUnitButtonStates() {
    const unitList = document.querySelector(".experiment-units-list");
    if (!unitList) return;

    // 只更新普通單元項目的按鈕狀態
    const normalItems = unitList.querySelectorAll("li:not(.power-option-card)");
    normalItems.forEach((li) => {
      this.updateUnitButtonStates(li);
    });
  }

  /**
   * 更新全選checkbox狀態
   */
  updateSelectAllCheckboxState() {
    const unitCheckboxes = document.querySelectorAll(
      "input[name=\"unitCheckbox\"]"
    );
    const checkedBoxes = document.querySelectorAll(
      "input[name=\"unitCheckbox\"]:checked"
    );
    const selectAllCheckbox = document.getElementById("selectAllUnits");

    if (selectAllCheckbox) {
      selectAllCheckbox.checked =
        unitCheckboxes.length > 0 &&
        checkedBoxes.length === unitCheckboxes.length;
      selectAllCheckbox.indeterminate =
        checkedBoxes.length > 0 && checkedBoxes.length < unitCheckboxes.length;
    }
  }

  /**
   * 處理組合選擇
   */
  handleCombinationSelection(combination) {
    if (!combination) {
      Logger.warn("無效的組合選擇");
      return;
    }

    Logger.debug(`處理組合選擇: ${combination.combination_name}`);

    // 應用組合到單元選擇
    this.applyUnitCombination(combination);

    // 更新組合選擇器UI
    if (window.combinationSelector) {
      window.combinationSelector.currentCombination = combination;
      window.combinationSelector.updateCombinationCardSelection(combination);
    }

    // 記錄日誌
    this.manager.logAction("combination_selected", {
      combination_name: combination.combination_name,
      combination_id: combination.combination_id,
      unit_count: combination.units?.length || 0,
      timestamp: new Date().toISOString()
    });

    Logger.debug("組合選擇處理完成");
  }

  /**
   * 重新隨機排列單元（用於隨機化組合）
   */
  reapplyRandomCombination() {
    if (
      this.manager.currentCombination &&
      this.manager.currentCombination.is_randomizable
    ) {
      Logger.debug("重新隨機排列單元組合");

      // 重新應用相同的隨機組合（會觸發重新隨機）
      this.applyUnitCombination(this.manager.currentCombination);

      // 記錄日誌
      if (window.logger) {
        const experimentId = this.manager.getCurrentExperimentId();
        window.logger.logAction(`ID變更(${experimentId})，重新隨機排列`);
      }
    }
  }

  /**
   * 檢查是否有選擇的單元
   */
  hasSelectedUnits() {
    const selectedCheckboxes = document.querySelectorAll(
      "input[name=\"unitCheckbox\"]:checked"
    );
    return selectedCheckboxes.length > 0;
  }

  /**
   * 取得選擇的單元數量
   */
  getSelectedUnitCount() {
    const selectedCheckboxes = document.querySelectorAll(
      "input[name=\"unitCheckbox\"]:checked"
    );
    return selectedCheckboxes.length;
  }

  /**
   * 載入選擇的單元
   */
  loadSelectedUnits() {
    const unitList = document.querySelector(".experiment-units-list");
    this.manager.loadedUnits = [];
    if (unitList) {
      // 只考慮普通單元項目，排除電源卡片
      Array.from(unitList.children).forEach((li) => {
        if (li.classList.contains("power-option-card")) return;

        const checkbox = li.querySelector("input[type=\"checkbox\"]");
        if (checkbox && checkbox.checked) {
          this.manager.loadedUnits.push(li.dataset.unitId);
        }
      });
    }
  }

  /**
   * 載入單元資料並開始實驗
   */
  async loadUnitsAndStart() {
    try {
      const data = await loadUnitsFromScenarios();
      window._allUnits = data.units;
      // 設定動作相關的全域變數
      window._allUnitsActionsMap = data.actions;
      window._allUnitsActionToStepMap = data.actionToStep;

      // 在資料載入完成後，初始化動作管理器
      if (window.actionManager && this.manager.isExperimentRunning) {
        try {
          const initialized =
            await window.actionManager.initializeFromExperiment();
          if (initialized) {
            Logger.debug(
              "實驗資料載入後已初始化動作序列，共",
              window.actionManager.currentActionSequence.length,
              "個動作"
            );

            //記錄第一個單元到 JSONL 實驗日誌
            if (
              window.panelExperimentLog &&
              this.manager.loadedUnits.length > 0
            ) {
              window.panelExperimentLog.logUnitChange(
                this.manager.loadedUnits[0],
                0,
                this.manager.loadedUnits.length
              );
            }

            //初始化完成後立即更新按鈕高亮和媒體
            // 顯示第一個教學動作的按鈕提示
            if (window.buttonManager) {
              window.buttonManager.updateMediaForCurrentAction();
            }
          }
        } catch (error) {
          Logger.error("資料載入後動作序列初始化失敗:", error);
        }
      }

      this.showExperimentWaitingState();
    } catch (error) {
      if (window.logger) {
        window.logger.logAction(`載入 scenarios.json 失敗: ${error.message}`);
      }
    }
  }

  /**
   * 顯示實驗等待狀態
   */
  showExperimentWaitingState() {
    if (!window._allUnits || this.manager.loadedUnits.length === 0) return;
    const unitId = this.manager.loadedUnits[this.manager.currentUnitIndex];
    const unit = window._allUnits.find((u) => u.unit_id === unitId);
    if (!unit) return;
    const step = unit.steps[this.manager.currentStepIndex];
    if (!step) return;

    // 顯示目前步驟的媒體內容和按鈕高亮
    this.manager.media.showCurrentStepMediaOrHome();
  }
}

// 匯出單元管理器類別（實例化時需要傳入manager）
window.PanelExperimentUnits = PanelExperimentUnits;
