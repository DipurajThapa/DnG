import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveRuntimeConfig } from '../runtime-config.js';

const local = resolveRuntimeConfig('http://localhost:3000');
const loopback = resolveRuntimeConfig('http://127.0.0.1:3000');
const canonical = resolveRuntimeConfig('https://goliath-project-management-tracker.vercel.app');
const preview = resolveRuntimeConfig('https://goliath-example.vercel.app');

assert.equal(local.originAllowed, true);
assert.equal(loopback.originAllowed, true);
assert.equal(canonical.originAllowed, false);
assert.equal(preview.originAllowed, false);
assert.equal(local.environment, 'development');
assert.equal(local.deploymentMode, 'local-only');

const auth = new URL(local.authUrl);
const data = new URL(local.dataApiUrl);
assert.equal(auth.protocol, 'https:');
assert.equal(data.protocol, 'https:');
assert.equal(auth.hostname.split('.')[0], data.hostname.split('.')[0]);

const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
assert.equal(vercel.git?.deploymentEnabled?.main, false);
assert.match(vercel.ignoreCommand, /process\.exit\(0\)/);

const csp = vercel.headers
  .flatMap(rule => rule.headers ?? [])
  .find(header => header.key === 'Content-Security-Policy')?.value ?? '';
assert.ok(csp.includes(auth.origin));
assert.ok(csp.includes(data.origin));
assert.ok(!csp.includes('ep-twilight-unit-au4iuyze'));

console.log('Goliath runtime boundary checks: PASS');
