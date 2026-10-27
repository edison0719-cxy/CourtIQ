const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

test('translation module exists', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '../static/i18n.js')));
});

test('translations cover all declared interface strings', () => {
  const { english, translate } = require('../static/i18n.js');
  const html = fs.readFileSync(path.join(__dirname, '../static/index.html'), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-placeholder|-aria-label|-title)?="([^"]+)"/g)].map(m => m[1]);
  assert.ok(keys.length > 60, 'The whole interface must participate, not only the header');
  for (const key of keys) {
    assert.ok(english[key], `Missing English translation: ${key}`);
    assert.equal(translate(key, 'zh'), key);
  }
});

test('dynamic copy interpolates actual values without translating user content', () => {
  const { translate } = require('../static/i18n.js');
  assert.equal(translate('统计覆盖前 {seconds} 秒', 'en', { seconds: '5.0' }), 'Analysis covers the first 5.0 s');
  assert.equal(translate('统计覆盖前 {seconds} 秒', 'zh', { seconds: '5.0' }), '统计覆盖前 5.0 秒');
  assert.equal(translate('学生自定义名称', 'en'), '学生自定义名称');
});
