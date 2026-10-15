<?php
// "Rapportér fejl". POST JSON {item_id, field?, message, page?, data_version?}.
// Stores only: text, time, page, data version (+ item/field). No IP, no user agent.
declare(strict_types=1);
require __DIR__ . '/lib.php';
function ulen(string $s): int { return function_exists('mb_strlen') ? mb_strlen($s) : (int)preg_match_all('/./us', $s); }
function usub(string $s, int $n): string { return function_exists('mb_substr') ? mb_substr($s, 0, $n) : (string)preg_replace('/^(.{0,' . $n . '}).*$/us', '$1', $s); }
try {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') kq_json(405, ['error' => 'method_not_allowed']);
  $in = kq_input(8192);
  if (!empty($in['website'])) kq_json(200, ['ok' => true]); // honeypot
  $item = $in['item_id'] ?? null; $msg = $in['message'] ?? null; $field = $in['field'] ?? null;
  $errors = [];
  if (!is_string($item) || !preg_match('/^[a-z0-9_]{1,120}$/', $item)) $errors[] = 'item_id';
  if (!is_string($msg) || ulen(trim($msg)) < 3 || ulen($msg) > 2000) $errors[] = 'message';
  if ($field !== null && (!is_string($field) || ulen($field) > 60)) $errors[] = 'field';
  if ($errors) kq_json(400, ['error' => 'validation', 'fields' => $errors]);
  // Ephemeral rate limits (in-memory/temp, nothing persisted with the report): 10/h per client, 300/h global.
  if (!kq_ephemeral_hit('report', 10, 3600)) kq_json(429, ['error' => 'rate_limited']);
  $db = kq_db();
  $c = $db->prepare('SELECT COUNT(*) FROM reports WHERE created_at > ?'); $c->execute([gmdate('Y-m-d\TH:i:s\Z', time() - 3600)]);
  if ((int)$c->fetchColumn() >= (int)(kq_config()['report_global_per_hour'] ?? 300)) kq_json(429, ['error' => 'rate_limited']);
  $s = $db->prepare('INSERT INTO reports (created_at,item_id,field,message,page,data_version) VALUES (?,?,?,?,?,?)');
  $s->execute([gmdate('Y-m-d\TH:i:s\Z'), $item, $field, trim($msg), usub((string)($in['page'] ?? ''), 255), usub((string)($in['data_version'] ?? ''), 20)]);
  kq_json(201, ['ok' => true, 'id' => (int)$db->lastInsertId()]);
} catch (Throwable $e) { error_log('anatomi report: ' . $e->getMessage()); kq_json(500, ['error' => 'server']); }
