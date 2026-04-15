/**
 * recordStore - IndexedDB 儲存層
 *
 * 集中處理 IndexedDB 初始化、讀寫與清除。
 * 作為 mixin 混入 RecordManager。
 */

export const recordStore = {
  /**
   * 列出所有已儲存的實驗（從 IndexedDB）
   * @returns {Promise<Array>}
   */
  async listExperiments() {
    try {
      if (!this.db) {
        Logger.warn("IndexedDB 尚未初始化");
        return [];
      }

      const transaction = this.db.transaction([this.pendingLogsStore], "readonly");
      const store = transaction.objectStore(this.pendingLogsStore);
      const request = store.getAll();

      return new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
          const allLogs = event.target.result || [];
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

            if (log.participant && !experiment.participantName.startsWith("受試者_")) {
              experiment.participantName = log.participant;
            }
            if (log.type === "exp_start" && !experiment.startTime) {
              experiment.startTime = log.ts;
            }
            if (log.type === "exp_end") {
              experiment.endTime = log.ts;
            }
          });

          const experiments = Array.from(experimentsMap.values());
          experiments.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
          Logger.debug(`從 IndexedDB 載入 ${experiments.length} 個實驗`);
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
   * 取得所有日誌（記憶體 + IndexedDB）
   * @returns {Promise<Array>}
   */
  async getAllLogs() {
    try {
      if (!this.db) {
        Logger.warn("IndexedDB 尚未初始化，僅回傳記憶體中的日誌");
        return [...this.logs, ...this.pendingLogs];
      }

      const transaction = this.db.transaction([this.pendingLogsStore], "readonly");
      const store = transaction.objectStore(this.pendingLogsStore);
      const request = store.getAll();

      return new Promise((resolve) => {
        request.onsuccess = (event) => {
          const storedLogs = event.target.result || [];
          const allLogs = [...this.logs, ...this.pendingLogs, ...storedLogs];
          allLogs.sort((a, b) => a.ts - b.ts);
          resolve(allLogs);
        };
        request.onerror = () => resolve([...this.logs, ...this.pendingLogs]);
      });
    } catch (error) {
      Logger.error("getAllLogs 發生錯誤:", error);
      return [...this.logs, ...this.pendingLogs];
    }
  },

  /**
   * 根據實驗 ID 取得日誌
   * @param {string} experimentId
   * @returns {Promise<Array>}
   */
  async getLogsByExperimentId(experimentId) {
    const allLogs = await this.getAllLogs();
    return allLogs.filter(
      (log) => log.exp_id === experimentId || log.experimentId === experimentId,
    );
  },

  /** 別名 */
  async getLogsByExperiment(experimentId) {
    return this.getLogsByExperimentId(experimentId);
  },

  /**
   * 刪除指定實驗的所有日誌
   * @param {string} experimentId
   * @returns {Promise<boolean>}
   */
  async deleteExperiment(experimentId) {
    try {
      if (!this.db) return false;

      const transaction = this.db.transaction([this.pendingLogsStore], "readwrite");
      const store = transaction.objectStore(this.pendingLogsStore);
      const getAllRequest = store.getAll();

      return new Promise((resolve, reject) => {
        getAllRequest.onsuccess = (event) => {
          const logsToDelete = (event.target.result || []).filter(
            (log) => log.exp_id === experimentId || log.experimentId === experimentId,
          );

          if (logsToDelete.length === 0) {
            resolve(true);
            return;
          }

          let deletedCount = 0;
          logsToDelete.forEach((log, index) => {
            const deleteRequest = store.delete(log.id || index);
            deleteRequest.onsuccess = () => {
              if (++deletedCount === logsToDelete.length) {
                Logger.info(`已刪除實驗 ${experimentId} 的 ${deletedCount} 條日誌`);
                this._broadcastMessage("experimentDeleted", { experimentId });
                resolve(true);
              }
            };
            deleteRequest.onerror = (e) => reject(e.target.error);
          });
        };
        getAllRequest.onerror = (event) => reject(event.target.error);
      });
    } catch (error) {
      Logger.error(`刪除實驗 ${experimentId} 失敗:`, error);
      return false;
    }
  },

  // ─── IndexedDB 內部方法 ────────────────────────────────────────────────────

  _initIndexedDB() {
    if (!window.indexedDB) {
      Logger.warn("IndexedDB 不支援，日誌將只存在記憶體中");
      this.db = null;
      return;
    }

    const request = indexedDB.open(this.dbName, this.dbVersion);

    request.onerror = (event) => {
      Logger.error("IndexedDB 初始化失敗:", event.target.error);
      this.db = null;
    };

    request.onsuccess = (event) => {
      this.db = event.target.result;
      Logger.debug("IndexedDB 初始化成功");
      this._restorePendingLogsFromIndexedDB();
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(this.pendingLogsStore)) {
        const objectStore = db.createObjectStore(this.pendingLogsStore, {
          keyPath: "id",
          autoIncrement: true,
        });
        objectStore.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
  },

  _restorePendingLogsFromIndexedDB() {
    if (!this.db) return;

    const transaction = this.db.transaction([this.pendingLogsStore], "readonly");
    const store = transaction.objectStore(this.pendingLogsStore);
    const request = store.getAll();

    request.onsuccess = (event) => {
      const storedLogs = event.target.result || [];
      if (storedLogs.length > 0) {
        const getLogTime = (log) => log?.ts ?? log?.savedAt ?? log?.timestamp ?? 0;
        storedLogs.sort((a, b) => getLogTime(a) - getLogTime(b));
        this.pendingLogs = storedLogs;
        Logger.debug(`已還原 ${storedLogs.length} 條待發送日誌`);
      }
    };
    request.onerror = (event) => {
      Logger.error("從 IndexedDB 還原日誌失敗:", event.target.error);
    };
  },

  _saveLogToIndexedDB(logEntry) {
    if (!this.db) return;
    const transaction = this.db.transaction([this.pendingLogsStore], "readwrite");
    const store = transaction.objectStore(this.pendingLogsStore);
    store.add(logEntry).onerror = (event) => {
      Logger.error("儲存日誌到 IndexedDB 失敗:", event.target.error);
    };
  },

  /**
   * 從 IndexedDB 刪除已發送的日誌（根據 id 欄位逐一刪除）
   * @param {Array} sentLogs - 已完成發送的日誌物件陣列（需含 id 欄位）
   */
  _removeLogsFromIndexedDB(sentLogs) {
    if (!this.db || !sentLogs?.length) return;
    const transaction = this.db.transaction([this.pendingLogsStore], "readwrite");
    const store = transaction.objectStore(this.pendingLogsStore);
    sentLogs.forEach((log) => {
      if (log.id) store.delete(log.id);
    });
  },

  async _removeLogsByExperimentIdFromIndexedDB(experimentId) {
    if (!this.db || !experimentId) return;

    const transaction = this.db.transaction([this.pendingLogsStore], "readwrite");
    const store = transaction.objectStore(this.pendingLogsStore);
    const request = store.getAll();

    await new Promise((resolve, reject) => {
      request.onsuccess = (event) => {
        const logsToDelete = (event.target.result || []).filter(
          (log) => log.exp_id === experimentId,
        );
        if (logsToDelete.length === 0) { resolve(); return; }

        let deletedCount = 0;
        logsToDelete.forEach((log) => {
          const req = store.delete(log.id);
          req.onsuccess = () => {
            if (++deletedCount === logsToDelete.length) {
              Logger.debug(`已清除 IndexedDB 中實驗 ${experimentId} 的 ${deletedCount} 筆日誌`);
              resolve();
            }
          };
          req.onerror = (e) => reject(e.target.error);
        });
      };
      request.onerror = (event) => reject(event.target.error);
    }).catch((err) => Logger.error("清除 IndexedDB 日誌失敗:", err));
  },

  _clearIndexedDB() {
    if (!this.db) return;
    const transaction = this.db.transaction([this.pendingLogsStore], "readwrite");
    const store = transaction.objectStore(this.pendingLogsStore);
    store.clear().onsuccess = () => {
      Logger.debug("IndexedDB 已清空");
      this._broadcastMessage("logsCleared", {});
    };
  },
};
