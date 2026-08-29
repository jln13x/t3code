import {
  ChatImageAttachment,
  EnvironmentId,
  OrchestrationMessage,
  OrchestrationThread,
  ThreadId,
  type ChatAttachment,
  type ModelSelection,
  type OrchestrationThreadDetailSnapshot,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const TRANSFER_ARCHIVE_VERSION = 1 as const;
const TRANSFER_MANIFEST_VERSION = 1 as const;
const TRANSFER_CHUNK_MAX_BYTES = 600 * 1024;
const MAX_PROVIDER_CONTEXT_CHARACTERS = 48_000;
const TRANSFER_CONTEXT_OPEN = '<t3-transferred-chat-context version="1">';
const TRANSFER_CONTEXT_CLOSE = "</t3-transferred-chat-context>";
const TRANSFER_HISTORY_ROOT = ".t3/chat-transfers";
const TRANSFERRED_THREAD_ID_PREFIX = "moved-";

const ArchivedChatImageAttachment = Schema.Struct({
  ...ChatImageAttachment.fields,
  previewUrl: Schema.String,
});
const isChatImageAttachment = Schema.is(ChatImageAttachment);
const ArchivedOrchestrationMessage = Schema.Struct({
  ...OrchestrationMessage.fields,
  attachments: Schema.optional(Schema.Array(ArchivedChatImageAttachment)),
});
const ArchivedOrchestrationThread = Schema.Struct({
  ...OrchestrationThread.fields,
  messages: Schema.Array(ArchivedOrchestrationMessage),
});

export const TransferredThreadArchive = Schema.Struct({
  version: Schema.Literal(TRANSFER_ARCHIVE_VERSION),
  sourceEnvironmentId: EnvironmentId,
  sourceThreadId: ThreadId,
  exportedAt: Schema.String,
  sourceFingerprint: Schema.String,
  thread: ArchivedOrchestrationThread,
});
export type TransferredThreadArchive = typeof TransferredThreadArchive.Type;

const TransferredThreadManifest = Schema.Struct({
  version: Schema.Literal(TRANSFER_MANIFEST_VERSION),
  encoding: Schema.Literal("base64-utf8-chunks"),
  byteLength: Schema.Number,
  sha256: Schema.String,
  chunks: Schema.Array(Schema.String),
});
type TransferredThreadManifest = typeof TransferredThreadManifest.Type;
const decodeTransferredThreadManifest = Schema.decodeUnknownSync(TransferredThreadManifest);
const decodeTransferredThreadArchive = Schema.decodeUnknownSync(TransferredThreadArchive);

export interface TransferredThreadArchiveFiles {
  readonly manifestPath: string;
  readonly files: ReadonlyArray<{
    readonly relativePath: string;
    readonly contents: string;
  }>;
}

export interface TransferredThreadFileContents {
  readonly contents: string;
  readonly byteLength: number;
  readonly truncated: boolean;
}

const archiveCache = new Map<string, TransferredThreadArchive>();

function archiveCacheKey(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `${environmentId}:${threadId}`;
}

export function cacheTransferredThreadArchive(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  archive: TransferredThreadArchive,
): void {
  archiveCache.set(archiveCacheKey(environmentId, threadId), archive);
}

export function readCachedTransferredThreadArchive(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): TransferredThreadArchive | null {
  return archiveCache.get(archiveCacheKey(environmentId, threadId)) ?? null;
}

export function transferredThreadArchiveDirectory(threadId: ThreadId): string {
  return `${TRANSFER_HISTORY_ROOT}/${threadId}`;
}

export function makeTransferredThreadId(uuid: string): ThreadId {
  return ThreadId.make(`${TRANSFERRED_THREAD_ID_PREFIX}${uuid}`);
}

export function isTransferredThreadId(threadId: ThreadId): boolean {
  return threadId.startsWith(TRANSFERRED_THREAD_ID_PREFIX);
}

export function transferredThreadManifestPath(threadId: ThreadId): string {
  return `${transferredThreadArchiveDirectory(threadId)}/manifest.json`;
}

export function resolveTransferredModelSelection(input: {
  readonly source: ModelSelection;
  readonly targetDefault: ModelSelection | null;
  readonly targetProviders: ReadonlyArray<ServerProvider>;
}): ModelSelection | null {
  const sourceProvider = input.targetProviders.find(
    (provider) =>
      provider.instanceId === input.source.instanceId &&
      provider.enabled &&
      provider.installed &&
      provider.availability !== "unavailable" &&
      provider.models.some((model) => model.slug === input.source.model),
  );
  if (sourceProvider !== undefined) return input.source;

  const defaultProvider = input.targetDefault
    ? input.targetProviders.find(
        (provider) =>
          provider.instanceId === input.targetDefault?.instanceId &&
          provider.enabled &&
          provider.installed &&
          provider.availability !== "unavailable" &&
          provider.models.some((model) => model.slug === input.targetDefault?.model),
      )
    : undefined;
  if (input.targetDefault !== null && defaultProvider !== undefined) return input.targetDefault;

  const fallback = input.targetProviders.find(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      provider.availability !== "unavailable" &&
      provider.models.length > 0,
  );
  const model = fallback?.models.find((candidate) => candidate.isDefault) ?? fallback?.models[0];
  return fallback !== undefined && model !== undefined
    ? { instanceId: fallback.instanceId, model: model.slug }
    : null;
}

function threadFingerprintPayload(thread: OrchestrationThread): unknown {
  const {
    archivedAt: _archivedAt,
    updatedAt: _updatedAt,
    titleRegeneration: _title,
    ...stable
  } = thread;
  return stable;
}

export async function fingerprintTransferredThread(thread: OrchestrationThread): Promise<string> {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(threadFingerprintPayload(thread))));
}

export async function prepareTransferredThreadArchive(input: {
  readonly sourceEnvironmentId: EnvironmentId;
  readonly thread: OrchestrationThread;
  readonly modelSelection: ModelSelection;
  readonly exportedAt?: string;
  readonly loadAttachment: (attachment: ChatAttachment) => Promise<string>;
}): Promise<TransferredThreadArchive> {
  const previewUrlByAttachmentId = new Map<string, string>();
  for (const message of input.thread.messages) {
    for (const attachment of message.attachments ?? []) {
      if (!isChatImageAttachment(attachment)) continue;
      if (!previewUrlByAttachmentId.has(attachment.id)) {
        previewUrlByAttachmentId.set(attachment.id, await input.loadAttachment(attachment));
      }
    }
  }

  return {
    version: TRANSFER_ARCHIVE_VERSION,
    sourceEnvironmentId: input.sourceEnvironmentId,
    sourceThreadId: input.thread.id,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    sourceFingerprint: await fingerprintTransferredThread(input.thread),
    thread: {
      ...input.thread,
      modelSelection: input.modelSelection,
      messages: input.thread.messages.map((message) => {
        const { attachments, ...messageWithoutAttachments } = message;
        const imageAttachments = attachments?.filter(isChatImageAttachment);
        return imageAttachments === undefined || imageAttachments.length === 0
          ? messageWithoutAttachments
          : {
              ...messageWithoutAttachments,
              attachments: imageAttachments.map((attachment) => ({
                ...attachment,
                previewUrl: previewUrlByAttachmentId.get(attachment.id)!,
              })),
            };
      }),
    },
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const blockSize = 32 * 1024;
  for (let offset = 0; offset < bytes.byteLength; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function encodeTransferredThreadArchiveFiles(
  destinationThreadId: ThreadId,
  archive: TransferredThreadArchive,
): Promise<TransferredThreadArchiveFiles> {
  const bytes = new TextEncoder().encode(JSON.stringify(archive));
  const directory = transferredThreadArchiveDirectory(destinationThreadId);
  const chunks: Array<{ readonly relativePath: string; readonly contents: string }> = [];
  for (let offset = 0, index = 0; offset < bytes.byteLength; index += 1) {
    const chunk = bytes.subarray(offset, offset + TRANSFER_CHUNK_MAX_BYTES);
    chunks.push({
      relativePath: `${directory}/chunk-${String(index).padStart(5, "0")}.txt`,
      contents: bytesToBase64(chunk),
    });
    offset += chunk.byteLength;
  }
  if (chunks.length === 0) {
    chunks.push({ relativePath: `${directory}/chunk-00000.txt`, contents: "" });
  }
  const manifest = {
    version: TRANSFER_MANIFEST_VERSION,
    encoding: "base64-utf8-chunks",
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    chunks: chunks.map((chunk) => chunk.relativePath),
  } satisfies TransferredThreadManifest;
  const manifestPath = transferredThreadManifestPath(destinationThreadId);
  return {
    manifestPath,
    files: [...chunks, { relativePath: manifestPath, contents: JSON.stringify(manifest) }],
  };
}

function decodeManifest(contents: string): TransferredThreadManifest {
  return decodeTransferredThreadManifest(JSON.parse(contents));
}

export async function loadTransferredThreadArchive(input: {
  readonly destinationThreadId: ThreadId;
  readonly readFile: (relativePath: string) => Promise<TransferredThreadFileContents>;
}): Promise<TransferredThreadArchive> {
  const manifestFile = await input.readFile(
    transferredThreadManifestPath(input.destinationThreadId),
  );
  if (manifestFile.truncated) throw new Error("The transferred chat manifest is truncated.");
  const manifest = decodeManifest(manifestFile.contents);
  const archiveDirectory = transferredThreadArchiveDirectory(input.destinationThreadId);
  if (manifest.chunks.length === 0) {
    throw new Error("The transferred chat manifest has no data chunks.");
  }
  for (let index = 0; index < manifest.chunks.length; index += 1) {
    const expectedPath = `${archiveDirectory}/chunk-${String(index).padStart(5, "0")}.txt`;
    if (manifest.chunks[index] !== expectedPath) {
      throw new Error("The transferred chat manifest contains an invalid chunk path.");
    }
  }
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for (const relativePath of manifest.chunks) {
    const file = await input.readFile(relativePath);
    if (file.truncated) throw new Error(`Transferred chat chunk '${relativePath}' is truncated.`);
    const chunk = base64ToBytes(file.contents);
    chunks.push(chunk);
    byteLength += chunk.byteLength;
  }
  if (byteLength !== manifest.byteLength) {
    throw new Error("The transferred chat has an unexpected byte length.");
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if ((await sha256Hex(bytes)) !== manifest.sha256) {
    throw new Error("The transferred chat failed its integrity check.");
  }
  return decodeTransferredThreadArchive(JSON.parse(new TextDecoder().decode(bytes)));
}

export async function persistTransferredThreadArchive(input: {
  readonly destinationThreadId: ThreadId;
  readonly archive: TransferredThreadArchive;
  readonly writeFile: (relativePath: string, contents: string) => Promise<void>;
  readonly readFile: (relativePath: string) => Promise<TransferredThreadFileContents>;
}): Promise<void> {
  const encoded = await encodeTransferredThreadArchiveFiles(
    input.destinationThreadId,
    input.archive,
  );
  for (const file of encoded.files) {
    await input.writeFile(file.relativePath, file.contents);
  }
  const verified = await loadTransferredThreadArchive({
    destinationThreadId: input.destinationThreadId,
    readFile: input.readFile,
  });
  if (verified.sourceFingerprint !== input.archive.sourceFingerprint) {
    throw new Error("The transferred chat did not survive the destination write intact.");
  }
}

function mergeById<T extends { readonly id: string }>(
  archived: ReadonlyArray<T>,
  live: ReadonlyArray<T>,
): ReadonlyArray<T> {
  const liveIds = new Set(live.map((item) => item.id));
  return [...archived.filter((item) => !liveIds.has(item.id)), ...live];
}

export function mergeTransferredThreadHistory<T extends OrchestrationThread>(
  live: T,
  archive: TransferredThreadArchive | null,
): T {
  if (archive === null) return live;
  const liveCheckpointTurns = new Set(live.checkpoints.map((checkpoint) => checkpoint.turnId));
  return {
    ...live,
    messages: mergeById(archive.thread.messages, live.messages),
    activities: mergeById(archive.thread.activities, live.activities),
    proposedPlans: mergeById(archive.thread.proposedPlans, live.proposedPlans),
    checkpoints: [
      ...archive.thread.checkpoints.filter(
        (checkpoint) => !liveCheckpointTurns.has(checkpoint.turnId),
      ),
      ...live.checkpoints,
    ],
    latestTurn: live.latestTurn ?? archive.thread.latestTurn,
  } as T;
}

export function mergeTransferredThreadSnapshotPage(
  loaded: OrchestrationThreadDetailSnapshot,
  older: OrchestrationThreadDetailSnapshot,
): OrchestrationThreadDetailSnapshot {
  if (loaded.thread.id !== older.thread.id || loaded.thread.updatedAt !== older.thread.updatedAt) {
    throw new Error("The source chat changed while its history was being read.");
  }
  const loadedCheckpointTurns = new Set(
    loaded.thread.checkpoints.map((checkpoint) => checkpoint.turnId),
  );
  return {
    snapshotSequence: Math.max(loaded.snapshotSequence, older.snapshotSequence),
    thread: {
      ...loaded.thread,
      messages: mergeById(older.thread.messages, loaded.thread.messages),
      activities: mergeById(older.thread.activities, loaded.thread.activities),
      proposedPlans: mergeById(older.thread.proposedPlans, loaded.thread.proposedPlans),
      checkpoints: [
        ...older.thread.checkpoints.filter(
          (checkpoint) => !loadedCheckpointTurns.has(checkpoint.turnId),
        ),
        ...loaded.thread.checkpoints,
      ],
    },
    ...(older.page === undefined ? {} : { page: older.page }),
  };
}

function renderProviderContextMessage(message: OrchestrationMessage): string {
  const attachmentCount = message.attachments?.length ?? 0;
  const attachmentNote =
    attachmentCount === 0
      ? ""
      : `\n[${attachmentCount} historical image${attachmentCount === 1 ? "" : "s"} in the transferred UI archive]`;
  return `<message role="${message.role}">\n${message.text}${attachmentNote}\n</message>`;
}

export function buildTransferredChatProviderInput(input: {
  readonly archive: TransferredThreadArchive;
  readonly userInput: string;
}): string {
  const header = [
    TRANSFER_CONTEXT_OPEN,
    "You are continuing a T3 Code chat that was moved from another environment.",
    "The destination has the original branch, worktree state, and complete UI history archive.",
    "Treat the transcript below as prior context and the text after the closing tag as the current request.",
    `Source thread: ${input.archive.thread.title}`,
    `Source branch: ${input.archive.thread.branch ?? "(current checkout)"}`,
    "<source-transcript>",
  ].join("\n");
  const footer = `\n</source-transcript>\n${TRANSFER_CONTEXT_CLOSE}`;
  const budget = Math.max(0, MAX_PROVIDER_CONTEXT_CHARACTERS - header.length - footer.length);
  const selected: string[] = [];
  let used = 0;
  for (let index = input.archive.thread.messages.length - 1; index >= 0; index -= 1) {
    const message = input.archive.thread.messages[index];
    if (message === undefined) continue;
    const rendered = renderProviderContextMessage(message);
    if (used + rendered.length > budget) continue;
    selected.unshift(rendered);
    used += rendered.length;
  }
  const transcript =
    selected.length === 0 ? "[No source transcript was available.]" : selected.join("\n");
  return `${header}\n${transcript}${footer}\n\n${input.userInput}`;
}

export function stripTransferredChatProviderContext(message: string): string {
  if (!message.startsWith(TRANSFER_CONTEXT_OPEN)) return message;
  const closeOffset = message.indexOf(TRANSFER_CONTEXT_CLOSE, TRANSFER_CONTEXT_OPEN.length);
  if (closeOffset < 0) return message;
  return message.slice(closeOffset + TRANSFER_CONTEXT_CLOSE.length).replace(/^\r?\n\r?\n/, "");
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Attachment could not be encoded.")),
    );
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Read failed.")));
    reader.readAsDataURL(blob);
  });
}
