/**
 * frontend/js/ai.js
 * AI module — replaces v4.1's direct-to-provider callAI() with backend proxy.
 * All AI calls go through POST /api/ai/generate so API keys stay server-side.
 */
'use strict';
/* global DB */

// ── Provider status cache ────────────────────────────────────────────────────
let _providerStatus = null;   // { hasDeepseekKey, providers: {...}, current }
let _providerPollHandle = null;

async function loadProviderStatus() {
  const wid = DB.getActiveWorkspaceId();
  try {
    const result = await api.ai.providers(wid);
    if (wid !== DB.getActiveWorkspaceId()) return _providerStatus;
    _providerStatus = result;
    _updateProviderStatusUI();
  } catch (e) {
    _providerStatus = null;
    _updateProviderStatusUI();
    console.warn('[AI] Could not load provider status:', e.message);
  }
  return _providerStatus;
}

function _updateProviderStatusUI() {
  const el     = document.getElementById('providerStatus');
  const txtEl  = document.getElementById('providerStatusText');
  if (!el || !txtEl) return;

  if (!_providerStatus) {
    el.className = 'provider-status offline';
    txtEl.textContent = 'AI offline';
    return;
  }

  const selected = _selectedProvider();
  if (selected?.available) {
    el.className = 'provider-status online';
    txtEl.textContent = `${selected.label} · ${selected.model}`;
  } else {
    el.className = 'provider-status error';
    txtEl.textContent = selected ? `${selected.label} · setup needed` : 'No AI provider';
  }
  el.title = selected?.message || '';
}

function _selectedProvider() {
  if (!_providerStatus) return null;
  if (_providerStatus.workspaceId && DB.getActiveWorkspaceId() && _providerStatus.workspaceId !== DB.getActiveWorkspaceId()) return null;
  return _providerStatus.providers?.[_providerStatus.resolved || _providerStatus.current] || null;
}

function startProviderPolling(intervalMs = 30000) {
  if (_providerPollHandle) return;
  _providerPollHandle = setInterval(loadProviderStatus, intervalMs);
}

// ── isAIReady — sync check ────────────────────────────────────────────────────
function isAIReady() {
  return !!_selectedProvider()?.available;
}

function aiProviderLabel() {
  return _selectedProvider()?.label || null;
}

// ── callAI — main AI call, used by Orchestrator, steps, continuity etc. ──────
// Signature matches v4.1's callAI(prompt, settings) so existing call-sites work.
// The `settings` param is accepted but ignored — the backend handles provider selection.
async function callAI(prompt, _settings, workspaceId) {
  const wid = workspaceId || DB.getActiveWorkspaceId() || undefined;
  const { text } = await api.ai.generate({
    prompt,
    workspaceId: wid,
    maxTokens:   16384,
  });
  return text;
}

// ── getEffectiveSettings — v4.1 compat shim ──────────────────────────────────
// In v4.1 this merged global AI creds into project settings.
// In the fullstack version we don't store keys in the frontend — just return
// the project's non-AI settings so existing call-sites don't break.
function getEffectiveSettings(project) {
  return project?.settings || {};
}

Object.assign(window, {
  loadProviderStatus,
  startProviderPolling,
  isAIReady,
  aiProviderLabel,
  callAI,
  getEffectiveSettings,
});
