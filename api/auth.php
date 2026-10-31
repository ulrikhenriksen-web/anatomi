<?php
// GET  ?action=config  -> {google_client_id|null, halloween_enabled: bool (default true)}
// GET  ?action=me      -> {user|null}
// POST ?action=login   {credential: <GIS ID token>} -> {user, merged_local}
// POST ?action=logout
declare(strict_types=1);
require __DIR__ . '/lib.php';
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
try {
  if ($action === 'config' && $method === 'GET') {
    $id = kq_config()['google_client_id'] ?? '';
    kq_json(200, ['google_client_id' => $id !== '' ? $id : null, 'halloween_enabled' => (kq_config()['halloween_enabled'] ?? true) !== false]);
  }
  if ($action === 'me' && $method === 'GET') kq_json(200, ['user' => kq_current_user()]);
  if ($action === 'login' && $method === 'POST') {
    kq_require_xhr();
    if (empty(kq_config()['google_client_id'])) kq_json(503, ['error' => 'login_disabled']);
    $in = kq_input(16384);
    $claims = is_string($in['credential'] ?? null) ? kq_verify_google_token($in['credential']) : null;
    if (!$claims) kq_json(401, ['error' => 'invalid_token']);
    $db = kq_db(); $now = gmdate('c');
    // Data minimisation: only sub, name, e-mail (no profile picture).
    $db->prepare('INSERT INTO users (google_sub,email,name,created_at,last_login) VALUES (?,?,?,?,?)
      ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email,name=excluded.name,last_login=excluded.last_login')
      ->execute([$claims['sub'], $claims['email'] ?? null, $claims['name'] ?? null, $now, $now]);
    $s = $db->prepare('SELECT id FROM users WHERE google_sub=?'); $s->execute([$claims['sub']]);
    $uid = (int)$s->fetchColumn();
    kq_start_session($uid);
    $m = $db->prepare('SELECT merged_local FROM progress WHERE user_id=?'); $m->execute([$uid]);
    $user = ['id' => $uid, 'email' => $claims['email'] ?? null, 'name' => $claims['name'] ?? null];
    kq_json(200, ['user' => $user, 'merged_local' => (bool)$m->fetchColumn()]);
  }
  if ($action === 'logout' && $method === 'POST') { kq_require_xhr(); kq_end_session(); kq_json(200, ['ok' => true]); }
  kq_json(404, ['error' => 'not_found']);
} catch (Throwable $e) {
  error_log('knoglequiz auth: ' . $e->getMessage());
  kq_json(500, ['error' => 'server']);
}
