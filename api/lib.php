<?php
// Shared helpers: config, SQLite, sessions, Google ID-token verification.
declare(strict_types=1);

const KQ_COOKIE = 'kq_session';
const KQ_SESSION_DAYS = 30;

function kq_json(int $code, array $body): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  header('X-Content-Type-Options: nosniff');
  header('Cache-Control: no-store');
  echo json_encode($body, JSON_UNESCAPED_UNICODE);
  exit;
}
function kq_config(): array {
  static $cfg = null;
  if ($cfg === null) { $f = getenv('KQ_CONFIG') ?: __DIR__ . '/config.php'; $cfg = is_file($f) ? (require $f) : []; }
  return $cfg;
}
function kq_db(): PDO {
  static $pdo = null;
  if ($pdo) return $pdo;
  $path = kq_config()['sqlite_path'] ?? (dirname(__DIR__) . '/_data/reports.sqlite');
  if (!is_dir(dirname($path))) @mkdir(dirname($path), 0700, true);
  $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
  $pdo->exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000');
  $pdo->exec('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, google_sub TEXT UNIQUE NOT NULL,
    email TEXT, name TEXT, picture TEXT, created_at TEXT NOT NULL, last_login TEXT NOT NULL)');
  $pdo->exec('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL, created_at TEXT NOT NULL)');
  $pdo->exec('CREATE TABLE IF NOT EXISTS progress (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    progress TEXT NOT NULL, meta TEXT NOT NULL, merged_local INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)');
  return $pdo;
}
function kq_input(int $max = 1048576): array {
  $raw = file_get_contents('php://input', false, null, 0, $max + 1) ?: '';
  if (strlen($raw) > $max) kq_json(413, ['error' => 'too_large']);
  $in = json_decode($raw, true);
  if (!is_array($in)) kq_json(400, ['error' => 'invalid_json']);
  return $in;
}
/** CSRF guard for state-changing requests: SameSite cookie + required custom header (forces CORS preflight cross-site). */
function kq_require_xhr(): void {
  if (($_SERVER['HTTP_X_KQ'] ?? '') !== '1') kq_json(403, ['error' => 'csrf']);
}
function kq_is_https(): bool {
  return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}
function kq_set_cookie(string $value, int $expires): void {
  setcookie(KQ_COOKIE, $value, ['expires' => $expires, 'path' => '/', 'secure' => kq_config()['cookie_secure'] ?? kq_is_https(),
    'httponly' => true, 'samesite' => 'Lax']);
}
function kq_start_session(int $userId): void {
  $token = bin2hex(random_bytes(32));
  $exp = time() + KQ_SESSION_DAYS * 86400;
  kq_db()->prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)')
    ->execute([hash('sha256', $token), $userId, $exp, gmdate('c')]);
  kq_db()->prepare('DELETE FROM sessions WHERE expires_at < ?')->execute([time()]);
  kq_set_cookie($token, $exp);
}
function kq_current_user(): ?array {
  $t = $_COOKIE[KQ_COOKIE] ?? '';
  if (!is_string($t) || !preg_match('/^[a-f0-9]{64}$/', $t)) return null;
  $s = kq_db()->prepare('SELECT u.id,u.email,u.name,u.picture FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?');
  $s->execute([hash('sha256', $t), time()]);
  return $s->fetch() ?: null;
}
function kq_end_session(): void {
  $t = $_COOKIE[KQ_COOKIE] ?? '';
  if (is_string($t) && $t !== '') kq_db()->prepare('DELETE FROM sessions WHERE token_hash=?')->execute([hash('sha256', $t)]);
  kq_set_cookie('', time() - 3600);
}

/**
 * Verify a Google Identity Services ID token server-side via Google's tokeninfo endpoint
 * (Google validates signature against its JWKS). We then check aud, iss, exp, email_verified.
 * Returns claims array or null.
 */
function kq_verify_google_token(string $idToken): ?array {
  $cfg = kq_config();
  $clientId = $cfg['google_client_id'] ?? '';
  if ($clientId === '' || !preg_match('/^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/', $idToken)) return null;
  $url = ($cfg['google_tokeninfo_url'] ?? 'https://oauth2.googleapis.com/tokeninfo') . '?id_token=' . rawurlencode($idToken);
  $body = kq_http_get($url);
  if ($body === null) return null;
  $c = json_decode($body, true);
  if (!is_array($c)) return null;
  $issOk = in_array($c['iss'] ?? '', ['accounts.google.com', 'https://accounts.google.com'], true);
  $audOk = hash_equals($clientId, (string)($c['aud'] ?? ''));
  $expOk = (int)($c['exp'] ?? 0) > time();
  $verified = ($c['email_verified'] ?? '') === true || ($c['email_verified'] ?? '') === 'true';
  if (!$issOk || !$audOk || !$expOk || empty($c['sub']) || !$verified) return null;
  return $c;
}
function kq_http_get(string $url): ?string {
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_SSL_VERIFYPEER => true]);
    $b = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
    return ($b !== false && $code === 200) ? $b : null;
  }
  $ctx = stream_context_create(['http' => ['timeout' => 8, 'ignore_errors' => true]]);
  $b = @file_get_contents($url, false, $ctx);
  $code = isset($http_response_header[0]) && preg_match('/\s(\d{3})\s?/', $http_response_header[0], $m) ? (int)$m[1] : 0;
  return ($b !== false && $code === 200) ? $b : null;
}

// ---- progress merge (mirrors src/lib/quiz.js mergeProgress / mergeMeta) ----
function kq_merge_progress(array $a, array $b): array {
  foreach ($b as $k => $v) {
    if (!is_string($k) || strlen($k) > 200 || !is_array($v)) continue;
    if (!isset($a[$k]) || (($v['last'] ?? 0) > ($a[$k]['last'] ?? 0))) $a[$k] = $v;
  }
  return $a;
}
function kq_merge_meta(array $a, array $b): array {
  $newer = (($a['lastDay'] ?? '') >= ($b['lastDay'] ?? '')) ? $a : $b;
  $tests = []; foreach (array_merge($a['tests'] ?? [], $b['tests'] ?? []) as $t) if (is_array($t) && isset($t['at'])) $tests[(string)$t['at']] = $t;
  usort($tests, fn($x, $y) => $x['at'] <=> $y['at']);
  return ['xp' => max((int)($a['xp'] ?? 0), (int)($b['xp'] ?? 0)), 'streak' => (int)($newer['streak'] ?? 0),
    'lastDay' => $newer['lastDay'] ?? null, 'tests' => array_slice(array_values($tests), -20)];
}
