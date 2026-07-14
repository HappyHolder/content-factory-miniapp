import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const repo = path.resolve(root, '..');
const require = createRequire(import.meta.url);
const { matchRegexWithTimeout } = require(path.join(root, 'dist/moderator/regexGuard.js'));
const { initiativeBackoffHours, consecutiveIgnored, chooseActivityType } = require(path.join(root, 'dist/communityManager/activityPolicy.js'));

assert.equal(initiativeBackoffHours(6, 0), 6);
assert.equal(initiativeBackoffHours(6, 1), 24);
assert.equal(initiativeBackoffHours(6, 2), 72);
assert.equal(initiativeBackoffHours(6, 3), 168);
assert.equal(consecutiveIgnored([{ automatic: true, evaluated: true, engaged: false }, { automatic: true, evaluated: true, engaged: false }, { automatic: true, evaluated: true, engaged: true }]), 2);
assert.equal(chooseActivityType(['DISCUSSION','POLL','GAME'], ['DISCUSSION']), 'POLL');

assert.equal(await matchRegexWithTimeout(['spam\\d+'], 'prefix spam42 suffix'), 'spam\\d+');
const started = Date.now();
assert.equal(await matchRegexWithTimeout(['^(a+)+$'], 'a'.repeat(4095) + '!', 100), null);
assert.ok(Date.now() - started < 500, 'catastrophic regex escaped its worker timeout');

const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const multerVersion = lock.packages?.['node_modules/multer']?.version;
const [major, minor] = String(multerVersion).split('.').map(Number);
assert.ok(major > 2 || (major === 2 && minor >= 2), `unsafe multer version: ${multerVersion}`);

const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
assert.match(dockerfile, /FROM node:20-bookworm-slim AS runtime/);
assert.match(dockerfile, /USER node/);
const caddyfile = fs.readFileSync(path.join(repo, 'deploy/Caddyfile'), 'utf8');
assert.match(caddyfile, /Content-Security-Policy/);
assert.match(caddyfile, /max_size 32MB/);

console.log('security smoke: ok');