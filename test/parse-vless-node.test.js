const assert = require('node:assert/strict');
const test = require('node:test');

const { parseVlessNode } = require('../dist/utils/parse-vless-node.js');

test('parses a plain VLESS node', () => {
  const outbound = parseVlessNode('vless://uuid-1@a.example:8443?encryption=none#Tokyo', 0);

  assert.equal(outbound.type, 'vless');
  assert.equal(outbound.tag, 'Tokyo');
  assert.equal(outbound.server, 'a.example');
  assert.equal(outbound.server_port, 8443);
  assert.equal(outbound.uuid, 'uuid-1');
});

test('falls back to a generated tag when the link has no fragment', () => {
  assert.equal(parseVlessNode('vless://uuid-1@a.example:443', 4).tag, 'vless-5');
});

test('builds reality TLS options from the link parameters', () => {
  const outbound = parseVlessNode(
    'vless://uuid-1@a.example:443?security=reality&pbk=PUBLIC-KEY&sid=abcd&fp=chrome&sni=a.example#R',
    0,
  );

  assert.equal(outbound.tls.enabled, true);
  assert.equal(outbound.tls.server_name, 'a.example');
  assert.deepEqual(outbound.tls.reality, { enabled: true, public_key: 'PUBLIC-KEY', short_id: 'abcd' });
  assert.deepEqual(outbound.tls.utls, { enabled: true, fingerprint: 'chrome' });
});

test('rejects a reality node without a public key', () => {
  assert.throws(
    () => parseVlessNode('vless://uuid-1@a.example:443?security=reality&sid=abcd#R', 2),
    /Reality node at index 3 is missing its public key/,
  );
});

test('rejects a link without a uuid', () => {
  assert.throws(() => parseVlessNode('vless://@a.example:443#X', 0), /Invalid vless node at index 1/);
});

test('maps ws transport options', () => {
  const outbound = parseVlessNode('vless://uuid-1@a.example:443?type=ws&path=/ray&host=cdn.example#W', 0);

  assert.deepEqual(outbound.transport, {
    type: 'ws',
    path: '/ray',
    headers: { Host: 'cdn.example' },
  });
});

test('omits TLS fields that do not exist in older sing-box builds', () => {
  const outbound = parseVlessNode('vless://uuid-1@a.example:443?security=tls&sni=a.example#T', 0);

  // record_fragment arrived in sing-box 1.12 and is only meaningful when enabled; emitting the
  // default made configs unparsable on 1.11 and earlier.
  assert.ok(!('record_fragment' in outbound.tls));
  assert.equal(JSON.stringify(outbound).includes('record_fragment'), false);
});
