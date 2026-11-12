# Agent Office 🏢

**Open-source 3D mission control for local AI coding agents.** Inspect an animated office, assign Codex CLI, Claude Code or Antigravity CLI tasks, follow execution events, and track task history. Built with React, TypeScript, React Three Fiber, Three.js, and Node/Express.

> **Project status: functional prototype (v0.4).** Agent profiles are configurable visual task slots backed by separate CLI executions. They do not yet share memory, delegate or form a coordinated multi-agent workflow. Idle walks and coffee breaks are ambient visual behavior, not real agent communication or task progress. In Demo mode, all activity is simulated and no code is executed. Codex is the most extensively tested provider; Claude Code support is experimental and Gemini CLI support has not been tested on a machine with Gemini installed.

![Agent Office 3D demo](docs/office-preview.png)

## Try the interactive demo online

**[Open the public browser demo](https://munizada.github.io/agent-office/)** — explore the 3D office, customize rooms, add/edit/delete agent profiles, and simulate tasks in your own browser. **No installation or AI account is needed.** The preview never connects to a local CLI or sends commands to the maintainer's computer. Agent profile and appearance changes stay in each visitor's own browser storage; simulated task activity resets on reload. The GitHub Actions workflow publishes the demo whenever `main` changes.

**Maintainer setup:** GitHub Pages must use **GitHub Actions** as its deployment source under repository **Settings → Pages**. If Pages is not enabled, this one-time setting is required before the first deployment succeeds. The URL above works only after GitHub reports a successful `Public interactive demo` deployment; see the [deployment workflow](.github/workflows/demo-pages.yml).

## Requirements

When upgrading to v0.4, update both the CLI archive and VS Code companion. The companion checks the identity of the CLI instance it starts, so it requires the matching updated CLI.

- Node.js 20.19+ / 22.12+ (tested on Node 24) and npm.
- A browser with WebGL enabled.
- At least one installed and authenticated CLI for real tasks: [Codex CLI](https://github.com/openai/codex), [Claude Code](https://code.claude.com/docs/en/quickstart), or [Antigravity CLI](https://antigravity.google/docs/cli/) (`agy`).

## Quick start

**Install once** (Windows, Linux or macOS):

```bash
npm install -g https://github.com/Munizada/agent-office/releases/latest/download/agent-office.tgz
```

Then, in **any project folder**, run:

```bash
agent-office
```

The office opens at **http://127.0.0.1:4300/** and uses the terminal's current folder as its default workspace. Keep the terminal open while using it (Ctrl+C stops the office). On PowerShell, if `npm` is blocked by script policy, substitute `npm.cmd` in the install command. You need Node.js and npm installed. Re-run the same command to update to the latest prebuilt GitHub release. Installing the release archive avoids requiring TypeScript or other development tools on the user's machine.

Options: `agent-office --no-open` (start without opening your browser), `agent-office --port 4400` (use a different port), or `agent-office --workspace /path/to/project` (select another project directory). For VS Code's integrated terminal, `agent-office` also works directly.

**Inside VS Code:** install the companion extension `.vsix` from [GitHub Releases](https://github.com/Munizada/agent-office/releases), then use **Ctrl+Shift+P → Agent Office: Open 3D Office**. The office appears in a VS Code tab and automatically uses the open project folder. See [VS Code extension guide](vscode-extension/README.md). Other editors can use the browser interface launched from their integrated terminals.

**Linux/macOS or development:** Run from this folder:

```bash
npm ci
npm run dev:all
```

Open **http://127.0.0.1:5173/** for development. For a built production UI use `npm run build` then `npm start` and open **http://127.0.0.1:4300/**. The interface starts in **Demo mode**. To run real tasks: authenticate your CLI, select **Live mode**, create a task, choose the AI provider, assign an avatar and select an absolute project directory. Unavailable providers are disabled.

If you prefer separate terminals, use:

```bash
npm run server
```

And in the second terminal:

```bash
npm run dev
```

When launched via `agent-office`, real tasks default to your terminal's current directory; when started from the source using `npm run dev:all`, they default to this project's root. Change the folder in Settings if needed. Each task starts a new CLI process with its own prompt. Agent profiles represent independent task slots; they do not observe existing external chat sessions or automatically coordinate. Several agents can work at once, even in the same folder; each agent runs one task at a time, and the task log warns when agents share a folder because their edits to the same files may conflict.

### 🏢 Flexible team and expanding office

Open **Agent team → Add agent** to create as many profiles as your setup needs. The original four agents are starting examples, **not a limit**: 0, 1, 10, 20, 50 and larger teams are supported by the roster and office layout. Edit each agent's name, role, mission/specialty, color and department, or remove agents when they are no longer needed. The app suggests a department when your role or mission clearly indicates one; you can override the suggestion. Unrecognized roles use shared workstations rather than being assigned to an unrelated themed area.

The 3D office is a corporate floor with reception (with a live digital desk clock and a wall calendar showing today's date and weekday, both from your computer's clock), a service wing, a TV lounge, coffee counters, a games room (darts, table tennis and chess) along the south edge, a shared circulation spine and open work areas. Small teams stay together; larger teams organize by function across nine department types. Departments expand into connected pods of up to nine desks each. Leadership roles declared in the profile guide seating order and desk accents; they are a visual placement hint, not an implemented chain of command. Furniture and character proportions stay stable as the floor expands. Idle agents pick random activities and spend most of their idle time on recreation: watching TV on the lounge sofa (the TV switches on while someone watches), throwing darts, playing table tennis or chess. Table tennis and chess need two players: the first agent waits at the table (about 30 seconds unless someone is already on the way), other idle agents usually come to join, the game clock only runs while both are there, and both leave when the game ends. Agents also sit at their computer browsing, stretch or check their phone beside the desk, take a coffee break, read the schedule board, or take a nap on the daybed against the games room's back wall: they lie down, close their eyes, Zs drift up and their label reads **Sleeping** (a new task still wakes them and sends them to their desk). The office also has two pets, a dog and a cat, with beds in the games room. They walk the same corridors and aisles as the agents, one at a time, and give way to people. Both visit agents at their desks and wait beside them; an agent standing there turns and pats them. The cat also curls up by the daybed to keep a napping agent company. Each seat or spot holds one agent at a time, and idle agents walk the corridors one at a time so nobody meets head-on. After a task an agent keeps sitting at the computer for a while. A new task always sends the agent straight back to the desk. These are ambient visuals only: they never reflect or change real task progress.

Beside reception stands a **knowledge graph** hologram that represents your [graphify](https://graphify.com) code graph. It drifts slowly in blue while idle. When a running agent queries graphify through MCP, its nodes light up in that agent's colour, spin faster, and the floating *Knowledge* label shows how many agents are reading it (for 45 seconds after each query). It reacts to tool-use events from all three providers (`mcp__graphify__*` in Claude Code, graphify tool names in Antigravity CLI, and Codex `mcp_tool_call` items from the `graphify` server). Agents only use graphify if it is set up as an MCP server in their CLI.

### Team knowledge base

Click the hologram or its *Knowledge* label to open the **knowledge base**: durable notes your team keeps about the current project folder (decisions and their reasons, conventions, gotchas, how things work). Notes are stored locally in `knowledge.json` next to the task history, separately for each project folder.

- **Graph**: a graphify-style map of the notes. Each note links to the tags and files it mentions, so related knowledge clusters together. Drag to pan, scroll to zoom, hover to trace links, click a note to read it, or click a tag or file to highlight everything connected to it. Search lights up matching notes.
- **Notes**: search, read, edit and delete notes, or write one yourself with **New note**.
- **Review**: drafts proposed by agents. **Keep** shares a draft with the team; **Discard** deletes it. Agents never see drafts.
- **Graphify activity**: which agents queried graphify, with which tool and for which task.

How agents use it:

1. **Before a task**, the most relevant kept notes (up to three, matched by keywords in the task) are added to the agent's instructions as background reference. The task feed says which notes were shared.
2. **During a task**, Claude Code and Codex also get an `agent-office` MCP server for that run with `search_knowledge`, `read_note` and `add_note` tools. Nothing needs configuring; your own MCP servers stay as they are. Antigravity CLI only reads MCP servers from its global config, so it relies on step 1 and 3.
3. **After a task**, an agent can end its reply with a `KNOWLEDGE NOTE:` section (title, a few sentences, optional `Tags:` and `Files:` lines). It becomes a draft in **Review**, together with the files the agent edited.

Notes are reference material, not instructions: agents are told they may be out of date and must verify them against the code.

The initial overview frames the team. Select a card or character to inspect it; the camera follows that character during a walk. Use the bottom-right overview button to see the full floor again. For rendering efficiency, **teams over 50 show the 50 nearest detailed avatars/workstations, with simplified characters, furniture and bay decoration for the remainder**. Selecting a distant agent promotes it to detailed display. Simplified distant characters show standing/seated work state without detailed idle routines. A roster of 1000 does not mean the machine can run 1000 CLI jobs; hardware, provider limits and the overlapping-project guard still apply.

**Customize your office in Settings → Office appearance:** choose bright white/daylight, midnight or warm color palettes; compact, balanced or spacious layouts; an office-wide accent color; and individual colors for all nine departments. Pick off, subtle or lively avatar movement. Open team bays and connecting aisles are regenerated from the live roster and department assignments. Appearance preferences persist in the current browser; agent profiles and task history remain in the local API data directory. A working agent returns along clear aisles, approaches the chair, sits facing the monitor and stays seated until the activity ends. When idle, an agent can take a routed coffee break: it walks to the shared kitchenette, lifts a mug for a sip, waits briefly and returns to its post. Movement preferences control this behavior. Coffee breaks are ambient presentation only; task phase/status remains tied to API execution events, and the characters do not claim to be having a real conversation or completing work. See [the audit and verification record](docs/AUDIT-2026-10-13.md) and [the reference decision record](docs/REFERENCE-DECISIONS.md) for ideas reviewed from related open-source projects.

![Automatically expanded office with 20 agents organized by function](docs/office-expanded.png)

Physical layout changes use a short floor transition to rebuild furniture and characters together. Activity snapshots with equivalent geometry preserve positions and gait. Optional avatar motion also honors the system reduced-motion preference. Distant characters consume the same position and seated progress as detailed avatars; ongoing visits finish even when the camera focuses elsewhere.

Profiles are saved locally in `agents.json` next to the private task history, survive restarts, and are scoped to the current Agent Office data directory. You can safely remove the last agent and rebuild your team from zero. Finished task history stays intact when its agent is removed. Demo mode only simulates activity for existing sample agents; it never consumes CLI tokens.

**Codex Web GPT / Codex desktop integration:** If you use [Codex Web GPT](https://github.com/miuuyy/codex-chatgpt-web), choose the same repository folder to launch a fresh independent CLI task there. The Agent Office does not connect to its tunnel, Native2 bridge, chat, or existing Codex processes. Avoid modifying the same files concurrently in the two apps; the folder conflict guard cannot detect external applications. Your Codex Web GPT configuration and authentication are never changed by setup.

### 🗓️ Scheduled tasks

Assign tasks to agents that run automatically: **once** at a set time, **every N minutes/hours/days**, **every day** at a time, or on **selected weekdays**. Open the scheduler from the **schedule board** standing beside reception in the 3D office (click the board or its floating *Schedules* label), from the **Schedules** button next to *New task*, or with **Schedule a task** on the selected agent's card (this pre-filters the list to that agent). Each schedule stores its own prompt, agent, AI provider, permission mode and project directory.

The board's lit rows show the next four upcoming runs in each agent's colour; a green marker means ready, amber means waiting. Agents with active schedules show a calendar icon on their 3D status label. In the list you can pause/resume, **Run now**, edit, delete and jump to the last task a schedule started.

- Schedules run **only while Agent Office is running**. A run missed while it was closed starts once at the next launch; several missed runs collapse into one.
- If the agent is still busy, the schedule **waits** and starts as soon as it can.
- Daily and weekly times use the clock of the computer running Agent Office.
- Live schedules are saved in `schedules.json` next to the task history. Deleting an agent also deletes its schedules. Demo-mode schedules stay in the browser and only simulate runs.
- Scheduled runs are unattended. Prefer **Restricted** permissions; **Full Access** lets every run change files outside the project without anyone watching.

### 🌐 Interface language

The interface is in English. Your own task prompts, CLI output, error messages and file paths are shown exactly as written.

To override CLI discovery or set the initial project directory:

```powershell
$env:CODEX_BIN = 'C:\path\to\codex.exe'
$env:CLAUDE_BIN = 'C:\path\to\claude.exe'
$env:AGY_BIN = 'C:\path\to\agy.exe'
$env:AGENT_OFFICE_WORKSPACE = 'C:\path\to\your-project'
npm run server
```

## What works

- Rotate and zoom the 3D office; click an avatar to inspect their task. The characters react visually to their reported phases: thinking, coding, researching, finishing, or idle. A completed task triggers a brief celebration; a failed/interrupted task triggers an error reaction.
- Customize themes, seating density, department colors, office accent and avatar movement. Idle avatars can walk along clear aisles between their workstation and their team's shared area. Appearance settings stay on this browser and can be reset at any time.
- Launch an independent CLI task per avatar, choosing Codex, Claude Code or Antigravity per task and targeting an absolute local project directory. Provider detection is performed at API startup; restart after installation.
- Stream command, file-change, research and progress events to the office through Server-Sent Events (SSE).
- Inspect a selected agent's execution phase, live elapsed time, latest update, chronological event details, errors and token usage (when reported by Codex). Select a task from the feed or history to inspect that exact run.
- Track finished jobs, latest status and task history; request cancellation.
- Schedule tasks for any agent (once, interval, daily or weekly) from the 3D schedule board, and pause, edit or run them on demand.
- Explore the whole interface in Demo mode without spending API tokens or executing commands.
- Create, edit and delete agent profiles; assign meaningful departments and expand the 3D office with no fixed number of slots.

## Scripts

| Command | Action |
| --- | --- |
| `npm run dev` | Local front end at 127.0.0.1:5173 |
| `agent-office` | Run the globally installed office for the current project |
| `agent-office --no-open --port 4400` | Run headlessly on a different local port |
| `npm run package:vscode` | Build VS Code VSIX installer in `work/` |
| `npm run dev:all` | Start both front end and local API in one terminal |
| `npm start` | Serve built UI and local API at 127.0.0.1:4300 (run `npm run build` first) |
| `START-WINDOWS.cmd` | Older Windows starter, retained for compatibility |
| `npm run server` | Local AI CLI bridge at 127.0.0.1:4300 |
| `npm run build` | Type-check and production build |
| `npm run lint` | Static code checks |
| `npm run test:behavior` | Test agent behavior and CLI adapter / folder-safety rules without real AI jobs |
| `npm run check:server` | Validate server syntax |
| `npm run smoke:browser` | Smoke-test UI, visual 3D rendering and WebGL (both services running, Chrome needed) |
| `npm run smoke:roster` | Start an isolated local office, test real agent-management UI, and check 0, 1, 20, 50 workstations without launching AI jobs (Chrome needed) |
| `npm run smoke:floor` | Render 0, 1, 4, 20, 100 and 1000 agents, inspect distant-agent focus, and capture desktop/mobile views without AI jobs |
| `npm run smoke:avatars` | Capture isolated 3D character poses while working, thinking, sitting, and walking; check WebGL and browser errors (Chrome needed, images saved locally in ignored `work/`) |
| `npm run smoke:live` | **Runs real Codex jobs and consumes tokens**; tests parallel isolated file writes and API protections |
| `npm run smoke:live-ui` | **Runs a real Codex job and consumes tokens**; verifies launch, live 3D reactions, timeline and result through Chrome |

## Safety and privacy

The API listens only on `127.0.0.1:4300` and restricts browser origins. Each Codex job requests a `workspace-write` sandbox; Claude Code uses `acceptEdits` with noninteractive prompts denied; Antigravity CLI uses `--mode accept-edits` (file edits only; commands and other actions needing approval are skipped and reported in the task log as errors), and **Full Access** passes `--dangerously-skip-permissions`. Antigravity does not offer *Approve for me*. Antigravity replaced Gemini CLI: older Gemini tasks stay in history, and saved Gemini schedules now run with Antigravity. These settings remain subject to your installed CLI and operating system permissions. Assign jobs only inside trusted project folders. Different agents may work in the same folder at once; the task log warns when they do, but nothing prevents conflicting edits, including from jobs launched by Codex Web GPT, your editor or a second Agent Office instance.

CLI detection checks whether a command is installed, **not whether you are signed in**. A missing or expired login is reported by the CLI when a real task starts. For Claude Code, reauthenticate using its normal login flow in the Claude Code app/terminal before retrying the office.

`smoke:live` creates disposable test directories inside `.local/`; it runs two real Codex sessions, so it requires an authenticated CLI and can incur usage costs. Do not run it as part of an untrusted CI workflow.

Task prompts, statuses, phase updates, recent events (up to 35 per task) and short output excerpts are saved locally in `.local/tasks.json`, and editable agent profiles in `.local/agents.json`, during source development. Globally installed CLI data lives in a folder specific to each workspace under your user state directory (`%LOCALAPPDATA%\\AgentOffice` on Windows, `~/.local/state/agent-office` on Linux, etc.). This prevents separate project windows from overwriting each other's history and roster. These files are not committed. Avoid putting credentials in task instructions. The API has no user authentication and must **never** be exposed publicly on a network.

## Roadmap

- True multi-agent planning, handoffs, coordination, shared context, and delegation.
- More provider integrations and full real-world cross-platform testing for Antigravity CLI and Claude Code.
- Drag-and-drop room layout editing, custom furniture, shared lounge areas, and richer agent appearance customization.
- Marketplace publication for the VS Code extension and standalone desktop packages. A manually installable VSIX is available through GitHub Releases.

## Contributing

Contributions and issue reports are welcome. Clearly distinguish simulated actions from real tool executions. License: MIT (see [LICENSE](LICENSE)).

## Documentation

- [Architecture and directory structure](docs/ARCHITECTURE.md)
- [Installation, development and GitHub synchronization](docs/DEVELOPMENT.md)
- [Contributing](CONTRIBUTING.md)
- [Security and privacy](SECURITY.md)

Before publishing a public update, run `npm run verify:public`. This checks tracked files for common secrets and personal paths, validates the code, and builds the application. The configured Git pre-push hook runs the same checks automatically. On the configured main branch, each commit is pushed automatically after pre-push verification when local hooks are enabled (`git config core.hooksPath .githooks`). Uncommitted edits never upload themselves.
