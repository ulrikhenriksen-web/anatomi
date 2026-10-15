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
  kq_migrate_highscore($pdo);
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

// ---- Highscore ----
const KQ_CATEGORIES = ['knogler', 'muskler', 'sener', 'ledbaand'];
const KQ_MODES = ['naming', 'drill', 'test', 'memory'];
// points per correct answer, by mode (server decides points; client never sends points)
const KQ_MODE_POINTS = ['naming' => 5, 'drill' => 10, 'test' => 20, 'memory' => 5];
const KQ_LIMITS = ['max_total' => 50, 'min_ms_per_item' => 1200, 'max_ms' => 7200000, 'per_hour' => 60, 'min_gap_s' => 10];

function kq_limit(string $k): int { return (int)((kq_config()['score_limits'] ?? [])[$k] ?? KQ_LIMITS[$k]); }
function kq_migrate_highscore(PDO $pdo): void {
  $pdo->exec('CREATE TABLE IF NOT EXISTS user_profile (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NULL, highscore_opt_in INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)');
  $pdo->exec('CREATE TABLE IF NOT EXISTS score_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL, mode TEXT NOT NULL, correct INTEGER NOT NULL, total INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
    points INTEGER NOT NULL, created_at INTEGER NOT NULL)');
  $pdo->exec('CREATE INDEX IF NOT EXISTS score_events_user_time ON score_events(user_id, created_at)');
  $pdo->exec('CREATE TABLE IF NOT EXISTS scores (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL, mode TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0, sessions INTEGER NOT NULL DEFAULT 0,
    best_pct INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, category, mode))');
  $pdo->exec('CREATE INDEX IF NOT EXISTS scores_cat ON scores(category, points)');
}
function kq_require_user(): array {
  $u = kq_current_user();
  if (!$u) kq_json(401, ['error' => 'unauthenticated']);
  return $u;
}
/** Default display name = first name from Google profile. */
function kq_default_display_name(?string $fullName): string {
  $first = preg_split('/\s+/u', trim((string)$fullName))[0] ?? '';
  $v = kq_validate_display_name($first);
  return $v['ok'] ? $v['value'] : 'Bruger';
}
/** 2–24 chars; letters (any script), digits, space, . - _ '; no e-mail/URL; collapses whitespace. */
function kq_validate_display_name($name): array {
  if (!is_string($name)) return ['ok' => false, 'error' => 'type'];
  $n = preg_replace('/\s+/u', ' ', trim($name));
  if ($n === null || !preg_match('//u', $n)) return ['ok' => false, 'error' => 'encoding'];
  $len = preg_match_all('/./us', $n);
  if ($len < 2) return ['ok' => false, 'error' => 'too_short'];
  if ($len > 24) return ['ok' => false, 'error' => 'too_long'];
  if (!preg_match("/^[\\p{L}\\p{M}\\p{N} .\\-_']+$/u", $n)) return ['ok' => false, 'error' => 'chars'];
  if (preg_match('/@|https?|www\\.|\\.(dk|com|net|org)\\b/i', $n)) return ['ok' => false, 'error' => 'contact_info'];
  return ['ok' => true, 'value' => $n];
}
function kq_profile(int $uid): array {
  $db = kq_db();
  $s = $db->prepare('SELECT p.display_name, p.highscore_opt_in, u.name FROM users u LEFT JOIN user_profile p ON p.user_id=u.id WHERE u.id=?');
  $s->execute([$uid]); $r = $s->fetch() ?: [];
  return ['display_name' => $r['display_name'] ?? kq_default_display_name($r['name'] ?? ''),
    'display_name_is_default' => empty($r['display_name']), 'highscore_opt_in' => (bool)($r['highscore_opt_in'] ?? 0)];
}
/** Standard competition ranking (1,1,3) over opted-in users. Returns ['top'=>[], 'me'=>?]. */
function kq_leaderboard(string $category, int $uid, int $limit): array {
  $db = kq_db();
  $where = $category === 'overall' ? '' : 'WHERE s.category = :cat';
  $sql = "SELECT s.user_id, SUM(s.points) AS score FROM scores s JOIN user_profile p ON p.user_id = s.user_id AND p.highscore_opt_in = 1
    $where GROUP BY s.user_id HAVING score > 0 ORDER BY score DESC, MIN(s.updated_at) ASC";
  $st = $db->prepare($sql); if ($category !== 'overall') $st->bindValue(':cat', $category); $st->execute();
  $rows = $st->fetchAll(); $top = []; $me = null; $rank = 0; $prev = null;
  foreach ($rows as $i => $r) {
    if ($prev === null || (int)$r['score'] !== $prev) { $rank = $i + 1; $prev = (int)$r['score']; }
    $isMe = (int)$r['user_id'] === $uid;
    if ($i < $limit) $top[] = ['rank' => $rank, 'user_id' => (int)$r['user_id'], 'score' => (int)$r['score'], 'is_me' => $isMe];
    if ($isMe) $me = ['rank' => $rank, 'score' => (int)$r['score']];
  }
  // names only for listed, opted-in users
  if ($top) {
    $ids = array_column($top, 'user_id');
    $q = $db->prepare('SELECT u.id, u.name, p.display_name FROM users u JOIN user_profile p ON p.user_id=u.id WHERE u.id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')');
    $q->execute($ids); $names = [];
    foreach ($q->fetchAll() as $n) $names[(int)$n['id']] = $n['display_name'] ?: kq_default_display_name($n['name']);
    foreach ($top as &$t) { $t['display_name'] = $names[$t['user_id']] ?? 'Bruger'; unset($t['user_id']); }
  }
  return ['top' => $top, 'me' => $me, 'participants' => count($rows)];
}
