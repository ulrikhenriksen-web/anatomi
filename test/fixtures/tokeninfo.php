<?php
// Fake Google tokeninfo for tests.
$t = $_GET['id_token'] ?? '';
$base = ['iss' => 'https://accounts.google.com', 'aud' => 'test-client.apps.googleusercontent.com', 'exp' => (string)(time() + 600), 'email_verified' => 'true'];
$map = [
  'h.p.alice' => $base + ['sub' => '111', 'email' => 'alice@example.com', 'name' => 'Alice'],
  'h.p.bob' => $base + ['sub' => '222', 'email' => 'bob@example.com', 'name' => 'Bob'],
  'h.p.wrongaud' => ['aud' => 'evil.apps.googleusercontent.com'] + $base + ['sub' => '333'],
  'h.p.expired' => ['exp' => (string)(time() - 10)] + $base + ['sub' => '444'],
  'h.p.badiss' => ['iss' => 'evil.com'] + $base + ['sub' => '555'],
];
header('Content-Type: application/json');
if (!isset($map[$t])) { http_response_code(400); echo '{"error":"invalid_token"}'; exit; }
echo json_encode($map[$t]);
