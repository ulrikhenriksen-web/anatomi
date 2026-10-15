<?php
// GET -> {display_name|null, suggested_display_name|null, highscore_opt_in, name_change_allowed_from|null}
// PUT {display_name?: string, highscore_opt_in?: bool}
//   display_name: 3–20 chars, unique, filtered; changeable max once per 30 days after first choice.
//   highscore_opt_in=true requires a chosen display name (409 display_name_required).
declare(strict_types=1);
require __DIR__ . '/lib.php';
try {
  $u = kq_require_user(); $uid = (int)$u['id'];
  $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
  if ($method === 'GET') kq_json(200, kq_profile($uid));
  if ($method !== 'PUT' && $method !== 'POST') kq_json(405, ['error' => 'method_not_allowed']);
  kq_require_xhr();
  $in = kq_input(2048); $db = kq_db(); $now = time();
  $cur = $db->prepare('SELECT display_name, display_name_lc, name_changed_at, highscore_opt_in FROM user_profile WHERE user_id=?'); $cur->execute([$uid]);
  $row = $cur->fetch() ?: ['display_name' => null, 'display_name_lc' => null, 'name_changed_at' => null, 'highscore_opt_in' => 0];
  if (array_key_exists('display_name', $in)) {
    $v = kq_validate_display_name($in['display_name']);
    if (!$v['ok']) kq_json(400, ['error' => 'validation', 'fields' => ['display_name'], 'reason' => $v['error']]);
    if ($v['value'] !== $row['display_name']) {
      if ($row['display_name'] !== null && $row['name_changed_at'] && $now < (int)$row['name_changed_at'] + 30 * 86400) kq_json(429, ['error' => 'name_change_too_soon']);
      $t = $db->prepare('SELECT 1 FROM user_profile WHERE display_name_lc=? AND user_id<>?'); $t->execute([$v['lc'], $uid]);
      if ($t->fetchColumn()) kq_json(409, ['error' => 'display_name_taken']);
      $row['name_changed_at'] = $now;
      $row['display_name'] = $v['value']; $row['display_name_lc'] = $v['lc'];
    }
  }
  if (array_key_exists('highscore_opt_in', $in)) {
    if (!is_bool($in['highscore_opt_in'])) kq_json(400, ['error' => 'validation', 'fields' => ['highscore_opt_in']]);
    if ($in['highscore_opt_in'] && $row['display_name'] === null) kq_json(409, ['error' => 'display_name_required']);
    $row['highscore_opt_in'] = $in['highscore_opt_in'] ? 1 : 0;
  }
  $db->prepare('INSERT INTO user_profile (user_id,display_name,display_name_lc,name_changed_at,highscore_opt_in,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name, display_name_lc=excluded.display_name_lc,
    name_changed_at=excluded.name_changed_at, highscore_opt_in=excluded.highscore_opt_in, updated_at=excluded.updated_at')
    ->execute([$uid, $row['display_name'], $row['display_name_lc'], $row['name_changed_at'], (int)$row['highscore_opt_in'], gmdate('c')]);
  kq_json(200, kq_profile($uid));
} catch (Throwable $e) {
  if ($e instanceof PDOException && str_contains($e->getMessage(), 'UNIQUE')) kq_json(409, ['error' => 'display_name_taken']);
  error_log('anatomi profile: ' . $e->getMessage()); kq_json(500, ['error' => 'server']);
}
