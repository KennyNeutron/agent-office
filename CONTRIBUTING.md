# Contributing

Contributions and issue reports are welcome.

1. Open an issue for a significant feature or behavior change.
2. Create a feature branch from `main`.
3. Keep edits small, update the corresponding documentation, and include a clear commit message.
4. Run `npm ci`, `npm run lint`, `npm run build`, `npm run check:server`, and `npm run check:public`.
5. Submit a pull request with the motivation, changed behavior, validation and known limitations.

Please do not commit API credentials, private prompts, `.local/`, `.env`, machine-specific settings, screenshots with personal content, or workspace paths. Report security concerns privately as described in [SECURITY.md](SECURITY.md). Do not submit real Codex command logs containing personal data.

The interface is English-only. Keep interface labels consistent and in English, and leave user prompts and machine paths unchanged.

Real-task smoke tests run Codex CLI and may consume tokens and modify test workspace files; do not run them automatically in pull requests.
