# 機台面板 - Panel

一個用於多裝置同步 MR（混合實境）機台教學互動系統的虛擬面板。

## 功能特色

- **多裝置同步**：支援多個客戶端即時同步實驗狀態
- **本機/同步模式**：自動判斷是否啟用同步功能
- **即時通訊**：基於 Server-Sent Events (SSE) 的雙向通訊
- **QR Code 分享**：快速分享工作階段
- **實驗日誌**：完整的實驗資訊記錄和管理

## 技術堆疊

- **前端**：Vanilla JavaScript (ES6+)
- **即時通訊**：WebSocket + REST API
- **資料持久性**：sessionStorage + Server-side session
- **樣式**：CSS3 + 響應式設計
- **後端**：Node.js + Express + SQLite

## 文件

- [架構說明](docs/ARCHITECTURE.md) - 系統架構和設計文件

## 專案結構

```
panel/
├── index.html              # 主頁面(機台面板)
├── experiment.html         # 實驗頁面(實驗管理)
├── js/                     # JavaScript 模組
│   ├── core/              # 核心功能
│   ├── experiment/        # 實驗相關
│   ├── panel/             # 面板控制
│   ├── power/             # 電源控制
│   ├── sync/              # 同步系統
│   └── ui/                # UI 組件
├── css/                   # 樣式表
├── data/                  # 設定資訊
├── assets/                # 資源檔案
├── docs/                  # 文件資料夾
├── runtime/               # 執行時資料（不上傳 GitHub）
│   ├── database/         # 資料庫檔案
│   └── sessions/         # 工作階段檔案
└── server/                # Node.js 後端服務
```

## 開發者

謝祥紫 Xiang-zi Xie(@zisunny104)、Github Copilot

## 版本

**2.1.0a7dec8** (2026-01-22)

### 更新日誌

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
- **QR Code 分享機制**：快速工作階段分享與加入
- **版本管理系統**：自動化版本追蹤與更新
- **Node.js 後端服務**：Express + SQLite + WebSocket 完整架構
- **響應式設計**：支援多裝置的介面配置

#### v1.5.gv0tm - 階段性成果上傳

- 多裝置同步系統基礎實現
- 實驗日誌記錄和管理
- SSE 即時通訊機制
- QR Code 工作階段分享
- 版本管理系統
