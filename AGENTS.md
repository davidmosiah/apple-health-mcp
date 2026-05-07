# Agent Development Notes

## Scope

This repo is the local-first, unofficial Apple Health export MCP connector. It parses user-provided Apple Health exports and must never require cloud credentials.

## Commands

- Install: `npm ci`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Fast smoke: `npm run smoke`
- HTTP smoke: `npm run smoke:http`
- Full gate: `npm test`

## Rules

- Never commit Apple Health exports, generated health data, tokens, API keys, or local config.
- Keep the connector explicitly unofficial and not medical advice.
- Preserve agent-ready surfaces: manifest, connection status, privacy audit, CLI UX, and metadata checks.
- Prefer fixture/local data in tests. Do not add network-dependent tests.
