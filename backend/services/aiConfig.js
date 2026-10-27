'use strict';

const VALID_PROVIDERS = ['codex', 'deepseek', 'openai', 'openrouter', 'claude', 'gemini', 'ollama', 'auto', 'none'];

function setting(db, key) {
  const value = db.prepare('SELECT value FROM global_settings WHERE key = ?').get(key)?.value;
  try { return JSON.parse(value); } catch { return value; }
}

function resolveConfig(db, workspaceId) {
  const workspace = workspaceId
    ? db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId)
    : db.prepare('SELECT * FROM workspaces WHERE is_active = 1 LIMIT 1').get();
  if (workspaceId && !workspace) {
    throw Object.assign(new Error('Workspace not found.'), { statusCode: 404 });
  }
  const globalProvider = setting(db, 'aiProvider') || process.env.DEFAULT_AI_PROVIDER || 'auto';
  const specific = workspace?.ai_provider && workspace.ai_provider !== 'auto';
  const provider = specific ? workspace.ai_provider : globalProvider;
  if (!VALID_PROVIDERS.includes(provider)) throw new Error('Invalid AI provider. Choose a provider in Settings.');
  let settings = {};
  try { settings = JSON.parse(workspace?.settings || '{}') || {}; } catch { /* old data */ }
  const model = specific && typeof settings.aiModel === 'string'
    ? settings.aiModel : provider === globalProvider ? setting(db, 'aiModel') || '' : '';
  return { provider, model, workspaceId: workspace?.id };
}

function saveConfig(db, { provider, model = '', workspaceId }) {
  if (!VALID_PROVIDERS.includes(provider)) throw Object.assign(new Error('Choose a valid AI provider.'), { statusCode: 400 });
  if (typeof model !== 'string' || (model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model))) {
    throw Object.assign(new Error('Enter a valid model name or leave Model blank.'), { statusCode: 400 });
  }
  db.transaction(() => {
    if (workspaceId) {
      const ws = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId);
      if (!ws) throw Object.assign(new Error('Workspace not found.'), { statusCode: 404 });
      let settings = {};
      try { settings = JSON.parse(ws.settings || '{}') || {}; } catch { /* old data */ }
      db.prepare("UPDATE workspaces SET ai_provider = ?, settings = ?, updated_at = datetime('now') WHERE id = ?")
        .run(provider, JSON.stringify({ ...settings, aiModel: model }), workspaceId);
    }
    const put = db.prepare('INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)');
    put.run('aiProvider', provider);
    put.run('aiModel', model);
  })();
}

module.exports = { resolveConfig, saveConfig, VALID_PROVIDERS };
