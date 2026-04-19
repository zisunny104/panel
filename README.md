# 機台面板 - Panel

用於機台 MR（混合實境）教學的多裝置同步互動系統，包含 Panel（受試者端）與 Board（管理端）。

## 功能特色

- **多裝置同步**：以工作階段為核心，同步實驗狀態與操作事件
- **雙模式運作**：支援本機模式與同步協作模式，自動切換
- **即時通訊**：`WebSocket` + `REST API`，支援重連與離線佇列
- **工作階段分享**：透過分享代碼快速加入協作
- **紀錄系統**：Record 模組 + IndexedDB 緩衝 + JSONL 伺服器備份

## 技術堆疊

- **前端**：`Vanilla JavaScript` (`ES6+`)
- **即時通訊**：`WebSocket` + `REST API`
- **資料持久性**：`localStorage` + `sessionStorage` + `IndexedDB` + `SQLite`
- **樣式**：`CSS3` + 響應式設計（`Responsive Web Design`）
- **後端**：`Node.js` + `Express` + `SQLite`

## 文件

- [架構說明](docs/ARCHITECTURE.md) - 系統架構和設計文件
- [專案用語指南](docs/PROJECT_TERMINOLOGY_GUIDE.md) - 用語與翻譯規範

## 專案結構

```
panel/
├── index.html              # 主頁面(機台面板)
├── board.html              # 實驗頁面(實驗管理)
├── js/                     # JavaScript 模組
│   ├── core/              # 核心功能
│   ├── board/             # 實驗相關
│   ├── constants/         # 常數定義
│   ├── experiment/        # 實驗系統
│   ├── panel/             # 面板控制
│   ├── record/            # 日誌紀錄與檢視
│   ├── sync/              # 同步系統
│   └── ui/                # UI 元件
├── css/                   # 樣式表
├── data/                  # 設定資訊
├── assets/                # 資源檔案
├── docs/                  # 文件資料夾
├── runtime/               # 執行時資料（不上傳 GitHub）
│   ├── database/         # 資料庫檔案
│   ├── experiment-data/  # JSONL 實驗日誌
│   └── sessions/         # 工作階段檔案
└── server/                # Node.js 後端服務
```

## 開發者

謝祥紫 Xiang-zi Xie(@zisunny104)、GitHub Copilot

## 更新日誌

#### v2.5.0c67292 - 修正特殊狀態動作與冷卻補丁

- 修正特殊狀態動作流程，使用補丁方式妥協OAO
- 關閉不必要狀態還原，使用也補丁方式妥協

#### v2.5.917995b - 同步常數對齊與語法清理

- 舊版同步 key 完整移除
- 協議常數對齊 WS_PROTOCOL
- Board 骨架載入動畫
- CSS 語法修正
- 其他小清理

#### v2.5.2ec0f36 - 系統架構整理與實驗流程修正

- 同步系統與實驗系統全面補齊 `Logger` import，消除執行期 ReferenceError
- 建立 `EventEmitter` 基底類（`js/core/event-emitter.js`），四個實驗 Manager 共用事件系統，移除約 200 行重複程式碼
- 修正 `ExperimentCombinationManager` 跨模組耦合：改由 `panel-init.js` 直接接線，移除 `document.dispatchEvent` 繞道設計
- 實驗開始時第一個手勢步驟卡片現在正確套用高亮邊框（統一改由 `STARTED` 事件驅動，移除搶先執行的 `activateGestureStep(0)`）
- 實驗結束後手勢序列自動重置並捲回頂端（新增 `resetGestureSequence()`，統一三處呼叫點）
- `experiment-state-manager` 防禦性 Logger 語法統一為直接呼叫
- 移除文件中已刪除模組 `sync-session-store.js` 的殘留記錄

#### v2.5.56abddf - 紀錄與同步流程整理

- `record` 命名已全面對齊前端、後端、樣式與文件，移除舊版相容層與過時模組名
- Panel / Board 初始化流程收斂為單一路徑，減少重複綁定與補做式渲染
- 啟動時自動清除舊版瀏覽器儲存資料，避免舊 IndexedDB 與 localStorage 一直殘留
- 架構藍圖與版本資訊同步更新，維持文件與現況一致

#### v2.4.d3fdddb - 同步與流程收斂

- 統一 bootstrap 載入與版本化資源處理，入口頁改由共同初始化流程管理
- 動作完成 / 進入事件分離，board 與 panel 的同步責任更清楚，起始步驟可正確進入
- 關閉目前工作階段與 panel 本機關機分流，避免自動結束實驗帶到 board 端
- 日誌載入改為延後更新與分批讀取，並補強複製即時日誌與完成樣式

#### v2.3.f366c7b - 同步與模組化更新

- **ES 模組化**：面板與同步模組全面轉為 ES module，明確注入依賴並收斂全域狀態
- **初始化流程**：集中 PanelPageManager 初始化與依賴串接，統一 UI、同步與實驗管理入口
- **同步事件整理**：統一事件常數與廣播流程，跨裝置狀態更新更一致
- **日誌 UI 拆分**：日誌列表、篩選、統計與彈窗獨立模組，提升維護性
- **電源與流程細化**：電源動作完成同步與冷卻流程計算邏輯明確化

#### v2.2.bc0460d - 模組重構與清理

- **移除過時的模組文件**：刪除舊版 panel 實驗模組與重複工具文件
- **重構實驗管理架構**：從 board.html 獨立管理 experiment 模組，新增系統協調器
- **重構UI與樣式系統**：合併控制項模組，重構CSS結構
- **清理測試與文檔**：移除舊版測試規格，更新架構文檔

#### v2.1.5d6c7ea - 改進同步系統，強化後端功能

- **同步系統改進**：統一事件常數（SyncEvents）、新增 LOCAL 角色與斷線/還原流程
- **QR Code 系統改善**：相機排序/過濾、掃描器重試與偵錯資訊、QR Code 產生 target 支援
- **後端強化**：新增 /metrics、rate limiting、低頻 Session 驗證與心跳穩定性修正

#### v2.1.0a7dec8 - 同步系統架構完善

- **扁平化伺服端工作階段架構**：簡化資料結構與存取邏輯
- **後端服務調整**：WebSocket 心跳機制與 HTTP 心跳檢測協同運作
- **前端同步整合**：心跳檢測定時器與 WebSocket 狀態監視整合
- **日誌規範化**：統一日誌訊息格式與內容
- **專案用語規範化**：統一用語以提升可讀性與維護性

#### v2.0 - 後端架構重構

- **多裝置同步系統**：完整的 WebSocket 雙向通訊與工作階段管理
- **實驗管理平台**：分離式機台面板與研究者管理介面
- **即時資料同步**：跨裝置狀態同步與離線佇列處理
- **實驗日誌系統**：完整的 JSONL 格式日誌記錄與管理
- ** QR Code 分享機制**：快速工作階段分享與加入
- **版本管理系統**：自動化版本追蹤與更新
- **Node.js 後端服務**：Express + SQLite + WebSocket 完整架構
- **響應式設計**：支援多裝置的介面配置

#### v1.5.gv0tm - 階段性成果上傳

- 多裝置同步系統基礎實現
- 實驗日誌記錄和管理
- SSE 即時通訊機制
- QR Code 工作階段分享
- 版本管理系統
