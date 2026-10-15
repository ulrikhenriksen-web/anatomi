<?php
// DELETE -> deletes the user, sessions, progress, profile and points (ON DELETE CASCADE). Reports are not linked to users.
declare(strict_types=1);
require __DIR__ . '/lib.php';
try {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'DELETE') kq_json(405, ['error' => 'method_not_allowed']);
  kq_require_xhr();
  $u = kq_require_user();
  kq_db()->prepare('DELETE FROM users WHERE id=?')->execute([(int)$u['id']]);
  kq_set_cookie('', time() - 3600);
  kq_json(200, ['ok' => true]);
} catch (Throwable $e) { error_log('anatomi account: ' . $e->getMessage()); kq_json(500, ['error' => 'server']); }
