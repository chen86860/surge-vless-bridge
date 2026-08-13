const assert = require('node:assert/strict');
const test = require('node:test');

const { decodeSubscription } = require('../dist/utils/decode-subscription.js');

const base64 = (value) => Buffer.from(value, 'utf8').toString('base64');

test('returns a plain proxy link list unchanged', () => {
  const raw = 'vless://u@a.example:443#A\nvless://u@b.example:443#B';
  assert.equal(decodeSubscription(raw), raw);
});

test('accepts CRLF line endings', () => {
  const raw = 'vless://u@a.example:443#A\r\nvless://u@b.example:443#B';
  assert.equal(decodeSubscription(raw), raw);
});

test('decodes standard Base64', () => {
  assert.equal(decodeSubscription(base64('vless://u@a.example:443#A')), 'vless://u@a.example:443#A');
});

test('decodes the URL-safe Base64 alphabet', () => {
  const link = 'vless://u@a.example:443?flow=xtls-rprx-vision&sni=a.example#A';
  const urlSafe = base64(link).replace(/\+/g, '-').replace(/\//g, '_');
  assert.equal(decodeSubscription(urlSafe), link);
});

test('decodes Base64 that is wrapped across lines', () => {
  const wrapped = base64('vless://u@a.example:443#A').match(/.{1,16}/g).join('\n');
  assert.equal(decodeSubscription(wrapped), 'vless://u@a.example:443#A');
});

test('keeps protocols other than VLESS for the caller to filter', () => {
  const decoded = decodeSubscription(base64('hysteria2://x@a.example#H\nvless://u@b.example:443#V'));
  assert.match(decoded, /hysteria2:\/\//);
  assert.match(decoded, /vless:\/\//);
});

test('rejects an empty response', () => {
  assert.throws(() => decodeSubscription('   '), /Subscription response is empty/);
});

test('rejects an HTML error page instead of decoding it into mojibake', () => {
  assert.throws(
    () => decodeSubscription('<html><body>403 Forbidden</body></html>'),
    /neither a proxy link list nor valid Base64/,
  );
});

test('rejects Base64 that decodes to something without proxy links', () => {
  assert.throws(
    () => decodeSubscription(base64('your subscription has expired')),
    /does not contain any supported proxy links/,
  );
});
