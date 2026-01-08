<?php
header('Content-Type: application/json; charset=utf-8');

/**
 * 實驗ID中樞管理器
 * 提供三個系統 (虛擬面板、舊劇本產生器、新實驗管理系統) 共享實驗ID的機制
 */

class ExperimentIdHub
{
    private $session_id_key = 'experiment_id_hub_session';
    private $storage_file;

    public function __construct()
    {
        // 使用 PHP session 作為臨時儲存
        $this->storage_file = sys_get_temp_dir() . '/experiment_id_hub.json';
        session_start();
    }

    /**
     * 註冊實驗ID - 由任何一個系統設定
     */
    public function register_experiment_id($experiment_id, $source = 'unknown', $additional_data = [])
    {
        if (empty($experiment_id)) {
            return ['success' => false, 'error' => '實驗ID不能為空'];
        }

        $data = [
            'experiment_id' => $experiment_id,
            'source' => $source,
            'timestamp' => date('c'),
            'session_id' => session_id(),
            'subject_name' => $additional_data['subject_name'] ?? null,
            'combination_name' => $additional_data['combination_name'] ?? null,
            'combination_id' => $additional_data['combination_id'] ?? null,
            'gesture_count' => $additional_data['gesture_count'] ?? 0,
            'gesture_sequence' => $additional_data['gesture_sequence'] ?? null,
            'current_step' => $additional_data['current_step'] ?? 0,
            'is_running' => $additional_data['is_running'] ?? false
        ];

        // 儲存到 session
        $_SESSION['current_experiment_id'] = $experiment_id;
        $_SESSION['experiment_source'] = $source;
        $_SESSION['experiment_timestamp'] = time();
        $_SESSION['experiment_data'] = $data;

        // 同時儲存到檔案（用於跨 session）
        file_put_contents($this->storage_file, json_encode($data, JSON_UNESCAPED_UNICODE));

        return [
            'success' => true,
            'experiment_id' => $experiment_id,
            'source' => $source,
            'timestamp' => $data['timestamp'],
            'session_id' => session_id()
        ];
    }

    /**
     * 取得目前實驗ID
     */
    public function get_current_experiment_id()
    {
        // 首先從 session 取得
        if (!empty($_SESSION['experiment_data'])) {
            return array_merge([
                'success' => true,
                'from' => 'session'
            ], $_SESSION['experiment_data']);
        }

        // 再從檔案取得
        if (file_exists($this->storage_file)) {
            $data = json_decode(file_get_contents($this->storage_file), true);
            if ($data && !empty($data['experiment_id'])) {
                return array_merge([
                    'success' => true,
                    'from' => 'file'
                ], $data);
            }
        }

        return [
            'success' => false,
            'error' => '無目前實驗ID',
            'experiment_id' => null
        ];
    }

    /**
     * 清空實驗ID
     */
    public function clear_experiment_id()
    {
        unset($_SESSION['current_experiment_id']);
        unset($_SESSION['experiment_source']);
        unset($_SESSION['experiment_timestamp']);

        if (file_exists($this->storage_file)) {
            unlink($this->storage_file);
        }

        return ['success' => true, 'message' => '實驗ID已清空'];
    }
}

// 處理 API 請求
$hub = new ExperimentIdHub();
$action = $_GET['action'] ?? $_POST['action'] ?? '';

try {
    switch ($action) {
        case 'register':
            $experiment_id = $_GET['experiment_id'] ?? $_POST['experiment_id'] ?? '';
            $source = $_GET['source'] ?? $_POST['source'] ?? 'unknown';

            // 接收額外資料
            $additional_data = [
                'subject_name' => $_GET['subject_name'] ?? $_POST['subject_name'] ?? null,
                'combination_name' => $_GET['combination_name'] ?? $_POST['combination_name'] ?? null,
                'combination_id' => $_GET['combination_id'] ?? $_POST['combination_id'] ?? null,
                'gesture_count' => $_GET['gesture_count'] ?? $_POST['gesture_count'] ?? 0,
                'is_running' => $_GET['is_running'] ?? $_POST['is_running'] ?? false
            ];

            echo json_encode($hub->register_experiment_id($experiment_id, $source, $additional_data));
            break;

        case 'get':
            echo json_encode($hub->get_current_experiment_id());
            break;

        case 'clear':
            echo json_encode($hub->clear_experiment_id());
            break;

        default:
            http_response_code(400);
            echo json_encode(['error' => '未知動作: ' . $action]);
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
