<?php

/**
 * MR Panel 簡化版同步 API
 * 使用 PHP + JSON 檔案進行 Session 管理
 * 改善版本：增加錯誤處理、安全性和穩定性
 */

// 設定錯誤報告
error_reporting(E_ALL);
ini_set('display_errors', 1);

// 系統配置
$config = [
    'sessionsDir' => dirname(__DIR__) . '/sessions',
    'sessionTimeout' => 7200, // 2小時
    'configFile' => dirname(__DIR__) . '/data/config.json',
    'maxDevices' => 4, // 每個 session 最多裝置數
    'debugMode' => true // 開發模式
];

// CORS 設定
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

function isAllowedOrigin($origin)
{
    if ($origin === null || $origin === '') {
        return true; // 允許直接存取
    }

    // 開發環境允許的來源
    $devOrigins = [
        'http://localhost',
        'http://127.0.0.1',
        'null', // 允許本機檔案存取
        'file://' // 允許本機檔案系統存取
    ];

    // 如果是開發環境，直接允許所有來源
    if ($GLOBALS['config']['debugMode']) {
        return true;
    }

    // 檢查是否為開發環境的網址
    foreach ($devOrigins as $devOrigin) {
        if (strpos($origin, $devOrigin) === 0) {
            return true;
        }
    }

    // 解析來源 URL
    $parsedUrl = parse_url($origin);
    if ($parsedUrl === false) {
        return false;
    }

    // 在正式環境中檢查是否來自同一個伺服器
    if (isset($_SERVER['HTTP_HOST']) && isset($parsedUrl['host'])) {
        return strcasecmp($_SERVER['HTTP_HOST'], $parsedUrl['host']) === 0;
    }

    return false;
}

// 設定 CORS 標頭
$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';

if ($origin !== '') {
    if (isAllowedOrigin($origin)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
        header('Access-Control-Allow-Credentials: true');
    } else if ($config['debugMode']) {
        // 在除錯模式下記錄被拒絕的來源
        error_log("CORS: 拒絕來自 $origin 的請求");
    }
}

header('Content-Type: application/json; charset=utf-8');

// 處理 CORS 預檢請求
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit(0);
}

// 檢查伺服器狀態的請求
if (isset($_GET['action']) && $_GET['action'] === 'check_status') {
    echo json_encode([
        'success' => true,
        'message' => 'PHP伺服器運作正常',
        'time' => date('Y-m-d H:i:s')
    ]);
    exit(0);
}

// 基本函數
function respondWithError($message, $code = 400)
{
    http_response_code($code);
    echo json_encode([
        'success' => false,
        'error' => $message
    ]);
    exit();
}

function respondWithSuccess($data)
{
    echo json_encode(array_merge(
        ['success' => true],
        $data
    ));
    exit();
}

// 確保 sessions 目錄存在
if (!is_dir($config['sessionsDir'])) {
    if (!mkdir($config['sessionsDir'], 0755, true)) {
        respondWithError('無法建立 sessions 目錄', 500);
    }
}

// 清理過期的 session 檔案
function cleanupSessions($dir, $timeout)
{
    foreach (glob("$dir/*.json") as $file) {
        $data = json_decode(file_get_contents($file), true);
        if ($data && isset($data['lastActivity']) && (time() - $data['lastActivity'] > $timeout)) {
            unlink($file);
        }
    }
}

// 驗證請求
try {
    // 驗證 Content-Type
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $contentType = isset($_SERVER['CONTENT_TYPE']) ? $_SERVER['CONTENT_TYPE'] : '';
        if (strpos($contentType, 'application/json') === false) {
            respondWithError('必須使用 application/json Content-Type');
        }
    }

    // 讀取請求內容
    $requestBody = file_get_contents('php://input');
    $input = !empty($requestBody) ? json_decode($requestBody, true) : [];

    if ($input === null && !empty($requestBody)) {
        respondWithError('無效的 JSON 格式');
    }

    // 定期清理過期的 sessions
    cleanupSessions($config['sessionsDir'], $config['sessionTimeout']);

    // 取得請求方法和動作
    $method = $_SERVER['REQUEST_METHOD'];
    $action = isset($_GET['action']) ? $_GET['action'] : '';

    // 路由處理
    switch ($action) {
        case 'create_session':
            if ($method !== 'POST') {
                respondWithError('建立 Session 必須使用 POST 方法', 405);
            }

            if (!isset($input['studentId'])) {
                respondWithError('缺少必要參數：studentId');
            }

            // 只取數字並驗證是否為9位
            $studentId = preg_replace('/[^0-9]/', '', $input['studentId']);
            if (strlen($studentId) !== 9) {
                respondWithError('學號格式不正確（需要9位數字）');
            }

            // 產生六位數代碼
            $sessionCode = sprintf('%06d', mt_rand(0, 999999));
            while (file_exists("$config[sessionsDir]/$sessionCode.json")) {
                $sessionCode = sprintf('%06d', mt_rand(0, 999999));
            }

            $deviceId = 'dev_' . bin2hex(random_bytes(8));

            $sessionData = [
                'code' => $sessionCode,
                'studentId' => $input['studentId'],
                'createdAt' => time(),
                'lastActivity' => time(),
                'devices' => [
                    [
                        'id' => $deviceId,
                        'type' => 'host',
                        'studentId' => $input['studentId'],
                        'joinedAt' => time(),
                        'lastSeen' => time()
                    ]
                ],
                'state' => [
                    'currentExperiment' => null,
                    'currentStep' => null,
                    'experimentData' => []
                ]
            ];

            if (!file_put_contents(
                "$config[sessionsDir]/$sessionCode.json",
                json_encode($sessionData, JSON_PRETTY_PRINT)
            )) {
                respondWithError('無法建立 Session 檔案', 500);
            }

            respondWithSuccess([
                'sessionCode' => $sessionCode,
                'deviceId' => $deviceId,
                'qrCode' => (isset($_SERVER['HTTPS']) ? 'https://' : 'http://') .
                    $_SERVER['HTTP_HOST'] .
                    dirname($_SERVER['REQUEST_URI']) .
                    '/?join=' . $sessionCode
            ]);
            break;

        case 'join_session':
            if ($method !== 'POST') {
                respondWithError('加入 Session 必須使用 POST 方法', 405);
            }

            $sessionCode = $input['sessionCode'] ?? '';
            $deviceType = $input['deviceType'] ?? 'client';

            if (empty($sessionCode)) {
                respondWithError('Session 代碼不能為空');
            }

            $sessionFile = "$config[sessionsDir]/$sessionCode.json";
            if (!file_exists($sessionFile)) {
                respondWithError('Session 不存在');
            }

            $session = json_decode(file_get_contents($sessionFile), true);
            if (!$session) {
                respondWithError('Session 檔案損壞');
            }

            if (time() - $session['lastActivity'] > $config['sessionTimeout']) {
                unlink($sessionFile);
                respondWithError('Session 已過期');
            }

            if (count($session['devices']) >= $config['maxDevices']) {
                respondWithError("Session 已滿（最多{$config['maxDevices']}個裝置）");
            }

            $deviceId = 'dev_' . bin2hex(random_bytes(8));
            $session['devices'][] = [
                'id' => $deviceId,
                'type' => $deviceType,
                'joinedAt' => time(),
                'lastSeen' => time()
            ];

            $session['lastActivity'] = time();

            if (!file_put_contents($sessionFile, json_encode($session, JSON_PRETTY_PRINT))) {
                respondWithError('無法更新 Session 檔案', 500);
            }

            respondWithSuccess([
                'deviceId' => $deviceId,
                'session' => [
                    'code' => $session['code'],
                    'devices' => count($session['devices']),
                    'state' => $session['state']
                ]
            ]);
            break;

        case 'sync_state':
            if ($method !== 'POST') {
                respondWithError('同步狀態必須使用 POST 方法', 405);
            }

            $sessionCode = $input['sessionCode'] ?? '';
            $deviceId = $input['deviceId'] ?? '';
            $state = $input['state'] ?? [];

            if (empty($sessionCode) || empty($deviceId)) {
                respondWithError('Session 代碼和裝置 ID 不能為空');
            }

            $sessionFile = "$config[sessionsDir]/$sessionCode.json";
            if (!file_exists($sessionFile)) {
                respondWithError('Session 不存在');
            }

            $session = json_decode(file_get_contents($sessionFile), true);
            if (!$session) {
                respondWithError('Session 檔案損壞');
            }

            $deviceFound = false;
            foreach ($session['devices'] as &$device) {
                if ($device['id'] === $deviceId) {
                    $device['lastSeen'] = time();
                    $deviceFound = true;
                    break;
                }
            }

            if (!$deviceFound) {
                respondWithError('裝置未授權');
            }

            if (!empty($state)) {
                $session['state'] = array_merge($session['state'], $state);
            }

            $session['lastActivity'] = time();

            if (!file_put_contents($sessionFile, json_encode($session, JSON_PRETTY_PRINT))) {
                respondWithError('無法更新 Session 檔案', 500);
            }

            respondWithSuccess([
                'state' => $session['state'],
                'devices' => count($session['devices'])
            ]);
            break;

        case 'check_session':
            if ($method !== 'POST') {
                respondWithError('檢查 Session 必須使用 POST 方法', 405);
            }

            $sessionCode = $input['sessionCode'] ?? '';
            $deviceId = $input['deviceId'] ?? '';

            if (empty($sessionCode) || empty($deviceId)) {
                respondWithError('Session 代碼和裝置 ID 不能為空');
            }

            $sessionFile = "$config[sessionsDir]/$sessionCode.json";
            if (!file_exists($sessionFile)) {
                respondWithError('Session 不存在');
            }

            $session = json_decode(file_get_contents($sessionFile), true);
            if (!$session) {
                respondWithError('Session 檔案損壞');
            }

            if (time() - $session['lastActivity'] > $config['sessionTimeout']) {
                unlink($sessionFile);
                respondWithError('Session 已過期');
            }

            $deviceFound = false;
            foreach ($session['devices'] as &$device) {
                if ($device['id'] === $deviceId) {
                    $device['lastSeen'] = time();
                    $deviceFound = true;
                    break;
                }
            }

            if (!$deviceFound) {
                respondWithError('裝置未授權');
            }

            $session['lastActivity'] = time();

            if (!file_put_contents($sessionFile, json_encode($session, JSON_PRETTY_PRINT))) {
                respondWithError('無法更新 Session 檔案', 500);
            }

            respondWithSuccess([
                'active' => true,
                'devices' => count($session['devices']),
                'state' => $session['state']
            ]);
            break;

        default:
            respondWithError('未知的操作', 400);
    }
} catch (Exception $e) {
    respondWithError($e->getMessage(), 500);
}
