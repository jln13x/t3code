import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("033_StandaloneThreadContext", (it) => {
  it.effect("preserves project threads and accepts standalone threads", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 32 });
      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          created_at,
          updated_at
        ) VALUES (
          'thread-project',
          'project-1',
          'Project thread',
          '{"instanceId":"codex","model":"gpt-5-codex"}',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 33 });

      const existing = yield* sql<{
        readonly projectId: string | null;
        readonly contextKind: string;
      }>`
        SELECT
          project_id AS projectId,
          context_kind AS contextKind
        FROM projection_threads
        WHERE thread_id = 'thread-project'
      `;
      assert.deepStrictEqual(existing, [{ projectId: "project-1", contextKind: "project" }]);

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          context_kind,
          title,
          model_selection_json,
          created_at,
          updated_at
        ) VALUES (
          'thread-standalone',
          NULL,
          'standalone',
          'Standalone chat',
          '{"instanceId":"codex","model":"gpt-5-codex"}',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z'
        )
      `;

      const standalone = yield* sql<{
        readonly projectId: string | null;
        readonly contextKind: string;
      }>`
        SELECT
          project_id AS projectId,
          context_kind AS contextKind
        FROM projection_threads
        WHERE thread_id = 'thread-standalone'
      `;
      assert.deepStrictEqual(standalone, [{ projectId: null, contextKind: "standalone" }]);
    }),
  );
});
