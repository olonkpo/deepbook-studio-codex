'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness({ fail = false, saved = [] } = {}) {
  let project = { id: 'p', settings: { autoRepair: false } };
  let calls = 0;
  const chapters = [...saved];
  const book = { id: 'b', number: 1, roadmap: { chapters: [{ title: 'One' }, { title: 'Two' }] } };
  const messages = [];
  const context = {
    console, setTimeout: () => 1, clearTimeout: () => {},
    APP: { currentProjectId: null },
    DB: {
      get: async () => project,
      getByIndex: async store => store === 'books' ? [book] : store === 'chapters' ? [...chapters] : [],
      put: async (store, value) => {
        if (store === 'projects') project = value;
        if (store === 'chapters') {
          const index = chapters.findIndex(c => c.id === value.id);
          if (index < 0) chapters.push(value); else chapters[index] = value;
        }
      },
    },
    isAIReady: () => true,
    uid: () => 'c' + calls,
    showToast: text => messages.push(text), updateWorkerBar: () => {},
    cleanEmDash: text => text, countWords: text => text.split(' ').length,
    buildChapterPrompt: async () => 'prompt',
    extractContinuityFacts: async () => ({ logText: 'Facts', facts: [] }),
    callAI: async () => {
      calls++;
      if (fail) throw Object.assign(new Error('Codex usage limit reached'), { code: 'CODEX_USAGE_LIMIT' });
      return 'An original chapter.';
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/js/orchestrator.js'), 'utf8'), context);
  return { context, chapters, messages, project: () => project, calls: () => calls };
}

test('a failed chapter stops the queue and cannot mark the project complete', async () => {
  const h = harness({ fail: true });
  const result = await h.context.Orchestrator.run('p');
  assert.equal(result.completed, false);
  assert.equal(h.calls(), 1);
  assert.equal(h.chapters.length, 0);
  assert.equal(h.project().status, 'error');
});

test('resuming skips saved chapters and completes only after all planned chapters exist', async () => {
  const h = harness({ saved: [{ id: 'existing', number: 1, content: 'Already saved.' }] });
  const result = await h.context.Orchestrator.run('p');
  assert.equal(result.completed, true);
  assert.equal(result.skipped, 1);
  assert.equal(h.calls(), 1);
  assert.equal(h.chapters.length, 2);
  assert.equal(h.project().status, 'complete');
});
