#!/bin/sh
# Забирает с сервера контент, историю версий и фото из админки:  DEPLOY_HOST=root@1.2.3.4 sh deploy/backup.sh
# Хэш пароля (data/auth.json) не копирует.
set -eu
: "${DEPLOY_HOST:?Укажи DEPLOY_HOST, например root@1.2.3.4}"
APP_DIR=/srv/lera

cd "$(dirname "$0")/.."
DEST="backups/$(date +%Y-%m-%d_%H%M)"
mkdir -p "$DEST"
scp -rq "$DEPLOY_HOST:$APP_DIR/data/content.json" "$DEPLOY_HOST:$APP_DIR/data/history" "$DEST/"
scp -rq "$DEPLOY_HOST:$APP_DIR/public/uploads" "$DEST/" 2>/dev/null || echo 'Фото из админки пока нет.'
echo "Сохранено в $DEST"
