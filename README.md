# DeepBook Studio

AI-powered book writing and generation desktop app — built with HTML/CSS/JS, Node.js, and Electron.

Runs on **macOS** and **Windows**. Supports **Codex with ChatGPT sign-in** (no API key), optional API providers, and local **Ollama**.

---

## Quick Start

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 22 LTS recommended (tested); 20+ required |
| npm | 10+ (comes with Node) |
| Git | Any recent version |
| Ollama | Optional — for offline AI |

### Install & Run

```bash
# 1. Clone the repo
git clone https://github.com/olonkpo/deepbook-studio.git
cd deepbook-studio

# 2. Install all dependencies (root + backend)
npm install

# 3. Set up your environment
cp .env.example .env
# The example selects Codex. No API key is required for this mode.

# 4. Install Codex and sign in with your ChatGPT account (once per computer)
npm install -g @openai/codex@latest
codex login

# 5. Start in development mode (hot-reload)
npm run dev
```

The app opens as a native window. The backend API runs on `localhost:3001`.

In **Settings → AI Provider**, choose **Codex · ChatGPT**, click **Check connection**,
then **Save**. Leave Model blank for the Codex default, or enter an exact model name
available to your Codex account. An Astra selection in a ChatGPT conversation does
not automatically select Astra inside DeepBook.

Add your story DNA, choose the number of books, chapters, and target word count,
then click **Generate Everything**. Keep DeepBook and your computer running during
generation. Completed chapters are saved as the queue advances. On a generation
failure or usage limit, the queue stops; run it again after resolving the issue to
skip saved chapters and continue. This is a resumable foreground workflow, not an
always-on background service. Review the manuscript before publication.

### How the Codex connection works

DeepBook runs the installed `codex exec` command and reuses its saved **ChatGPT**
authentication. It does not read Codex credential files or send requests directly
to an inference API. It refuses API-key authentication for this provider and never
falls back to a paid API provider if Codex fails. ChatGPT/Codex usage limits, plan
eligibility, and model availability still apply; internet access is required.

Prompts go through stdin, not shell commands or command-line arguments. Each
request uses a temporary directory, read-only sandbox, disabled shell/web tools,
and an ephemeral session. User Codex configuration is skipped for predictable
writing behavior, while Codex still manages its own sign-in. Only a successful
completed turn's final response is accepted; progress messages and partial drafts
are excluded. Temporary output is removed after each request.

The existing `maxTokens` setting is not a hard Codex output limit. Chapter length
is requested in the writing prompt and checked by DeepBook. The Codex stream
endpoint returns the completed manuscript in one chunk rather than CLI progress.

### Codex troubleshooting

- **Not installed:** install/update with `npm install -g @openai/codex@latest`.
  The integration was checked with Codex CLI **0.164.0**. Older versions may lack
  required flags; upgrade rather than removing the isolation options.
- **Sign-in needed:** run `codex login` and complete ChatGPT sign-in. An API-key
  login is deliberately not accepted for this provider.
- **Works in Terminal but not DeepBook:** set `CODEX_CLI_PATH` in `.env` to the
  absolute executable path (`command -v codex` on macOS/Linux). For Windows npm
  installs, use the absolute path to `node_modules/@openai/codex/bin/codex.js`
  under your global npm directory. Restart DeepBook after changing `.env`.
- **Model unavailable:** clear Model to use the Codex default. The connection
  check verifies local sign-in, not entitlement to a particular model.
- **Usage limit:** wait for your Codex allowance to reset, then resume. DeepBook
  will not switch billing methods or repeatedly retry the remaining chapters.
- **Slow response:** `CODEX_TIMEOUT_MS` defaults to 20 minutes per request and
  can be increased up to one hour. A timeout discards the incomplete response.

Official documentation: [Codex authentication](https://learn.chatgpt.com/docs/auth),
[non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), and
[CLI commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli).

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend + Electron with hot-reload |
| `npm run dev:backend` | Start only the Express server |
| `npm run dev:electron` | Start only the Electron window |
| `npm run build` | Build installer for current OS |
| `npm run build:mac` | Build macOS `.dmg` |
| `npm run build:win` | Build Windows `.exe` |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Format all files with Prettier |
| `npm test` | Run tests |

---

## Project Structure

```
deepbook-studio/
├── frontend/          # HTML/CSS/JS UI
├── backend/           # Node.js + Express API (port 3001)
├── electron/          # Desktop shell (main process)
├── .github/workflows/ # CI/CD pipelines
├── build/             # App icons for installers
└── electron-builder.yml
```

See the [planning document](./DeepBook_Studio_Fullstack_Plan_v1.1_FINAL.docx) for full architecture details.

---

## Building Installers

### Local build (current OS only)
```bash
npm run build
# Output → dist/
```

### Cross-platform (via GitHub Actions)
Push a version tag — GitHub builds both installers automatically:
```bash
git tag v1.0.0
git push origin v1.0.0
```
Both `.dmg` and `.exe` appear in the GitHub Release within ~10 minutes.

---

## AI Providers

| Provider | Type | Setup |
|----------|------|-------|
| Codex · ChatGPT | Online, ChatGPT sign-in | Install Codex CLI and run `codex login` |
| DeepSeek / OpenAI / OpenRouter / Claude / Gemini | Online, API billing | Add the provider key in Settings or `.env` |
| Ollama | Offline/Local | Install from [ollama.com](https://ollama.com) |

Choose providers in **Settings → AI Provider**.

Provider/model selections are saved for the open project and become the default
for projects that inherit settings. Changing providers is blocked while generation
is running. `Auto (API / local)` retains the existing API-key/Ollama selection
behavior; choose **Codex · ChatGPT** explicitly for subscription-based generation.

### Validation

Run `npm test` after installing dependencies. Tests cover CLI authentication,
safe prompt transport, final-response validation, timeout/cancellation, usage-limit
handling, provider/model persistence, API routes, provider badges, and resuming the
chapter queue. They use a fake CLI and make no billable model requests.

Development uses a separate Node.js server. Packaged desktop apps use Electron's
bundled Node runtime, and the build hook rebuilds SQLite for that runtime and the
target architecture. You still need to install Codex and sign in with ChatGPT on
your computer. After building locally, run `npm --prefix backend rebuild
better-sqlite3` to restore the development Node binary before running tests/dev.

### Build the Codex DMGs on GitHub

The **Build Codex macOS DMGs** workflow can be run from the repository's Actions
tab. It also runs when the `codex-desktop` branch is pushed. Forks may require
enabling Actions first.

The workflow tests the source, builds separate Intel (`x64`) and Apple Silicon
(`arm64`) DMGs, and checks the packaged Electron runtime, SQLite database, HTTP
API, and frontend before uploading the installers as Actions artifacts. Downloads
are retained for 14 days. No API keys, ChatGPT credentials, or Apple developer
credentials are required for this build.

These are unsigned, unnotarized test builds. They do not have Apple's trusted
distribution signature. Signing/notarization can be configured separately when
an Apple Developer identity is available. The build currently uses Electron's
default icon because the repository does not contain the configured custom icons.

---

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Production — protected, triggers installer build |
| `develop` | Integration — all features merge here first |
| `feature/*` | One branch per feature |
| `hotfix/*` | Emergency fixes |
| `release/v*` | Release preparation |

---

## License

MIT
