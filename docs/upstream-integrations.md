# Upstream PR Integrations

This inventory tracks open-upstream changes carried by the personal fork ahead of
`upstream/main`. Correctness fixes, performance work, recovery behavior, security hardening, and
narrow quality-of-life improvements are intentionally not feature-flagged. When an upstream PR
merges, compare its final implementation during the next sync and remove the entry once no
fork-only delta remains.

## Reliability and quality batch

| Upstream PR                                            | Area                          | Behavior carried by the fork                                                                                                                                                                                                                      | Integration notes                                                                                                                                                |
| ------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#4136](https://github.com/pingdotgg/t3code/pull/4136) | Shared settings correctness   | `deepMerge` recurses only through plain objects, preserving `Date`, `Map`, arrays, functions, and class instances as whole values. Invalid primitive top-level patches fail explicitly.                                                           | Includes upstream normal and edge-case regression suites.                                                                                                        |
| [#4009](https://github.com/pingdotgg/t3code/pull/4009) | Streaming performance         | Streaming assistant deltas update messages and thread timestamps without rescanning full thread activity to rebuild shell summaries on every token batch.                                                                                         | Already landed through fork PR #15. Final non-streaming events retain the normal shell-summary refresh path.                                                     |
| [#3903](https://github.com/pingdotgg/t3code/pull/3903) | Codex steering and stop       | Consecutive in-turn steering is acknowledged by the exact projected user-message ID. Root Stop resolves the live Codex turn with a bounded `thread/read` before falling back to projected state.                                                  | Selective code/test backport. `BRANCH_DETAILS.md`, workspace configuration, and lockfile changes were excluded. Explicit child-turn interruption remains direct. |
| [#4187](https://github.com/pingdotgg/t3code/pull/4187) | Idle Git/preview performance  | Git ref polling revalidates the first page less frequently, cursor pages are generation-scoped, inactive atoms expire sooner, ref menus refresh on interaction, and preview port discovery uses serialized snapshot replay with adaptive polling. | Already landed through fork PR #15; this batch adds explicit cursor-page regression coverage. `BRANCH_DETAILS.md` was excluded.                                  |
| [#3830](https://github.com/pingdotgg/t3code/pull/3830) | Codex error quality           | JSON and double-encoded provider error bodies are reduced to their readable message for runtime and session display while raw payload detail remains available for diagnostics.                                                                   | The web banner also normalizes previously persisted errors and wraps long tokens.                                                                                |
| [#2338](https://github.com/pingdotgg/t3code/pull/2338) | Diff renderer safety          | Files containing a diff line over 500,000 characters are sorted after renderable files and forced closed so pathological generated or minified content cannot lock the UI.                                                                        | Adapted to the current `AnnotatableCodeView`: the collapse control is disabled with an explanation, while the file header can still open the file in the editor. |
| [#3885](https://github.com/pingdotgg/t3code/pull/3885) | Diff highlighting performance | Web and desktop diff workers use Shiki's Oniguruma WASM engine instead of the JavaScript-regex engine, avoiding pathological backtracking.                                                                                                        | Electron's renderer CSP allows only the narrow `wasm-unsafe-eval` capability required for WebAssembly compilation.                                               |
| [#4213](https://github.com/pingdotgg/t3code/pull/4213) | Desktop reliability           | Closed stdout or stderr pipes no longer trigger Electron crash dialogs.                                                                                                                                                                           | Only `EPIPE` is swallowed; all other stream errors continue to surface.                                                                                          |
| [#4205](https://github.com/pingdotgg/t3code/pull/4205) | Repository cloning            | Automatic Create & Clone flows prefer HTTPS, allowing GitHub CLI credential-helper authentication without requiring an SSH key.                                                                                                                   | Explicitly requested SSH clones remain unchanged.                                                                                                                |
| [#3520](https://github.com/pingdotgg/t3code/pull/3520) | Startup recovery              | A root startup error automatically retries when the app becomes visible, focused, or online, allowing a recovered backend to unstick the UI without a reload.                                                                                     | Retry state is transient and guards against concurrent invalidations; listeners exist only while the error view is mounted.                                      |
| [#4107](https://github.com/pingdotgg/t3code/pull/4107) | Message actions               | Completed assistant-message copy and link actions remain visible without requiring hover.                                                                                                                                                         | Streaming assistant actions retain their existing hover treatment.                                                                                               |

## Earlier integrations

- [#4018](https://github.com/pingdotgg/t3code/pull/4018) — Loads older conversation history on
  demand, reducing memory use and reconnect payloads for long-running remote threads.
- [#4176](https://github.com/pingdotgg/t3code/pull/4176) — Caps orchestration state and cleans up
  browser, preview, VCS, and UI state when threads are deleted.
- [#4199](https://github.com/pingdotgg/t3code/pull/4199) — Keeps Codex sessions alive while
  background agents are still producing events, preventing active remote work from being reaped.
- [#3166](https://github.com/pingdotgg/t3code/pull/3166) — Caches successful Git top-level lookups
  so reconnect event replay does not spawn the same Git process for every event.

## Verification expectations

- Run each PR's focused regression tests after conflict resolution or upstream synchronization.
- Run `vp check`, `vp run typecheck`, and the complete `vp test` suite for a combined backport batch.
- Verify Codex steering and Stop, branch and diff refresh, oversized-diff fallback, readable
  provider errors, automatic HTTPS clone selection, and persistent completed-message actions in
  the web app.
- Keep fork-aware PR and ref behavior covered with `enableForkPullRequests` both on and off.
- Verify the WASM diff worker and `EPIPE` handling in a packaged-desktop-capable environment when
  desktop bootstrap, Electron protocol policy, or packaging dependencies change.
- During upstream merges, compare the final upstream implementation instead of blindly retaining
  the fork patch; preserve local adaptations only where the fork's newer architecture requires
  them.
