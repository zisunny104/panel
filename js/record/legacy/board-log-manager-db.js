/**
 * LogManagerDbStore - IndexedDB 與本機日誌存取
 *
 * 集中處理 IndexedDB 初始化、讀寫與清除。
 */

export const logDbStore = {
  /**
   * 列出所有已儲存的實驗（從 IndexedDB）
   * @returns {Promise<Array>} 實驗列表
   */
  async listExperiments() {
    try {
      if (!this.db) {
        Logger.warn("IndexedDB 尚未初始化");
        return [];
      }

      const transaction = this.db.transaction(
        [this.pendingLogsStore],
        "readonly",
      );
      const store = transaction.objectStore(this.pendingLogsStore);
      const request = store.getAll();

      return new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
          const allLogs = event.target.result || [];

          // 按實驗 ID 分組
          const experimentsMap = new Map();

          allLogs.forEach((log) => {
            const expId = log.exp_id || "unknown";
            const participant = log.participant || `受試者_${expId}`;

            if (!experimentsMap.has(expId)) {
              experimentsMap.set(expId, {
                experimentId: expId,
                participantName: participant,
                startTime: null,
                endTime: null,
                logCount: 0,
                logs: [],
              });
            }

            const experiment = experimentsMap.get(expId);
            experiment.logs.push(log);
            experiment.logCount++;

            // 更新參與者名稱（使用最新的非空值）
            if (
              log.participant &&
              !experiment.participantName.startsWith("受試者_")
            ) {
              experiment.participantName = log.participant;
            }

            // 記錄開始和結束時間
            if (log.type === "exp_start" && !experiment.startTime) {
              experiment.startTime = log.ts;
            }
            if (log.type === "exp_end") {
              experiment.endTime = log.ts;
            }
          });

          // 轉換為陣列並排序（最新的在前）
          const experiments = Array.from(experimentsMap.values());
          experiments.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));

          Logger.debug(`從 IndexedDB 載入 ${experiments.length} 個實驗`);

          // 調試資訊：列出所有實驗ID
          if (experiments.length > 0) {
            Logger.debug(
              `實驗ID列表: ${experiments
                .map((e) => `${e.experimentId}(${e.logCount}條)`)
                .join(", ")}`,
            );
          }

          resolve(experiments);
        };

        request.onerror = (event) => {
          Logger.error("列出實驗失敗:", event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      Logger.error("listExperiments 發生錯誤:", error);
      return [];
    }
  },

  /**
   * 取得所有日誌（包含記憶體和 IndexedDB 的）
   * @returns {Promise<Array>} 所有日誌
   */
  async getAllLogs() {
    try {
      if (!this.db) {
        Logger.warn("IndexedDB 尚未初始化，僅回傳記憶體中的日誌");
        return [...this.logs, ...this.pendingLogs];
      }

      const transaction = this.db.transaction(
        [this.pendingLogsStore],
        "readonly",
      );
      const store = transaction.objectStore(this.pendingLogsStore);
      const request = store.getAll();

      return new Promise((resolve) => {
        request.onsuccess = (event) => {
          const storedLogs = event.target.result || [];
          // 合併記憶體和儲存的日誌
          const allLogs = [...this.logs, ...this.pendingLogs, ...storedLogs];
          // 按時間戳排序
          allLogs.sort((a, b) => a.ts - b.ts);
          resolve(allLogs);
        };

        request.onerror = (event) => {
          Logger.error("讀取所有日誌失敗:", event.target.error);
          // 發生錯誤時至少回傳記憶體中的日誌
          resolve([...this.logs, ...this.pendingLogs]);
        };
      });
    } catch (error) {
      Logger.error("getAllLogs 發生錯誤:", error);
      return [...this.logs, ...this.pendingLogs];
    }
  },

  /**
   * 根據實驗 ID 取得日誌
   * @param {string} experimentId - 實驗 ID
   * @returns {Promise<Array>} 該實驗的所有日誌
   */
  async getLogsByExperimentId(experimentId) {
    try {
      const allLogs = await this.getAllLogs();
      return allLogs.filter(
        (log) =>
          log.exp_id === experimentId || log.experimentId === experimentId,
      );
    } catch (error) {
      Logger.error(`取得實驗 ${experimentId} 的日誌失敗:`, error);
      return [];
    }
  },

  /**
   * 根據實驗 ID 取得日誌（別名，供 UI 使用）
   * @param {string} experimentId - 實驗 ID
   * @returns {Promise<Array>} 該實驗的所有日誌
   */
  async getLogsByExperiment(experimentId) {
    return this.getLogsByExperimentId(experimentId);
  },

  /**
   * 刪除指定實驗的所有日誌（從 IndexedDB）
   * @param {string} experimentId - 實驗 ID
   * @returns {Promise<boolean>} 是否成功
   */
  async deleteExperiment(experimentId) {
    try {
      if (!this.db) {
        Logger.warn("IndexedDB 尚未初始化");
        return false;
      }

      const transaction = this.db.transaction(
        [this.pendingLogsStore],
        "readwrite",
      );
      const store = transaction.objectStore(this.pendingLogsStore);

      // 先取得所有日誌
      const getAllRequest = store.getAll();

      return new Promise((resolve, reject) => {
        getAllRequest.onsuccess = (event) => {
          const allLogs = event.target.result || [];

          // 過濾出要刪除的日誌
          const logsToDelete = allLogs.filter(
            (log) =>
              log.exp_id === experimentId || log.experimentId === experimentId,
          );

          if (logsToDelete.length === 0) {
            Logger.warn(`沒有找到實驗 ${experimentId} 的日誌`);
            resolve(true);
            return;
          }

          // 刪除每一條日誌
          let deletedCount = 0;
          logsToDelete.forEach((log, index) => {
            const deleteRequest = store.delete(log.id || index);

            deleteRequest.onsuccess = () => {
              deletedCount++;
              if (deletedCount === logsToDelete.length) {
                Logger.info(
                  `已刪除實驗 ${experimentId} 的 ${deletedCount} 條日誌`,
                );
                // 廣播刪除事件
                this._broadcastMessage("experimentDeleted", { experimentId });
                resolve(true);
              }
            };

            deleteRequest.onerror = (e) => {
              Logger.error("刪除日誌失敗:", e.target.error);
              reject(e.target.error);
            };
          });
        };

        getAllRequest.onerror = (event) => {
          Logger.error("讀取日誌失敗:", event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      Logger.error(`刪除實驗 ${experimentId} 失敗:`, error);
      return false;
    }
  },

  /**
   * 初始化 IndexedDB
   * @private
   */
  _initIndexedDB() {
    Logger.debug("開始初始化 IndexedDB");

    try {
      if (!window.indexedDB) {
        Logger.warn("IndexedDB 不支援，日誌將只存在記憶體中 (離線時可能遺失)");
        this.db = null;
        return;
      }

      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = (event) => {
        Logger.error("IndexedDB 初始化失敗:", event.target.error);
        this.db = null;
        Logger.warn("將使用記憶體儲存日誌，離線時可能遺失");
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        Logger.debug("IndexedDB 初始化成功");
        this._restorePendingLogsFromIndexedDB();
      };

      request.onupgradeneeded = (event) => {
        try {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(this.pendingLogsStore)) {
            const store = db.createObjectStore(this.pendingLogsStore, {
              keyPath: "id",
              autoIncrement: true,
            });
            store.createIndex("timestamp", "timestamp", { unique: false });
            Logger.info("建立 IndexedDB 儲存物件:", this.pendingLogsStore);
          }
        } catch (error) {
          Logger.error("IndexedDB 更新失敗:", error);
        }
      };
    } catch (error) {
      Logger.error("IndexedDB 初始化異常:", error);
      this.db = null;
      Logger.warn("將使用記憶體儲存日誌，離線時可能遺失");
    }
  },

  /**
   * 從 IndexedDB 還原待發送日誌
   * @private
   */
  _restorePendingLogsFromIndexedDB() {
    Logger.debug("開始從 IndexedDB 還原待發送日誌");

    try {
      if (!this.db) {
        Logger.debug("IndexedDB 未初始化，跳過還原");
        return;
      }

      const transaction = this.db.transaction(
        [this.pendingLogsStore],
        "readonly",
      );
      const store = transaction.objectStore(this.pendingLogsStore);
      const request = store.getAll();

      request.onsuccess = (event) => {
        try {
          const storedLogs = event.target.result;
          Logger.debug(`從 IndexedDB 取得 ${storedLogs.length} 條待發送日誌`);
          if (storedLogs && storedLogs.length > 0) {
            const getLogTime = (log) =>
              log?.ts ?? log?.savedAt ?? log?.timestamp ?? 0;
            storedLogs.sort((a, b) => getLogTime(a) - getLogTime(b));
            this.pendingLogs = storedLogs;
            Logger.debug(`已還原 ${storedLogs.length} 條待發送日誌到記憶體`);
          } else {
            Logger.debug("IndexedDB 中沒有已儲存的日誌");
          }
        } catch (error) {
          Logger.error("還原日誌時發生錯誤:", error);
        }
      };

      request.onerror = (event) => {
        Logger.error("從 IndexedDB 還原日誌失敗:", event.target.error);
      };
    } catch (error) {
      Logger.error("IndexedDB 還原異常:", error);
    }
  },

  /**
   * 儲存日誌到 IndexedDB
   * @param {Object} logEntry - 日誌條目
   * @private
   */
  _saveLogToIndexedDB(logEntry) {
    try {
      if (!this.db) return;

      const transaction = this.db.transaction(
        [this.pendingLogsStore],
        "readwrite",
      );
      const store = transaction.objectStore(this.pendingLogsStore);
      const request = store.add(logEntry);

      request.onsuccess = () => {
        Logger.debug("日誌儲存到 IndexedDB 成功");
      };

      request.onerror = (event) => {
        Logger.error("儲存日誌到 IndexedDB 失敗:", event.target.error);
      };
    } catch (error) {
      Logger.error("儲存日誌到 IndexedDB 異常:", error);
    }
  },

  /**
   * 從 IndexedDB 刪除已發送的日誌
   * @param {Array} sentLogs - 已發送的日誌數組
   * @private
   */
  _removeLogsFromIndexedDB(sentLogs) {
    try {
      if (!this.db || !sentLogs || sentLogs.length === 0) return;

      const transaction = this.db.transaction(
        [this.pendingLogsStore],
        "readwrite",
      );
      const store = transaction.objectStore(this.pendingLogsStore);

      sentLogs.forEach((log) => {
        if (log.id) {
          const request = store.delete(log.id);
          request.onerror = (event) => {
            Logger.error("從 IndexedDB 刪除日誌失敗:", event.target.error);
          };
        }
      });

      Logger.debug(`從 IndexedDB 刪除 ${sentLogs.length} 條已發送日誌`);
    } catch (error) {
      Logger.error("刪除日誌異常:", error);
    }
  },

  /**
   * 從 IndexedDB 刪除指定實驗的日誌
   * @param {string} experimentId - 實驗 ID
   * @private
   */
  async _removeLogsByExperimentIdFromIndexedDB(experimentId) {
    if (!this.db || !experimentId) return;

    try {
      const transaction = this.db.transaction(
        [this.pendingLogsStore],
        "readwrite",
      );
      const store = transaction.objectStore(this.pendingLogsStore);
      const request = store.getAll();

      await new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
          const allLogs = event.target.result || [];
          const logsToDelete = allLogs.filter(
            (log) => log.exp_id === experimentId,
          );
          if (logsToDelete.length === 0) {
            resolve();
            return;
          }

          let deletedCount = 0;
          logsToDelete.forEach((log) => {
            const deleteRequest = store.delete(log.id);
            deleteRequest.onsuccess = () => {
              deletedCount++;
              if (deletedCount === logsToDelete.length) {
                Logger.debug(
                  `已清除 IndexedDB 中實驗 ${experimentId} 的 ${deletedCount} 筆日誌`,
                );
                resolve();
              }
            };
            deleteRequest.onerror = (e) => {
              Logger.error("刪除 IndexedDB 日誌失敗:", e.target.error);
              reject(e.target.error);
            };
          });
        };

        request.onerror = (event) => {
          Logger.error("讀取 IndexedDB 日誌失敗:", event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      Logger.error("清除 IndexedDB 日誌失敗:", error);
    }
  },

  /**
   * 清空 IndexedDB 中的所有待發送日誌
   * @private
   */
  _clearIndexedDB() {
    if (!this.db) return;

    const transaction = this.db.transaction(
      [this.pendingLogsStore],
      "readwrite",
    );
    const store = transaction.objectStore(this.pendingLogsStore);
    const request = store.clear();

    request.onsuccess = () => {
      Logger.debug("IndexedDB 已清空");
      this._broadcastMessage("logsCleared", {});
    };

    request.onerror = (event) => {
      Logger.error("清空 IndexedDB 失敗:", event.target.error);
    };
  },
};
