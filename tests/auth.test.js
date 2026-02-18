const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../server');

test('password hashing and verify', () => {
  const hash = hashPassword('secret1');
  assert.equal(verifyPassword('secret1', hash), true);
  assert.equal(verifyPassword('wrong', hash), false);
});
