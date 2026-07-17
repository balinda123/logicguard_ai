---
name: maintain-project-docs
description: Keep LogicGuard AI documentation synchronized with implemented code whenever features, UI behavior, configuration, Tauri commands, data formats, authentication, dependencies, build scripts, packaging, supported platforms, installation steps, or runtime requirements change, and whenever preparing a release.
---

# Maintain Project Docs

Treat documentation as part of the implementation.

## Workflow

1. Inspect the relevant code, configuration, existing documentation, and uncommitted document changes before editing.
2. Identify affected public behavior: setup, UI, commands, data, security, dependencies, packaging, troubleshooting, or platform support.
3. Update the applicable files in the same task:
   - `README.md`: product status, prerequisites, quick start, supported platforms, documentation links.
   - `开发文档.md`: as-built architecture, interfaces, storage, security, limitations, verification.
   - `零成本部署附录.md`: installation, local data, upgrades, and platform deployment.
   - `BUILDING.md`: toolchain, build commands, artifacts, signing, release checks.
   - `sidecar/README.md`: commands, environment variables, protocol, runtime assumptions.
4. Describe implemented behavior as current. Label unfinished work as a limitation or future item.
5. Link to one authoritative section instead of duplicating long instructions.
6. Search every Markdown file for removed names, old versions, obsolete commands, storage claims, providers, ports, and platform assumptions.
7. Run applicable checks and claim verification only when it actually passed.
8. In the final handoff, list documentation files changed. If none changed, explain why the change had no user-, operator-, or developer-visible impact.

## Consistency Rules

- Code and checked-in configuration outrank old prose.
- Keep README concise; move implementation detail to `开发文档.md`.
- Never claim API keys are safe without naming their real storage mechanism.
- Never claim a platform installer was verified unless it was built or tested on that platform.
- Update version requirements and lockfile instructions together.
- Update command tables when Tauri or sidecar commands change.
- Preserve unrelated user-authored documentation changes.
- Update known limitations when partial work changes a security or reliability boundary.
