#!/usr/bin/env bash
# Network: needs outbound TCP 21 + passive ports (FTPS explicit). EXTRA_DIR (optional) holds server-only api/config.php + _data/.htaccess.
# Deploy dist/ to Simply.com via FTPS (lftp). Requires real credentials in env:
#   SIMPLY_FTP_HOST (e.g. linux123.unoeuro.com), SIMPLY_FTP_USER, SIMPLY_FTP_PASSWORD,
#   SIMPLY_REMOTE_DIR (web root for knoglequiz.emiltram.dk, e.g. /public_html or the subdomain folder)
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SIMPLY_FTP_HOST:?missing SIMPLY_FTP_HOST}" "${SIMPLY_FTP_USER:?missing SIMPLY_FTP_USER}" "${SIMPLY_FTP_PASSWORD:?missing SIMPLY_FTP_PASSWORD}" "${SIMPLY_REMOTE_DIR:?missing SIMPLY_REMOTE_DIR}"
command -v lftp >/dev/null || { echo "install lftp"; exit 1; }
npm test
node scripts/build.mjs
DRY=${DRY_RUN:+--dry-run}
lftp -u "$SIMPLY_FTP_USER","$SIMPLY_FTP_PASSWORD" "ftp://$SIMPLY_FTP_HOST:${SIMPLY_FTP_PORT:-21}" -e "
  set ftp:ssl-force true; set ftp:passive-mode true; set net:max-retries 2; set net:timeout 30; set ftp:ssl-protect-data true; set ssl:verify-certificate yes;
  mkdir -fp $SIMPLY_REMOTE_DIR/_data;
  ${EXTRA_DIR:+put -O $SIMPLY_REMOTE_DIR/api $EXTRA_DIR/api/config.php; put -O $SIMPLY_REMOTE_DIR/_data $EXTRA_DIR/_data/.htaccess;}
  mirror -R --delete --verbose $DRY --exclude-glob api/config.php --exclude _data/ dist/ $SIMPLY_REMOTE_DIR/;
  cls -lR $SIMPLY_REMOTE_DIR; bye"
echo "Deployed. Smoke test:"; curl -fsS -o /dev/null -w "%{http_code}\n" "https://knoglequiz.emiltram.dk/" || true
