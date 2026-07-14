import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Make a thread's project binding optional and persist its explicit context kind. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`DROP TABLE IF EXISTS projection_threads_next`;
  yield* sql`
    CREATE TABLE projection_threads_next (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT,
      context_kind TEXT NOT NULL DEFAULT 'project'
        CHECK (context_kind IN ('project', 'standalone')),
      title TEXT NOT NULL,
      model_selection_json TEXT NOT NULL,
      runtime_mode TEXT NOT NULL DEFAULT 'full-access',
      interaction_mode TEXT NOT NULL DEFAULT 'default',
      branch TEXT,
      worktree_path TEXT,
      latest_turn_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      latest_user_message_at TEXT,
      pending_approval_count INTEGER NOT NULL DEFAULT 0,
      pending_user_input_count INTEGER NOT NULL DEFAULT 0,
      has_actionable_proposed_plan INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      CHECK (
        (context_kind = 'project' AND project_id IS NOT NULL)
        OR (context_kind = 'standalone' AND project_id IS NULL)
      )
    )
  `;

  yield* sql`
    INSERT INTO projection_threads_next (
      thread_id,
      project_id,
      context_kind,
      title,
      model_selection_json,
      runtime_mode,
      interaction_mode,
      branch,
      worktree_path,
      latest_turn_id,
      created_at,
      updated_at,
      archived_at,
      latest_user_message_at,
      pending_approval_count,
      pending_user_input_count,
      has_actionable_proposed_plan,
      deleted_at
    )
    SELECT
      thread_id,
      project_id,
      'project',
      title,
      model_selection_json,
      runtime_mode,
      interaction_mode,
      branch,
      worktree_path,
      latest_turn_id,
      created_at,
      updated_at,
      archived_at,
      latest_user_message_at,
      pending_approval_count,
      pending_user_input_count,
      has_actionable_proposed_plan,
      deleted_at
    FROM projection_threads
  `;

  yield* sql`DROP TABLE projection_threads`;
  yield* sql`ALTER TABLE projection_threads_next RENAME TO projection_threads`;

  yield* sql`
    CREATE INDEX idx_projection_threads_project_id
    ON projection_threads(project_id)
  `;
  yield* sql`
    CREATE INDEX idx_projection_threads_project_archived_at
    ON projection_threads(project_id, archived_at)
  `;
  yield* sql`
    CREATE INDEX idx_projection_threads_project_deleted_created
    ON projection_threads(project_id, deleted_at, created_at)
  `;
  yield* sql`
    CREATE INDEX idx_projection_threads_shell_active
    ON projection_threads(deleted_at, archived_at, context_kind, project_id, created_at, thread_id)
  `;
  yield* sql`
    CREATE INDEX idx_projection_threads_shell_archived
    ON projection_threads(deleted_at, archived_at, context_kind, project_id, thread_id)
  `;
});
