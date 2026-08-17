import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const assertTurnQueueSchema = Effect.fn("test.assertTurnQueueSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const messageColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_messages)
  `;
  assert.equal(messageColumns.filter((column) => column.name === "delivery_state").length, 1);

  const queueColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_turn_queue)
  `;
  assert.deepEqual(
    queueColumns.map((column) => column.name),
    [
      "message_id",
      "thread_id",
      "event_id",
      "command_id",
      "model_selection_json",
      "title_seed",
      "runtime_mode",
      "interaction_mode",
      "source_proposed_plan_thread_id",
      "source_proposed_plan_id",
      "queued_at",
      "event_sequence",
      "status",
    ],
  );
});

layer("044_EnsureProjectionThreadTurnQueue", (it) => {
  it.effect("repairs personal fork databases whose migration ids skipped the queue schema", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 40 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (41, 'ProjectionProjectsDefaultThreadEnvMode'),
          (42, 'ProjectionProjectFaviconPath'),
          (43, 'CleanupRetiredStandaloneThreads')
      `;

      yield* runMigrations({ toMigrationInclusive: 44 });
      yield* assertTurnQueueSchema();
    }),
  );

  it.effect("is idempotent when the canonical queue migration already ran", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 41 });
      yield* runMigrations({ toMigrationInclusive: 44 });
      yield* assertTurnQueueSchema();
    }),
  );
});
