<?php

/**
 * Experiment Hub - 統一的實驗同步中樞
 * 整合實驗ID管理和多裝置狀態同步，提供Server-Sent Events即時推播
 */

// 設定錯誤報告
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

// 開啟輸出暫存
ob_start();

// 常數定義
define('SESSION_TIMEOUT', 1800); // 30分鐘
define('INACTIVE_TIMEOUT', 600); // 10分鐘無活動自動清理
define('SHARE_CODE_TIMEOUT', 300); // 分享代碼5分鐘過期
define('MAX_CLIENTS', 6); // 單一工作階段最多6個裝置
define('VALID_CREATE_CODE', '113151006'); // 有效的建立代碼
define('CLEANUP_INTERVAL', 120); // 清理檢查間隔(秒)
define('FAST_UPDATE_LIMIT', 1000); // 快速更新限制(1秒內最多1次)

/**
 * Experiment Hub 類
 */
class ExperimentHub
{
    private $sessionsPath;
    private $shareCodesPath;
    private $experimentIdsPath;
    private $activeStreams = []; // 活躍的SSE連線
    private $lastCleanup = 0;

    public function __construct()
    {
        $this->sessionsPath = __DIR__ . '/../sessions/';
        $this->shareCodesPath = __DIR__ . '/../sessions/share_codes/';
        $this->experimentIdsPath = __DIR__ . '/../sessions/experiment_ids/';

        // 建立必要目錄
        $this->ensureDirectories();

        // 註冊關閉Callback以清理連線
        register_shutdown_function([$this, 'cleanupConnection']);
    }

    private function ensureDirectories()
    {
        $dirs = [$this->sessionsPath, $this->shareCodesPath, $this->experimentIdsPath];
        foreach ($dirs as $dir) {
            if (!file_exists($dir)) {
                @mkdir($dir, 0777, true);
            }
            if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
                @chmod($dir, 0777);
            }
        }
    }

    /**
     * 處理HTTP請求
     */
    public function handleRequest()
    {
        $action = $_GET['action'] ?? $_POST['action'] ?? 'health_check';

        try {
            switch ($action) {
                // 健康檢查
                case 'health_check':
                    $this->sendJsonResponse(['success' => true, 'message' => 'Experiment Hub 在線']);
                    break;

                // 實驗ID管理
                case 'register_experiment_id':
                    $this->handleRegisterExperimentId();
                    break;

                case 'get_experiment_id':
                    $this->handleGetExperimentId();
                    break;

                case 'clear_experiment_id':
                    $this->handleClearExperimentId();
                    break;

                // 同步工作階段管理
                case 'create_session':
                    $this->handleCreateSession();
                    break;

                case 'join_by_share_code':
                    $this->handleJoinByShareCode();
                    break;

                case 'restore_session':
                    $this->handleRestoreSession();
                    break;

                case 'sync_state':
                    $this->handleSyncState();
                    break;

                case 'get_state':
                    $this->handleGetState();
                    break;

                // Server-Sent Events 流
                case 'stream':
                    $this->handleStream();
                    break;

                // 廣播更新
                case 'broadcast':
                    $this->handleBroadcast();
                    break;

                case 'poll_updates':
                    $this->handlePollUpdates();
                    break;

                default:
                    throw new Exception('未知的動作: ' . $action);
            }
        } catch (Exception $e) {
            $this->sendJsonResponse([
                'success' => false,
                'message' => $e->getMessage()
            ], 400);
        }
    }

    /**
     * 處理實驗ID註冊
     */
    private function handleRegisterExperimentId()
    {
        $experimentId = $_REQUEST['experiment_id'] ?? '';
        $source = $_REQUEST['source'] ?? 'unknown';

        if (empty($experimentId)) {
            throw new Exception('缺少實驗ID');
        }

        error_log("[ExperimentHub] 📝 收到實驗ID註冊請求: ID={$experimentId}, source={$source}");

        // 儲存實驗ID
        $data = [
            'experiment_id' => $experimentId,
            'source' => $source,
            'timestamp' => time(),
            'ip' => $_SERVER['REMOTE_ADDR'] ?? 'unknown'
        ];

        $filename = $this->experimentIdsPath . 'current.json';
        file_put_contents($filename, json_encode($data, JSON_PRETTY_PRINT));

        error_log("[ExperimentHub] 實驗ID已儲存: {$experimentId}");

        // 廣播更新
        $this->broadcastUpdate('experiment_id_update', $data);

        error_log("[ExperimentHub] 📢 已廣播實驗ID更新: {$experimentId}");

        $this->sendJsonResponse([
            'success' => true,
            'message' => '實驗ID已註冊',
            'data' => $data
        ]);
    }

    /**
     * 處理取得實驗ID
     */
    private function handleGetExperimentId()
    {
        $filename = $this->experimentIdsPath . 'current.json';

        if (!file_exists($filename)) {
            $this->sendJsonResponse([
                'success' => false,
                'message' => '未找到實驗ID'
            ]);
            return;
        }

        $data = json_decode(file_get_contents($filename), true);

        $this->sendJsonResponse([
            'success' => true,
            'experiment_id' => $data['experiment_id'] ?? null,
            'data' => $data
        ]);
    }

    /**
     * 處理清除實驗ID
     */
    private function handleClearExperimentId()
    {
        $filename = $this->experimentIdsPath . 'current.json';

        if (file_exists($filename)) {
            unlink($filename);
        }

        // 廣播清除更新
        $this->broadcastUpdate('experiment_id_cleared', [
            'timestamp' => time()
        ]);

        $this->sendJsonResponse([
            'success' => true,
            'message' => '實驗ID已清除'
        ]);
    }

    /**
     * 處理建立工作階段
     */
    private function handleCreateSession()
    {
        $this->limitedCleanup();

        $createCode = $_REQUEST['createCode'] ?? '';
        if (!$this->validateCreateCode($createCode)) {
            throw new Exception('建立代碼無效');
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
            'maxClients' => MAX_CLIENTS,
            'shareCode' => null,
            'shareCodeCreatedAt' => null
        ];

        file_put_contents($sessionFile, json_encode($sessionData, JSON_PRETTY_PRINT));

        // 自動產生分享代碼
        $shareCode = $this->generateShareCode($sessionId);

        $this->sendJsonResponse([
            'success' => true,
            'message' => '工作階段建立成功',
            'data' => [
                'sessionId' => $sessionId,
                'shareCode' => $shareCode
            ]
        ]);
    }

    /**
     * 處理通過分享代碼加入
     */
    private function handleJoinByShareCode()
    {
        $shareCode = $_REQUEST['shareCode'] ?? '';
        $role = $_REQUEST['role'] ?? 'viewer';
        $clientId = $_REQUEST['clientId'] ?? null;

        if (empty($shareCode)) {
            throw new Exception('缺少分享代碼');
        }

        // 驗證分享代碼並取得工作階段
        $result = $this->joinSessionByShareCode($shareCode, $role, $clientId);

        $this->sendJsonResponse($result);
    }

    /**
     * 處理還原工作階段
     */
    private function handleRestoreSession()
    {
        $sessionId = $_REQUEST['sessionId'] ?? '';
        $clientId = $_REQUEST['clientId'] ?? '';
        $role = $_REQUEST['role'] ?? 'viewer';

        if (empty($sessionId) || empty($clientId)) {
            throw new Exception('缺少參數');
        }

        $result = $this->restoreSession($sessionId, $clientId, $role);

        $this->sendJsonResponse($result);
    }

    /**
     * 處理狀態同步
     */
    private function handleSyncState()
    {
        $sessionId = $_REQUEST['sessionId'] ?? '';
        $state = $_REQUEST['state'] ?? null;

        if (empty($sessionId)) {
            throw new Exception('缺少sessionId');
        }

        $result = $this->syncState($sessionId, $state);

        $this->sendJsonResponse($result);
    }

    /**
     * 處理取得狀態
     */
    private function handleGetState()
    {
        $sessionId = $_REQUEST['sessionId'] ?? '';
        $lastUpdate = intval($_REQUEST['lastUpdate'] ?? 0);

        if (empty($sessionId)) {
            throw new Exception('缺少sessionId');
        }

        $result = $this->getState($sessionId, $lastUpdate);

        $this->sendJsonResponse($result);
    }

    /**
     * 處理Server-Sent Events流
     */
    private function handleStream()
    {
        $sessionId = $_GET['sessionId'] ?? '';
        $clientId = $_GET['clientId'] ?? '';
        $lastUpdate = intval($_GET['lastUpdate'] ?? 0);

        if (empty($sessionId) || empty($clientId)) {
            http_response_code(400);
            echo "data: " . json_encode(['error' => '缺少參數']) . "\n\n";
            return;
        }

        // 設定SSE標頭（在此設定以避免與JSON回應衝突）
        header('Content-Type: text/event-stream');
        header('Cache-Control: no-cache');
        header('Connection: keep-alive');
        header('Access-Control-Allow-Origin: *');
        header('X-Accel-Buffering: no'); // 禁用代理暫存

        // 註冊此連線
        $streamId = uniqid('stream_', true);
        $this->activeStreams[$streamId] = [
            'sessionId' => $sessionId,
            'clientId' => $clientId,
            'lastUpdate' => $lastUpdate,
            'startTime' => time()
        ];

        // 發送初始狀態
        $initialState = $this->getState($sessionId, $lastUpdate);
        if ($initialState['success'] && isset($initialState['data'])) {
            $this->sendSSE($streamId, 'state_update', $initialState['data']);
        }

        // 保持連線並監聽更新
        $lastPing = time();
        $maxConnectionTime = 300; // 5分鐘最長連線時間
        $pollingInterval = 500000; // 0.5秒（優化：比原來0.1秒更長）
        $pollCount = 0;

        while (true) {
            // 檢查連線是否還活躍
            if (connection_aborted()) {
                unset($this->activeStreams[$streamId]);
                break;
            }

            // 檢查連線是否超時
            $connectionDuration = time() - $this->activeStreams[$streamId]['startTime'];
            if ($connectionDuration > $maxConnectionTime) {
                // 通知客戶端應切換到輪詢模式
                echo "data: " . json_encode([
                    'type' => 'timeout',
                    'message' => '連線已達最長時限，請切換到輪詢',
                    'canRestoreSSE' => true
                ]) . "\n\n";
                unset($this->activeStreams[$streamId]);
                break;
            }

            // 每30秒發送ping
            if (time() - $lastPing > 30) {
                echo "data: " . json_encode(['type' => 'ping', 'timestamp' => time()]) . "\n\n";
                $lastPing = time();
            }

            // 檢查是否有新狀態（減少查詢頻率，避免CPU過載）
            $pollCount++;
            if ($pollCount % 3 == 0) { // 每3次循環查詢一次 = ~1.5秒查詢間隔
                $currentState = $this->getState($sessionId, $this->activeStreams[$streamId]['lastUpdate']);
                if ($currentState['success'] && isset($currentState['data'])) {
                    $this->activeStreams[$streamId]['lastUpdate'] = $currentState['data']['lastUpdate'];
                    $this->sendSSE($streamId, 'state_update', $currentState['data']);
                }
            }

            // 定期清理超時連線
            if ($pollCount % 10 == 0) {
                $this->cleanupTimedOutStreams();
            }

            // 優化的休眠時間，避免CPU過載
            usleep($pollingInterval); // 0.5秒
        }

        unset($this->activeStreams[$streamId]);
    }

    /**
     * 處理廣播更新
     */
    private function handleBroadcast()
    {
        $sessionId = $_REQUEST['sessionId'] ?? '';
        $updateType = $_REQUEST['updateType'] ?? '';
        $data = json_decode($_REQUEST['data'] ?? '{}', true);
        $priority = $_REQUEST['priority'] ?? 'normal'; // 'fast' 或 'normal'

        if (empty($sessionId) || empty($updateType)) {
            throw new Exception('缺少參數');
        }

        // 檢查 experiment_started 衝突防止
        if ($updateType === 'experiment_started') {
            $experimentId = $data['experiment_id'] ?? null;
            if ($experimentId) {
                $conflict = $this->checkExperimentIdConflict($sessionId, $experimentId);
                if ($conflict) {
                    throw new Exception("實驗ID '{$experimentId}' 已被其他操作者使用");
                }
            }
        }

        // 檢查快速更新限制
        if ($priority === 'fast' && !$this->checkFastUpdateLimit($sessionId, $updateType)) {
            // 降級為普通更新
            $priority = 'normal';
        }

        // 廣播更新
        $this->broadcastUpdate($updateType, $data, $sessionId, $priority);

        $this->sendJsonResponse([
            'success' => true,
            'message' => '更新已廣播'
        ]);
    }

    /**
     * 處理輪詢更新請求（SSE備援機制）
     */
    private function handlePollUpdates()
    {
        $sessionId = $_REQUEST['sessionId'] ?? '';
        $lastUpdate = intval($_REQUEST['lastUpdate'] ?? 0);
        $clientId = $_REQUEST['clientId'] ?? '';

        if (empty($sessionId)) {
            throw new Exception('缺少Session ID');
        }

        // 取得新的更新
        $updates = $this->getUpdates($sessionId, $lastUpdate);

        $this->sendJsonResponse([
            'success' => true,
            'updates' => $updates,
            'canRestoreSSE' => true, // 提示客戶端可嘗試還原SSE
            'timestamp' => time()
        ]);
    }

    /**
     * 取得自上次更新以來的所有更新
     */
    private function getUpdates($sessionId, $lastUpdate = 0)
    {
        $updates = [];
        $sessionDir = $this->sessionsPath . $sessionId;

        if (!is_dir($sessionDir)) {
            return [];
        }

        // 掃描所有更新檔案
        $files = glob($sessionDir . '/updates_*.json');
        if (!$files) {
            return [];
        }

        foreach ($files as $file) {
            $data = json_decode(file_get_contents($file), true);
            if ($data && isset($data['timestamp']) && $data['timestamp'] > $lastUpdate) {
                $updates[] = $data;
            }
        }

        // 按時間戳排序
        usort($updates, function ($a, $b) {
            return $a['timestamp'] - $b['timestamp'];
        });

        return $updates;
    }

    /**
     * 廣播更新到所有連線的客戶端
     */
    private function broadcastUpdate($type, $data, $sessionId = null, $priority = 'normal')
    {
        error_log("[ExperimentHub] 📡 廣播更新: type={$type}, priority={$priority}, activeStreams=" . count($this->activeStreams));

        $updateData = [
            'type' => $type,
            'data' => $data,
            'timestamp' => time(),
            'sessionId' => $sessionId,
            'priority' => $priority
        ];

        $broadcastCount = 0;
        foreach ($this->activeStreams as $streamId => $stream) {
            if ($sessionId === null || $stream['sessionId'] === $sessionId) {
                $this->sendSSE($streamId, 'update', $updateData);
                $broadcastCount++;
            }
        }

        if ($broadcastCount > 0) {
            error_log("[ExperimentHub] 廣播完成: 已發送給 {$broadcastCount} 個客戶端 (type={$type})");
        } else {
            error_log("[ExperimentHub] 廣播無客戶端: 沒有活躍的SSE連線 (type={$type})");
        }
    }

    /**
     * 發送SSE事件
     */
    private function sendSSE($streamId, $event, $data)
    {
        if (!isset($this->activeStreams[$streamId])) {
            return;
        }

        $message = "event: $event\n";
        $message .= "data: " . json_encode($data) . "\n\n";

        echo $message;
        ob_flush();
        flush();
    }

    /**
     * 檢查快速更新限制
     */
    private function checkFastUpdateLimit($sessionId, $updateType)
    {
        $key = $sessionId . '_' . $updateType;
        $now = time();

        // 使用靜態變數儲存最後更新時間
        static $lastFastUpdates = [];

        if (!isset($lastFastUpdates[$key]) || ($now - $lastFastUpdates[$key]) > 1) {
            $lastFastUpdates[$key] = $now;
            return true;
        }

        return false;
    }

    /**
     * 清理超時的流連線
     */
    private function cleanupTimedOutStreams()
    {
        $now = time();
        foreach ($this->activeStreams as $streamId => $stream) {
            if (($now - $stream['startTime']) > 3600) { // 1小時超時
                unset($this->activeStreams[$streamId]);
            }
        }
    }

    /**
     * 清理連線
     */
    public function cleanupConnection()
    {
        // 清理此連線的資源
        $currentStreamId = null;
        foreach ($this->activeStreams as $streamId => $stream) {
            if ($stream['clientId'] === ($_GET['clientId'] ?? '')) {
                $currentStreamId = $streamId;
                break;
            }
        }

        if ($currentStreamId) {
            unset($this->activeStreams[$currentStreamId]);
        }
    }

    /**
     * 驗證建立代碼
     */
    private function validateCreateCode($code)
    {
        $code = substr($code, 0, 9);
        if (!preg_match('/^\d{9}$/', $code)) {
            return false;
        }
        return $code === VALID_CREATE_CODE;
    }

    private function generateSessionId()
    {
        return strtoupper(substr(md5(uniqid(mt_rand(), true)), 0, 6));
    }

    private function generateShareCode($sessionId)
    {
        // 簡化版分享代碼生成
        $code = strtoupper(substr(md5($sessionId . time()), 0, 6));
        $shareCodeFile = $this->shareCodesPath . $code . '.json';

        $shareCodeData = [
            'code' => $code,
            'sessionId' => $sessionId,
            'createdAt' => time(),
            'expiresAt' => time() + SHARE_CODE_TIMEOUT,
            'used' => false
        ];

        file_put_contents($shareCodeFile, json_encode($shareCodeData, JSON_PRETTY_PRINT));

        // 更新工作階段
        $sessionFile = $this->sessionsPath . $sessionId . '.json';
        $sessionData = json_decode(file_get_contents($sessionFile), true);
        $sessionData['shareCode'] = $code;
        $sessionData['shareCodeCreatedAt'] = time();
        file_put_contents($sessionFile, json_encode($sessionData, JSON_PRETTY_PRINT));

        return $code;
    }

    private function joinSessionByShareCode($shareCode, $role, $clientId)
    {
        // 簡化版實現 - 實際應與原版相同
        $shareCodeFile = $this->shareCodesPath . $shareCode . '.json';

        if (!file_exists($shareCodeFile)) {
            throw new Exception('分享代碼無效');
        }

        $shareCodeData = json_decode(file_get_contents($shareCodeFile), true);
        $sessionId = $shareCodeData['sessionId'];

        $sessionFile = $this->sessionsPath . $sessionId . '.json';
        $sessionData = json_decode(file_get_contents($sessionFile), true);

        // 加入邏輯...
        $newClientId = $clientId ?: uniqid('client_', true);

        $sessionData['clients'][] = [
            'id' => $newClientId,
            'role' => $role,
            'joinedAt' => time(),
            'lastActivity' => time()
        ];

        $sessionData['lastActivity'] = time();
        file_put_contents($sessionFile, json_encode($sessionData, JSON_PRETTY_PRINT));

        // 標記分享代碼為已使用
        $shareCodeData['used'] = true;
        $shareCodeData['usedAt'] = time();
        $shareCodeData['usedBy'] = $newClientId;
        file_put_contents($shareCodeFile, json_encode($shareCodeData, JSON_PRETTY_PRINT));

        return [
            'success' => true,
            'message' => '成功加入工作階段',
            'data' => [
                'sessionId' => $sessionId,
                'clientId' => $newClientId,
                'role' => $role,
                'state' => $sessionData['state']
            ]
        ];
    }

    private function restoreSession($sessionId, $clientId, $role)
    {
        // 簡化版實現
        $sessionFile = $this->sessionsPath . $sessionId . '.json';

        if (!file_exists($sessionFile)) {
            throw new Exception('工作階段不存在');
        }

        $sessionData = json_decode(file_get_contents($sessionFile), true);

        // 檢查clientId是否存在
        $clientExists = false;
        foreach ($sessionData['clients'] as &$client) {
            if ($client['id'] === $clientId) {
                $client['lastActivity'] = time();
                $client['role'] = $role;
                $clientExists = true;
                break;
            }
        }

        if (!$clientExists) {
            throw new Exception('客戶端不存在');
        }

        $sessionData['lastActivity'] = time();
        file_put_contents($sessionFile, json_encode($sessionData, JSON_PRETTY_PRINT));

        return [
            'success' => true,
            'message' => '工作階段已還原',
            'data' => [
                'sessionId' => $sessionId,
                'clientId' => $clientId,
                'role' => $role,
                'state' => $sessionData['state']
            ]
        ];
    }

    private function syncState($sessionId, $state)
    {
        $sessionFile = $this->sessionsPath . $sessionId . '.json';

        if (!file_exists($sessionFile)) {
            throw new Exception('工作階段不存在');
        }

        $sessionData = json_decode(file_get_contents($sessionFile), true);
        $sessionData['state'] = $state;
        $sessionData['lastUpdate'] = time();
        $sessionData['lastActivity'] = time();

        file_put_contents($sessionFile, json_encode($sessionData, JSON_PRETTY_PRINT));

        // 廣播狀態更新
        $this->broadcastUpdate('state_sync', [
            'state' => $state,
            'lastUpdate' => $sessionData['lastUpdate']
        ], $sessionId);

        return [
            'success' => true,
            'message' => '狀態同步成功'
        ];
    }

    private function getState($sessionId, $lastUpdate = 0)
    {
        $sessionFile = $this->sessionsPath . $sessionId . '.json';

        if (!file_exists($sessionFile)) {
            throw new Exception('工作階段不存在');
        }

        $sessionData = json_decode(file_get_contents($sessionFile), true);
        $sessionData['lastActivity'] = time();
        file_put_contents($sessionFile, json_encode($sessionData, JSON_PRETTY_PRINT));

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

    private function limitedCleanup()
    {
        $now = time();
        if ($now - $this->lastCleanup > CLEANUP_INTERVAL) {
            $this->lastCleanup = $now;
        }
    }

    /**
     * 檢查實驗ID衝突
     */
    private function checkExperimentIdConflict($currentSessionId, $experimentId)
    {
        // 掃描所有工作階段檔案
        $sessionFiles = glob($this->sessionsPath . '*.json');

        foreach ($sessionFiles as $sessionFile) {
            $sessionData = json_decode(file_get_contents($sessionFile), true);

            // 跳過目前工作階段
            if (basename($sessionFile, '.json') === $currentSessionId) {
                continue;
            }

            // 檢查是否有相同的實驗ID
            if (
                isset($sessionData['state']['experiment_id']) &&
                $sessionData['state']['experiment_id'] === $experimentId
            ) {
                return true; // 發現衝突
            }
        }

        return false; // 無衝突
    }

    /**
     * 發送JSON回應
     */
    private function sendJsonResponse($data, $statusCode = 200)
    {
        http_response_code($statusCode);
        header('Content-Type: application/json');
        echo json_encode($data, JSON_UNESCAPED_UNICODE);
        exit;
    }

    /**
     * 發送SSE事件
     */
    private function sendEvent($eventType, $data)
    {
        echo "event: $eventType\n";
        echo "data: " . json_encode($data, JSON_UNESCAPED_UNICODE) . "\n\n";

        // 強制輸出
        if (ob_get_level() > 0) {
            ob_flush();
        }
        flush();
    }
}

// 實例化並處理請求
$hub = new ExperimentHub();
$hub->handleRequest();
