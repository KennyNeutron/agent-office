# Architecture

Agent Office is a local web interface for starting and observing local coding-agent CLI tasks.

```text
Browser / VS Code Simple Browser (local port)
  React + TypeScript + Vite
   ├─ src/views/          Studio, task history, team, settings
   ├─ src/components/     Sidebar, avatars, task cards, task dialog
   ├─ src/scene/          Three.js office / React Three Fiber
   └─ src/locales/        English text helpers and date formatting
            │ REST / Server-Sent Events
            ▼
Local Express API (127.0.0.1:4300, or a CLI-selected port)
   ├─ discovers Codex CLI, Claude Code and Gemini CLI at startup
   ├─ starts/cancels local CLI subprocesses
   ├─ streams task status and progress events
   └─ writes private task history (source .local/ or user state directory)
            │
            ▼
Selected CLI → filesystem inside the selected project directory
```

## Modes and data

Demo mode creates simulated tasks in browser memory. Live mode asks the local API to launch independently managed CLI jobs. Each real run includes the selected agent's configured name, role, specialty and department in the CLI request, while the original human task is preserved in history. Agent profiles are user-editable task slots, not a coordinated agent swarm. No agent-to-agent communication or shared memory is currently implemented.

`server/agents.mjs` validates and persists each local roster atomically to `agents.json`, separate from task history. The REST API exposes `GET /api/state`, `POST /api/agents`, `PUT /api/agents/:id`, and `DELETE /api/agents/:id`. Updates stream over the existing SSE channel; concurrent edits are serialized before acknowledgement. Profiles start with four examples on first use but can be reduced to zero or expanded as needed. Agents cannot be deleted while they have a running task; deleted agents retain their completed history.

`src/scene/officeLayout.ts` creates a corporate floor with a reception/service wing, a longitudinal circulation spine, open team pods, meeting furniture and a kitchenette per floor wing. Small teams sit together; larger departments split into pods of at most nine desks and expand in a grid rather than one endless room. Sector keys remain unique even when several pods share a department. Declared leadership roles guide seating order and desk accents only; they do not grant runtime authority or implement agent delegation. Workstations and characters keep their own dimensions while spacing preferences adjust circulation and pod placement.

`OfficeCampus.tsx` renders grounded furniture and contextual props, glazed perimeter architecture and physically mounted lighting. A meeting area appears with three agents; larger floors gain focus spaces and additional coffee points. Teams over 50 keep the 50 nearest detailed avatars/workstations and simplify distant furniture, characters and bay furnishings. `OfficeCrowdLOD.tsx` derives its seated/standing limbs from the same rig coordinates as detailed avatars. Simplified distant characters do not run detailed ambient animations. Selecting their card or mesh loads their detailed station. The overview frames the full floor; individual inspection follows the selected character when it leaves the desk.

`officeSimulation.ts` owns movement for the scene, preserves state across equivalent SSE snapshots, reserves one complete coffee visit per shared wing and yields before character contact. Waiting agents remain at their own workstations. In-flight visits still finish when their avatars become distant, releasing reservations. `officeMotion.ts` provides clear-aisle routes, separate outward/return paths and explicit standing, walking, coffee, returning, approaching, sitting, working, rising and leaving states. Real running tasks outrank ambient routines and request a safe return to the chair. Negative frame priorities apply movement, world transforms and camera tracking before pose/badge rendering.

The appearance context persists theme, spacing, accent, departmental colors and avatar movement preferences under `agent-office-appearance-v1`; persisted values are validated. `avatarRig.ts` uses distance-driven gait, fixed thigh/shin lengths, planted shoes and shared sitting transitions. Breathing moves the upper body without lifting planted shoes; coffee sip timing starts on arrival rather than using global scene time. HTML labels project actual character world positions. Ambient routines never change backend task status. **There is no agent-to-agent messaging, shared memory or multi-agent orchestration.**

See [Technical reference projects](REFERENCE-DECISIONS.md) for the reviewed upstream ideas, fit, license notes and decisions. The reference list is guidance for future work; it does not imply copied code or a complete upstream security audit.

Physical revisions use a short fade and replace furniture and actors atomically. Rapid edits supersede older pending revisions; running tasks initialize seated in the rebuilt floor. This prevents relocated furniture from appearing on preserved bodies. Metadata-only updates retain the scene and movement state. Distant avatars use the same world positions, facing, seated progress and gait, and finish in-flight visits even after focus changes. They start new idle visits only while detailed. System reduced motion suppresses optional avatar animation and shortens floor transitions. `officeDecor.ts` supplies shared decoration geometry so tests can check boards, storage and plants against one another and workstation tabletops.

The API is local-only, unauthenticated, and restricted to loopback host/origins. It **must not be published or proxied to the internet or a LAN**. Real CLI jobs can change files in the selected workspace. The API rejects concurrent office tasks targeting the same or nested workspace; it cannot detect writes by other apps or instances.

The Studio execution inspector reuses task data from the same SSE snapshots. Its timeline shows the last 35 server-recorded events per task in newest-first order; phase, elapsed time, error details and token usage are derived from those snapshots. The elapsed clock runs in the browser while a task is active, and stops after the task finishes. Selecting an avatar shows its running task or most recent task; selecting a task tile/history entry inspects that specific execution. Demo events are simulated.

The 3D workstations also use those task snapshots. `src/scene/agentBehavior.ts` maps a running task phase to a character pose, or displays a celebration/error reaction for eight seconds after a completed/failed task. A current running task takes priority over terminal reactions from earlier tasks, so the displayed phase always reflects current work. Status labels are shown in English; demo mode drives the same animation system from simulated events. These gestures represent **reported task states**, not continuous observation of the agent's keyboard, reasoning or filesystem activity.

The browser uses the EventSource API to receive snapshots. The server stores bounded task history in `.local/tasks.json`, which can include the prompts, workspace paths, and short command output excerpts. It is intentionally private and excluded from version control. The browser smoke tests wait for the rendered UI rather than for a fully idle network, since the event stream is designed to stay connected.

The studio loads the 3D renderer on demand. Production builds split the Three.js engine into separately cached JavaScript chunks, reducing the size of the scene's own chunk and avoiding a full re-download of the engine after ordinary interface changes. This does not eliminate the cost of loading Three.js on the first visit.

## Scheduled tasks

`server/schedules.mjs` holds the pure schedule logic (validation, next-run calculation, run recording). The API persists schedules atomically to `schedules.json` beside `agents.json` and exposes `POST /api/schedules`, `PUT /api/schedules/:id`, `DELETE /api/schedules/:id` and `POST /api/schedules/:id/run`; changes stream through the existing SSE snapshot. A timer (every 10 s, `AGENT_OFFICE_SCHEDULER_MS` in tests) launches due schedules through the same `launchTask` function as `POST /api/tasks`, so every provider, workspace, overlap and storage check applies. A `409` (busy agent or overlapping folder) leaves the schedule *waiting* in its current slot; other errors record a failed run and advance it. Missed runs collapse into one. Tasks started by a schedule carry `scheduleId`. Corrupt `schedules.json` is preserved and blocks schedule writes, like the other stores. Deleting an agent removes its schedules.

In Demo mode the same module drives an in-browser scheduler that stores schedules in local storage and simulates runs. In the office, `src/scene/ScheduleBoard.tsx` renders a free-standing board beside reception (`scheduleBoardLayout.ts` places it clear of every walking route, which `test-office-layout.mjs` verifies). Clicking the board or its projected label opens `ScheduleManager`.

## Directories

| Path | Purpose |
| --- | --- |
| `src/App.tsx` | Application state, API connection and task lifecycle |
| `src/components/` | Shared UI controls, task cards, avatars, execution inspector and display functions |
| `src/views/` | Studio, Tasks, Team, Settings screens |
| `src/scene/` | Lazily loaded interactive 3D office |
| `src/locales/` | English text pass-through and date/time formatting provider |
| `src/types.ts` | Agent and task data models |
| `src/index.css` | Styling and responsive layout |
| `server/index.mjs` | Local Express API, durable history, SSE and CLI lifecycle |
| `server/task-output.mjs` | Provider event parsing and bounded output framing |
| `server/processes.mjs` | Provider descendant process termination |
| `server/providers.mjs` | CLI adapters, binary discovery and folder overlap checking |
| `server/schedules.mjs` | Schedule validation and next-run calculation, shared by the API and the browser demo |
| `bin/agent-office.mjs` | Globally installed terminal launcher with workspace selection |
| `vscode-extension/` | VS Code companion that launches CLI and opens a Simple Browser tab |
| `START-WINDOWS.cmd` | One-click Windows startup and first-run dependency installation |
| `scripts/` | Dev launcher, validation and smoke tests |
| `public/` | Static assets |
| `docs/` | Documentation and reference screenshot |
| `.github/workflows/` | GitHub Actions checks |

## Security boundaries

The API accepts a local workspace path and starts a tool with code-execution capabilities. Only use it on a trusted machine. Confirm the selected project directory before running Live tasks. The task data file is not encrypted, so avoid inserting secrets in prompts or outputs. See [Security](../SECURITY.md).

## Known limitations

3D rendering depends on WebGL/GPU/browser drivers, and the first visit still downloads the 3D engine. Real execution requires CLI authentication and follows its separate usage/approval policies. The integration launches fresh CLI processes; existing chats in Codex, Claude, Gemini or Codex Web GPT are not tracked. Gemini and Claude compatibility can vary with CLI updates.
