import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HashMap from "effect/HashMap";
import { expect } from "vite-plus/test";

import { createEmptyCommandReadModel } from "./commandReadModel.ts";
import { decideOrchestrationCommand } from "./decider.ts";

const threadId = ThreadId.make("thread-change-request");
const changeRequest = {
  provider: "github" as const,
  number: 42,
  title: "Durable association",
  url: "https://github.com/acme/repo/pull/42",
  baseRefName: "main",
  headRefName: "feature/original",
  state: "open" as const,
};
const thread: OrchestrationThread = {
  id: threadId,
  projectId: ProjectId.make("project-change-request"),
  context: { kind: "project", projectId: ProjectId.make("project-change-request") },
  title: "Change request thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: "feature/original",
  worktreePath: "/repo/worktree",
  changeRequest,
  latestTurn: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};
const readModel = {
  ...createEmptyCommandReadModel("2026-01-01T00:00:00.000Z"),
  threads: HashMap.make([threadId, thread]),
};

const decideMetadataUpdate = (
  command: Omit<Extract<OrchestrationCommand, { type: "thread.meta.update" }>, "commandId">,
) =>
  decideOrchestrationCommand({
    command: {
      ...command,
      commandId: CommandId.make("command-change-request"),
    },
    readModel,
  });

function metadataPayload(
  event: Omit<OrchestrationEvent, "sequence"> | ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
) {
  if (!("type" in event) || event.type !== "thread.meta-updated") {
    throw new Error("Expected a single thread.meta-updated event");
  }
  return event.payload as unknown as {
    readonly branch?: string | null;
    readonly changeRequest?: unknown;
  };
}

it.layer(NodeServices.layer)("change-request metadata decisions", (it) => {
  it.effect("clears the association when the branch changes", () =>
    Effect.gen(function* () {
      const event = yield* decideMetadataUpdate({
        type: "thread.meta.update",
        threadId,
        branch: "feature/replacement",
        expectedBranch: "feature/original",
      });
      const payload = metadataPayload(event);
      expect(payload.branch).toBe("feature/replacement");
      expect(payload.changeRequest).toBeNull();
    }),
  );

  it.effect("persists an explicit association without changing the branch", () =>
    Effect.gen(function* () {
      const event = yield* decideMetadataUpdate({
        type: "thread.meta.update",
        threadId,
        changeRequest: { ...changeRequest, state: "merged" },
      });
      const payload = metadataPayload(event);
      expect(payload.branch).toBeUndefined();
      expect(payload.changeRequest).toEqual({ ...changeRequest, state: "merged" });
    }),
  );

  it.effect("rejects a paired association when its optimistic branch update is stale", () =>
    Effect.gen(function* () {
      const event = yield* decideMetadataUpdate({
        type: "thread.meta.update",
        threadId,
        branch: "feature/stale-action",
        expectedBranch: "feature/no-longer-current",
        changeRequest: { ...changeRequest, headRefName: "feature/stale-action" },
      });
      const payload = metadataPayload(event);
      expect(payload.branch).toBe("feature/original");
      expect(payload.changeRequest).toBeUndefined();
    }),
  );
});
