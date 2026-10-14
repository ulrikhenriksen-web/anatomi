<?php
// Copy to api/config.php on the server (never commit). Omit db_dsn to use SQLite outside the web root.
return [
  'db_dsn'  => 'mysql:host=mysqlXX.unoeuro.com;dbname=emiltram_dk_db;charset=utf8mb4',
  'db_user' => 'CHANGE_ME',
  'db_pass' => 'CHANGE_ME',
  'salt'    => 'CHANGE_ME_random_string',
  // 'sqlite_path' => '/path/outside/public_html/reports.sqlite',
];
