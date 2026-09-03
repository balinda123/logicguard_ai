---
name: document-complex-code
description: Add concise, high-value Chinese code comments when changing LogicGuard AI state machines, execution protocols, database migrations, security boundaries, concurrency controls, compatibility layers, or other non-obvious business logic. Use for implementation and review work where the reason, invariant, fallback, or failure behavior cannot be understood safely from code alone.
---

# Document Complex Code

Write comments that preserve decisions and invariants, not comments that translate syntax.

## Comment Required Logic

Add a short Chinese comment before code that implements any of these:

- State transitions, checkpoints, retries, cancellation, handoff, or recovery.
- Cross-process or frontend/Rust/Sidecar protocol contracts.
- Database migrations, legacy compatibility, or intentionally duplicated fields.
- Credential, origin, redaction, authorization, or other security boundaries.
- Deduplication, merging, ordering, identity selection, or fallback rules that affect test meaning.
- Workarounds for framework, browser, operating-system, or upstream API behavior.

State why the rule exists and what must remain true. Mention the failure behavior when it is not obvious.

## Keep Code Quiet

Do not comment imports, assignments, straightforward validation, obvious UI markup, or code already made clear by names and types. Do not add section banners or narrate every branch.

Prefer one comment for a coherent block. Keep it within three lines unless a public protocol or migration genuinely needs more context.

## Preserve Accuracy

Update or remove a nearby comment whenever behavior changes. Treat a stale comment as a defect. Verify comments against tests and current runtime behavior before completion.

Example:

```ts
// 只合并同一执行账号下完全相同的动作和断言；不同测试数据必须保留，
// 否则边界值用例会在“去重”时丢失覆盖范围。
const compiledSteps = compileSuiteSteps(cases)
```