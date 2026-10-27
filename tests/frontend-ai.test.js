'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(status) {
  const elements = { providerStatus: {}, providerStatusText: {} };
  const context = { console, setInterval, document: { getElementById: id => elements[id] }, DB: { getActiveWorkspaceId: () => 'project' }, api: { ai: { providers: async () => status } } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/js/ai.js'), 'utf8'), context);
  return { context, elements };
}

test('Codex readiness and badge follow the selected provider', async () => {
  const { context, elements } = load({ current: 'codex', resolved: 'codex', workspaceId: 'project', providers: {
    codex: { available: true, label: 'Codex · ChatGPT', model: 'Codex default' }, deepseek: { available: true },
  } });
  await context.loadProviderStatus();
  assert.equal(context.isAIReady(), true);
  assert.equal(context.aiProviderLabel(), 'Codex · ChatGPT');
  assert.match(elements.providerStatusText.textContent, /Codex/);
});

test('an unavailable Codex selection never falls back to a configured API provider', async () => {
  const { context } = load({ current: 'codex', resolved: 'codex', providers: {
    codex: { available: false }, deepseek: { available: true }, ollama: { available: true },
  } });
  await context.loadProviderStatus();
  assert.equal(context.isAIReady(), false);
});

test('other selected providers and disabled AI are handled correctly', async () => {
  for (const provider of ['openrouter', 'openai', 'gemini', 'claude', 'ollama']) {
    const { context } = load({ current: provider, resolved: provider, providers: { [provider]: { available: true } } });
    await context.loadProviderStatus();
    assert.equal(context.isAIReady(), true);
  }
  const { context } = load({ current: 'none', resolved: 'none', providers: { deepseek: { available: true } } });
  await context.loadProviderStatus();
  assert.equal(context.isAIReady(), false);
});

test('stale status from another project cannot enable generation', async () => {
  const { context } = load({ current: 'codex', resolved: 'codex', workspaceId: 'other', providers: { codex: { available: true } } });
  await context.loadProviderStatus();
  assert.equal(context.isAIReady(), false);
});
