# Codex integration validation

Checked on 26 October 2026 against the repository based on commit `61ccf68`.

- **23 automated tests passed** using Node.js 22. These exercise actual child
  processes with a deterministic fake Codex CLI, an isolated SQLite database,
  Express endpoints, and the frontend provider/queue logic.
- **Live Codex CLI 0.164.0 smoke test passed:** ChatGPT authentication was detected
  and a short original mystery sentence was returned through `codexService`.
  This verified a real completed inference request without an API key.
- **Browser settings check passed:** project navigation, selecting Codex, hidden
  API-key input, checking ChatGPT sign-in, and saving the provider. No page errors.
- **Browser pipeline check passed with simulated model responses:** one book,
  two chapters, continuity extraction, front matter, and completed status. This
  validates wiring, not the quality or reliability of a full-length generated book.
- **Focused lint and whitespace checks passed** for the new adapter, configuration
  service, route module, and tests. The full repository lint still reports 577
  existing-style/global-reference errors (the base revision reported 710).
  No claim is made that the repository-wide CI is clean.

Packaged Windows/macOS installers and a full-length live book have not been tested.
Codex CLI must be installed and signed in on the computer running DeepBook.
See the README for setup and recovery steps.

Related compatibility fixes: the frontend uses same-origin API URLs, settings
save the provider/model actually used by generation, the backend loads the root
`.env`, development starts one backend, and SQLite is installed for the external
Node runtime. The current UI uses inline event attributes; its CSP now explicitly
allows those attributes while keeping script elements restricted to local files.
Replacing legacy inline handlers with event listeners remains separate work.

## DMG build preparation — 27 October 2026

The packaged launcher now uses Electron's bundled Node runtime with a separate
loopback port allocated by the OS. A build hook rebuilds the backend's SQLite
module for Electron and the target architecture. The dependency lockfile was
repaired so clean CI installs include the native rebuild tools. Source tests
still pass (23 tests).

A Linux directory build passed the packaged-runtime smoke test: Electron's
bundled Node loaded the rebuilt SQLite module, started the backend on an allocated
port, served the frontend, and read the database. This does not replace the macOS
runner checks or a manual DMG installation test.

The `Build Codex macOS DMGs` Actions workflow builds Intel and Apple Silicon DMGs
on matching macOS runners. It checks the packaged backend, SQLite and frontend
before uploading artifacts. Running this workflow requires access to the target
GitHub repository. Builds are unsigned and unnotarized.
