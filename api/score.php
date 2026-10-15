<?php
// POST {category, mode, correct, total, duration_ms} -> {ok, points, totals:{category, overall}}
// Points are computed server-side from correct answers; client never sends points.
declare(strict_types=1);
require __DIR__ . '/lib.php';
try {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') kq_json(405, ['error' => 'method_not_allowed']);
  kq_require_xhr();
  $u = kq_require_user(); $uid = (int)$u['id'];
  $in = kq_input(4096);
  $cat = $in['category'] ?? null; $mode = $in['mode'] ?? null;
  $correct = $in['correct'] ?? null; $total = $in['total'] ?? null; $ms = $in['duration_ms'] ?? null;
  $err = [];
  if (!in_array($cat, KQ_CATEGORIES, true)) $err[] = 'category';
  if (!in_array($mode, KQ_MODES, true)) $err[] = 'mode';
  if (!is_int($total) || $total < 1 || $total > kq_limit('max_total')) $err[] = 'total';
  if (!is_int($correct) || $correct < 0 || (is_int($total) && $correct > $total)) $err[] = 'correct';
  if (!is_int($ms) || $ms > kq_limit('max_ms') || (is_int($total) && $ms < $total * kq_limit('min_ms_per_item'))) $err[] = 'duration_ms';
  if ($err) kq_json(400, ['error' => 'validation', 'fields' => $err]);
  $db = kq_db(); $now = time();
  $c = $db->prepare('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM score_events WHERE user_id=? AND created_at>?');
  $c->execute([$uid, $now - 3600]); $r = $c->fetch();
  if ((int)$r['n'] >= kq_limit('per_hour') || ($r['last'] && $now - (int)$r['last'] < kq_limit('min_gap_s'))) kq_json(429, ['error' => 'rate_limited']);
  $points = $correct * KQ_MODE_POINTS[$mode];
  $pct = (int)floor(100 * $correct / $total);
  $db->beginTransaction();
  $db->prepare('INSERT INTO score_events (user_id,category,mode,correct,total,duration_ms,points,created_at) VALUES (?,?,?,?,?,?,?,?)')
    ->execute([$uid, $cat, $mode, $correct, $total, $ms, $points, $now]);
  $db->prepare('INSERT INTO scores (user_id,category,mode,points,sessions,best_pct,updated_at) VALUES (?,?,?,?,1,?,?)
    ON CONFLICT(user_id,category,mode) DO UPDATE SET points=points+excluded.points, sessions=sessions+1,
    best_pct=MAX(best_pct,excluded.best_pct), updated_at=excluded.updated_at')->execute([$uid, $cat, $mode, $points, $pct, gmdate('c')]);
  $db->commit();
  $t = $db->prepare('SELECT COALESCE(SUM(points),0) FROM scores WHERE user_id=? AND category=?'); $t->execute([$uid, $cat]);
  $o = $db->prepare('SELECT COALESCE(SUM(points),0) FROM scores WHERE user_id=?'); $o->execute([$uid]);
  kq_json(201, ['ok' => true, 'points' => $points, 'totals' => ['category' => (int)$t->fetchColumn(), 'overall' => (int)$o->fetchColumn()]]);
} catch (Throwable $e) { error_log('anatomi score: ' . $e->getMessage()); kq_json(500, ['error' => 'server']); }
