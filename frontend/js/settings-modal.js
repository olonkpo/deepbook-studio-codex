/**
 * frontend/js/settings-modal.js
 * Settings modal, theme cycling, and delete-project.
 *
 * Fullstack differences from v4.1:
 *  - AI provider/key saved server-side via api.settings.saveKey()
 *  - Provider status polled from backend (ai.js / loadProviderStatus)
 *  - Per-project settings (wordCount, autoRepair) still stored in project record
 */
'use strict';
/* global APP, DB, Orchestrator, _autoRunning, showToast */

// ── Open settings modal ───────────────────────────────────────────────────────
async function openSettings() {
  const project = APP.currentProjectId ? await DB.get('projects', APP.currentProjectId) : null;
  const ps      = project?.settings || {};

  // Use the same resolved settings as generation, including project overrides.
  let currentProvider = 'none', currentModel = '';
  try {
    const status = await api.ai.providers(APP.currentProjectId || undefined);
    currentProvider = status.current || 'none';
    currentModel = status.model || '';
  } catch (_) { /* backend may not have them set yet */ }

  document.getElementById('settingsBody').innerHTML = `
    <div class="setting-row">
      <div class="setting-info"><label>Author Name</label><span>Appears on the title page of every exported book</span></div>
      <div class="setting-control"><input id="setAuthorName" class="field" style="width:220px" value="${esc(project?.authorName || '')}" placeholder="e.g. Jane Smith"/></div>
    </div>
    <div class="setting-row">
      <div class="setting-info"><label>AI Provider</label><span>Used for this project and as the default for new projects</span></div>
      <div class="setting-control">
        <select id="setProvider" class="field" style="width:200px" onchange="document.getElementById('setModel').value='';updateSetModelHint()">
          <option value="none"       ${!currentProvider || currentProvider === 'none' ? 'selected' : ''}>— None —</option>
          <option value="codex"      ${currentProvider === 'codex' ? 'selected' : ''}>Codex · ChatGPT</option>
          <option value="auto"       ${currentProvider === 'auto' ? 'selected' : ''}>Auto (API / local)</option>
          <option value="deepseek"   ${currentProvider === 'deepseek'   ? 'selected' : ''}>DeepSeek ⭐</option>
          <option value="gemini"     ${currentProvider === 'gemini'     ? 'selected' : ''}>Gemini</option>
          <option value="claude"     ${currentProvider === 'claude'     ? 'selected' : ''}>Claude</option>
          <option value="openai"     ${currentProvider === 'openai'     ? 'selected' : ''}>OpenAI</option>
          <option value="openrouter" ${currentProvider === 'openrouter' ? 'selected' : ''}>OpenRouter</option>
          <option value="ollama"     ${currentProvider === 'ollama'     ? 'selected' : ''}>Ollama (local)</option>
        </select>
      </div>
    </div>
    <div id="codexSetup" style="display:none;margin:12px 0;padding:16px;background:var(--bg-alt);border:1px solid var(--border);border-radius:var(--radius-sm)">
      <strong>Use your ChatGPT account</strong>
      <p style="font-size:.85rem;margin:8px 0">Install Codex once, then sign in with ChatGPT in your terminal:</p>
      <pre style="white-space:pre-wrap;user-select:text;font-size:.82rem">npm install -g @openai/codex@latest\ncodex login</pre>
      <p style="font-size:.82rem;margin:8px 0">No API key is needed. Keep DeepBook open while generating. Your Codex allowance and model access apply.</p>
      <button class="btn btn-secondary btn-sm" id="checkCodexBtn" onclick="checkCodexConnection()">Check connection</button>
      <div id="codexConnectionStatus" role="status" style="font-size:.82rem;margin-top:8px"></div>
    </div>
    <div class="setting-row" id="setApiKeyRow">
      <div class="setting-info"><label>API Key</label><span id="setKeyHint">Stored on this computer</span></div>
      <div class="setting-control"><input id="setApiKey" type="password" class="field" style="width:220px" placeholder="Paste new key to update…"/></div>
    </div>
    <div class="setting-row">
      <div class="setting-info"><label>Model</label><span id="setModelHint">Leave blank for default</span></div>
      <div class="setting-control"><input id="setModel" class="field" style="width:180px" value="${esc(currentModel)}" placeholder="default"/></div>
    </div>
    <div class="setting-row">
      <div class="setting-info"><label>Target Words/Chapter</label><span>Chapters will be auto-repaired to this length</span></div>
      <div class="setting-control"><input id="setWords" type="number" class="field" style="width:100px" value="${ps.targetWordCount || 3000}" min="500" max="8000"/></div>
    </div>
    <div class="setting-row">
      <div class="setting-info"><label>Chapters Per Book</label><span>Maximum chapters generated per book</span></div>
      <div class="setting-control"><input id="setChaptersPerBook" type="number" class="field" style="width:100px" value="${ps.chaptersPerBook || 15}" min="1" max="60"/></div>
    </div>
    <div class="setting-row">
      <div class="setting-info"><label>Books Per Series</label><span>Number of books in the series</span></div>
      <div class="setting-control"><input id="setMaxBooks" type="number" class="field" style="width:100px" value="${project?.maxBooks || 5}" min="1" max="25"/></div>
    </div>
    <div class="setting-row">
      <div class="setting-info"><label>Auto-Repair</label><span>Auto-tighten chapters outside word count range</span></div>
      <div class="setting-control"><input type="checkbox" id="setAutoRepair" ${ps.autoRepair !== false ? 'checked' : ''} style="width:18px;height:18px"></div>
    </div>
    ${project ? `<div class="setting-row">
      <div class="setting-info"><label style="color:var(--red)">Delete Project</label><span>Permanently removes all data</span></div>
      <div class="setting-control"><button class="btn btn-red btn-sm" onclick="deleteProject()">Delete</button></div>
    </div>` : ''}
    <div id="settingsStatus" class="status-msg" style="margin-top:12px"></div>`;

  updateSetModelHint();
  openModal('settingsModal');
  if (currentProvider === 'codex') checkCodexConnection();
}

function updateSetModelHint() {
  const p = document.getElementById('setProvider')?.value;
  const defaults = {
    deepseek: 'deepseek-chat', gemini: 'gemini-2.0-flash',
    claude: 'claude-sonnet-4-20250514', openai: 'gpt-4o',
    openrouter: 'deepseek/deepseek-chat', ollama: 'llama3',
  };
  const h = document.getElementById('setModelHint');
  if (h) h.textContent = p === 'codex'
    ? 'Leave blank for Codex default, or enter a model available in your Codex account'
    : defaults[p] ? 'Default: ' + defaults[p] : 'Leave blank for default';

  const setup = document.getElementById('codexSetup');
  if (setup) setup.style.display = p === 'codex' ? 'block' : 'none';
  const keyRow = document.getElementById('setApiKeyRow');
  const needsKey = !['codex', 'ollama', 'auto', 'none'].includes(p);
  if (keyRow) keyRow.style.display = needsKey ? '' : 'none';
  const keyInput = document.getElementById('setApiKey');
  if (keyInput) keyInput.disabled = !needsKey;

  const kh = document.getElementById('setKeyHint');
  if (kh) {
    const urls = {
      deepseek: 'platform.deepseek.com', gemini: 'aistudio.google.com',
      claude: 'console.anthropic.com', openai: 'platform.openai.com',
      openrouter: 'openrouter.ai',
    };
    kh.textContent = p && p !== 'none' && p !== 'ollama' && urls[p]
      ? 'Get key at ' + urls[p]
      : p === 'ollama'
        ? 'No API key needed for local Ollama'
        : 'Your provider API key';
  }
}

async function checkCodexConnection() {
  const statusEl = document.getElementById('codexConnectionStatus');
  const button = document.getElementById('checkCodexBtn');
  if (!statusEl || !button) return;
  button.disabled = true;
  statusEl.textContent = 'Checking Codex sign-in…';
  try {
    const status = await api.ai.codexStatus();
    statusEl.textContent = status.message;
    statusEl.style.color = status.available ? 'var(--green)' : 'var(--amber)';
  } catch (err) {
    statusEl.textContent = 'Could not check Codex: ' + err.message;
  } finally { button.disabled = false; }
}

async function saveSettings() {
  if (Orchestrator.isRunning() || (typeof _autoRunning !== 'undefined' && _autoRunning)) {
    showToast('Wait for generation to finish before changing providers.', 'warning');
    return;
  }
  const provider   = document.getElementById('setProvider').value;
  const apiKey     = (document.getElementById('setApiKey')?.value || '').replace(/[^\x20-\x7E]/g, '').trim();
  const model      = (document.getElementById('setModel')?.value  || '').replace(/[^\x20-\x7E]/g, '').trim();
  const authorName = (document.getElementById('setAuthorName')?.value || '').trim();

  try {
    // Save API key server-side (only if a new key was entered)
    if (apiKey && !['none', 'ollama', 'codex', 'auto'].includes(provider)) {
      await api.settings.saveKey(provider, apiKey);
    }

    await api.ai.setProvider({ provider, model, workspaceId: APP.currentProjectId || undefined });
    DB.setActiveWorkspaceId(DB.getActiveWorkspaceId()); // invalidate cached project provider

    // Refresh provider status in ai.js
    await loadProviderStatus();
  } catch (e) {
    showToast('Failed to save AI settings: ' + e.message, 'danger');
    return;
  }

  // Per-project settings
  if (APP.currentProjectId) {
    const projectSettings = {
      targetWordCount:  +document.getElementById('setWords').value || 3000,
      chaptersPerBook:  Math.max(1, Math.min(60, +document.getElementById('setChaptersPerBook')?.value || 15)),
      autoRepair:       document.getElementById('setAutoRepair').checked,
    };
    const maxBooks = Math.max(1, Math.min(25, +document.getElementById('setMaxBooks')?.value || 5));
    const project  = await DB.get('projects', APP.currentProjectId);
    await DB.put('projects', {
      ...project,
      authorName: authorName || project.authorName || '',
      maxBooks,
      settings:  { ...project.settings, ...projectSettings },
      updatedAt: new Date().toISOString(),
    });
  }

  closeModal('settingsModal');
  showToast('Settings saved', 'success');

  // Refresh DNA step if open (shows AI badge)
  if (APP.currentProjectId && APP.currentStep === 0) {
    renderStep(0);
  }
}

async function deleteProject() {
  if (!APP.currentProjectId) return;
  if (Orchestrator.isRunning()) {
    showToast('Cannot delete while generation is running', 'danger');
    return;
  }
  closeModal('settingsModal');
  confirmDialog('Delete Project',
    'This will permanently delete all chapters, roadmaps, and continuity data. This cannot be undone.',
    async () => {
      const id = APP.currentProjectId;
      if (APP.dashInterval) { clearInterval(APP.dashInterval); APP.dashInterval = null; }
      await DB.delByIndex('chapters',          'by_project', id);
      await DB.delByIndex('books',             'by_project', id);
      await DB.delByIndex('continuityFacts',   'by_project', id);
      await DB.delByIndex('codexEntries',      'by_project', id);
      await DB.delByIndex('jobQueue',          'by_project', id);
      await DB.del('projects', id);
      showToast('Project deleted', 'info');
      goHome();
    });
}

// ── Theme ─────────────────────────────────────────────────────────────────────
let _theme = 'light';

function cycleTheme() {
  _theme = _theme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', _theme);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = _theme === 'dark' ? '☀️' : '🌙';
  DB.setSetting('theme', _theme).catch(() => {});
}

async function loadTheme() {
  const t = await DB.getSetting('theme', 'light');
  _theme = t;
  document.documentElement.setAttribute('data-theme', t);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
}

Object.assign(window, {
  openSettings, updateSetModelHint, checkCodexConnection, saveSettings, deleteProject,
  cycleTheme, loadTheme,
});
