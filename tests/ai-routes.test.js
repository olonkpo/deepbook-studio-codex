'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const express = require('../backend/node_modules/express');

let server, base, db, directory, workspaceId;

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'deepbook-routes-'));
  process.env.NODE_ENV = 'production';
  process.env.APPDATA_PATH = directory;
  process.env.CODEX_CLI_PATH = path.join(__dirname, 'fixtures', 'fake-codex.cjs');
  process.env.DEEPBOOK_TEST_MODE = 'success';
  process.env.DEEPBOOK_TEST_TRACE = path.join(directory, 'trace.json');
  process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:1';
  db = require('../backend/db/database').getDb();
  workspaceId = db.prepare('SELECT id FROM workspaces LIMIT 1').get().id;
  const app = express();
  app.use(express.json());
  app.use('/api/ai', require('../backend/routes/ai'));
  app.use('/api/settings', require('../backend/routes/settings'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  require('../backend/db/database').closeDb();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

async function request(url, method = 'GET', body) {
  const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}

test('saving Codex provider and model controls generation and persists across database reopen', async () => {
  const saved = await request('/api/ai/provider', 'POST', { workspaceId, provider: 'codex', model: 'test-writing-model' });
  assert.equal(saved.status, 200);
  require('../backend/db/database').closeDb();
  db = require('../backend/db/database').getDb();
  const status = await request('/api/ai/providers?workspaceId=' + workspaceId);
  assert.equal(status.body.current, 'codex');
  assert.equal(status.body.resolved, 'codex');
  assert.equal(status.body.providers.codex.available, true);
  assert.equal(status.body.providers.codex.model, 'test-writing-model');
  for (const endpoint of ['generate', 'outline']) {
    const result = await request('/api/ai/' + endpoint, 'POST', { workspaceId, prompt: 'Write a chapter.' });
    assert.equal(result.status, 200);
    assert.equal(result.body.provider, 'codex');
    assert.match(result.body.text, /teacup/);
  }
  const trace = JSON.parse(await fs.readFile(process.env.DEEPBOOK_TEST_TRACE, 'utf8'));
  assert.ok(trace.args.includes('test-writing-model'));
});

test('stream endpoint sends manuscript and completion, not CLI diagnostic text', async () => {
  const response = await fetch(base + '/api/ai/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, prompt: 'Write prose.' }) });
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(text, /teacup/);
  assert.match(text, /data: \[DONE\]/);
  assert.ok(!text.includes('Working on it'));
});

test('usage limit propagates as 429 and never falls through to another provider', async () => {
  process.env.DEEPBOOK_TEST_MODE = 'quota';
  try {
    const beforeCount = db.prepare('SELECT COUNT(*) as n FROM generation_history').get().n;
    const result = await request('/api/ai/generate', 'POST', { workspaceId, prompt: 'Write prose.' });
    assert.equal(result.status, 429);
    assert.equal(result.body.code, 'CODEX_USAGE_LIMIT');
    assert.equal(db.prepare('SELECT COUNT(*) as n FROM generation_history').get().n, beforeCount);
  } finally { process.env.DEEPBOOK_TEST_MODE = 'success'; }
});

test('explicit project settings win over global defaults, while auto projects inherit defaults', async () => {
  await request('/api/ai/provider', 'POST', { provider: 'none', model: '' });
  const status = await request('/api/ai/providers?workspaceId=' + workspaceId);
  assert.equal(status.body.current, 'codex');
  db.prepare("INSERT INTO workspaces (id, name, ai_provider) VALUES ('inherited', 'Other project', 'auto')").run();
  const other = await request('/api/ai/providers?workspaceId=inherited');
  assert.equal(other.body.current, 'none');
});

test('unknown workspace and invalid inputs fail before launching Codex', async () => {
  assert.equal((await request('/api/ai/generate', 'POST', { workspaceId: 'missing', prompt: 'Hello' })).status, 404);
  assert.equal((await request('/api/ai/provider', 'POST', { workspaceId, provider: 'fake' })).status, 400);
  assert.equal((await request('/api/ai/provider', 'POST', { workspaceId, provider: 'codex', model: '--injected option' })).status, 400);
  assert.equal((await request('/api/ai/generate', 'POST', { workspaceId, prompt: {} })).status, 400);
  assert.equal((await request('/api/ai/generate', 'POST', { workspaceId, prompt: 'Hello', maxTokens: -1 })).status, 400);
});

test('general settings endpoints do not expose saved provider API keys', async () => {
  db.prepare('INSERT INTO global_settings (key, value) VALUES (?, ?)').run('openai_api_key', 'secret-test-key');
  const all = await request('/api/settings');
  assert.ok(!JSON.stringify(all.body).includes('secret-test-key'));
  assert.equal((await request('/api/settings/openai_api_key')).status, 404);
});
