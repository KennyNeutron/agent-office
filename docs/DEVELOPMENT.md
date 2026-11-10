# Development and release workflow

## Requirements

Install Node.js with npm (Node 24 recommended; minimum supported by Vite: Node 20.19+ or 22.12+), a browser supporting WebGL, and at least one coding agent CLI for real tasks (Codex, Claude Code or Antigravity CLI).

### Windows (PowerShell)

For normal use on Windows, Linux or macOS, install the prebuilt CLI from GitHub Releases with `npm install -g https://github.com/Munizada/agent-office/releases/latest/download/agent-office.tgz`. On PowerShell, substitute `npm.cmd` if `.ps1` execution is blocked. Run `agent-office` inside the directory of any project. Re-run the install command to update. The old `START-WINDOWS.cmd` remains as a legacy alternative. GitHub source installs via `npm install -g github:Munizada/agent-office` are not recommended: they attempt to build the UI during installation and can fail if development executables are missing.

For IDE use, install the companion `.vsix` distributed in GitHub Releases (or built using `npm run package:vscode`). In VS Code run **Agent Office: Open 3D Office** from the Command Palette after opening a project folder. The extension launches the CLI with that workspace on a free loopback port and shows the UI in a Simple Browser editor tab. More details: `vscode-extension/README.md`.

```powershell
git clone https://github.com/Munizada/agent-office.git
cd agent-office
npm ci
npm run dev:all
```

Then open http://127.0.0.1:5173/ . Demo mode works without any AI account. For real execution install/login to your CLI, open Settings, set an absolute workspace directory and select Live mode. In the New Task dialog, select an available provider. Restart the server to refresh detection after installing a new CLI.

### Linux and macOS

```bash
git clone https://github.com/Munizada/agent-office.git
cd agent-office
npm ci
npm run dev:all
```

CLI executable discovery uses PATH. On Windows, `.cmd` wrappers are resolved to native or Node executables without invoking a command shell. `CODEX_BIN`, `CLAUDE_BIN` and `AGY_BIN` may override each executable path. On Windows PowerShell, for example:

```powershell
$env:CODEX_BIN = 'C:\tools\codex.exe'
$env:AGENT_OFFICE_WORKSPACE = 'C:\projects\my-app'
$env:PORT = '4300'
npm run dev:all
```

These are optional **process environment variables**, not an automatically loaded .env file. Do not commit a local .env file or credentials. Use the default API port unless you also adjust the Vite proxy and allowed origins in the server.

## Commands

Upgrade the CLI and VS Code companion together for v0.4. The companion now verifies the instance and workspace of its own CLI process. The VSIX packager is pinned to VSCE 4.0.0; downloaded packaging tools remain in npm's cache and are not included in the project runtime.

| Command | Purpose |
| --- | --- |
| `npm run dev:all` | Local API + UI in one terminal |
| `npm start` | Serve the built UI and API together on localhost:4300 after `npm run build` |
| `agent-office` | Launch globally installed office for the current folder |
| `npm run package:vscode` | Create VS Code VSIX in `work/` |
| `npm run dev` | UI only |
| `npm run server` | API only |
| `npm run lint` | Source checks |
| `npm run build` | TypeScript and production build |
| `npm run check:server` | Server syntax check |
| `npm run check:public` | Scan tracked files for secrets and private paths |
| `npm run verify:public` | Pre-push full validation |
| `npm run smoke:floor` | Isolated rendered floor matrix, dynamic size, LOD selection, mobile/desktop; no AI jobs |
| `npm run smoke:avatars` | Isolated seated/walking/coffee captures; no AI jobs |
| `npm run smoke:roster` | Isolated live roster CRUD and expansion browser tests; no AI jobs |
| `npm run smoke:browser` | Browser/WebGL and UI regression tests with API + UI running |
| `npm run smoke:live` | **Executes real Codex tasks and consumes usage** |
| `npm run smoke:live-ui` | **Executes a real Codex task and consumes usage**; verifies Live mode from the browser to the final file |

For browser smoke tests, set `CHROME_BIN` if Chrome is not installed in the default location. The Demo test writes an ignored screenshot into `screenshots/`. The live UI test requires **both services running** and an authenticated Codex CLI; it writes only to a fresh ignored `.local/live-ui-smoke-*` folder and cancels its test task if validation fails. These live tests are opt-in and are never run in CI.

## Regular development and GitHub sync

Enable hooks in each clone with git config core.hooksPath .githooks. The Git pre-push hook runs `npm run verify:public` when `core.hooksPath` is set to `.githooks`. This prevents an ordinary Git push if checks or tracked-secret screening fail. GitHub Actions repeats checks on pushes and pull requests.

For every change: update source and docs, run the checks, inspect `git diff`, and commit a descriptive message. The local post-commit hook pushes `main` automatically through the pre-push validation. Verify the remote commit and GitHub Actions; if the push fails, resolve the cause and run `git push origin main`. When these local Git hooks are enabled, commits to `main` trigger GitHub synchronization. Editing a file without committing does **not** upload anything. Each clone must enable hooks separately; the GitHub CI also checks remote changes.

A failed check must be fixed before pushing. Never use `--no-verify` to bypass secret checks. Avoid `git push --all` and `git push --mirror`: old local branches or refs may contain historical private metadata.

## Troubleshooting

- **Blank 3D scene**: enable WebGL/hardware acceleration, update browser/GPU drivers, test Chrome.
- **API offline**: run `npm run dev:all` and check port 4300 is unused.
- **CLI missing**: install/login to the selected CLI, ensure it is on PATH or set its matching `_BIN` environment variable, and restart the API.
- **Codex Web GPT**: selecting its repository folder creates fresh independent tasks; it does not mirror existing Codex Web GPT conversations. Avoid simultaneous edits through both apps.
- **Task fails to start**: check absolute workspace path, write permissions, CLI configuration and the error shown in Activity.
- **Port occupied**: stop the previous Agent Office API/web instance before starting another.
- **Tasks missing after restart**: development saves to `.local/tasks.json`; the global CLI stores history in a workspace-specific subfolder of the user state directory (`%LOCALAPPDATA%\\AgentOffice` on Windows). Both stay local and private.
- **Change office appearance**: Settings → Office appearance; themes, spacing, departmental colors, walking and ambient interactions save in browser local storage, separate from the server's private agent roster. "Restore office defaults" resets the appearance only.
