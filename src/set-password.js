'use strict';

// Sets the admin password. On the server:  sudo -u lera node /srv/lera/src/set-password.js
// Only a hash is stored (data/auth.json), and every device that was logged in is signed out.
// Non-interactive use reads the first line of stdin.
const path = require('path');
const { MIN_LENGTH, writeAuth } = require('./auth');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

function fail(message) {
  console.error(message);
  process.exit(1);
}

// Reads a line from the terminal without echoing it.
function askHidden(question) {
  return new Promise(resolve => {
    const input = process.stdin;
    let value = '';
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          input.setRawMode(false);
          input.pause();
          input.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    process.stdout.write(question);
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();
    input.on('data', onData);
  });
}

function readFirstLine() {
  return new Promise(resolve => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data.split(/\r?\n/)[0]));
  });
}

(async () => {
  // A file written by root would be unreadable for the service, which runs as lera.
  if (process.getuid && process.getuid() === 0) {
    fail('Не запускай от root — сервис не сможет прочитать пароль. Запусти так: sudo -u lera node src/set-password.js');
  }
  let password;
  if (process.stdin.isTTY) {
    password = await askHidden('Новый пароль админки: ');
    if (password !== (await askHidden('Ещё раз: '))) fail('Пароли не совпали — ничего не изменено.');
  } else {
    password = await readFirstLine();
  }
  if (password.length < MIN_LENGTH) fail(`Пароль короткий — нужно хотя бы ${MIN_LENGTH} символов. Ничего не изменено.`);
  writeAuth(DATA_DIR, password);
  console.log('Готово: пароль сохранён (на сервере только его хэш), все прежние входы сброшены.');
})();
