'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createCodexService } = require('../backend/services/codexService');
const cli = path.join(__dirname, 'fixtures', 'fake-codex.cjs');
const messages = [{ role: 'user', content: 'Write prose. Preserve literal $(echo injected), `commands`, "quotes", and Ghanaian names: Baaba.' }];

function service(mode = 'success', extra = {}) {
  return createCodexService({ env: { ...process.env, CODEX_CLI_PATH: cli, DEEPBOOK_TEST_MODE: mode, ...extra } });
}

test('recognizes ChatGPT authentication without exposing credentials', async () => {
  const status = await service().checkStatus();
  assert.equal(status.available, true);
  assert.equal(status.authMode, 'chatgpt');
  assert.equal(status.authenticated, true);
});

test('refuses API-key login and signed-out mode before generation', async () => {
  for (const mode of ['api-auth', 'signed-out']) {
    const codex = service(mode);
    const status = await codex.checkStatus();
    assert.equal(status.available, false);
    assert.ok(!JSON.stringify(status).includes('sk-test-secret'));
    await assert.rejects(codex.generate(messages), { code: 'CODEX_LOGIN_REQUIRED' });
  }
});

test('reports missing executable with actionable setup instructions', async () => {
  const status = await service('success', { CODEX_CLI_PATH: path.join(os.tmpdir(), 'deepbook-nonexistent-codex') }).checkStatus();
  assert.equal(status.available, false);
  assert.equal(status.code, 'CODEX_NOT_INSTALLED');
});

test('passes full prompt on stdin, isolates execution, strips API keys and reads only final manuscript', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepbook-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const tracePath = path.join(dir, 'trace.json');
  const result = await service('success', { DEEPBOOK_TEST_TRACE: tracePath, OPENAI_API_KEY: 'not-a-real-key', CODEX_API_KEY: 'not-a-real-key' })
    .generate(messages, { model: 'test-model' });
  assert.equal(result.text, 'The teacup was missing.\n\n“Who took it?” I asked.');
  assert.equal(result.tokens, 25);
  assert.equal(result.provider, 'codex');
  const trace = JSON.parse(await fs.readFile(tracePath, 'utf8'));
  assert.ok(trace.input.includes(messages[0].content));
  assert.ok(!trace.args.join(' ').includes(messages[0].content));
  assert.ok(trace.args.includes('forced_login_method="chatgpt"'));
  assert.ok(trace.args.includes('--ignore-user-config'));
  assert.ok(trace.args.includes('read-only'));
  assert.ok(trace.args.includes('features.shell_tool=false'));
  assert.ok(trace.args.includes('test-model'));
  assert.deepEqual(trace.apiKeys, []);
  await assert.rejects(fs.access(trace.cwd), { code: 'ENOENT' });
});

test('rejects partial or missing final responses even when process exits successfully', async () => {
  for (const mode of ['partial', 'empty', 'missing-output']) {
    await assert.rejects(service(mode).generate(messages), err => err.code.startsWith('CODEX_'));
  }
});

test('usage limit stops generation and preserves a typed error', async () => {
  await assert.rejects(service('quota').generate(messages), { code: 'CODEX_USAGE_LIMIT', statusCode: 429 });
});

test('old CLI receives update guidance', async () => {
  await assert.rejects(service('old-cli').generate(messages), { code: 'CODEX_UPDATE_REQUIRED' });
});

test('a recoverable event does not discard a completed response', async () => {
  assert.ok((await service('recovered').generate(messages)).text.startsWith('The teacup'));
});

test('terminates hung generation and cleans up its temporary directory', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepbook-timeout-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const tracePath = path.join(dir, 'trace.json');
  await assert.rejects(service('timeout', { CODEX_TIMEOUT_MS: '1000', DEEPBOOK_TEST_TRACE: tracePath }).generate(messages), { code: 'CODEX_TIMEOUT' });
  const trace = JSON.parse(await fs.readFile(tracePath, 'utf8'));
  await assert.rejects(fs.access(trace.cwd), { code: 'ENOENT' });
});

test('cancels an active request and rejects overlapping generation', async () => {
  const codex = service('timeout');
  const controller = new AbortController();
  const running = codex.generate(messages, { signal: controller.signal });
  await assert.rejects(codex.generate(messages), { code: 'CODEX_BUSY' });
  setTimeout(() => controller.abort(), 200);
  await assert.rejects(running, { code: 'CODEX_CANCELLED' });
});

test('server shutdown cancels an owned Codex process', async () => {
  const codex = service('timeout');
  const running = codex.generate(messages);
  setTimeout(() => codex.shutdown(), 200);
  await assert.rejects(running, { code: 'CODEX_CANCELLED' });
});
