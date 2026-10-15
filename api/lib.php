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
    email TEXT, name TEXT, created_at TEXT NOT NULL, last_login TEXT NOT NULL)');
  $pdo->exec('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL, created_at TEXT NOT NULL)');
  $pdo->exec('CREATE TABLE IF NOT EXISTS progress (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    progress TEXT NOT NULL, meta TEXT NOT NULL, merged_local INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)');
  kq_migrate($pdo);
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
  $s = kq_db()->prepare('SELECT u.id,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?');
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


// ---- Migrations (idempotent) ----
function kq_has_column(PDO $pdo, string $table, string $col): bool {
  foreach ($pdo->query("PRAGMA table_info($table)")->fetchAll() as $c) if ($c['name'] === $col) return true;
  return false;
}
/** Drop a column; on SQLite < 3.35 fall back to nulling it. */
function kq_drop_column(PDO $pdo, string $table, string $col): void {
  if (!kq_has_column($pdo, $table, $col)) return;
  try { $pdo->exec("ALTER TABLE $table DROP COLUMN $col"); }
  catch (Throwable $e) { $pdo->exec("UPDATE $table SET $col = NULL"); }
}
function kq_migrate(PDO $pdo): void {
  $pdo->exec('CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, item_id TEXT NOT NULL,
    field TEXT NULL, message TEXT NOT NULL, page TEXT NULL, data_version TEXT NULL, status TEXT NOT NULL DEFAULT \'new\')');
  // Data minimisation (2026-10-15): no Google picture, no hashed IP, no user agent.
  kq_drop_column($pdo, 'users', 'picture');
  foreach (['reports_ip' => 'DROP INDEX IF EXISTS reports_ip'] as $sql) $pdo->exec($sql);
  kq_drop_column($pdo, 'reports', 'ip_hash');
  kq_drop_column($pdo, 'reports', 'user_agent');
  // Highscore
  $pdo->exec('CREATE TABLE IF NOT EXISTS user_profile (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NULL, display_name_lc TEXT NULL UNIQUE, name_changed_at INTEGER NULL,
    highscore_opt_in INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, flagged INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)');
  foreach (['display_name_lc TEXT NULL', 'name_changed_at INTEGER NULL', 'hidden INTEGER NOT NULL DEFAULT 0', 'flagged INTEGER NOT NULL DEFAULT 0'] as $c) {
    $n = explode(' ', $c)[0]; if (!kq_has_column($pdo, 'user_profile', $n)) $pdo->exec("ALTER TABLE user_profile ADD COLUMN $c");
  }
  $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS user_profile_name ON user_profile(display_name_lc)');
  // PR #3 draft tables (never deployed) are replaced by per-answer events.
  if (kq_has_column($pdo, 'score_events', 'total')) $pdo->exec('DROP TABLE score_events');
  $pdo->exec('DROP TABLE IF EXISTS scores');
  $pdo->exec('CREATE TABLE IF NOT EXISTS score_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL, category TEXT NOT NULL, mode TEXT NOT NULL, item_id TEXT NOT NULL, facet TEXT NOT NULL,
    points INTEGER NOT NULL, answered_at INTEGER NOT NULL, created_at INTEGER NOT NULL)');
  $pdo->exec('CREATE INDEX IF NOT EXISTS score_events_user ON score_events(user_id, answered_at)');
  $pdo->exec('CREATE INDEX IF NOT EXISTS score_events_time ON score_events(answered_at, category, mode)');
  $pdo->exec('CREATE TABLE IF NOT EXISTS score_submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL, mode TEXT NOT NULL, set_hash TEXT NULL, counted INTEGER NOT NULL, created_at INTEGER NOT NULL)');
  $pdo->exec('CREATE INDEX IF NOT EXISTS score_sub_user ON score_submissions(user_id, created_at)');
  $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS score_sub_testset ON score_submissions(user_id, set_hash) WHERE set_hash IS NOT NULL');
}

// ---- Ephemeral rate limiting (nothing about the client is persisted) ----
/** Uses APCu (in-memory, TTL) when available; else a per-session/per-user counter or a global DB-free bucket in /tmp keyed by HMAC that expires. */
function kq_ephemeral_hit(string $bucket, int $limit, int $window): bool {
  $key = 'kq:' . $bucket . ':' . hash_hmac('sha256', $_SERVER['REMOTE_ADDR'] ?? '', kq_ephemeral_secret());
  if (function_exists('apcu_enabled') && apcu_enabled()) {
    apcu_add($key, 0, $window); $n = apcu_inc($key);
    return $n !== false && $n <= $limit;
  }
  // Fallback: temp file in the system temp dir (not backed up), whole window bucket, auto-expired.
  $dir = rtrim(sys_get_temp_dir(), '/') . '/kq-rl'; if (!is_dir($dir)) @mkdir($dir, 0700, true);
  $f = $dir . '/' . hash('sha256', $key . ':' . intdiv(time(), $window));
  foreach (glob($dir . '/*') ?: [] as $old) if (@filemtime($old) < time() - 2 * $window) @unlink($old);
  $n = (int)@file_get_contents($f) + 1; @file_put_contents($f, (string)$n, LOCK_EX);
  return $n <= $limit;
}
/** Secret rotates daily, so even the ephemeral key cannot be linked across days. */
function kq_ephemeral_secret(): string { return (kq_config()['salt'] ?? 'anatomi') . gmdate('Y-m-d'); }

// ---- Highscore ----
const KQ_CATEGORIES = ['knogler', 'muskler', 'sener', 'ledbaand'];
const KQ_TOPIC_CATEGORY = ['bones' => 'knogler', 'muscles' => 'muskler', 'tendons' => 'sener', 'ligaments' => 'ledbaand'];
const KQ_MODES = ['naming', 'drill', 'test', 'memory'];
const KQ_MODE_POINTS = ['naming' => 5, 'drill' => 10, 'test' => 20, 'memory' => 5]; // per correct answer / found pair (Ulrik 2026-10-15)
// Daily caps (UX v2 caps translated to counted answers): naming 100 answers, drill 150 answers, memory 5 games; test: first completion of a question set only.
const KQ_DAILY = ['naming' => 100, 'drill' => 150, 'memory_games' => 5];
const KQ_TIERS = [['Celle', 0], ['Væv', 250], ['Sene', 1000], ['Muskel', 2500], ['Skelet', 5000], ['Prosektor', 10000], ['Anatom', 20000], ['Vesalius', 40000]];
const KQ_LIMITS = ['per_hour' => 120, 'max_events' => 60, 'fast_ms' => 400, 'fast_max' => 2, 'max_age_days' => 7, 'future_s' => 120, 'parallel' => 3, 'parallel_window_s' => 900];

function kq_limit(string $k): int { return (int)((kq_config()['score_limits'] ?? [])[$k] ?? KQ_LIMITS[$k]); }

function kq_tier(int $points): array {
  $cur = KQ_TIERS[0]; $next = null;
  foreach (KQ_TIERS as $i => $t) if ($points >= $t[1]) { $cur = $t; $next = KQ_TIERS[$i + 1] ?? null; }
  return ['name' => $cur[0], 'from' => $cur[1], 'next' => $next ? ['name' => $next[0], 'from' => $next[1], 'to_go' => $next[1] - $points] : null];
}
/** Server-side copy of the published data (same file the app loads). */
function kq_items(): array {
  static $map = null;
  if ($map !== null) return $map;
  $path = kq_config()['data_path'] ?? (dirname(__DIR__) . '/data/knoglequiz.json');
  $raw = json_decode((string)@file_get_contents($path), true) ?: [];
  $map = [];
  foreach (KQ_TOPIC_CATEGORY as $topic => $cat) foreach (($raw[$topic]['items'] ?? []) as $it) {
    if (!empty($it['id'])) $map[$it['id']] = $it + ['_category' => $cat];
  }
  return $map;
}
/** Mirrors FACETS in src/lib/quiz.js. */
function kq_facet_value(array $it, string $facet): ?string {
  switch ($facet) {
    case 'naming': case 'navn': case 'pair': return $it['name_da'] ?? null;
    case 'udspring': return ($it['origin_da'] ?? null) ?: ($it['attachment_from_da'] ?? null);
    case 'haefte': return ($it['insertion_da'] ?? null) ?: (($it['attachment_da'] ?? null) ?: ($it['attachment_to_da'] ?? null));
    case 'innervation':
      $n = $it['innervation']['nerve'] ?? null; if (!$n) return null;
      $seg = $it['innervation']['segments'] ?? null;
      return $n . ($seg && strpos($n, $seg) === false ? " ($seg)" : '');
  }
  return null;
}
function kq_day_start(int $ts): int {
  $d = new DateTime('@' . $ts); $d->setTimezone(new DateTimeZone('Europe/Copenhagen')); $d->setTime(0, 0);
  return $d->getTimestamp();
}
function kq_period_start(string $period, int $now): int {
  $d = new DateTime('@' . $now); $d->setTimezone(new DateTimeZone('Europe/Copenhagen')); $d->setTime(0, 0);
  if ($period === 'week') $d->modify('-' . ((int)$d->format('N') - 1) . ' days');
  elseif ($period === 'month') $d->setDate((int)$d->format('Y'), (int)$d->format('m'), 1);
  else return 0;
  return $d->getTimestamp();
}

// display names: 3–20 chars, unique (case-insensitive), no e-mail/URL, small offensive-word filter
const KQ_BLOCKLIST = ['fuck', 'shit', 'kusse', 'pik', 'fisse', 'luder', 'neger', 'nigger', 'bøsserøv', 'hitler', 'nazi', 'admin', 'moderator', 'anatomi'];
function kq_validate_display_name($name): array {
  if (!is_string($name)) return ['ok' => false, 'error' => 'type'];
  $n = preg_replace('/\s+/u', ' ', trim($name));
  if ($n === null || !preg_match('//u', $n)) return ['ok' => false, 'error' => 'encoding'];
  $len = preg_match_all('/./us', $n);
  if ($len < 3) return ['ok' => false, 'error' => 'too_short'];
  if ($len > 20) return ['ok' => false, 'error' => 'too_long'];
  if (!preg_match("/^[\\p{L}\\p{M}\\p{N} .\\-_']+$/u", $n)) return ['ok' => false, 'error' => 'chars'];
  if (preg_match('/@|https?|www\.|\.(dk|com|net|org)\b/i', $n)) return ['ok' => false, 'error' => 'contact_info'];
  $lc = function_exists('mb_strtolower') ? mb_strtolower($n) : strtolower($n);
  $flat = preg_replace('/[^\p{L}\p{N}]/u', '', $lc);
  foreach (KQ_BLOCKLIST as $w) if (strpos($flat, $w) !== false) return ['ok' => false, 'error' => 'not_allowed'];
  return ['ok' => true, 'value' => $n, 'lc' => $lc];
}
function kq_suggest_display_name(?string $fullName): string {
  $first = preg_split('/\s+/u', trim((string)$fullName))[0] ?? '';
  $first = preg_replace("/[^\\p{L}\\p{M}\\p{N}]/u", '', $first) ?: 'Anatom';
  if (preg_match_all('/./us', $first) > 16) $first = preg_replace('/^(.{16}).*$/us', '$1', $first);
  for ($i = 0; $i < 20; $i++) {
    $cand = $first . random_int(10, 99);
    $v = kq_validate_display_name($cand);
    if (!$v['ok']) { $first = 'Anatom'; continue; }
    $s = kq_db()->prepare('SELECT 1 FROM user_profile WHERE display_name_lc=?'); $s->execute([$v['lc']]);
    if (!$s->fetchColumn()) return $cand;
  }
  return 'Anatom' . random_int(1000, 9999);
}
function kq_profile(int $uid): array {
  $s = kq_db()->prepare('SELECT p.display_name, p.highscore_opt_in, p.name_changed_at, u.name FROM users u LEFT JOIN user_profile p ON p.user_id=u.id WHERE u.id=?');
  $s->execute([$uid]); $r = $s->fetch() ?: [];
  $changed = $r['name_changed_at'] ?? null;
  return ['display_name' => $r['display_name'] ?? null, 'suggested_display_name' => empty($r['display_name']) ? kq_suggest_display_name($r['name'] ?? '') : null,
    'highscore_opt_in' => (bool)($r['highscore_opt_in'] ?? 0),
    'name_change_allowed_from' => $changed ? gmdate('c', (int)$changed + 30 * 86400) : null];
}
function kq_points_sum(int $uid, int $since = 0): int {
  $s = kq_db()->prepare('SELECT COALESCE(SUM(points),0) FROM score_events WHERE user_id=? AND answered_at>=?'); $s->execute([$uid, $since]);
  return (int)$s->fetchColumn();
}
/**
 * Leaderboard for period/category/mode. Public rows: opted-in, not hidden, with a chosen display name.
 * Caller's own rank is always computed (hypothetical if not public).
 */
function kq_leaderboard(int $uid, string $period, string $category, string $mode, int $limit, int $now): array {
  $db = kq_db();
  $w = ['e.answered_at >= :since']; $args = [':since' => kq_period_start($period, $now)];
  if ($category !== 'alle') { $w[] = 'e.category = :cat'; $args[':cat'] = $category; }
  if ($mode !== 'alle') { $w[] = 'e.mode = :mode'; $args[':mode'] = $mode; }
  $sql = 'SELECT e.user_id, SUM(e.points) AS pts, MAX(e.answered_at) AS reached,
      CASE WHEN p.highscore_opt_in = 1 AND p.hidden = 0 AND p.display_name IS NOT NULL THEN 1 ELSE 0 END AS public
    FROM score_events e LEFT JOIN user_profile p ON p.user_id = e.user_id WHERE ' . implode(' AND ', $w) . '
    GROUP BY e.user_id HAVING pts > 0 ORDER BY pts DESC, reached ASC';
  $st = $db->prepare($sql); $st->execute($args);
  $rows = $st->fetchAll();
  $public = array_values(array_filter($rows, fn($r) => (int)$r['public'] === 1));
  $mine = null; foreach ($rows as $r) if ((int)$r['user_id'] === $uid) $mine = $r;
  $rankOf = function (array $list, int $pts): int { $n = 0; foreach ($list as $r) if ((int)$r['pts'] > $pts) $n++; return $n + 1; };
  $top = []; $rank = 0; $prev = null;
  foreach (array_slice($public, 0, $limit) as $i => $r) {
    if ($prev === null || (int)$r['pts'] !== $prev) { $rank = $i + 1; $prev = (int)$r['pts']; }
    $top[] = ['rank' => $rank, 'user_id' => (int)$r['user_id'], 'points' => (int)$r['pts'], 'is_me' => (int)$r['user_id'] === $uid];
  }
  if ($top) {
    $ids = array_column($top, 'user_id');
    $q = $db->prepare('SELECT user_id, display_name FROM user_profile WHERE user_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')');
    $q->execute($ids); $names = array_column($q->fetchAll(), 'display_name', 'user_id');
    foreach ($top as &$t) {
      $t['display_name'] = $names[$t['user_id']];
      $t['initial'] = function_exists('mb_substr') ? mb_strtoupper(mb_substr($t['display_name'], 0, 1)) : strtoupper(substr($t['display_name'], 0, 1));
      $t['tier'] = kq_tier(kq_points_sum($t['user_id']))['name'];
      unset($t['user_id']);
    }
    unset($t);
  }
  $me = null;
  if ($mine) {
    $pts = (int)$mine['pts']; $isPublic = (int)$mine['public'] === 1;
    $others = array_values(array_filter($public, fn($r) => (int)$r['user_id'] !== $uid));
    $r = $rankOf($others, $pts);
    // nearest public score above me -> points to reach that position
    $above = null; foreach (array_reverse($others) as $o) if ((int)$o['pts'] > $pts) { $above = $o; break; }
    $me = ['rank' => $r, 'points' => $pts, 'public' => $isPublic,
      'to_next' => $above ? ['rank' => $rankOf($others, (int)$above['pts']), 'points' => (int)$above['pts'] - $pts] : null];
  }
  return ['top' => $top, 'me' => $me, 'participants' => count($public)];
}
function kq_require_user(): array {
  $u = kq_current_user();
  if (!$u) kq_json(401, ['error' => 'unauthenticated']);
  return $u;
}
