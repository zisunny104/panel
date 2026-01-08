<?php

/**
 * experiment-log-api.php - 實驗日誌 API
 * 負責：
 * 1. 接收前端發送的日誌
 * 2. 儲存為 JSONL 檔案 (保留最近 30 份)
 * 3. 轉換為 CSV 並提供下載
 */

header('Content-Type: application/json; charset=utf-8');

class ExperimentLogAPI
{
    private $logsDir;
    private $maxExperiments = 30;

    public function __construct()
    {
        $this->logsDir = __DIR__ . '/../sessions/experiment_logs/';
        $this->ensureLogsDirectory();
    }

    /**
     * 確保日誌目錄存在
     */
    private function ensureLogsDirectory()
    {
        if (!file_exists($this->logsDir)) {
            if (!@mkdir($this->logsDir, 0777, true)) {
                http_response_code(500);
                echo json_encode(['success' => false, 'message' => '無法建立日誌目錄']);
                exit;
            }
        }

        if (!is_writable($this->logsDir)) {
            @chmod($this->logsDir, 0777);
        }
    }

    /**
     * 處理請求
     */
    public function handle()
    {
        $input = json_decode(file_get_contents('php://input'), true);

        // 如果沒有 POST JSON，嘗試從 GET 參數讀取
        if (!$input) {
            $input = $_GET;
        }

        if (!$input) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => '無效的請求']);
            exit;
        }

        $action = $input['action'] ?? null;

        switch ($action) {
            case 'log_batch':
                $this->saveLogs($input);
                break;
            case 'finalize_experiment':
                $this->finalizeExperiment($input);
                break;
            case 'list':
            case 'list_experiments':
                $this->listExperiments();
                break;
            case 'download_jsonl':
                $this->downloadAsJSONL($input);
                break;
            case 'get_jsonl_content':
                $this->getJsonlContent($input);
                break;
            case 'download_batch_zip':
                $this->downloadBatchZip($input);
                break;
            case 'delete':
            case 'delete_log':
                $this->deleteLog($input);
                break;
            case 'delete_multiple':
            case 'delete_multiple_logs':
                $this->deleteMultipleLogs($input);
                break;
            default:
                http_response_code(400);
                echo json_encode(['success' => false, 'message' => '未知的操作']);
        }
    }

    /**
     * 儲存日誌批次
     */
    private function saveLogs($input)
    {
        $logs = $input['logs'] ?? [];

        if (empty($logs)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => '缺少必要參數']);
            return;
        }

        // 分組日誌 - 按 exp_id 和 exp_start 事件分組
        $groupedLogs = $this->groupLogsByExperiment($logs);

        $savedCount = 0;
        $fileInfo = [];

        // 為每個實驗分別儲存
        foreach ($groupedLogs as $groupId => $expLogs) {
            $filePath = $this->logsDir . $groupId . '.jsonl';

            // 以追加模式寫入 JSONL
            $handle = fopen($filePath, 'a');
            if (!$handle) {
                error_log("無法寫入日誌檔案: $filePath");
                continue;
            }

            foreach ($expLogs as $log) {
                fwrite($handle, json_encode($log, JSON_UNESCAPED_UNICODE) . "\n");
                $savedCount++;
            }
            fclose($handle);

            $fileInfo[] = [
                'group_id' => $groupId,
                'file' => $groupId . '.jsonl',
                'logs' => count($expLogs)
            ];
        }

        echo json_encode([
            'success' => true,
            'message' => '日誌已儲存',
            'count' => $savedCount,
            'files' => $fileInfo,
            'groups' => count($groupedLogs)
        ]);
    }

    /**
     * 按實驗分組日誌
     * 依據 exp_start 事件和 exp_id 將日誌分組
     */
    private function groupLogsByExperiment($logs)
    {
        $grouped = [];
        $currentExpId = null;
        $currentGroupId = null;

        foreach ($logs as $log) {
            if (!is_array($log) && is_object($log)) {
                $log = json_decode(json_encode($log), true);
            }

            if (!is_array($log)) {
                continue;
            }

            $expId = $log['exp_id'] ?? null;
            $type = $log['type'] ?? null;

            // 如果沒有 exp_id，跳過
            if (!$expId) {
                continue;
            }

            // 當遇到 exp_start 時，創建新的組
            if ($type === 'exp_start') {
                // 為新實驗創建組 ID（exp_id + 時間戳以區分同一實驗的多次運行）
                $timestamp = $log['ts'] ?? time();
                $currentGroupId = $expId . '_' . intval($timestamp / 1000); // 轉換為秒級時間戳
                $currentExpId = $expId;

                if (!isset($grouped[$currentGroupId])) {
                    $grouped[$currentGroupId] = [];
                }
            }

            // 如果還沒有開始任何實驗，使用 exp_id 作為組
            if ($currentGroupId === null) {
                $currentGroupId = $expId;
                if (!isset($grouped[$currentGroupId])) {
                    $grouped[$currentGroupId] = [];
                }
            }

            // 新增日誌到目前組
            $grouped[$currentGroupId][] = $log;

            // 當實驗結束時，準備下一個
            if ($type === 'exp_end') {
                $currentGroupId = null;
                $currentExpId = null;
            }
        }

        return $grouped;
    }

    /**
     * 完成實驗 (清理舊檔案)
     */
    private function finalizeExperiment($input)
    {
        $expId = $input['exp_id'] ?? null;
        $totalLogs = $input['total_logs'] ?? 0;

        if (!$expId) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => '缺少實驗ID']);
            return;
        }

        // 清理超過 maxExperiments 的舊檔案
        $this->cleanupOldExperiments();

        echo json_encode([
            'success' => true,
            'message' => '實驗已完成',
            'exp_id' => $expId,
            'total_logs' => $totalLogs,
            'file_path' => $expId . '.jsonl'
        ]);
    }

    /**
     * 重新組織現有的日誌檔案 (將混合的日誌按實驗分組)
     * 這是一個工具方法，可用於管理界面
     */
    public function reorganizeLogs()
    {
        $files = array_filter(
            scandir($this->logsDir),
            function ($f) {
                return substr($f, -6) === '.jsonl';
            }
        );

        $results = [];

        foreach ($files as $file) {
            $filePath = $this->logsDir . $file;
            $lines = file($filePath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);

            if (!$lines) {
                continue;
            }

            $logs = [];
            foreach ($lines as $line) {
                $log = json_decode($line, true);
                if ($log) {
                    $logs[] = $log;
                }
            }

            if (empty($logs)) {
                continue;
            }

            // 分組
            $grouped = $this->groupLogsByExperiment($logs);

            $fileResults = [];
            foreach ($grouped as $groupId => $groupLogs) {
                $newFilePath = $this->logsDir . $groupId . '.jsonl';

                // 只有在新檔案不存在或檔案內容不同時才寫入
                if ($newFilePath !== $filePath) {
                    $handle = fopen($newFilePath, 'w');
                    if ($handle) {
                        foreach ($groupLogs as $log) {
                            fwrite($handle, json_encode($log, JSON_UNESCAPED_UNICODE) . "\n");
                        }
                        fclose($handle);
                        $fileResults[] = [
                            'group_id' => $groupId,
                            'file' => $groupId . '.jsonl',
                            'logs' => count($groupLogs)
                        ];
                    }
                }
            }

            $results[$file] = $fileResults;
        }

        return $results;
    }

    /**
     * 清理舊實驗日誌 (保留最近 30 份)
     */
    private function cleanupOldExperiments()
    {
        $files = array_filter(
            scandir($this->logsDir),
            function ($f) {
                return substr($f, -6) === '.jsonl';
            }
        );

        if (count($files) > $this->maxExperiments) {
            // 按修改時間排序
            usort($files, function ($a, $b) {
                $timeA = filemtime($this->logsDir . $a);
                $timeB = filemtime($this->logsDir . $b);
                return $timeA - $timeB; // 舊的在前
            });

            // 刪除超過限制的舊檔案
            $toDelete = array_slice($files, 0, count($files) - $this->maxExperiments);
            foreach ($toDelete as $file) {
                @unlink($this->logsDir . $file);
            }
        }
    }

    /**
     * 列出所有實驗
     */
    private function listExperiments()
    {
        $files = array_filter(
            scandir($this->logsDir),
            function ($f) {
                return substr($f, -6) === '.jsonl';
            }
        );

        usort($files, function ($a, $b) {
            return filemtime($this->logsDir . $b) - filemtime($this->logsDir . $a);
        });

        $experiments = [];
        foreach ($files as $file) {
            $expId = substr($file, 0, -6); // 移除 .jsonl
            $filePath = $this->logsDir . $file;
            $fileTime = filemtime($filePath);
            $experiments[] = [
                'exp_id' => $expId,
                'file' => $file,
                'size' => filesize($filePath),
                'modified' => date('Y-m-d H:i:s', $fileTime),
                'timestamp' => $fileTime * 1000  // 轉換為毫秒供前端使用（JavaScript 使用毫秒時間戳）
            ];
        }

        echo json_encode(['success' => true, 'experiments' => $experiments]);
    }

    /**
     * 下載為 JSONL
     * 搜尋並下載最新的 exp_id_timestamp.jsonl 檔案
     */
    private function downloadAsJSONL($input)
    {
        $expId = $input['exp_id'] ?? null;
        $experimentId = $input['experiment_id'] ?? null;

        // 相容新舊參數名稱
        $id = $experimentId ?? $expId;

        if (!$id) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => '缺少實驗ID']);
            return;
        }

        // 搜尋目錄中所有符合 {id}_*.jsonl 的檔案
        $pattern = $this->logsDir . preg_quote($id) . '_*.jsonl';
        $files = glob($pattern);

        if (empty($files)) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => '檔案不存在']);
            return;
        }

        // 取最新的檔案（按修改時間排序）
        usort($files, function ($a, $b) {
            return filemtime($b) - filemtime($a);
        });

        $filePath = $files[0];
        $filename = basename($filePath);

        // 設定下載頭
        header('Content-Type: application/x-ndjson; charset=utf-8');
        header('Content-Disposition: attachment; filename=' . $filename);
        header('Content-Length: ' . filesize($filePath));

        readfile($filePath);
        exit;
    }

    /**
     * 取得 JSONL 內容（用於檢視）
     */
    private function getJsonlContent($input)
    {
        $expId = $input['exp_id'] ?? null;

        if (!$expId) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => '缺少實驗ID']);
            return;
        }

        $filePath = $this->logsDir . $expId . '.jsonl';

        if (!file_exists($filePath)) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => '檔案不存在']);
            return;
        }

        try {
            $content = file_get_contents($filePath);
            echo json_encode([
                'success' => true,
                'content' => $content,
                'exp_id' => $expId,
                'file_size' => filesize($filePath),
                'modified_time' => filemtime($filePath)
            ]);
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => '無法讀取檔案: ' . $e->getMessage()]);
        }
    }

    /**
     * 批量下載為 ZIP
     */
    private function downloadBatchZip($input)
    {
        $expIds = $input['exp_ids'] ?? [];

        if (empty($expIds)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => '未指定實驗']);
            return;
        }

        // 建立臨時 ZIP
        $zipFile = tempnam(sys_get_temp_dir(), 'exp_logs_');
        $zip = new ZipArchive();

        if ($zip->open($zipFile, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => '無法建立 ZIP 檔案']);
            return;
        }

        foreach ($expIds as $expId) {
            $filePath = $this->logsDir . $expId . '.jsonl';
            if (file_exists($filePath)) {
                $csvData = $this->convertJSONLToCSV(file($filePath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES));
                $zip->addFromString($expId . '.csv', $csvData);
            }
        }

        $zip->close();

        // 下載 ZIP
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename=experiment_logs_' . date('YmdHis') . '.zip');
        header('Content-Length: ' . filesize($zipFile));

        readfile($zipFile);
        unlink($zipFile);
        exit;
    }

    /**
     * 刪除單一日誌
     */
    private function deleteLog($input)
    {
        $expId = $input['exp_id'] ?? $input['id'] ?? null;

        if (!$expId) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => '缺少實驗ID']);
            return;
        }

        $filePath = $this->logsDir . $expId . '.jsonl';

        if (!file_exists($filePath)) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => '檔案不存在']);
            return;
        }

        if (@unlink($filePath)) {
            echo json_encode(['success' => true, 'message' => '日誌已刪除']);
        } else {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => '刪除失敗']);
        }
    }

    /**
     * 刪除多個日誌
     */
    private function deleteMultipleLogs($input)
    {
        $expIds = $input['exp_ids'] ?? $input['ids'] ?? [];

        if (empty($expIds)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => '未指定實驗']);
            return;
        }

        $deleted = 0;
        $failed = [];

        foreach ($expIds as $expId) {
            $filePath = $this->logsDir . $expId . '.jsonl';
            if (file_exists($filePath)) {
                if (@unlink($filePath)) {
                    $deleted++;
                } else {
                    $failed[] = $expId;
                }
            }
        }

        echo json_encode([
            'success' => true,
            'deleted' => $deleted,
            'failed' => $failed,
            'message' => "已刪除 {$deleted} 個日誌"
        ]);
    }

    /**
     * 將 JSONL 轉換為 CSV
     */
    private function convertJSONLToCSV($lines)
    {
        if (empty($lines)) {
            return '';
        }

        $logs = [];
        foreach ($lines as $line) {
            if (trim($line)) {
                $log = json_decode($line, true);
                if ($log) {
                    $logs[] = $log;
                }
            }
        }

        if (empty($logs)) {
            return '';
        }

        // 合併所有可能的欄位
        $allKeys = [];
        foreach ($logs as $log) {
            $allKeys = array_unique(array_merge($allKeys, array_keys($log)));
        }
        sort($allKeys);

        // CSV 標頭
        $csv = fopen('php://memory', 'r+');
        fputcsv($csv, $allKeys);

        // CSV 資料
        foreach ($logs as $log) {
            $row = [];
            foreach ($allKeys as $key) {
                $row[] = $log[$key] ?? '';
            }
            fputcsv($csv, $row);
        }

        rewind($csv);
        $output = stream_get_contents($csv);
        fclose($csv);

        return $output;
    }
}

// 執行 API
$api = new ExperimentLogAPI();
$api->handle();
