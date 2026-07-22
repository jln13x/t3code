import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("034_ProjectionThreadChangeRequest", (it) => {
  it.effect("adds nullable durable change-request metadata without changing existing rows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 33 });
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
          'thread-pr',
          'project-1',
          'project',
          'Pull request thread',
          '{"instanceId":"codex","model":"gpt-5-codex"}',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 34 });

      const existing = yield* sql<{ readonly changeRequestJson: string | null }>`
        SELECT change_request_json AS changeRequestJson
        FROM projection_threads
        WHERE thread_id = 'thread-pr'
      `;
      assert.deepStrictEqual(existing, [{ changeRequestJson: null }]);

      const changeRequestJson =
        '{"provider":"github","number":42,"title":"Durable association","url":"https://github.com/acme/repo/pull/42","baseRefName":"main","headRefName":"feature/durable","state":"open"}';
      yield* sql`
        UPDATE projection_threads
        SET change_request_json = ${changeRequestJson}
        WHERE thread_id = 'thread-pr'
      `;

      const updated = yield* sql<{ readonly changeRequestJson: string | null }>`
        SELECT change_request_json AS changeRequestJson
        FROM projection_threads
        WHERE thread_id = 'thread-pr'
      `;
      assert.deepStrictEqual(updated, [{ changeRequestJson }]);
    }),
  );
});
