<?php
// GET ?limit=N (1..50, default 10) — logged-in users only.
// -> {opted_in, me:{display_name}, categories:{knogler|muskler|sener|ledbaand|overall: {top:[{rank,display_name,score,is_me}], me:{rank,score}|null, participants}}}
declare(strict_types=1);
require __DIR__ . '/lib.php';
try {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') kq_json(405, ['error' => 'method_not_allowed']);
  $u = kq_require_user(); $uid = (int)$u['id'];
  $limit = max(1, min(50, (int)($_GET['limit'] ?? 10)));
  $out = [];
  foreach (array_merge(KQ_CATEGORIES, ['overall']) as $c) $out[$c] = kq_leaderboard($c, $uid, $limit);
  $p = kq_profile($uid);
  kq_json(200, ['opted_in' => $p['highscore_opt_in'], 'me' => ['display_name' => $p['display_name']], 'categories' => $out]);
} catch (Throwable $e) { error_log('anatomi leaderboard: ' . $e->getMessage()); kq_json(500, ['error' => 'server']); }
