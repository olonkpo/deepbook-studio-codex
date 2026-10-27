'use strict';

// Codex owns authentication. DeepBook never reads its credential files or calls
// an inference API: it sends a prompt on stdin and reads the completed response.
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OUTPUT_LIMIT = 8 * 1024 * 1024;
const LOGIN_HELP = 'Run codex login on this computer and sign in with ChatGPT, then check the connection again.';

function failure(code, message, statusCode = 503) {
  return Object.assign(new Error(message), { code, statusCode });
}

// Never run a shell, including for npm's Windows .cmd shim. Invoke the npm
// package's JS launcher with Node directly on Windows instead.
function resolveCommand(env, platform = process.platform) {
  const configured = env.CODEX_CLI_PATH;
  if (configured) {
    if (/\.(cmd|bat)$/i.test(configured)) {
      const launcher = path.join(path.dirname(configured), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (existsSync(launcher)) return { command: process.execPath, prefix: [launcher] };
      throw failure('CODEX_NOT_INSTALLED', 'Set CODEX_CLI_PATH to the Codex executable or its bin/codex.js launcher, not a shell script.');
    }
    return /\.(mjs|cjs|js)$/i.test(configured)
      ? { command: process.execPath, prefix: [configured] }
      : { command: configured, prefix: [] };
  }
  if (platform === 'win32') {
    const dirs = (env.PATH || env.Path || '').split(path.delimiter);
    if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'npm'));
    for (const dir of dirs.filter(Boolean)) {
      const native = path.join(dir, 'codex.exe');
      if (existsSync(native)) return { command: native, prefix: [] };
      const launcher = path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (existsSync(launcher)) return { command: process.execPath, prefix: [launcher] };
    }
  }
  return { command: 'codex', prefix: [] };
}

function childEnvironment(env) {
  const clean = { ...env, NO_COLOR: '1' };
  // Prevent an inherited API key from silently changing the billing method.
  for (const name of Object.keys(clean)) {
    if (/_API_KEY$/i.test(name) || name === 'OPENAI_BASE_URL') delete clean[name];
  }
  const extraPaths = process.platform === 'win32' ? [] : ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin')];
  clean.PATH = [env.PATH || env.Path || '', ...extraPaths].filter(Boolean).join(path.delimiter);
  return clean;
}

function classifyError(detail, exitCode) {
  if (/usage limit|rate.?limit|quota|limit reached|too many requests|429/i.test(detail)) {
    return failure('CODEX_USAGE_LIMIT', 'Codex usage limit reached. Your saved chapters are safe. Wait for your allowance to reset, then resume generation.', 429);
  }
  if (/unauthorized|not logged in|authentication|token.*expired|401|sign in|login/i.test(detail)) {
    return failure('CODEX_LOGIN_REQUIRED', LOGIN_HELP, 401);
  }
  if (/unexpected argument|unknown (option|flag)|unrecognized option/i.test(detail)) {
    return failure('CODEX_UPDATE_REQUIRED', 'Update Codex CLI with npm install -g @openai/codex@latest, then try again.');
  }
  if (/model.*(not found|not supported|not available|does not exist)|unsupported model/i.test(detail)) {
    return failure('CODEX_MODEL_UNAVAILABLE', 'This model is not available to your Codex account. Clear the Model field to use the Codex default or choose a model available in your Codex CLI.');
  }
  return failure('CODEX_GENERATION_FAILED', `Codex did not complete the request${exitCode == null ? '' : ` (exit ${exitCode})`}. Check Codex in your terminal, then retry. No partial response was saved as a chapter.`);
}

function createCodexService({ env = process.env, spawnProcess = spawn } = {}) {
  let busy = false;
  const active = new Set();

  function run(args, { input = '', cwd = os.tmpdir(), timeoutMs = 10000, signal } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(failure('CODEX_CANCELLED', 'Codex generation was cancelled.', 499));
      let command;
      try { command = resolveCommand(env); } catch (err) { reject(err); return; }
      let child;
      try {
        child = spawnProcess(command.command, [...command.prefix, ...args], {
          cwd, env: childEnvironment(env), shell: false, windowsHide: true,
          detached: process.platform !== 'win32',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) { reject(err); return; }
      let stdout = '', stderr = '', size = 0, stopped = null;
      let killTimer;
      const terminate = (signal = 'SIGTERM') => {
        if (!child.pid) return;
        if (process.platform === 'win32') {
          // npm's launcher owns a native child; terminate the entire owned tree.
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
          killer.on('error', () => child.kill());
        } else {
          try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
        }
      };
      const stop = (err) => {
        if (stopped) return;
        stopped = err;
        terminate();
        killTimer = setTimeout(() => terminate('SIGKILL'), 1000);
        killTimer.unref();
      };
      const abort = () => stop(failure('CODEX_CANCELLED', 'Codex generation was cancelled.', 499));
      active.add(abort);
      const timer = setTimeout(() => stop(failure('CODEX_TIMEOUT', 'Codex took too long to complete this request. Your saved chapters are safe; try again or select a faster model.', 504)), timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        signal?.removeEventListener('abort', abort);
        active.delete(abort);
      };
      signal?.addEventListener('abort', abort, { once: true });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        size += Buffer.byteLength(chunk);
        if (size > OUTPUT_LIMIT) stop(failure('CODEX_OUTPUT_TOO_LARGE', 'Codex returned too much output. Try a smaller chapter.'));
        else stdout += chunk;
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-32768); });
      child.on('error', err => {
        cleanup();
        reject(err.code === 'ENOENT'
          ? failure('CODEX_NOT_INSTALLED', 'Codex CLI was not found. Install it with npm install -g @openai/codex@latest, then run codex login. If already installed, set CODEX_CLI_PATH in .env.')
          : failure('CODEX_START_FAILED', 'Codex could not start. Check the installation and CODEX_CLI_PATH.'));
      });
      child.on('close', code => {
        cleanup();
        if (stopped) reject(stopped);
        else resolve({ code, stdout, stderr });
      });
      // A rejected command can close stdin before the full prompt is written.
      child.stdin.on('error', err => {
        if (err.code !== 'EPIPE') stop(failure('CODEX_INPUT_FAILED', 'Could not send the manuscript prompt to Codex.'));
      });
      child.stdin.end(input);
      if (signal?.aborted) abort();
    });
  }

  async function checkStatus() {
    const base = { label: 'Codex · ChatGPT', model: env.CODEX_MODEL || 'Codex default', available: false, installed: false, authenticated: false };
    try {
      const result = await run(['login', 'status']);
      const output = result.stdout + '\n' + result.stderr;
      if (result.code === 0 && /logged in using chatgpt/i.test(output)) {
        return { ...base, available: true, installed: true, authenticated: true, authMode: 'chatgpt', message: 'Signed in with ChatGPT. Codex plan limits apply.' };
      }
      const apiAuth = /api.?key/i.test(output);
      return {
        ...base, installed: true, authMode: apiAuth ? 'api-key' : 'unknown',
        code: 'CODEX_LOGIN_REQUIRED',
        message: apiAuth ? 'Codex is signed in with an API key. Run codex login and choose ChatGPT to use this provider.' : LOGIN_HELP,
      };
    } catch (err) {
      return { ...base, code: err.code || 'CODEX_START_FAILED', message: err.message };
    }
  }

  async function generate(messages, opts = {}) {
    if (busy) throw failure('CODEX_BUSY', 'Codex is already generating. Wait for the current request to finish.', 409);
    busy = true;
    let workDir;
    try {
      const status = await checkStatus();
      if (!status.available) throw failure(status.code, status.message, status.code === 'CODEX_LOGIN_REQUIRED' ? 401 : 503);
      workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepbook-codex-'));
      const outputPath = path.join(workDir, 'response.txt');
      const model = opts.model || env.CODEX_MODEL || '';
      if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model)) {
        throw failure('INVALID_MODEL', 'Enter a valid Codex model name or leave Model blank.', 400);
      }
      const args = [
        'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
        '--sandbox', 'read-only', '--color', 'never', '--json',
        '-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"',
        '-c', 'approval_policy="never"', '-c', 'features.shell_tool=false',
        '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0',
        '--output-last-message', outputPath,
      ];
      if (model) args.push('--model', model);
      args.push('-');
      const input = [
        'You are the writing engine for DeepBook Studio. Complete the writing request using only the supplied context. Return only the requested manuscript text or JSON as your final response. Do not run commands, browse, inspect files, or write files. Do not add a progress report or commentary.',
        ...messages.map(m => `[${m.role}]\n${m.content}`),
      ].join('\n\n');
      const requestedTimeout = Number(env.CODEX_TIMEOUT_MS);
      const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout >= 1000
        ? Math.min(requestedTimeout, 3600000) : 1200000;
      const result = await run(args, { input, cwd: workDir, timeoutMs, signal: opts.signal });
      const events = result.stdout.split(/\r?\n/).filter(Boolean).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      const completed = events.findLast(e => e.type === 'turn.completed');
      const failed = events.find(e => e.type === 'turn.failed');
      if (result.code !== 0 || failed || !completed) {
        // Use errors only for classification; don't leak CLI diagnostics or tokens.
        throw classifyError(result.stderr + '\n' + JSON.stringify(events.filter(e => e.type === 'error' || e.type === 'turn.failed')), result.code);
      }
      let text;
      try {
        const stat = await fs.stat(outputPath);
        if (stat.size > OUTPUT_LIMIT) throw new Error('Too large');
        text = await fs.readFile(outputPath, 'utf8');
      } catch {
        throw failure('CODEX_EMPTY_RESPONSE', 'Codex finished without a readable final response. Retry this chapter.');
      }
      if (!text.trim()) throw failure('CODEX_EMPTY_RESPONSE', 'Codex returned an empty response. Retry this chapter.');
      return { text, model: model || 'Codex default', tokens: completed.usage?.output_tokens || 0, provider: 'codex' };
    } finally {
      busy = false;
      if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  function shutdown() { for (const abort of active) abort(); }
  return { generate, checkStatus, shutdown };
}

module.exports = { ...createCodexService(), createCodexService, resolveCommand };
