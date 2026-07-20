# Upstream PRs

- [#4018](https://github.com/pingdotgg/t3code/pull/4018) — Loads older conversation history on
  demand. This reduces memory use and reconnect payloads for long-running remote threads.
- [#4176](https://github.com/pingdotgg/t3code/pull/4176) — Caps orchestration state. It also cleans
  up browser, preview, VCS, and UI state when threads are deleted.
- [#4187](https://github.com/pingdotgg/t3code/pull/4187) — Reduces idle Git and port-scanning work.
  Relevant user actions and terminal changes still refresh immediately.
