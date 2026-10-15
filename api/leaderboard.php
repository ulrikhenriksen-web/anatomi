<?php
// GET ?period=week|month|all &category=alle|knogler|muskler|sener|ledbaand &mode=alle|naming|drill|test|memory &limit=1..100
// Logged-in users only. -> {period, category, mode, profile:{display_name, highscore_opt_in}, tier:{name,from,next}, all_time_points, top:[{rank, display_name, initial, tier, points, is_me}], me:{rank, points, public, to_next:{rank, points}|null}|null, participants}
declare(strict_types=1);
require __DIR__ . '/lib.php';
try {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') kq_json(405, ['error' => 'method_not_allowed']);
  $u = kq_require_user(); $uid = (int)$u['id'];
  $period = in_array($_GET['period'] ?? 'week', ['week', 'month', 'all'], true) ? ($_GET['period'] ?? 'week') : null;
  $cat = $_GET['category'] ?? 'alle'; $mode = $_GET['mode'] ?? 'alle';
  if (!$period || !in_array($cat, array_merge(['alle'], KQ_CATEGORIES), true) || !in_array($mode, array_merge(['alle'], KQ_MODES), true)) kq_json(400, ['error' => 'validation']);
  $limit = max(1, min(100, (int)($_GET['limit'] ?? 100)));
  $lb = kq_leaderboard($uid, $period, $cat, $mode, $limit, time());
  $p = kq_profile($uid); $all = kq_points_sum($uid);
  kq_json(200, ['period' => $period, 'category' => $cat, 'mode' => $mode,
    'profile' => ['display_name' => $p['display_name'], 'highscore_opt_in' => $p['highscore_opt_in']],
    'all_time_points' => $all, 'tier' => kq_tier($all)] + $lb);
} catch (Throwable $e) { error_log('anatomi leaderboard: ' . $e->getMessage()); kq_json(500, ['error' => 'server']); }
