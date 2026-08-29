import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationThread,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  buildTransferredChatProviderInput,
  encodeTransferredThreadArchiveFiles,
  fingerprintTransferredThread,
  loadTransferredThreadArchive,
  isTransferredThreadId,
  makeTransferredThreadId,
  mergeTransferredThreadHistory,
  mergeTransferredThreadSnapshotPage,
  persistTransferredThreadArchive,
  prepareTransferredThreadArchive,
  resolveTransferredModelSelection,
  stripTransferredChatProviderContext,
} from "./threadTransfer";

const sourceModel = {
  instanceId: ProviderInstanceId.make("codex-work"),
  model: "gpt-5.4",
  options: [{ id: "reasoningEffort", value: "high" }],
};
const sourceEnvironmentId = EnvironmentId.make("source-machine");

function provider(instanceId: string, model: string): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [{ slug: model, name: model, isCustom: false, isDefault: true, capabilities: {} }],
    slashCommands: [],
    skills: [],
  };
}

function thread(): OrchestrationThread {
  const attachment = {
    type: "image" as const,
    id: "thread-attachment-00000000-0000-4000-8000-000000000000",
    name: "image.png",
    mimeType: "image/png",
    sizeBytes: 3,
  };
  return {
    id: ThreadId.make("thread-transfer"),
    projectId: ProjectId.make("project-transfer"),
    title: "Transfer",
    modelSelection: sourceModel,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "feature/transfer",
    worktreePath: "/source/worktree",
    latestTurn: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    titleRegeneration: null,
    deletedAt: null,
    messages: [
      {
        id: MessageId.make("message-one"),
        role: "user",
        text: "First",
        attachments: [attachment],
        turnId: null,
        streaming: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: MessageId.make("message-two"),
        role: "assistant",
        text: "Second",
        attachments: [attachment],
        turnId: null,
        streaming: false,
        createdAt: "2026-01-01T00:00:01.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
      },
    ],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  };
}

async function archive() {
  return prepareTransferredThreadArchive({
    sourceEnvironmentId,
    thread: thread(),
    modelSelection: sourceModel,
    exportedAt: "2026-01-01T00:01:00.000Z",
    loadAttachment: async () => "data:image/png;base64,AQID",
  });
}

describe("thread transfer preparation", () => {
  it("keeps the exact model selection when the destination has that provider instance", () => {
    expect(
      resolveTransferredModelSelection({
        source: sourceModel,
        targetDefault: null,
        targetProviders: [provider("codex-work", "gpt-5.4")],
      }),
    ).toEqual(sourceModel);
  });

  it("uses the destination project default when the source provider is unavailable", () => {
    const targetDefault = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.3-codex",
    };
    expect(
      resolveTransferredModelSelection({
        source: sourceModel,
        targetDefault,
        targetProviders: [provider("codex", "gpt-5.3-codex")],
      }),
    ).toEqual(targetDefault);
  });

  it("uses the destination default when the source model is unavailable", () => {
    const targetDefault = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.3-codex",
    };
    expect(
      resolveTransferredModelSelection({
        source: sourceModel,
        targetDefault,
        targetProviders: [
          provider("codex-work", "gpt-5.3-codex"),
          provider("codex", "gpt-5.3-codex"),
        ],
      }),
    ).toEqual(targetDefault);
  });

  it("refuses a transfer when the destination has no usable model", () => {
    expect(
      resolveTransferredModelSelection({
        source: sourceModel,
        targetDefault: null,
        targetProviders: [],
      }),
    ).toBeNull();
  });

  it("downloads duplicate attachment references once and stores previews on every message", async () => {
    const loadAttachment = vi.fn(async () => "data:image/png;base64,AQID");
    const prepared = await prepareTransferredThreadArchive({
      sourceEnvironmentId,
      thread: thread(),
      modelSelection: sourceModel,
      loadAttachment,
    });
    expect(loadAttachment).toHaveBeenCalledTimes(1);
    expect(prepared.thread.messages[0]?.attachments?.[0]).toMatchObject({
      name: "image.png",
      previewUrl: "data:image/png;base64,AQID",
    });
    expect(prepared.thread.messages[1]?.attachments?.[0]?.previewUrl).toBe(
      "data:image/png;base64,AQID",
    );
  });

  it("keeps generic files out of the portable image archive", async () => {
    const source = thread();
    const withFile = {
      ...source,
      messages: source.messages.map((message, index) =>
        index === 0
          ? {
              ...message,
              attachments: [
                ...(message.attachments ?? []),
                {
                  type: "file" as const,
                  id: "thread-file-00000000-0000-4000-8000-000000000000",
                  name: "report.pdf",
                  mimeType: "application/pdf",
                  sizeBytes: 42,
                },
              ],
            }
          : message,
      ),
    };
    const loadAttachment = vi.fn(async () => "data:image/png;base64,AQID");

    const prepared = await prepareTransferredThreadArchive({
      sourceEnvironmentId,
      thread: withFile,
      modelSelection: sourceModel,
      loadAttachment,
    });

    expect(loadAttachment).toHaveBeenCalledTimes(1);
    expect(prepared.thread.messages[0]?.attachments).toHaveLength(1);
    expect(prepared.thread.messages[0]?.attachments?.[0]?.type).toBe("image");
  });
});

describe("destination history capsule", () => {
  it("marks destination thread ids so a missing capsule cannot look like an empty chat", () => {
    const threadId = makeTransferredThreadId("00000000-0000-4000-8000-000000000000");
    expect(isTransferredThreadId(threadId)).toBe(true);
    expect(isTransferredThreadId(ThreadId.make("ordinary-thread"))).toBe(false);
  });

  it("chunks, writes, reloads, and verifies the complete archive", async () => {
    const base = await archive();
    const prepared = {
      ...base,
      thread: {
        ...base.thread,
        messages: base.thread.messages.map((message, index) =>
          index === 0 ? { ...message, text: "x".repeat(800_000) } : message,
        ),
      },
    };
    const destinationThreadId = ThreadId.make("destination-thread");
    const encoded = await encodeTransferredThreadArchiveFiles(destinationThreadId, prepared);
    expect(encoded.files.length).toBeGreaterThan(2);
    expect(
      encoded.files.every((file) => new TextEncoder().encode(file.contents).length < 1024 * 1024),
    ).toBe(true);

    const files = new Map<string, string>();
    await persistTransferredThreadArchive({
      destinationThreadId,
      archive: prepared,
      writeFile: async (relativePath, contents) => {
        files.set(relativePath, contents);
      },
      readFile: async (relativePath) => {
        const contents = files.get(relativePath);
        if (contents === undefined) throw new Error("missing");
        return {
          contents,
          byteLength: new TextEncoder().encode(contents).length,
          truncated: false,
        };
      },
    });
    const restored = await loadTransferredThreadArchive({
      destinationThreadId,
      readFile: async (relativePath) => {
        const contents = files.get(relativePath)!;
        return {
          contents,
          byteLength: new TextEncoder().encode(contents).length,
          truncated: false,
        };
      },
    });
    expect(restored.thread.messages[0]?.text).toHaveLength(800_000);
    expect(restored.thread.messages[1]?.attachments?.[0]?.previewUrl).toBe(
      "data:image/png;base64,AQID",
    );
  });

  it("rejects a corrupted destination chunk", async () => {
    const prepared = await archive();
    const destinationThreadId = ThreadId.make("destination-thread");
    const encoded = await encodeTransferredThreadArchiveFiles(destinationThreadId, prepared);
    const files = new Map(encoded.files.map((file) => [file.relativePath, file.contents]));
    const chunk = encoded.files.find((file) => file.relativePath.includes("chunk-"))!;
    files.set(chunk.relativePath, chunk.contents.slice(0, -4) + "AAAA");
    await expect(
      loadTransferredThreadArchive({
        destinationThreadId,
        readFile: async (relativePath) => ({
          contents: files.get(relativePath)!,
          byteLength: files.get(relativePath)!.length,
          truncated: false,
        }),
      }),
    ).rejects.toThrow(/integrity|byte length/);
  });

  it("treats archive lifecycle metadata as unchanged but detects new work", async () => {
    const before = thread();
    const archived = {
      ...before,
      archivedAt: "2026-01-01T00:02:00.000Z",
      updatedAt: "2026-01-01T00:02:00.000Z",
    };
    expect(await fingerprintTransferredThread(archived)).toBe(
      await fingerprintTransferredThread(before),
    );
    expect(
      await fingerprintTransferredThread({
        ...archived,
        messages: [...archived.messages, { ...archived.messages[1]!, id: MessageId.make("new") }],
      }),
    ).not.toBe(await fingerprintTransferredThread(before));
  });
});

describe("transferred history rendering and continuation", () => {
  it("places archived rows before new destination rows", async () => {
    const prepared = await archive();
    const live = {
      ...thread(),
      id: ThreadId.make("destination-thread"),
      messages: [
        {
          ...thread().messages[0]!,
          id: MessageId.make("destination-message"),
          text: "After moving",
          attachments: undefined,
        },
      ],
    };
    const merged = mergeTransferredThreadHistory(live, prepared);
    expect(merged.id).toBe(live.id);
    expect(merged.messages.map((message) => message.text)).toEqual([
      "First",
      "Second",
      "After moving",
    ]);
  });

  it("injects bounded recent context once and strips it from the displayed user message", async () => {
    const prepared = await archive();
    const input = buildTransferredChatProviderInput({ archive: prepared, userInput: "Continue" });
    expect(input).toContain("First");
    expect(input).toContain("Second");
    expect(input).toContain("complete UI history archive");
    expect(stripTransferredChatProviderContext(input)).toBe("Continue");
    expect(stripTransferredChatProviderContext("ordinary message")).toBe("ordinary message");
    expect(input.length).toBeLessThanOrEqual(48_000 + "Continue".length + 2);
  });

  it("merges disjoint snapshot pages and rejects a moving source", () => {
    const recent = {
      snapshotSequence: 3,
      thread: thread(),
      page: { beforeCursor: "older", hasMore: true, snapshotSequence: 3 },
    };
    const oldMessage = { ...thread().messages[0]!, id: MessageId.make("old"), text: "Old" };
    const older = {
      snapshotSequence: 4,
      thread: { ...thread(), messages: [oldMessage] },
      page: { beforeCursor: null, hasMore: false, snapshotSequence: 4 },
    };
    expect(
      mergeTransferredThreadSnapshotPage(recent, older).thread.messages.map(
        (message) => message.text,
      ),
    ).toEqual(["Old", "First", "Second"]);
    expect(() =>
      mergeTransferredThreadSnapshotPage(recent, {
        ...older,
        thread: { ...older.thread, updatedAt: "2026-01-01T00:00:02.000Z" },
      }),
    ).toThrow(/changed/);
  });
});
