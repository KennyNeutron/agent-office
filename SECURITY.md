# Security and privacy

Agent Office runs locally and can execute Codex CLI jobs with access to project files. **Never expose its Express API to the public internet or a local network.** It binds to 127.0.0.1 and uses host/origin checks; there is no account login or production-grade authentication.

## Private information

Live task prompts, workspace directories, generated events and short output excerpts are stored in `.local/tasks.json`. This folder, `.env*`, credentials and keys are excluded from Git. GitHub repositories should contain only source code, public assets and example documentation. Scheduled tasks (prompt, agent, provider, permission mode and project directory) are stored in `.local/schedules.json`. Scheduled runs are unattended and start while the office is running, so prefer the Restricted permission mode for them.

Do not enter passwords, API keys, private documents or personal information into task descriptions. Do not attach sensitive information to public issues or pull requests. Use trusted workspaces and understand the Codex CLI's filesystem/sandbox permissions.

## Reporting a vulnerability

Please do not disclose exploitable issues or secrets in public issues. Contact the repository maintainer privately using GitHub's **Report a vulnerability** / private security advisory feature when available. Include reproduction steps, impact and affected versions; do not include real private credentials. Maintainers should rotate exposed credentials immediately and remove them from all reachable Git history before publication.

## Maintainer release checklist

Before every public push, verify tracked paths and contents with `npm run check:public`, run `npm run verify:public`, review `git diff --cached` and audit new assets. Confirm a clean public history and that `.local/` and `.env` are absent. The repository's CI provides additional checks, but cannot guarantee detection of every possible secret.
