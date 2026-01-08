<?php

/**
 * 同步系統API - PHP後端
 * 提供多裝置同步工作階段管理和狀態同步功能
 */

// 配置常數
define('SESSION_WITH_CHECKSUM', false);     // 工作階段ID是否使用檢查碼 (true: 有, false: 無)
define('SHARE_CODE_WITH_CHECKSUM', true);   // 分享代碼是否使用檢查碼 (true: 有, false: 無)

// 開啟輸出暫存
ob_start();

// 設定錯誤報告（開發環境）
error_reporting(E_ALL);
ini_set('display_errors', '0'); // 不直接顯示錯誤
ini_set('log_errors', '1'); // 記錄到日誌

// 設定 JSON 響應標頭
header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

/**
 * 同步系統類
 */
class SyncSystem
{
    private $sessionsPath;
    private $shareCodesPath;
    private $sessionTimeout = 1800; // 30分鐘過期
    private $inactiveTimeout = 600; // 10分鐘無活動自動清理
    private $shareCodeTimeout = 300; // 分享代碼 5分鐘過期
    private $maxClients = 6; // 單一工作階段最多6個裝置
    private $validCreateCode = '113151006'; // 有效的建立代碼
    private $cleanupCheckInterval = 120; // 檢查清理間隔 120 秒（建立新項目時檢查）

    public function __construct()
    {
        $this->sessionsPath = __DIR__ . '/../sessions/';
        $this->shareCodesPath = __DIR__ . '/../sessions/share_codes/';

        // 建立 sessions 目錄
        if (!file_exists($this->sessionsPath)) {
            @mkdir($this->sessionsPath, 0777, true);
        }

        // 建立 share_codes 目錄
        if (!file_exists($this->shareCodesPath)) {
            @mkdir($this->shareCodesPath, 0777, true);
        }

        // 確保目錄可寫入（Windows 環境）
        if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
            @chmod($this->sessionsPath, 0777);
            @chmod($this->shareCodesPath, 0777);
        }
    }

    /**
     * 限制清理執行頻率，避免每次都掃描所有檔案
     */
    private function limitedCleanup()
    {
        // 事件驅動的清理機制 - 只在 createSession() 中調用
        // 防止過度頻繁的清理操作，透過檢查上次清理時間
        $lastCleanupFile = $this->sessionsPath . '.last_cleanup';
        $now = time();

        // 讀取上次清理時間
        $lastCleanup = 0;
        if (file_exists($lastCleanupFile)) {
            $lastCleanup = (int) file_get_contents($lastCleanupFile);
        }

        // 如果距離上次清理超過設定的間隔（120秒），執行清理
        if ($now - $lastCleanup > $this->cleanupCheckInterval) {
            $this->cleanup();
            file_put_contents($lastCleanupFile, $now);
        }
    }

    /**
     * 驗證建立代碼
     */
    private function validateCreateCode($code)
    {
        // 只取前9碼，只允許數字
        $code = substr($code, 0, 9);
        if (!preg_match('/^\d{9}$/', $code)) {
            return false;
        }
        return $code === $this->validCreateCode;
    }

    /**
     * 建立新工作階段（需要建立代碼）
     */
    public function createSession($createCode)
    {
        // 事件驅動清理：每次建立新工作階段時檢查是否需要清理
        $this->limitedCleanup();

        // 驗證建立代碼
        if (!$this->validateCreateCode($createCode)) {
            throw new Exception('建立代碼無效，請輸入正確的9位數字代碼');
        }

        $sessionId = $this->generateSessionId();
        $sessionFile = $this->sessionsPath . $sessionId . '.json';

        $sessionData = [
            'id' => $sessionId,
            'created' => time(),
            'lastUpdate' => time(),
            'lastActivity' => time(),
            'state' => null,
            'clients' => [],
            'maxClients' => $this->maxClients,
            'shareCodes' => [],  // 修改：分享代碼陣列
            'currentShareCode' => null  // 新增：目前有效的分享代碼
        ];

        file_put_contents($sessionFile, json_encode($sessionData, JSON_PRETTY_PRINT));

        // 自動產生分享代碼
        $shareCode = $this->generateShareCode($sessionId);

        return [
            'success' => true,
            'message' => '工作階段建立成功',
            'data' => [
                'sessionId' => $sessionId,
                'shareCode' => $shareCode  // 新增：回傳分享代碼給客戶端
            ]
        ];
    }

    /**
     * 產生分享代碼（一次性使用，時間有效）
     */
    private function generateShareCode($sessionId, $clientId = null, $length = 6)
    {
        // 確保分享代碼目錄存在並可寫
        if (!file_exists($this->shareCodesPath)) {
            if (!@mkdir($this->shareCodesPath, 0777, true)) {
                throw new Exception("無法建立分享代碼目錄: {$this->shareCodesPath}");
            }
        }

        // Windows 環境下嘗試設置權限
        if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
            @chmod($this->shareCodesPath, 0777);
        }

        if (!is_writable($this->shareCodesPath)) {
            // 嘗試直接寫入測試檔案以診斷問題
            $testFile = $this->shareCodesPath . '.write_test';
            $testResult = @file_put_contents($testFile, 'test');
            if ($testResult === false) {
                throw new Exception("分享代碼目錄無寫入權限: {$this->shareCodesPath}。請檢查資料夾權限設定。");
            }
            @unlink($testFile);
        }

        // 使用不同的字符集和長度生成分享代碼（區別於工作階段ID）
        // 工作階段ID: 6位大寫英數字 (如: ABC123)
        // 分享代碼: 4位數字 + 2位字母 (如: 1234AB) + 2位檢查碼 (如: 56)
        $shareCode = $this->generateShareCodeWithChecksum($length);
        $shareCodeFile = $this->shareCodesPath . $shareCode . '.json';

        $shareCodeData = [
            'code' => $shareCode,
            'sessionId' => $sessionId,
            'createdAt' => time(),
            'expiresAt' => time() + $this->shareCodeTimeout,
            'used' => false,
            'usedAt' => null,
            'usedBy' => null,
            'createdBy' => $clientId,  // 新增：記錄產生分享代碼的裝置
            'checksumValid' => true,  // 記錄檢查碼驗證狀態
            'singleUse' => true  // 新增：單次使用限制
        ];

        error_log("[DEBUG] 建立分享代碼 {$shareCode}:");
        error_log("[DEBUG] 建立時間: " . date('Y-m-d H:i:s', $shareCodeData['createdAt']));
        error_log("[DEBUG] 過期時間: " . date('Y-m-d H:i:s', $shareCodeData['expiresAt']));
        error_log("[DEBUG] 超時設定: {$this->shareCodeTimeout} 秒");

        $shareCodeContent = json_encode($shareCodeData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        $bytesWritten = file_put_contents($shareCodeFile, $shareCodeContent);

        if ($bytesWritten === false) {
            throw new Exception("無法寫入分享代碼檔案: {$shareCodeFile}");
        }

        // 更新工作階段中的分享代碼記錄
        $sessionFile = $this->sessionsPath . $sessionId . '.json';
        if (!file_exists($sessionFile)) {
            throw new Exception("工作階段檔案不存在: {$sessionFile}");
        }

        $sessionContent = file_get_contents($sessionFile);
        if ($sessionContent === false) {
            throw new Exception("無法讀取工作階段檔案: {$sessionFile}");
        }

        $sessionData = json_decode($sessionContent, true);
        if ($sessionData === null) {
            throw new Exception("工作階段檔案 JSON 無效");
        }

        // 初始化分享代碼陣列（如果不存在）
        if (!isset($sessionData['shareCodes'])) {
            $sessionData['shareCodes'] = [];
        }

        // 新增分享代碼到陣列
        $sessionData['shareCodes'][] = [
            'code' => $shareCode,
            'createdAt' => time(),
            'createdBy' => $clientId,
            'expiresAt' => time() + $this->shareCodeTimeout,
            'used' => false,
            'usedAt' => null,
            'usedBy' => null
        ];

        // 設定目前有效的分享代碼
        $sessionData['currentShareCode'] = $shareCode;
        $sessionData['lastUpdate'] = time();
        $sessionData['shareCodeCreatedAt'] = time();

        $sessionUpdateContent = json_encode($sessionData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        $sessionBytesWritten = file_put_contents($sessionFile, $sessionUpdateContent);

        if ($sessionBytesWritten === false) {
            throw new Exception("無法更新工作階段檔案: {$sessionFile}");
        }

        return $shareCode;
    }

    /**
     * 重新產生分享代碼（刪除舊代碼，產生新代碼）
     */
    /**
     * 驗證分享代碼的檢查碼
     * 回傳驗證結果和分享代碼資訊
     */
    public function validateShareCode($shareCode)
    {
        // 檢查長度
        if (strlen($shareCode) < 8) {
            return [
                'success' => false,
                'message' => '分享代碼格式錯誤 [長度不足]',
                'isValid' => false,
                'checksum' => null
            ];
        }

        // 驗證檢查碼
        $isValid = $this->validateShareCodeChecksum($shareCode);

        // 提取基礎代碼和檢查碼
        $baseCode = substr($shareCode, 0, 6);
        $providedChecksum = substr($shareCode, 6, 2);
        $correctChecksum = $this->calculateChecksum($baseCode);

        $response = [
            'success' => true,
            'message' => $isValid ? '分享代碼檢查碼有效' : '分享代碼檢查碼無效',
            'isValid' => $isValid,
            'baseCode' => $baseCode,
            'providedChecksum' => $providedChecksum,
            'correctChecksum' => $correctChecksum,
            'checksumMatch' => ($providedChecksum === $correctChecksum)
        ];

        return $response;
    }

    /**
     * 驗證工作階段ID的檢查碼
     * 回傳驗證結果和工作階段ID資訊
     */
    public function validateSessionId($sessionId)
    {
        // 檢查長度
        if (strlen($sessionId) < 8) {
            return [
                'success' => false,
                'message' => '工作階段ID格式錯誤 [長度不足或無檢查碼]',
                'isValid' => false,
                'idType' => 'legacy'  // 舊格式ID（無檢查碼）
            ];
        }

        // 驗證檢查碼
        $isValid = $this->validateSessionIdChecksum($sessionId);

        // 提取基礎代碼和檢查碼
        $baseCode = substr($sessionId, 0, 6);
        $providedChecksum = substr($sessionId, 6, 2);
        $correctChecksum = $this->calculateChecksum($baseCode);

        $response = [
            'success' => true,
            'message' => $isValid ? '工作階段ID檢查碼有效' : '工作階段ID檢查碼無效',
            'isValid' => $isValid,
            'idType' => 'checksum',  // 新格式ID（有檢查碼）
            'baseCode' => $baseCode,
            'providedChecksum' => $providedChecksum,
            'correctChecksum' => $correctChecksum,
            'checksumMatch' => ($providedChecksum === $correctChecksum)
        ];

        return $response;
    }

    public function regenerateShareCode($sessionId, $clientId = null)
    {
        // 驗證工作階段是否存在
        $sessionFile = $this->sessionsPath . $sessionId . '.json';
        if (!file_exists($sessionFile)) {
            throw new Exception("工作階段不存在");
        }

        // 讀取現有工作階段資料
        $sessionContent = file_get_contents($sessionFile);
        if ($sessionContent === false) {
            throw new Exception("無法讀取工作階段檔案");
        }

        $sessionData = json_decode($sessionContent, true);
        if ($sessionData === null) {
            throw new Exception("工作階段檔案格式無效");
        }

        // 將目前有效的分享代碼標記為已過期
        if (isset($sessionData['currentShareCode'])) {
            $oldShareCodeFile = $this->shareCodesPath . $sessionData['currentShareCode'] . '.json';
            if (file_exists($oldShareCodeFile)) {
                $oldShareCodeContent = file_get_contents($oldShareCodeFile);
                if ($oldShareCodeContent !== false) {
                    $oldShareCodeData = json_decode($oldShareCodeContent, true);
                    if ($oldShareCodeData !== null) {
                        // 將舊分享代碼標記為已過期
                        $oldShareCodeData['expired'] = true;
                        $oldShareCodeData['expiredAt'] = time();
                        $oldShareCodeData['expiredReason'] = 'regenerated';
                        file_put_contents($oldShareCodeFile, json_encode($oldShareCodeData, JSON_PRETTY_PRINT));
                    }
                }
            }
        }

        // 產生新的分享代碼
        $newShareCode = $this->generateShareCode($sessionId, $clientId);

        return $newShareCode;
    }

    /**
     * 取得分享代碼資訊（用於前端顯示剩餘時間）
     */
    public function getShareCodeInfo($shareCode)
    {
        // 驗證分享代碼格式
        if (strlen($shareCode) < 8) {
            throw new Exception('分享代碼格式錯誤 [長度不足]');
        }

        // 驗證檢查碼
        if (!$this->validateShareCodeChecksum($shareCode)) {
            throw new Exception('分享代碼檢查碼驗證失敗 [檢查碼不正確]');
        }

        $shareCodeFile = $this->shareCodesPath . $shareCode . '.json';

        if (!file_exists($shareCodeFile)) {
            throw new Exception('分享代碼不存在');
        }

        $shareCodeContent = file_get_contents($shareCodeFile);
        if ($shareCodeContent === false) {
            throw new Exception('無法讀取分享代碼檔案');
        }

        $shareCodeData = json_decode($shareCodeContent, true);
        if ($shareCodeData === null) {
            throw new Exception('分享代碼格式錯誤');
        }

        $now = time();
        $remainingTime = max(0, $shareCodeData['expiresAt'] - $now);

        return [
            'success' => true,
            'message' => '取得分享代碼資訊成功',
            'data' => [
                'code' => $shareCodeData['code'],
                'createdAt' => $shareCodeData['createdAt'],
                'expiresAt' => $shareCodeData['expiresAt'],
                'remainingTime' => $remainingTime,
                'used' => $shareCodeData['used'] ?? false,
                'singleUse' => $shareCodeData['singleUse'] ?? true,
                'expired' => !empty($shareCodeData['expired']) ? $shareCodeData['expired'] : false
            ]
        ];
    }

    /**
     * 通過分享代碼加入工作階段
     */
    public function joinSessionByShareCode($shareCode, $role = 'viewer', $clientId = null)
    {
        // 首先驗證分享代碼格式和檢查碼
        if (strlen($shareCode) < 8) {
            throw new Exception('分享代碼格式錯誤 [長度不足]');
        }

        // 驗證檢查碼
        if (!$this->validateShareCodeChecksum($shareCode)) {
            throw new Exception('分享代碼檢查碼驗證失敗 [檢查碼不正確]');
        }

        $shareCodeFile = $this->shareCodesPath . $shareCode . '.json';

        if (!file_exists($shareCodeFile)) {
            throw new Exception('分享代碼無效或已過期 [檔案不存在]');
        }

        $shareCodeContent = file_get_contents($shareCodeFile);
        if ($shareCodeContent === false) {
            throw new Exception('無法讀取分享代碼檔案 [讀取失敗]');
        }

        $shareCodeData = json_decode($shareCodeContent, true);
        if ($shareCodeData === null) {
            throw new Exception('分享代碼格式錯誤 [JSON解析失敗]');
        }

        error_log("[DEBUG] 讀取分享代碼 {$shareCode} 資料:");
        error_log("[DEBUG] 檔案內容: " . json_encode($shareCodeData, JSON_UNESCAPED_UNICODE));

        // 檢查分享代碼是否已被標記為過期
        if (!empty($shareCodeData['expired']) && $shareCodeData['expired'] === true) {
            // 嘗試刪除過期的分享代碼檔案
            @unlink($shareCodeFile);
            throw new Exception('此分享代碼已被重新產生，請使用新的分享代碼 [已過期]');
        }

        // 檢查分享代碼是否已被使用
        if (!empty($shareCodeData['used']) && $shareCodeData['used'] === true) {
            // 如果有提供 clientId，檢查是否是同一個裝置
            if (!empty($clientId) && isset($shareCodeData['usedBy']) && $shareCodeData['usedBy'] === $clientId) {
                // 同一個裝置可以重複使用（重新連線）
                // 繼續執行後續邏輯
            } else {
                // 不同裝置嘗試使用已被使用的分享代碼
                throw new Exception('此分享代碼已被其他裝置使用，請重新產生新的分享代碼 [已使用]');
            }
        }

        // 檢查分享代碼是否已過期
        $now = time();
        error_log("[DEBUG] 分享代碼 {$shareCode} 檢查過期狀態:");
        error_log("[DEBUG] 目前時間: " . date('Y-m-d H:i:s', $now));
        error_log("[DEBUG] 過期時間: " . date('Y-m-d H:i:s', $shareCodeData['expiresAt']));
        error_log("[DEBUG] 剩餘時間: " . ($shareCodeData['expiresAt'] - $now) . " 秒");

        if (!empty($shareCodeData['expiresAt']) && $shareCodeData['expiresAt'] < $now) {
            // 嘗試刪除過期檔案（不影響驗證結果）
            @unlink($shareCodeFile);
            $timeDiff = $now - $shareCodeData['expiresAt'];
            error_log("[DEBUG] 分享代碼 {$shareCode} 已過期 {$timeDiff} 秒");
            throw new Exception("分享代碼已過期 {$timeDiff}秒，請取得新的分享代碼 [已過期]");
        }

        $sessionId = $shareCodeData['sessionId'] ?? null;
        if (empty($sessionId)) {
            throw new Exception('分享代碼缺少sessionId [無效結構]');
        }

        $sessionFile = $this->sessionsPath . $sessionId . '.json';

        if (!file_exists($sessionFile)) {
            throw new Exception('工作階段不存在或已過期 [工作階段檔案不存在]');
        }

        $sessionContent = file_get_contents($sessionFile);
        if ($sessionContent === false) {
            throw new Exception('無法讀取工作階段檔案 [讀取失敗]');
        }

        $sessionData = json_decode($sessionContent, true);
        if ($sessionData === null) {
            throw new Exception('工作階段格式錯誤 [JSON解析失敗]');
        }

        // 驗證角色
        if (!in_array($role, ['viewer', 'operator'])) {
            $role = 'viewer';
        }

        // 檢查是否有傳入 clientId（重新連線的客戶端）
        if (!empty($clientId)) {
            // 尋找是否已存在此 clientId
            $existingClientIndex = -1;
            foreach ($sessionData['clients'] as $index => $client) {
                if ($client['id'] === $clientId) {
                    $existingClientIndex = $index;
                    break;
                }
            }

            // 如果找到現存的客戶端，更新其活動時間（重新連線）
            if ($existingClientIndex !== -1) {
                $sessionData['clients'][$existingClientIndex]['lastActivity'] = time();
                $sessionData['clients'][$existingClientIndex]['role'] = $role;  // 允許更新角色
                // 保留或更新 deviceToken（如果沒有則產生新的）
                if (!isset($sessionData['clients'][$existingClientIndex]['deviceToken'])) {
                    $sessionData['clients'][$existingClientIndex]['deviceToken'] = $this->generateDeviceToken($sessionId, $clientId);
                }
                $sessionData['lastActivity'] = time();
                file_put_contents($sessionFile, json_encode($sessionData, JSON_PRETTY_PRINT));

                //標記分享代碼為已使用（只在成功加入時）
                $shareCodeData['used'] = true;
                $shareCodeData['usedAt'] = time();
                $shareCodeData['usedBy'] = $clientId;
                file_put_contents($shareCodeFile, json_encode($shareCodeData, JSON_PRETTY_PRINT));

                // 更新工作階段中的分享代碼狀態
                if (isset($sessionData['shareCodes'])) {
                    foreach ($sessionData['shareCodes'] as &$shareCodeEntry) {
                        if ($shareCodeEntry['code'] === $shareCode) {
                            $shareCodeEntry['used'] = true;
                            $shareCodeEntry['usedAt'] = time();
                            $shareCodeEntry['usedBy'] = $clientId;
                            break;
                        }
                    }
                    file_put_contents($sessionFile, json_encode($sessionData, JSON_PRETTY_PRINT));
                }

                return [
                    'success' => true,
                    'message' => '成功重新連線到工作階段',
                    'data' => [
                        'sessionId' => $sessionId,
                        'clientId' => $clientId,  // 回傳相同的 clientId
                        'deviceToken' => $sessionData['clients'][$existingClientIndex]['deviceToken'],  // 回傳裝置簽章
                        'role' => $role,
                        'state' => $sessionData['state'],
                        'isReconnect' => true
                    ]
                ];
            }
        }

        // 如果不是重新連線，檢查工作階段是否已滿
        if (count($sessionData['clients']) >= $this->maxClients) {
            throw new Exception('工作階段已滿，無法加入（最多' . $this->maxClients . '個裝置）');
        }

        // 新客戶端：產生新的 clientId（如果沒有提供或不存在）
        $newClientId = uniqid('client_', true);
        // 產生裝置驗證簽章：用 sessionId + clientId 計算
        $deviceToken = $this->generateDeviceToken($sessionId, $newClientId);

        $sessionData['clients'][] = [
            'id' => $newClientId,
            'role' => $role,
            'joinedAt' => time(),
            'lastActivity' => time(),
            'deviceToken' => $deviceToken  // 新增：裝置驗證簽章
        ];

        $sessionData['lastActivity'] = time();
        file_put_contents($sessionFile, json_encode($sessionData, JSON_PRETTY_PRINT));

        //標記分享代碼為已使用（只在成功加入時）
        $shareCodeData['used'] = true;
        $shareCodeData['usedAt'] = time();
        $shareCodeData['usedBy'] = $newClientId;
        file_put_contents($shareCodeFile, json_encode($shareCodeData, JSON_PRETTY_PRINT));

        return [
            'success' => true,
            'message' => '成功通過分享代碼加入工作階段',
            'data' => [
                'sessionId' => $sessionId,
                'clientId' => $newClientId,
                'deviceToken' => $deviceToken,  // 新增：回傳裝置簽章
                'role' => $role,
                'state' => $sessionData['state'],
                'isReconnect' => false
            ]
        ];
    }


    /**
     * 加入工作階段（支援角色選擇）
     * 注意：此方法已停用，改為只允許通過分享代碼加入
     * 工作階段ID僅作為內部使用，不應被分享或用於加入
     */
    public function joinSession($sessionId, $role = 'viewer', $clientId = null)
    {
        // 停用直接使用工作階段ID加入，必須使用分享代碼
        throw new Exception('無法直接使用工作階段代碼加入，請使用分享代碼加入工作階段 [未支援的方式]');
    }

    /**
     * 已廢棄的加入方法（保留簽名以防止代碼破裂）
     * 原邏輯已移至此註解以供參考：
     */
    private function _joinSessionLegacy($sessionId, $role = 'viewer', $clientId = null)
    {
        // 驗證工作階段ID的檢查碼（如果啟用）
        if (SESSION_WITH_CHECKSUM && strlen($sessionId) === 8) {
            if (!$this->validateSessionIdChecksum($sessionId)) {
                throw new Exception('工作階段ID檢查碼驗證失敗 [無效的工作階段ID]');
            }
        }

        $sessionFile = $this->sessionsPath . $sessionId . '.json';

        if (!file_exists($sessionFile)) {
            throw new Exception('工作階段不存在或已過期');
        }

        $sessionData = json_decode(file_get_contents($sessionFile), true);

        // 驗證角色
        if (!in_array($role, ['viewer', 'operator'])) {
            $role = 'viewer';
        }

        // 檢查是否有傳入 clientId（重新連線的客戶端）
        if (!empty($clientId)) {
            // 尋找是否已存在此 clientId
            $existingClientIndex = -1;
            foreach ($sessionData['clients'] as $index => $client) {
                if ($client['id'] === $clientId) {
                    $existingClientIndex = $index;
                    break;
                }
            }

            // 如果找到現存的客戶端，更新其活動時間（重新連線）
            if ($existingClientIndex !== -1) {
                $sessionData['clients'][$existingClientIndex]['lastActivity'] = time();
                $sessionData['clients'][$existingClientIndex]['role'] = $role;  // 允許更新角色
                $sessionData['lastActivity'] = time();
                file_put_contents($sessionFile, json_encode($sessionData, JSON_PRETTY_PRINT));

                return [
                    'success' => true,
                    'message' => '成功重新連線到工作階段',
                    'data' => [
                        'sessionId' => $sessionId,
                        'clientId' => $clientId,  // 回傳相同的 clientId
                        'role' => $role,
                        'state' => $sessionData['state'],
                        'isReconnect' => true
                    ]
                ];
            }
        }

        // 如果不是重新連線，檢查工作階段是否已滿
        if (count($sessionData['clients']) >= $this->maxClients) {
            throw new Exception('工作階段已滿，無法加入（最多' . $this->maxClients . '個裝置）');
        }

        // 新客戶端：產生新的 clientId（如果沒有提供或不存在）
        $newClientId = uniqid('client_', true);
        $sessionData['clients'][] = [
            'id' => $newClientId,
            'role' => $role,
            'joinedAt' => time(),
            'lastActivity' => time()
        ];

        $sessionData['lastActivity'] = time();
        file_put_contents($sessionFile, json_encode($sessionData, JSON_PRETTY_PRINT));

        return [
            'success' => true,
            'message' => '成功加入工作階段',
            'data' => [
                'sessionId' => $sessionId,
                'clientId' => $newClientId,
                'role' => $role,
                'state' => $sessionData['state'],
                'isReconnect' => false
            ]
        ];
    }

    /**
     * 還原工作階段連線（用於同一裝置短期內重新連線）
     * 驗證 sessionId 和 clientId，允許客戶端還原之前的連線
     * 僅限於 10 分鐘內的還原
     */
    public function restoreSession($sessionId, $clientId, $role = 'viewer')
    {
        $sessionFile = $this->sessionsPath . $sessionId . '.json';

        if (!file_exists($sessionFile)) {
            throw new Exception('工作階段不存在或已過期 [session file not found]');
        }

        $sessionData = json_decode(file_get_contents($sessionFile), true);
        if ($sessionData === null) {
            throw new Exception('工作階段格式錯誤 [invalid JSON]');
        }

        // 驗證 clientId 是否存在於此工作階段
        $existingClientIndex = -1;
        foreach ($sessionData['clients'] as $index => $client) {
            if ($client['id'] === $clientId) {
                $existingClientIndex = $index;
                break;
            }
        }

        if ($existingClientIndex === -1) {
            throw new Exception('此裝置未在此工作階段中，無法還原 [client not found]');
        }

        // 更新客戶端活動時間
        $sessionData['clients'][$existingClientIndex]['lastActivity'] = time();
        $sessionData['clients'][$existingClientIndex]['role'] = $role;
        // 保留或產生 deviceToken
        if (!isset($sessionData['clients'][$existingClientIndex]['deviceToken'])) {
            $sessionData['clients'][$existingClientIndex]['deviceToken'] = $this->generateDeviceToken($sessionId, $clientId);
        }
        $deviceToken = $sessionData['clients'][$existingClientIndex]['deviceToken'];
        $sessionData['lastActivity'] = time();
        file_put_contents($sessionFile, json_encode($sessionData, JSON_PRETTY_PRINT));

        return [
            'success' => true,
            'message' => '成功還原工作階段連線',
            'data' => [
                'sessionId' => $sessionId,
                'clientId' => $clientId,
                'deviceToken' => $deviceToken,  // 新增：回傳裝置簽章
                'shareCode' => $sessionData['shareCode'] ?? null,  // 新增：回傳分享代碼
                'role' => $role,
                'state' => $sessionData['state'],
                'isReconnect' => true
            ]
        ];
    }

    /**
     * 更新工作階段狀態
     */
    public function syncState($sessionId, $state)
    {
        $sessionFile = $this->sessionsPath . $sessionId . '.json';

        if (!file_exists($sessionFile)) {
            throw new Exception('工作階段不存在或已過期');
        }

        $sessionData = json_decode(file_get_contents($sessionFile), true);
        $sessionData['state'] = $state;
        $sessionData['lastUpdate'] = time();
        $sessionData['lastActivity'] = time();  // 重要：更新活動時間，防止被清理

        file_put_contents($sessionFile, json_encode($sessionData, JSON_PRETTY_PRINT));

        return [
            'success' => true,
            'message' => '狀態更新成功'
        ];
    }

    /**
     * 取得工作階段狀態
     */
    public function getState($sessionId, $lastUpdate = 0)
    {
        $sessionFile = $this->sessionsPath . $sessionId . '.json';

        if (!file_exists($sessionFile)) {
            throw new Exception('工作階段不存在或已過期');
        }

        $sessionData = json_decode(file_get_contents($sessionFile), true);

        // 更新工作階段的 lastActivity，表示有客戶端在輪詢（即在線上）
        $sessionData['lastActivity'] = time();
        file_put_contents($sessionFile, json_encode($sessionData, JSON_PRETTY_PRINT));

        // 如果沒有新更新，回傳null
        if ($sessionData['lastUpdate'] <= $lastUpdate) {
            return [
                'success' => true,
                'message' => '無更新',
                'data' => null
            ];
        }

        return [
            'success' => true,
            'message' => '取得狀態成功',
            'data' => [
                'state' => $sessionData['state'],
                'lastUpdate' => $sessionData['lastUpdate']
            ]
        ];
    }

    /**
     * 取得工作階段中的所有客戶端資訊
     */
    public function getSessionClients($sessionId)
    {
        $sessionFile = $this->sessionsPath . $sessionId . '.json';

        if (!file_exists($sessionFile)) {
            throw new Exception('工作階段不存在或已過期');
        }

        $sessionData = json_decode(file_get_contents($sessionFile), true);

        // 更新工作階段的 lastActivity
        $sessionData['lastActivity'] = time();
        file_put_contents($sessionFile, json_encode($sessionData, JSON_PRETTY_PRINT));

        // 返回客戶端列表和工作階段狀態
        return [
            'success' => true,
            'message' => '取得工作階段客戶端成功',
            'data' => [
                'sessionId' => $sessionId,
                'clientCount' => count($sessionData['clients']),
                'clients' => $sessionData['clients'],  // 包含所有客戶端ID和角色
                'state' => $sessionData['state'],  // 工作階段狀態
                'lastUpdate' => $sessionData['lastUpdate'],
                'created' => $sessionData['created'] ?? null,
                'lastActivity' => $sessionData['lastActivity']
            ]
        ];
    }

    /**
     * 清理過期工作階段和分享代碼
     * 規則：
     * 1. 如果工作階段中有至少一個客戶端在線上，不刪除
     * 2. 如果工作階段中沒有客戶端，5分鐘無活動後刪除
     * 3. 如果工作階段沒有客戶端加入過，30分鐘後刪除
     */
    public function cleanup()
    {
        $expired = 0;
        $failed = [];

        // 清理過期的工作階段
        $sessionFiles = glob($this->sessionsPath . '*.json');
        $now = time();

        foreach ($sessionFiles as $file) {
            // 跳過系統檔案
            $basename = basename($file);
            if ($basename === '.last_cleanup') {
                continue;
            }

            $sessionData = json_decode(file_get_contents($file), true);
            if ($sessionData === null) {
                continue; // 跳過無效的 JSON
            }

            // 檢查是否應該刪除工作階段
            $shouldDelete = false;

            // 情況1：工作階段中有客戶端在線上 → 不刪除
            if (!empty($sessionData['clients']) && count($sessionData['clients']) > 0) {
                // 至少有一個客戶端，不刪除
                $shouldDelete = false;
            } else {
                // 情況2：沒有客戶端在線上，檢查無活動時間
                $lastActivity = isset($sessionData['lastActivity']) ? $sessionData['lastActivity'] : $sessionData['created'];
                $inactiveTime = $now - $lastActivity;

                // 如果沒有客戶端且超過10分鐘無活動，則刪除（改為10分鐘給使用者更寬裕的還原時間）
                if ($inactiveTime > 600) { // 改為 600 秒 = 10 分鐘
                    $shouldDelete = true;
                }
            }

            // 情況3：極端情況，工作階段存在超過30分鐘（防呆機制）
            $sessionAge = $now - $sessionData['created'];
            if ($sessionAge > $this->sessionTimeout && empty($sessionData['clients'])) {
                $shouldDelete = true;
            }

            if ($shouldDelete) {
                try {
                    // 確保檔案可寫
                    if (file_exists($file)) {
                        if (!is_writable($file)) {
                            @chmod($file, 0644);
                        }
                        if (unlink($file)) {
                            $expired++;
                        } else {
                            $failed[] = basename($file) . ' (unlink failed)';
                        }
                    }
                } catch (Exception $e) {
                    $failed[] = basename($file) . ' (' . $e->getMessage() . ')';
                }
            }
        }

        // 清理過期的分享代碼
        $shareCodeFiles = glob($this->shareCodesPath . '*.json');

        foreach ($shareCodeFiles as $file) {
            $shareCodeData = json_decode(file_get_contents($file), true);

            // 檢查分享代碼是否已過期或已使用
            if ($shareCodeData['expiresAt'] < $now || $shareCodeData['used']) {
                try {
                    // 確保檔案可寫
                    if (file_exists($file)) {
                        if (!is_writable($file)) {
                            @chmod($file, 0644);
                        }
                        if (unlink($file)) {
                            $expired++;
                        } else {
                            $failed[] = basename($file) . ' (unlink failed)';
                        }
                    }
                } catch (Exception $e) {
                    $failed[] = basename($file) . ' (' . $e->getMessage() . ')';
                }
            }
        }

        // 儲存清理結果以供診斷
        $cleanupLog = [
            'timestamp' => $now,
            'expired_count' => $expired,
            'failed_count' => count($failed),
            'failed_files' => $failed
        ];

        // 可選：將清理日誌儲存到檔案以供調試
        // file_put_contents($this->sessionsPath . '.cleanup_log', json_encode($cleanupLog, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

        return $expired;
    }

    /**
     * 強制清理：刪除所有沒有活躍客戶端的 sessions（忽略時間限制）
     * 用於緊急情況或診斷工具
     */
    public function forceCleanup()
    {
        $deleted = 0;
        $failed = 0;
        $now = time();

        // 強制清理所有無客戶端的工作階段
        $sessionFiles = glob($this->sessionsPath . '*.json');

        foreach ($sessionFiles as $file) {
            $basename = basename($file);
            if ($basename === '.last_cleanup') {
                continue;
            }

            $sessionData = json_decode(file_get_contents($file), true);
            if ($sessionData === null) {
                continue;
            }

            // 只要沒有活躍客戶端，就刪除
            if (empty($sessionData['clients'])) {
                try {
                    if (file_exists($file)) {
                        if (!is_writable($file)) {
                            @chmod($file, 0644);
                        }
                        if (unlink($file)) {
                            $deleted++;
                        } else {
                            $failed++;
                        }
                    }
                } catch (Exception $e) {
                    $failed++;
                }
            }
        }

        // 強制清理所有分享代碼
        $shareCodeFiles = glob($this->shareCodesPath . '*.json');

        foreach ($shareCodeFiles as $file) {
            try {
                if (file_exists($file)) {
                    if (!is_writable($file)) {
                        @chmod($file, 0644);
                    }
                    if (unlink($file)) {
                        $deleted++;
                    } else {
                        $failed++;
                    }
                }
            } catch (Exception $e) {
                $failed++;
            }
        }

        return [
            'deleted' => $deleted,
            'failed' => $failed,
            'total_affected' => $deleted + $failed
        ];
    }

    /**
     * 產生工作階段ID
     */
    /**
     * 生成帶有檢查碼的分享代碼
     * 格式: 4位數字 + 2位大寫字母 + 2位檢查碼 (共8位)
     * 例如: 1234AB56
     */
    private function generateShareCodeWithChecksum($length = 6)
    {
        // 第一部分: 4位數字 (0-9)
        $digits = '';
        for ($i = 0; $i < 4; $i++) {
            $digits .= rand(0, 9);
        }

        // 第二部分: 2位大寫字母 (A-Z)
        $letters = '';
        $letterChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        for ($i = 0; $i < 2; $i++) {
            $letters .= $letterChars[rand(0, 25)];
        }

        // 第三部分: 基礎代碼
        $baseCode = $digits . $letters;

        // 計算檢查碼 (Luhn算法的簡化版本)
        $checksum = $this->calculateChecksum($baseCode);

        return $baseCode . $checksum;
    }

    /**
     * 計算檢查碼（產生2個字符）
     * 將所有字符轉換為數值，進行運算，確保分享代碼的完整性
     * 回傳: 2個字符的檢查碼 (例如: "3A", "1Z", "99")
     */
    private function calculateChecksum($code)
    {
        $sum = 0;
        for ($i = 0; $i < strlen($code); $i++) {
            $char = $code[$i];
            // 數字: 直接使用其值
            // 字母: A=10, B=11, ..., Z=35
            if (is_numeric($char)) {
                $value = intval($char);
            } else {
                $value = ord($char) - ord('A') + 10;
            }
            $sum += $value * ($i + 1);  // 按位置加權
        }

        // 計算2個檢查碼字符
        // 第一個檢查碼: sum % 36 (0-9, A-Z)
        // 第二個檢查碼: (sum / 36) % 36 (0-9, A-Z)
        $checksum1Value = $sum % 36;
        $checksum2Value = (intval($sum / 36)) % 36;

        // 將數值轉換回字符 (0-9 直接用, 10-35 用 A-Z)
        $checksum1 = ($checksum1Value < 10) ? strval($checksum1Value) : chr(ord('A') + $checksum1Value - 10);
        $checksum2 = ($checksum2Value < 10) ? strval($checksum2Value) : chr(ord('A') + $checksum2Value - 10);

        return $checksum1 . $checksum2;
    }

    /**
     * 產生裝置驗證簽章
     * 用 sessionId + clientId 運算，產生用於廣播驗證的簽章
     * 格式: md5(sessionId . clientId . salt)
     * 回傳: 16位十六進制字符串（可用於加密或驗證）
     */
    private function generateDeviceToken($sessionId, $clientId)
    {
        $salt = "device_verify_token";  // 內部鹽值
        $token = md5($sessionId . $clientId . $salt);
        return $token;
    }

    /**
     * 驗證裝置簽章
     * 檢查 clientId 是否與 sessionId 產生的簽章相符
     */
    private function verifyDeviceToken($sessionId, $clientId, $providedToken)
    {
        $expectedToken = $this->generateDeviceToken($sessionId, $clientId);
        return $providedToken === $expectedToken;
    }

    /**
     * 驗證分享代碼的檢查碼
     */
    private function validateShareCodeChecksum($shareCode)
    {
        // 分享代碼格式: 6位基礎代碼 + 2位檢查碼 = 8位
        if (strlen($shareCode) < 8) {
            return false;
        }

        // 提取基礎代碼和檢查碼
        $baseCode = substr($shareCode, 0, 6);
        $providedChecksum = substr($shareCode, 6, 2);

        // 計算正確的檢查碼
        $correctChecksum = $this->calculateChecksum($baseCode);

        // 比較
        return $providedChecksum === $correctChecksum;
    }

    private function generateSessionId($length = 6)
    {
        // 如果要求帶檢查碼的工作階段ID，使用特殊生成方式
        // 不帶檢查碼時保持原有邏輯（向後相容）
        if (defined('SESSION_WITH_CHECKSUM') && SESSION_WITH_CHECKSUM === true) {
            return $this->generateSessionIdWithChecksum($length);
        }

        // 原有邏輯：6位英數字
        $characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        $id = '';
        for ($i = 0; $i < $length; $i++) {
            $id .= $characters[rand(0, strlen($characters) - 1)];
        }
        return $id;
    }

    /**
     * 生成帶有檢查碼的工作階段ID
     * 格式: 4位字母 + 2位數字 + 2位檢查碼 (共8位)
     * 例如: ABCD1256
     */
    private function generateSessionIdWithChecksum($length = 6)
    {
        // 第一部分: 4位大寫字母 (A-Z)
        $letters = '';
        $letterChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        for ($i = 0; $i < 4; $i++) {
            $letters .= $letterChars[rand(0, 25)];
        }

        // 第二部分: 2位數字 (0-9)
        $digits = '';
        for ($i = 0; $i < 2; $i++) {
            $digits .= rand(0, 9);
        }

        // 第三部分: 基礎代碼
        $baseCode = $letters . $digits;

        // 計算檢查碼 (Luhn算法的簡化版本)
        $checksum = $this->calculateChecksum($baseCode);

        return $baseCode . $checksum;
    }

    /**
     * 驗證工作階段ID的檢查碼（可選）
     */
    private function validateSessionIdChecksum($sessionId)
    {
        // 僅當工作階段ID啟用檢查碼時才驗證
        if (strlen($sessionId) !== 8) {
            return true;  // 不是8位，跳過驗證（相容舊ID）
        }

        // 提取基礎代碼和檢查碼
        $baseCode = substr($sessionId, 0, 6);
        $providedChecksum = substr($sessionId, 6, 2);

        // 計算正確的檢查碼
        $correctChecksum = $this->calculateChecksum($baseCode);

        // 比較
        return $providedChecksum === $correctChecksum;
    }

    /**
     * 列出所有工作階段
     */
    public function listSessions()
    {
        $sessions = [];

        // 掃描sessions目錄
        if ($handle = opendir($this->sessionsPath)) {
            while (false !== ($file = readdir($handle))) {
                if ($file != "." && $file != ".." && $file != ".last_cleanup" && pathinfo($file, PATHINFO_EXTENSION) == 'json') {
                    $sessionId = pathinfo($file, PATHINFO_FILENAME);
                    $sessionFile = $this->sessionsPath . $file;

                    if (file_exists($sessionFile)) {
                        $sessionContent = file_get_contents($sessionFile);
                        if ($sessionContent !== false) {
                            $sessionData = json_decode($sessionContent, true);
                            if ($sessionData !== null) {
                                // 處理向後相容性：將舊的單一分享代碼格式轉換為陣列格式
                                if (isset($sessionData['shareCode']) && !isset($sessionData['shareCodes'])) {
                                    $sessionData['shareCodes'] = [
                                        [
                                            'code' => $sessionData['shareCode'],
                                            'createdAt' => $sessionData['shareCodeCreatedAt'] ?? $sessionData['created'],
                                            'expiresAt' => ($sessionData['shareCodeCreatedAt'] ?? $sessionData['created']) + $this->shareCodeTimeout,
                                            'used' => false,
                                            'usedAt' => null,
                                            'usedBy' => null,
                                            'createdBy' => null
                                        ]
                                    ];
                                    // 設定目前有效的分享代碼
                                    $sessionData['currentShareCode'] = $sessionData['shareCode'];
                                    // 移除舊欄位
                                    unset($sessionData['shareCode']);
                                    unset($sessionData['shareCodeCreatedAt']);
                                }

                                // 檢查並更新分享代碼的實際狀態
                                if (isset($sessionData['shareCodes']) && is_array($sessionData['shareCodes'])) {
                                    foreach ($sessionData['shareCodes'] as &$shareCodeEntry) {
                                        $shareCodeFile = $this->shareCodesPath . $shareCodeEntry['code'] . '.json';
                                        if (file_exists($shareCodeFile)) {
                                            $shareCodeContent = file_get_contents($shareCodeFile);
                                            if ($shareCodeContent !== false) {
                                                $actualShareCodeData = json_decode($shareCodeContent, true);
                                                if ($actualShareCodeData !== null) {
                                                    // 更新實際的使用狀態
                                                    $shareCodeEntry['used'] = $actualShareCodeData['used'] ?? false;
                                                    $shareCodeEntry['usedAt'] = $actualShareCodeData['usedAt'] ?? null;
                                                    $shareCodeEntry['usedBy'] = $actualShareCodeData['usedBy'] ?? null;
                                                    $shareCodeEntry['expired'] = !empty($actualShareCodeData['expired']) ? $actualShareCodeData['expired'] : false;
                                                }
                                            }
                                        }
                                    }
                                }

                                // 新增計算欄位
                                $sessionData['isActive'] = (time() - $sessionData['lastActivity']) < $this->inactiveTimeout;
                                $sessions[] = $sessionData;
                            }
                        }
                    }
                }
            }
            closedir($handle);
        }

        // 按建立時間排序（最新的在前）
        usort($sessions, function ($a, $b) {
            return $b['created'] - $a['created'];
        });

        return $sessions;
    }

    /**
     * 刪除指定工作階段
     */
    public function deleteSession($sessionId)
    {
        // 驗證工作階段是否存在
        $sessionFile = $this->sessionsPath . $sessionId . '.json';
        if (!file_exists($sessionFile)) {
            throw new Exception("工作階段不存在");
        }

        // 讀取工作階段資料
        $sessionContent = file_get_contents($sessionFile);
        if ($sessionContent === false) {
            throw new Exception("無法讀取工作階段檔案");
        }

        $sessionData = json_decode($sessionContent, true);
        if ($sessionData === null) {
            throw new Exception("工作階段檔案格式無效");
        }

        // 刪除分享代碼檔案（如果存在）
        if (isset($sessionData['shareCode'])) {
            $shareCodeFile = $this->shareCodesPath . $sessionData['shareCode'] . '.json';
            if (file_exists($shareCodeFile)) {
                @unlink($shareCodeFile);
            }
        }

        // 刪除工作階段檔案
        if (!unlink($sessionFile)) {
            throw new Exception("無法刪除工作階段檔案");
        }

        return true;
    }
}

// API 端點處理
$syncSystem = new SyncSystem();
$action = $_REQUEST['action'] ?? '';
$response = ['success' => false, 'message' => '無效的操作', 'data' => null];

try {
    if (empty($action)) {
        throw new Exception('缺少 action 參數');
    }

    switch ($action) {
        case 'create_session':
            $createCode = $_REQUEST['createCode'] ?? '';
            if (empty($createCode)) {
                throw new Exception('缺少建立代碼');
            }
            $response = $syncSystem->createSession($createCode);
            break;

        case 'join_session':
            $sessionId = $_REQUEST['sessionId'] ?? '';
            $role = $_REQUEST['role'] ?? 'viewer'; // viewer 或 operator
            $clientId = $_REQUEST['clientId'] ?? null;  // 新增：客戶端傳來的裝置ID
            if (empty($sessionId)) {
                throw new Exception('缺少sessionId參數');
            }
            $response = $syncSystem->joinSession($sessionId, $role, $clientId);
            break;

        case 'join_by_share_code':
            // 新增：通過分享代碼加入工作階段
            $shareCode = $_REQUEST['shareCode'] ?? '';
            $role = $_REQUEST['role'] ?? 'viewer';
            $clientId = $_REQUEST['clientId'] ?? null;  // 新增：客戶端傳來的裝置ID
            if (empty($shareCode)) {
                throw new Exception('缺少分享代碼');
            }
            $response = $syncSystem->joinSessionByShareCode($shareCode, $role, $clientId);
            break;

        case 'restore_session':
            // 新增：還原工作階段連線（同一裝置，短期內）
            $sessionId = $_REQUEST['sessionId'] ?? '';
            $clientId = $_REQUEST['clientId'] ?? '';
            $role = $_REQUEST['role'] ?? 'viewer';
            if (empty($sessionId) || empty($clientId)) {
                throw new Exception('缺少sessionId或clientId參數');
            }
            $response = $syncSystem->restoreSession($sessionId, $clientId, $role);
            break;

        case 'sync_state':
            $sessionId = $_REQUEST['sessionId'] ?? '';
            $state = $_REQUEST['state'] ?? null;
            if (empty($sessionId)) {
                throw new Exception('缺少sessionId參數');
            }
            $response = $syncSystem->syncState($sessionId, $state);
            break;

        case 'get_state':
            $sessionId = $_REQUEST['sessionId'] ?? '';
            $lastUpdate = intval($_REQUEST['lastUpdate'] ?? 0);
            if (empty($sessionId)) {
                throw new Exception('缺少sessionId參數');
            }
            $response = $syncSystem->getState($sessionId, $lastUpdate);
            break;

        case 'get_session_clients':
            // 新增：取得工作階段中的所有客戶端資訊
            $sessionId = $_REQUEST['sessionId'] ?? '';
            if (empty($sessionId)) {
                throw new Exception('缺少sessionId參數');
            }
            $response = $syncSystem->getSessionClients($sessionId);
            break;

        case 'validate_share_code':
            // 驗證分享代碼的檢查碼
            $shareCode = $_REQUEST['shareCode'] ?? '';
            if (empty($shareCode)) {
                throw new Exception('缺少shareCode參數');
            }
            $response = $syncSystem->validateShareCode($shareCode);
            break;

        case 'validate_session_id':
            // 驗證工作階段ID的檢查碼
            $sessionId = $_REQUEST['sessionId'] ?? '';
            if (empty($sessionId)) {
                throw new Exception('缺少sessionId參數');
            }
            $response = $syncSystem->validateSessionId($sessionId);
            break;

        case 'get_share_code_info':
            // 取得分享代碼資訊
            $shareCode = $_REQUEST['shareCode'] ?? '';
            if (empty($shareCode)) {
                throw new Exception('缺少shareCode參數');
            }
            $response = $syncSystem->getShareCodeInfo($shareCode);
            break;

        case 'health_check':
            // 簡單的健康檢查端點
            $response = [
                'success' => true,
                'message' => '伺服器在線',
                'timestamp' => time()
            ];
            break;

        case 'getServerTime':
            // 新增：返回伺服器時間（毫秒級）用於客戶端時間同步
            // 用於計算客戶端與伺服器的時間偏差
            $response = [
                'success' => true,
                'message' => '伺服器時間',
                'serverTime' => intval(microtime(true) * 1000),  // 毫秒級時間戳
                'timestamp' => time(),  // 秒級時間戳（用於診斷）
                'timezone' => 'Asia/Taipei'  // 伺服器時區（東八區）
            ];
            break;

        case 'regenerate_share_code':
            // 重新產生分享代碼 - 為現有工作階段產生新的分享代碼
            $sessionId = $_REQUEST['sessionId'] ?? null;
            $clientId = $_REQUEST['clientId'] ?? null;
            if (!$sessionId) {
                throw new Exception('缺少 sessionId 參數');
            }
            $newShareCode = $syncSystem->regenerateShareCode($sessionId, $clientId);
            $response = [
                'success' => true,
                'message' => '已產生新的分享代碼',
                'data' => [
                    'sessionId' => $sessionId,
                    'shareCode' => $newShareCode
                ]
            ];
            break;

        case 'list_sessions':
            // 列出所有工作階段
            $sessions = $syncSystem->listSessions();
            $response = [
                'success' => true,
                'message' => '工作階段列表',
                'data' => $sessions
            ];
            break;

        case 'delete_session':
            // 刪除指定工作階段
            $sessionId = $_REQUEST['sessionId'] ?? null;
            if (!$sessionId) {
                throw new Exception('缺少 sessionId 參數');
            }
            $syncSystem->deleteSession($sessionId);
            $response = [
                'success' => true,
                'message' => '工作階段已刪除',
                'data' => $sessionId
            ];
            break;

        case 'diagnose':
            // 診斷端點 - 檢查檔案系統和路徑配置
            $sessionsPath = __DIR__ . '/../sessions/';
            $shareCodesPath = __DIR__ . '/../sessions/share_codes/';

            $diagnostics = [
                'server_time' => time(),
                'php_version' => phpversion(),
                'sessions_path' => $sessionsPath,
                'sessions_path_exists' => file_exists($sessionsPath),
                'sessions_path_writable' => is_writable($sessionsPath),
                'sessions_path_readable' => is_readable($sessionsPath),
                'share_codes_path' => $shareCodesPath,
                'share_codes_path_exists' => file_exists($shareCodesPath),
                'share_codes_path_writable' => is_writable($shareCodesPath),
                'share_codes_path_readable' => is_readable($shareCodesPath),
            ];

            $response = [
                'success' => true,
                'message' => '診斷資訊',
                'data' => $diagnostics
            ];
            break;

        case 'cleanup':
            // 清理過期工作階段
            $expired = $syncSystem->cleanup();
            $response = [
                'success' => true,
                'message' => "清理完成: 已刪除 {$expired} 個過期項目",
                'data' => $expired
            ];
            break;

        case 'force_cleanup':
            // 強制清理：刪除所有沒有活躍客戶端的 sessions
            $forceClean = $syncSystem->forceCleanup();
            $response = [
                'success' => true,
                'message' => "強制清理完成: 已刪除 {$forceClean['deleted']} 個項目，失敗 {$forceClean['failed']} 個",
                'data' => $forceClean
            ];
            break;

        default:
            throw new Exception('未知的操作: ' . htmlspecialchars($action));
    }
} catch (Exception $e) {
    $response = [
        'success' => false,
        'message' => $e->getMessage(),
        'data' => null,
        'error_trace' => [
            'file' => $e->getFile(),
            'line' => $e->getLine()
        ]
    ];
} catch (Throwable $e) {
    // 捕捉所有可能的錯誤（包括 ParseError 等）
    $response = [
        'success' => false,
        'message' => '伺服器內部錯誤: ' . $e->getMessage(),
        'data' => null,
        'error_type' => get_class($e)
    ];
}

// 確保沒有任何額外輸出被送出
ob_clean();

// 回傳 JSON 響應
header('Content-Type: application/json; charset=UTF-8');
echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
exit();
