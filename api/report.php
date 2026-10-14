<?php
// Knoglequiz – "Rapportér fejl" endpoint. POST JSON {item_id, field?, message, page?, data_version?}.
// Storage: MySQL (if config.php defines DB_DSN) or SQLite file outside web root fallback.
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function ulen(string $s): int { return function_exists('mb_strlen') ? mb_strlen($s) : (int)preg_match_all('/./us', $s); }
function usub(string $s, int $n): string { return function_exists('mb_substr') ? mb_substr($s, 0, $n) : (string)preg_replace('/^(.{0,' . $n . '}).*$/us', '$1', $s); }
function out(int $code, array $body): void { http_response_code($code); echo json_encode($body); exit; }

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') out(405, ['error' => 'method_not_allowed']);
$cfgFile = getenv('KQ_CONFIG') ?: __DIR__ . '/config.php';
$cfg = is_file($cfgFile) ? require $cfgFile : [];
$raw = file_get_contents('php://input', false, null, 0, 8192) ?: '';
$in = json_decode($raw, true);
if (!is_array($in)) out(400, ['error' => 'invalid_json']);
if (!empty($in['website'])) out(200, ['ok' => true]); // honeypot

$item = $in['item_id'] ?? null; $msg = $in['message'] ?? null; $field = $in['field'] ?? null;
$errors = [];
if (!is_string($item) || !preg_match('/^[a-z0-9_]{1,120}$/', $item)) $errors[] = 'item_id';
if (!is_string($msg) || ulen(trim($msg)) < 3 || ulen($msg) > 2000) $errors[] = 'message';
if ($field !== null && (!is_string($field) || ulen($field) > 60)) $errors[] = 'field';
if ($errors) out(400, ['error' => 'validation', 'fields' => $errors]);

try {
  if (!empty($cfg['db_dsn'])) {
    $pdo = new PDO($cfg['db_dsn'], $cfg['db_user'] ?? null, $cfg['db_pass'] ?? null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $driver = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
  } else {
    $path = $cfg['sqlite_path'] ?? (dirname(__DIR__) . '/_data/reports.sqlite');
    if (!is_dir(dirname($path))) @mkdir(dirname($path), 0700, true);
    $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $driver = 'sqlite';
  }
  $pk = $driver === 'mysql' ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  $pdo->exec("CREATE TABLE IF NOT EXISTS reports (id $pk, created_at VARCHAR(25) NOT NULL, item_id VARCHAR(120) NOT NULL,
    field VARCHAR(60) NULL, message TEXT NOT NULL, page VARCHAR(255) NULL, data_version VARCHAR(20) NULL,
    ip_hash CHAR(64) NOT NULL, user_agent VARCHAR(255) NULL, status VARCHAR(20) NOT NULL DEFAULT 'new')");
  $ipHash = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . ($cfg['salt'] ?? 'kq'));
  // rate limit: 10 reports / hour / IP
  $since = gmdate('Y-m-d\TH:i:s\Z', time() - 3600);
  $c = $pdo->prepare('SELECT COUNT(*) FROM reports WHERE ip_hash = ? AND created_at > ?'); $c->execute([$ipHash, $since]);
  if ((int)$c->fetchColumn() >= 10) out(429, ['error' => 'rate_limited']);
  $s = $pdo->prepare('INSERT INTO reports (created_at,item_id,field,message,page,data_version,ip_hash,user_agent) VALUES (?,?,?,?,?,?,?,?)');
  $s->execute([gmdate('Y-m-d\TH:i:s\Z'), $item, $field, trim($msg), usub((string)($in['page'] ?? ''), 255),
    usub((string)($in['data_version'] ?? ''), 20), $ipHash, usub((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 255)]);
  out(201, ['ok' => true, 'id' => (int)$pdo->lastInsertId()]);
} catch (Throwable $e) {
  error_log('knoglequiz report: ' . $e->getMessage());
  out(500, ['error' => 'server']);
}
