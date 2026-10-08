#!/bin/sh
# Выкладывает код на сервер:  DEPLOY_HOST=root@1.2.3.4 sh deploy/deploy.sh
# Контент (data/) и фото из админки (public/uploads/) на сервере не трогает.
# Каждый раз обновляет systemd-сервис (свои настройки — в /etc/lera-admin.env).
# Первый запуск заодно создаёт пользователя lera и спрашивает пароль админки.
set -eu
: "${DEPLOY_HOST:?Укажи DEPLOY_HOST, например root@1.2.3.4}"
APP_DIR=/srv/lera
STAGE=/tmp/lera-deploy

cd "$(dirname "$0")/.."
ssh "$DEPLOY_HOST" "rm -rf $STAGE && mkdir -p $STAGE/public"
scp -rq package.json content.default.json src admin deploy "$DEPLOY_HOST:$STAGE/"
scp -rq public/assets "$DEPLOY_HOST:$STAGE/public/"

ssh -t "$DEPLOY_HOST" "
  set -e
  S=''; AS_LERA='runuser -u lera --'
  [ \"\$(id -u)\" -eq 0 ] || { S=sudo; AS_LERA='sudo -u lera'; }
  id lera >/dev/null 2>&1 || \$S useradd --system --home-dir $APP_DIR --shell /usr/sbin/nologin lera
  \$S mkdir -p $APP_DIR/data $APP_DIR/public/uploads
  \$S cp -r $STAGE/. $APP_DIR/
  \$S chown -R lera:lera $APP_DIR
  \$S cp $APP_DIR/deploy/lera-admin.service /etc/systemd/system/
  \$S systemctl daemon-reload
  \$S systemctl enable --quiet lera-admin
  \$S systemctl restart lera-admin
  rm -rf $STAGE
  if [ ! -f $APP_DIR/data/auth.json ]; then
    echo 'Пароль админки ещё не задан — задаём сейчас.'
    cd $APP_DIR && \$AS_LERA node src/set-password.js
  fi
  sleep 1
  \$S systemctl --no-pager --lines=3 status lera-admin
"
