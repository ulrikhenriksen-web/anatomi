<?php
// GET -> {display_name, display_name_is_default, highscore_opt_in}
// PUT {display_name?: string|null (null = reset to first name), highscore_opt_in?: bool}
declare(strict_types=1);
require __DIR__ . '/lib.php';
try {
  $u = kq_require_user(); $uid = (int)$u['id'];
  $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
  if ($method === 'GET') kq_json(200, kq_profile($uid));
  if ($method !== 'PUT' && $method !== 'POST') kq_json(405, ['error' => 'method_not_allowed']);
  kq_require_xhr();
  $in = kq_input(2048);
  $cur = kq_db()->prepare('SELECT display_name, highscore_opt_in FROM user_profile WHERE user_id=?'); $cur->execute([$uid]);
  $row = $cur->fetch() ?: ['display_name' => null, 'highscore_opt_in' => 0];
  if (array_key_exists('display_name', $in)) {
    if ($in['display_name'] === null || $in['display_name'] === '') $row['display_name'] = null;
    else { $v = kq_validate_display_name($in['display_name']); if (!$v['ok']) kq_json(400, ['error' => 'validation', 'fields' => ['display_name'], 'reason' => $v['error']]); $row['display_name'] = $v['value']; }
  }
  if (array_key_exists('highscore_opt_in', $in)) {
    if (!is_bool($in['highscore_opt_in'])) kq_json(400, ['error' => 'validation', 'fields' => ['highscore_opt_in']]);
    $row['highscore_opt_in'] = $in['highscore_opt_in'] ? 1 : 0;
  }
  kq_db()->prepare('INSERT INTO user_profile (user_id,display_name,highscore_opt_in,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name, highscore_opt_in=excluded.highscore_opt_in, updated_at=excluded.updated_at')
    ->execute([$uid, $row['display_name'], (int)$row['highscore_opt_in'], gmdate('c')]);
  kq_json(200, kq_profile($uid));
} catch (Throwable $e) { error_log('anatomi profile: ' . $e->getMessage()); kq_json(500, ['error' => 'server']); }
