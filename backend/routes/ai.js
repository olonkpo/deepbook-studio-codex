'use strict';

const express = require('express');
const { randomUUID } = require('node:crypto');
const { getDb } = require('../db/database');
const aiService = require('../services/aiService');
const codexService = require('../services/codexService');
const ollamaService = require('../services/ollamaService');
const { resolveConfig, saveConfig } = require('../services/aiConfig');
const router = express.Router();

function saveHistory(db, { workspaceId, type, prompt, result, provider }) {
  if (!workspaceId) return;
  try {
    db.prepare(`INSERT INTO generation_history (id, workspace_id, type, prompt, result, provider)
      VALUES (?, ?, ?, ?, ?, ?)`).run(randomUUID(), workspaceId, type, prompt.slice(0, 4000), result.slice(0, 8000), provider);
  } catch (_) { /* history is non-critical */ }
}

function validateInput(req) {
  const { prompt, maxTokens = 16384 } = req.body;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000000) {
    throw Object.assign(new Error('A non-empty prompt of at most 2,000,000 characters is required.'), { statusCode: 400 });
  }
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 131072) {
    throw Object.assign(new Error('maxTokens must be an integer between 1 and 131072.'), { statusCode: 400 });
  }
  return { prompt, maxTokens };
}

function handleGeneration(type) {
  return async (req, res) => {
    const controller = new AbortController();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', onClose);
    try {
      const { prompt, maxTokens } = validateInput(req);
      const db = getDb();
      const config = resolveConfig(db, req.body.workspaceId);
      const opts = { maxTokens, model: config.model, signal: controller.signal };
      if (type === 'stream') {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        let text = '';
        const provider = await aiService.streamGenerate(config.provider, [{ role: 'user', content: prompt }], opts, chunk => {
          text += chunk;
          if (!res.destroyed) res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        });
        saveHistory(db, { workspaceId: config.workspaceId, type, prompt, result: text, provider });
        if (!res.destroyed) res.end('data: [DONE]\n\n');
      } else {
        const result = await aiService.generate(config.provider, [{ role: 'user', content: prompt }], opts);
        saveHistory(db, { workspaceId: config.workspaceId, type, prompt, result: result.text, provider: result.provider });
        if (!res.destroyed) res.json(result);
      }
    } catch (err) {
      if (!res.destroyed) {
        const error = { error: err.message, code: err.code };
        if (res.headersSent) res.end(`data: ${JSON.stringify(error)}\n\n`);
        else res.status(err.statusCode || 500).json(error);
      }
    } finally {
      res.removeListener('close', onClose);
    }
  };
}

router.post('/generate', handleGeneration('generate'));
router.post('/outline', handleGeneration('outline'));
router.post('/stream', handleGeneration('stream'));

router.get('/providers', async (req, res) => {
  try {
    const config = resolveConfig(getDb(), req.query.workspaceId);
    const [ollamaStatus, codexStatus] = await Promise.all([ollamaService.checkStatus(), codexService.checkStatus()]);
    const providers = {
      ...aiService.getProviderStatus(),
      codex: codexStatus,
      ollama: {
        available: ollamaStatus.running, running: ollamaStatus.running,
        models: ollamaStatus.models || [], model: process.env.OLLAMA_DEFAULT_MODEL || 'llama3', label: 'Ollama (local)',
      },
    };
    const resolved = aiService.resolveProvider(config.provider);
    if (config.model && providers[resolved]) providers[resolved].model = config.model;
    res.json({ current: config.provider, resolved, model: config.model, workspaceId: config.workspaceId, providers });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

// A read-only connection check never starts a model request or opens a browser.
router.get('/codex/status', async (_req, res) => {
  res.json(await codexService.checkStatus());
});

router.post('/provider', (req, res) => {
  try {
    saveConfig(getDb(), req.body);
    res.json({ success: true, provider: req.body.provider });
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

router.get('/history', (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 20, 100));
  try {
    const db = getDb();
    const config = resolveConfig(db, req.query.workspaceId);
    if (!config.workspaceId) return res.json([]);
    res.json(db.prepare(`SELECT id, type, provider, created_at FROM generation_history
      WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`).all(config.workspaceId, limit));
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

module.exports = router;
