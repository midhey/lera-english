'use strict';

// Builds public/index.html (plus robots.txt and sitemap.xml) from the published content.
const path = require('path');
const store = require('./store');

const record = store.build();
console.log(`Собрано: ${path.join(store.SITE_DIR, 'index.html')} (версия ${record.version})`);
