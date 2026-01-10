/**
 * 資料庫設定
 */
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const DATABASE_CONFIG = {
  // 資料庫檔案路徑（相對於server目錄）
  path: process.env.DB_PATH || resolve(__dirname, "../../data/experiment.db"),

  // SQLite設定選項
  options: {
    // WAL模式：允許並發讀取
    enableWAL: true,

    // NORMAL同步：平衡性能和安全性
    synchronous: "NORMAL",

    // 快取大小：64MB
    cacheSize: -64000,

    // 開啟外鍵約束
    foreignKeys: true,

    // 自動清空（checkpoint）WAL檔案
    walAutoCheckpoint: 1000,
  },
};
