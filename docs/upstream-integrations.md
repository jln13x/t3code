# Upstream PR Integrations

This file tracks upstream pull requests selectively integrated into the personal fork. Routine
`upstream/main` merges are not listed.

- **2026-07-20 — [#4018: Paginate large thread history for remote
  clients](https://github.com/pingdotgg/t3code/pull/4018):** Bounds initial activity reads and loads
  older conversation history on demand, reducing memory use and reconnect payloads for long-running
  remote threads.
- **2026-07-20 — [#4176: Bound in-memory read model and client per-thread
  state](https://github.com/pingdotgg/t3code/pull/4176):** Caps orchestration state and cleans up
  browser, preview, VCS, and UI state when threads are deleted.
- **2026-07-20 — [#4187: Reduce background Git ref and port
  polling](https://github.com/pingdotgg/t3code/pull/4187):** Reduces idle Git and port-scanning work
  while retaining immediate refreshes after relevant user actions and terminal changes.
