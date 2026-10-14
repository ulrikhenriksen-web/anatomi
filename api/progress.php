<?php
// GET -> {progress, meta, merged_local}
// PUT {progress, meta, merge_local?:bool} -> server-side merge (newest per card wins) -> merged result.
declare(strict_types=1);
require __DIR__ . '/lib.php';
try {
  $user = kq_current_user();
  if (!$user) kq_json(401, ['error' => 'unauthenticated']);
  $db = kq_db(); $uid = (int)$user['id'];
  $load = function () use ($db, $uid) {
    $s = $db->prepare('SELECT progress, meta, merged_local FROM progress WHERE user_id=?'); $s->execute([$uid]);
    $r = $s->fetch();
    return $r ? [json_decode($r['progress'], true) ?: [], json_decode($r['meta'], true) ?: [], (bool)$r['merged_local']] : [[], [], false];
  };
  $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
  if ($method === 'GET') { [$p, $m, $ml] = $load(); kq_json(200, ['progress' => (object)$p, 'meta' => $m, 'merged_local' => $ml]); }
  if ($method === 'PUT' || $method === 'POST') {
    kq_require_xhr();
    $in = kq_input(2 * 1048576);
    if (!is_array($in['progress'] ?? null) || (isset($in['meta']) && !is_array($in['meta']))) kq_json(400, ['error' => 'validation']);
    $db->beginTransaction();
    [$p, $m, $ml] = $load();
    $p = kq_merge_progress($p, $in['progress']);
    $m = kq_merge_meta($m, $in['meta'] ?? []);
    $ml = $ml || !empty($in['merge_local']);
    $db->prepare('INSERT INTO progress (user_id,progress,meta,merged_local,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET progress=excluded.progress, meta=excluded.meta, merged_local=excluded.merged_local, updated_at=excluded.updated_at')
      ->execute([$uid, json_encode((object)$p), json_encode($m), $ml ? 1 : 0, gmdate('c')]);
    $db->commit();
    kq_json(200, ['progress' => (object)$p, 'meta' => $m, 'merged_local' => $ml]);
  }
  kq_json(405, ['error' => 'method_not_allowed']);
} catch (Throwable $e) {
  error_log('knoglequiz progress: ' . $e->getMessage());
  kq_json(500, ['error' => 'server']);
}
