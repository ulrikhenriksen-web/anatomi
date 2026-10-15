<?php
// Fake Google tokeninfo for tests.
$t = $_GET['id_token'] ?? '';
$base = ['iss' => 'https://accounts.google.com', 'aud' => 'test-client.apps.googleusercontent.com', 'exp' => (string)(time() + 600), 'email_verified' => 'true'];
$map = [
  'h.p.alice' => $base + ['sub' => '111', 'email' => 'alice@example.com', 'name' => 'Alice', 'picture' => 'https://lh3.googleusercontent.com/a/x'],
  'h.p.bob' => $base + ['sub' => '222', 'email' => 'bob@example.com', 'name' => 'Bob'],
  'h.p.carol' => $base + ['sub' => '666', 'email' => 'carol@example.com', 'name' => 'Carol Danvers'],
  'h.p.dave' => $base + ['sub' => '777', 'email' => 'dave@example.com', 'name' => 'Dave'],
  'h.p.erin' => $base + ['sub' => '888', 'email' => 'erin@example.com', 'name' => 'Erin'],
  'h.p.frank' => $base + ['sub' => '999', 'email' => 'frank@example.com', 'name' => 'Frank'],
  'h.p.wrongaud' => ['aud' => 'evil.apps.googleusercontent.com'] + $base + ['sub' => '333'],
  'h.p.expired' => ['exp' => (string)(time() - 10)] + $base + ['sub' => '444'],
  'h.p.badiss' => ['iss' => 'evil.com'] + $base + ['sub' => '555'],
];
header('Content-Type: application/json');
if (!isset($map[$t])) { http_response_code(400); echo '{"error":"invalid_token"}'; exit; }
echo json_encode($map[$t]);
