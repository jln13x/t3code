# Upstream PRs

- [#4018](https://github.com/pingdotgg/t3code/pull/4018) — Loads older conversation history on
  demand. This reduces memory use and reconnect payloads for long-running remote threads.
- [#4176](https://github.com/pingdotgg/t3code/pull/4176) — Caps orchestration state. It also cleans
  up browser, preview, VCS, and UI state when threads are deleted.
- [#4187](https://github.com/pingdotgg/t3code/pull/4187) — Reduces idle Git and port-scanning work.
  Relevant user actions and terminal changes still refresh immediately.
- [#4199](https://github.com/pingdotgg/t3code/pull/4199) — Keeps Codex sessions alive while
  background agents are still producing events. This prevents active remote work from being reaped.
- [#4009](https://github.com/pingdotgg/t3code/pull/4009) — Avoids rebuilding thread summaries for
  every streaming delta. This reduces server work during long Codex responses.
- [#3166](https://github.com/pingdotgg/t3code/pull/3166) — Caches successful Git top-level lookups.
  Reconnect event replay no longer spawns the same Git process for every event.
