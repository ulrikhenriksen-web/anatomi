<?php
// POST answer events; the server computes points (client never sends points).
// {session_id, mode: naming|drill|test|memory, timer?: 45|90|0, events:[{item_id, facet, answer, ts, ms}], memory?: {difficulty, pairs, moves, seconds}}
// -> {ok, counted, points, rejected:[{i, reason}], reasons:[...], totals:{all_time, today}, tier}
declare(strict_types=1);
require __DIR__ . '/lib.php';
try {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') kq_json(405, ['error' => 'method_not_allowed']);
  kq_require_xhr();
  $u = kq_require_user(); $uid = (int)$u['id'];
  $in = kq_input(65536);
  $sid = $in['session_id'] ?? null; $mode = $in['mode'] ?? null; $events = $in['events'] ?? null;
  $err = [];
  if (!is_string($sid) || !preg_match('/^[A-Za-z0-9_-]{8,64}$/', $sid)) $err[] = 'session_id';
  if (!in_array($mode, KQ_MODES, true)) $err[] = 'mode';
  if (!is_array($events) || !array_is_list($events) || count($events) < 1 || count($events) > kq_limit('max_events')) $err[] = 'events';
  $mem = null;
  if ($mode === 'memory') {
    $mem = $in['memory'] ?? null;
    $pairsOk = is_array($mem) && in_array($mem['pairs'] ?? null, [6, 8, 12], true);
    if (!$pairsOk || !is_int($mem['moves'] ?? null) || $mem['moves'] < $mem['pairs'] || $mem['moves'] > 500
      || !is_int($mem['seconds'] ?? null) || $mem['seconds'] < $mem['pairs'] * 2 || $mem['seconds'] > 7200
      || !is_array($events) || count($events) !== $mem['pairs']) $err[] = 'memory';
  }
  if ($err) kq_json(400, ['error' => 'validation', 'fields' => $err]);

  $db = kq_db(); $now = time(); $items = kq_items();
  $c = $db->prepare('SELECT COUNT(*) FROM score_submissions WHERE user_id=? AND created_at>?'); $c->execute([$uid, $now - 3600]);
  if ((int)$c->fetchColumn() >= kq_limit('per_hour')) kq_json(429, ['error' => 'rate_limited']);

  $reasons = []; $flag = false;
  // Plausibility: future timestamps, repeated sub-400 ms answers, too many parallel sessions -> nothing counts (+ flag for review)
  $fast = 0; $future = false;
  foreach ($events as $e) {
    if (!is_array($e)) continue;
    if (is_int($e['ts'] ?? null) && intdiv($e['ts'], 1000) > $now + kq_limit('future_s')) $future = true;
    if (is_int($e['ms'] ?? null) && $e['ms'] < kq_limit('fast_ms')) $fast++;
  }
  if ($future) { $reasons[] = 'future_timestamp'; $flag = true; }
  if ($mode !== 'memory' && $fast > kq_limit('fast_max')) { $reasons[] = 'too_fast'; $flag = true; }
  $p = $db->prepare('SELECT COUNT(DISTINCT session_id) FROM score_submissions WHERE user_id=? AND created_at>? AND session_id<>?');
  $p->execute([$uid, $now - kq_limit('parallel_window_s'), $sid]);
  if ((int)$p->fetchColumn() >= kq_limit('parallel')) { $reasons[] = 'parallel_sessions'; $flag = true; }

  // Test: only the first completion of the same question set counts
  $setHash = null;
  if ($mode === 'test') {
    $keys = array_map(fn($e) => (is_array($e) ? ($e['item_id'] ?? '') . '::' . ($e['facet'] ?? '') : ''), $events); sort($keys);
    $setHash = hash('sha256', implode('|', $keys));
    $s = $db->prepare('SELECT 1 FROM score_submissions WHERE user_id=? AND set_hash=?'); $s->execute([$uid, $setHash]);
    if ($s->fetchColumn()) { $reasons[] = 'test_set_already_counted'; $setHash = null; }
  }
  // Memory: max 5 counted games per day
  if ($mode === 'memory') {
    $s = $db->prepare("SELECT COUNT(*) FROM score_submissions WHERE user_id=? AND mode='memory' AND counted>0 AND created_at>=?");
    $s->execute([$uid, kq_day_start($now)]);
    if ((int)$s->fetchColumn() >= KQ_DAILY['memory_games']) $reasons[] = 'daily_cap';
  }
  $blocked = (bool)array_intersect($reasons, ['future_timestamp', 'too_fast', 'parallel_sessions', 'test_set_already_counted', 'daily_cap']);

  // Daily answer caps per mode (Copenhagen day)
  $capLeft = PHP_INT_MAX;
  if (isset(KQ_DAILY[$mode])) {
    $s = $db->prepare('SELECT COUNT(*) FROM score_events WHERE user_id=? AND mode=? AND answered_at>=?');
    $s->execute([$uid, $mode, kq_day_start($now)]);
    $capLeft = max(0, KQ_DAILY[$mode] - (int)$s->fetchColumn());
  }
  $rows = []; $rejected = []; $seen = [];
  foreach ($events as $i => $e) {
    $why = null;
    $id = is_array($e) ? ($e['item_id'] ?? null) : null; $facet = is_array($e) ? ($e['facet'] ?? null) : null;
    $ts = is_array($e) && is_int($e['ts'] ?? null) ? intdiv($e['ts'], 1000) : null;
    if (!is_string($id) || !isset($items[$id])) $why = 'unknown_item';
    elseif (!in_array($facet, ['naming', 'navn', 'udspring', 'haefte', 'innervation', 'pair'], true) || ($mode === 'memory') !== ($facet === 'pair') || ($mode === 'naming') !== ($facet === 'naming')) $why = 'facet';
    elseif (($items[$id]['verification'] ?? '') !== 'verified') $why = 'not_verified';
    elseif ($ts === null || $ts < $now - kq_limit('max_age_days') * 86400) $why = 'too_old';
    elseif (isset($seen["$id::$facet"])) $why = 'duplicate';
    elseif ($facet !== 'pair' && (!is_string($e['answer'] ?? null) || $e['answer'] !== kq_facet_value($items[$id], $facet))) $why = 'incorrect';
    elseif ($capLeft <= 0) $why = 'daily_cap';
    if ($why) { $rejected[] = ['i' => $i, 'reason' => $why]; continue; }
    $seen["$id::$facet"] = true; $capLeft--;
    $rows[] = [$id, $facet, $items[$id]['_category'], min($ts, $now)];
  }
  if ($blocked) $rows = [];
  $pts = KQ_MODE_POINTS[$mode];
  $db->beginTransaction();
  $ins = $db->prepare('INSERT INTO score_events (user_id,session_id,category,mode,item_id,facet,points,answered_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  foreach ($rows as [$id, $facet, $cat, $ts]) $ins->execute([$uid, $sid, $cat, $mode, $id, $facet, $pts, $ts, $now]);
  $db->prepare('INSERT INTO score_submissions (user_id,session_id,mode,set_hash,counted,created_at) VALUES (?,?,?,?,?,?)')
    ->execute([$uid, $sid, $mode, $rows ? $setHash : null, count($rows), $now]);
  if ($flag) $db->prepare("INSERT INTO user_profile (user_id,updated_at,flagged) VALUES (?,?,1) ON CONFLICT(user_id) DO UPDATE SET flagged=1")->execute([$uid, gmdate('c')]);
  $db->commit();
  $all = kq_points_sum($uid);
  kq_json(201, ['ok' => true, 'counted' => count($rows), 'points' => count($rows) * $pts, 'rejected' => $rejected, 'reasons' => $reasons,
    'totals' => ['all_time' => $all, 'today' => kq_points_sum($uid, kq_day_start($now))], 'tier' => kq_tier($all)]);
} catch (Throwable $e) { error_log('anatomi score: ' . $e->getMessage()); kq_json(500, ['error' => 'server']); }
