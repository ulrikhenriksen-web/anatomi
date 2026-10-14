<?php
// Server-only (never commit). Upload to /knoglequiz/api/config.php.
return [
  'sqlite_path'      => dirname(__DIR__) . '/_data/knoglequiz.sqlite', // _data/ is deny-all via .htaccess
  'salt'             => 'CHANGE_ME_random_string',
  'google_client_id' => '', // e.g. 1234-abc.apps.googleusercontent.com; empty = guest mode only
  // 'cookie_secure' => true,
];
