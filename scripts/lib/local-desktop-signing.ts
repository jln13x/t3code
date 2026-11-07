// @effect-diagnostics nodeBuiltinImport:off

import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import * as Schema from "effect/Schema";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

export const DESKTOP_FORK_BUNDLE_ID = "com.t3tools.t3code.fork";
// Keep this a custom name: electron-builder treats Apple certificate prefixes
// as selectors and rejects them in an explicit identity qualifier.
export const LOCAL_DESKTOP_SIGNING_COMMON_NAME = "T3 Code Fork Local Signing";
export const LOCAL_DESKTOP_SIGNING_STATE_DIRECTORY = "T3 Code Fork Local Signing";
export const LOCAL_DESKTOP_SIGNING_STATE_FILE = "identity.json";

export type DesktopSigningMode = "unsigned" | "release" | "local";

export interface LocalDesktopSigningState {
  readonly version: 1;
  readonly commonName: typeof LOCAL_DESKTOP_SIGNING_COMMON_NAME;
  readonly keychainPath: string;
  readonly certificateSha1: string;
  readonly certificateSha256: string;
  readonly designatedRequirement?: string | undefined;
}

export interface LocalDesktopSigningIdentity {
  readonly commonName: string;
  readonly certificateSha1: string;
  readonly certificateSha256: string;
}

export interface LocalDesktopSigningInspection {
  readonly identities: ReadonlyArray<LocalDesktopSigningIdentity>;
  readonly certificates: ReadonlyArray<LocalDesktopSigningIdentity>;
}

export interface LocalDesktopCommandOutput {
  readonly stdout: string;
  readonly stderr: string;
}

export type LocalDesktopCommandRunner = (
  executable: string,
  args: ReadonlyArray<string>,
  options?: { readonly cwd?: string | undefined },
) => Promise<LocalDesktopCommandOutput>;

export class DesktopSigningModeConflictError extends Schema.TaggedError<
  DesktopSigningModeConflictError,
  { readonly brand: unique symbol }
>()("DesktopSigningModeConflictError", {
  message: Schema.String,
}) {
  override readonly name = "DesktopSigningModeConflictError";

  static new(): DesktopSigningModeConflictError {
    return new DesktopSigningModeConflictError({
      message: "--signed and --local-signed are mutually exclusive desktop signing modes.",
    });
  }
}

export class LocalDesktopSigningStateMissingError extends Schema.TaggedError<
  LocalDesktopSigningStateMissingError,
  { readonly brand: unique symbol }
>()("LocalDesktopSigningStateMissingError", {
  message: Schema.String,
  statePath: Schema.String,
}) {
  override readonly name = "LocalDesktopSigningStateMissingError";

  static new(statePath: string): LocalDesktopSigningStateMissingError {
    return new LocalDesktopSigningStateMissingError({
      message: `The local desktop signing identity is not configured. Run 'vp run setup:desktop:signing' once. Refusing to fall back to ad-hoc signing.`,
      statePath,
    });
  }
}

export class LocalDesktopSigningStateInvalidError extends Schema.TaggedError<
  LocalDesktopSigningStateInvalidError,
  { readonly brand: unique symbol }
>()("LocalDesktopSigningStateInvalidError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
  statePath: Schema.String,
}) {
  override readonly name = "LocalDesktopSigningStateInvalidError";

  static new(statePath: string, options?: ErrorOptions): LocalDesktopSigningStateInvalidError {
    return new LocalDesktopSigningStateInvalidError({
      message: `The local desktop signing state at ${statePath} is invalid. Refusing to use an unpinned certificate.`,
      ...options,
      statePath,
    });
  }
}

export class LocalDesktopSigningIdentityMissingError extends Schema.TaggedError<
  LocalDesktopSigningIdentityMissingError,
  { readonly brand: unique symbol }
>()("LocalDesktopSigningIdentityMissingError", {
  message: Schema.String,
  expectedCertificateSha256: Schema.String,
}) {
  override readonly name = "LocalDesktopSigningIdentityMissingError";

  static new(expectedCertificateSha256: string): LocalDesktopSigningIdentityMissingError {
    return new LocalDesktopSigningIdentityMissingError({
      message:
        "The pinned local desktop signing certificate is missing, untrusted, expired, or no longer has its private key. " +
        "Deleting this certificate changes the app identity and resets macOS permissions; restore it instead of creating a replacement.",
      expectedCertificateSha256,
    });
  }
}

export class LocalDesktopSigningIdentityChangedError extends Schema.TaggedError<
  LocalDesktopSigningIdentityChangedError,
  { readonly brand: unique symbol }
>()("LocalDesktopSigningIdentityChangedError", {
  message: Schema.String,
  expectedCertificateSha256: Schema.String,
  actualCertificateSha256s: Schema.Array(Schema.String),
}) {
  override readonly name = "LocalDesktopSigningIdentityChangedError";

  static new(
    expectedCertificateSha256: string,
    actualCertificateSha256s: ReadonlyArray<string>,
  ): LocalDesktopSigningIdentityChangedError {
    return new LocalDesktopSigningIdentityChangedError({
      message:
        "A different certificate now uses the local desktop signing name. Refusing to sign because certificate replacement changes the app identity and resets macOS permissions.",
      expectedCertificateSha256,
      actualCertificateSha256s,
    });
  }
}

export class LocalDesktopSigningIdentityAmbiguousError extends Schema.TaggedError<
  LocalDesktopSigningIdentityAmbiguousError,
  { readonly brand: unique symbol }
>()("LocalDesktopSigningIdentityAmbiguousError", {
  message: Schema.String,
  certificateSha256s: Schema.Array(Schema.String),
}) {
  override readonly name = "LocalDesktopSigningIdentityAmbiguousError";

  static new(certificateSha256s: ReadonlyArray<string>): LocalDesktopSigningIdentityAmbiguousError {
    return new LocalDesktopSigningIdentityAmbiguousError({
      message:
        "More than one valid Keychain identity uses the local desktop signing name. Refusing an ambiguous signing identity.",
      certificateSha256s,
    });
  }
}

export class LocalDesktopSigningCommandError extends Schema.TaggedError<
  LocalDesktopSigningCommandError,
  { readonly brand: unique symbol }
>()("LocalDesktopSigningCommandError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
  executable: Schema.String,
  args: Schema.Array(Schema.String),
}) {
  override readonly name = "LocalDesktopSigningCommandError";

  static new(
    executable: string,
    args: ReadonlyArray<string>,
    options?: ErrorOptions,
  ): LocalDesktopSigningCommandError {
    return new LocalDesktopSigningCommandError({
      message: `Local desktop signing command failed: ${NodePath.basename(executable)}.`,
      ...options,
      executable,
      args,
    });
  }
}

const isLocalDesktopSigningCommandError = Schema.is(LocalDesktopSigningCommandError);

export type LocalSignedAppValidationReason = LocalSignedAppValidationError["reason"];

export class LocalSignedAppValidationError extends Schema.TaggedError<
  LocalSignedAppValidationError,
  { readonly brand: unique symbol }
>()("LocalSignedAppValidationError", {
  message: Schema.String,
  reason: Schema.Literals([
    "bundle-id",
    "certificate",
    "nested-certificate",
    "designated-requirement-cdhash",
    "designated-requirement-identifier",
    "designated-requirement-certificate",
    "designated-requirement-changed",
  ]),
  codePath: Schema.optional(Schema.String),
}) {
  override readonly name = "LocalSignedAppValidationError";

  static new(
    reason: LocalSignedAppValidationReason,
    codePath?: string | undefined,
  ): LocalSignedAppValidationError {
    const suffix = codePath ? ` (${codePath})` : "";
    return new LocalSignedAppValidationError({
      message: `Local desktop app signature validation failed: ${reason}${suffix}.`,
      reason,
      codePath,
    });
  }
}

export function resolveDesktopSigningMode(
  releaseSigned: boolean,
  localSigned: boolean,
): DesktopSigningMode {
  if (releaseSigned && localSigned) {
    throw DesktopSigningModeConflictError.new();
  }
  if (localSigned) return "local";
  return releaseSigned ? "release" : "unsigned";
}

export function resolveLocalDesktopSigningStatePath(homeDirectory = NodeOS.homedir()): string {
  return NodePath.join(
    homeDirectory,
    "Library",
    "Application Support",
    LOCAL_DESKTOP_SIGNING_STATE_DIRECTORY,
    LOCAL_DESKTOP_SIGNING_STATE_FILE,
  );
}

function normalizeFingerprint(value: string, length: 40 | 64): string | undefined {
  const normalized = value.replaceAll(":", "").trim().toUpperCase();
  return new RegExp(`^[0-9A-F]{${String(length)}}$`, "u").test(normalized) ? normalized : undefined;
}

function normalizeDesignatedRequirement(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function isLocalDesktopSigningState(value: unknown): value is LocalDesktopSigningState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    candidate.commonName === LOCAL_DESKTOP_SIGNING_COMMON_NAME &&
    typeof candidate.keychainPath === "string" &&
    NodePath.isAbsolute(candidate.keychainPath) &&
    typeof candidate.certificateSha1 === "string" &&
    normalizeFingerprint(candidate.certificateSha1, 40) === candidate.certificateSha1 &&
    typeof candidate.certificateSha256 === "string" &&
    normalizeFingerprint(candidate.certificateSha256, 64) === candidate.certificateSha256 &&
    (candidate.designatedRequirement === undefined ||
      (typeof candidate.designatedRequirement === "string" &&
        candidate.designatedRequirement.trim().length > 0))
  );
}

export async function readLocalDesktopSigningState(
  statePath = resolveLocalDesktopSigningStatePath(),
): Promise<LocalDesktopSigningState> {
  let source: string;
  try {
    source = await NodeFSP.readFile(statePath, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      throw LocalDesktopSigningStateMissingError.new(statePath);
    }
    throw LocalDesktopSigningStateInvalidError.new(statePath, { cause });
  }

  try {
    const parsed: unknown = JSON.parse(source);
    if (!isLocalDesktopSigningState(parsed)) {
      throw new Error("state schema mismatch");
    }
    return {
      ...parsed,
      certificateSha1: normalizeFingerprint(parsed.certificateSha1, 40)!,
      certificateSha256: normalizeFingerprint(parsed.certificateSha256, 64)!,
      ...(parsed.designatedRequirement
        ? { designatedRequirement: normalizeDesignatedRequirement(parsed.designatedRequirement) }
        : {}),
    };
  } catch (cause) {
    throw LocalDesktopSigningStateInvalidError.new(statePath, { cause });
  }
}

export async function writeLocalDesktopSigningState(
  state: LocalDesktopSigningState,
  statePath = resolveLocalDesktopSigningStatePath(),
): Promise<void> {
  if (!isLocalDesktopSigningState(state)) {
    throw LocalDesktopSigningStateInvalidError.new(statePath);
  }
  const stateDirectory = NodePath.dirname(statePath);
  await NodeFSP.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${statePath}.${String(process.pid)}.tmp`;
  await NodeFSP.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await NodeFSP.rename(temporaryPath, statePath);
}

export const runLocalDesktopCommand: LocalDesktopCommandRunner = async (
  executable,
  args,
  options,
) => {
  try {
    const output = await execFile(executable, [...args], {
      cwd: options?.cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout: output.stdout, stderr: output.stderr };
  } catch (cause) {
    throw LocalDesktopSigningCommandError.new(executable, args, { cause });
  }
};

export function parseCodeSigningIdentities(output: string): ReadonlyArray<{
  readonly commonName: string;
  readonly certificateSha1: string;
}> {
  const identities: Array<{ commonName: string; certificateSha1: string }> = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = /^\s*\d+\)\s+([0-9A-Fa-f]{40})\s+"([^"]+)"\s*$/u.exec(line);
    if (!match) continue;
    identities.push({
      certificateSha1: match[1]!.toUpperCase(),
      commonName: match[2]!,
    });
  }
  return identities;
}

function certificateCommonName(certificate: NodeCrypto.X509Certificate): string | undefined {
  const match = /(?:^|\n)CN=(.+?)(?:\n|$)/u.exec(certificate.subject);
  return match?.[1];
}

export function parsePemCertificates(
  pemSource: string,
): ReadonlyArray<LocalDesktopSigningIdentity> {
  const certificates: LocalDesktopSigningIdentity[] = [];
  const blocks = pemSource.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu);
  for (const block of blocks ?? []) {
    const certificate = new NodeCrypto.X509Certificate(block);
    const commonName = certificateCommonName(certificate);
    const certificateSha1 = normalizeFingerprint(certificate.fingerprint, 40);
    const certificateSha256 = normalizeFingerprint(certificate.fingerprint256, 64);
    if (!commonName || !certificateSha1 || !certificateSha256) continue;
    certificates.push({ commonName, certificateSha1, certificateSha256 });
  }
  return certificates;
}

export async function inspectLocalDesktopSigningIdentity(
  keychainPath: string,
  runCommand: LocalDesktopCommandRunner = runLocalDesktopCommand,
): Promise<LocalDesktopSigningInspection> {
  const certificateOutputPromise = runCommand("/usr/bin/security", [
    "find-certificate",
    "-a",
    "-p",
    "-c",
    LOCAL_DESKTOP_SIGNING_COMMON_NAME,
    keychainPath,
  ]).catch((error: unknown) => {
    const commandCause = isLocalDesktopSigningCommandError(error)
      ? (error.cause as { readonly code?: string | number } | undefined)
      : undefined;
    // `security find-certificate` uses exit status 44 for an empty result.
    if (commandCause?.code === 44 || commandCause?.code === "44") {
      return { stdout: "", stderr: "" };
    }
    throw error;
  });
  const [identityOutput, certificateOutput] = await Promise.all([
    runCommand("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning", keychainPath]),
    certificateOutputPromise,
  ]);
  const identities = parseCodeSigningIdentities(identityOutput.stdout).filter(
    (identity) => identity.commonName === LOCAL_DESKTOP_SIGNING_COMMON_NAME,
  );
  const certificates = parsePemCertificates(certificateOutput.stdout).filter(
    (certificate) => certificate.commonName === LOCAL_DESKTOP_SIGNING_COMMON_NAME,
  );
  const certificateBySha1 = new Map(
    certificates.map((certificate) => [certificate.certificateSha1, certificate]),
  );

  return {
    identities: identities.flatMap((identity) => {
      const certificate = certificateBySha1.get(identity.certificateSha1);
      return certificate ? [certificate] : [];
    }),
    certificates,
  };
}

export function resolvePinnedLocalDesktopSigningIdentity(
  state: LocalDesktopSigningState,
  inspection: LocalDesktopSigningInspection,
): LocalDesktopSigningIdentity {
  const identities = inspection.identities;
  if (identities.length === 0) {
    const pinnedCertificateStillExists = inspection.certificates.some(
      (certificate) =>
        certificate.certificateSha1 === state.certificateSha1 &&
        certificate.certificateSha256 === state.certificateSha256,
    );
    if (pinnedCertificateStillExists || inspection.certificates.length === 0) {
      throw LocalDesktopSigningIdentityMissingError.new(state.certificateSha256);
    }
    if (inspection.certificates.length > 0) {
      throw LocalDesktopSigningIdentityChangedError.new(
        state.certificateSha256,
        inspection.certificates.map((certificate) => certificate.certificateSha256),
      );
    }
  }
  if (identities.length > 1) {
    throw LocalDesktopSigningIdentityAmbiguousError.new(
      identities.map((identity) => identity.certificateSha256),
    );
  }

  const identity = identities[0]!;
  if (
    identity.certificateSha1 !== state.certificateSha1 ||
    identity.certificateSha256 !== state.certificateSha256
  ) {
    throw LocalDesktopSigningIdentityChangedError.new(state.certificateSha256, [
      identity.certificateSha256,
    ]);
  }
  return identity;
}

export async function assertPinnedLocalDesktopSigningIdentity(options?: {
  readonly statePath?: string | undefined;
  readonly runCommand?: LocalDesktopCommandRunner | undefined;
}): Promise<{
  readonly state: LocalDesktopSigningState;
  readonly identity: LocalDesktopSigningIdentity;
}> {
  const state = await readLocalDesktopSigningState(options?.statePath);
  const inspection = await inspectLocalDesktopSigningIdentity(
    state.keychainPath,
    options?.runCommand,
  );
  return {
    state,
    identity: resolvePinnedLocalDesktopSigningIdentity(state, inspection),
  };
}

export function parseDesignatedRequirement(output: string): string | undefined {
  const match = /(?:^|\n)\s*designated\s*=>\s*(.+?)\s*(?:\n|$)/u.exec(output);
  return match ? normalizeDesignatedRequirement(match[1]!) : undefined;
}

export function certificateFingerprints(certificateDer: Uint8Array): {
  readonly certificateSha1: string;
  readonly certificateSha256: string;
} {
  return {
    certificateSha1: NodeCrypto.createHash("sha1")
      .update(certificateDer)
      .digest("hex")
      .toUpperCase(),
    certificateSha256: NodeCrypto.createHash("sha256")
      .update(certificateDer)
      .digest("hex")
      .toUpperCase(),
  };
}

export function validateLocalSignedAppMetadata(input: {
  readonly state: LocalDesktopSigningState;
  readonly bundleId: string;
  readonly certificateSha1: string;
  readonly certificateSha256: string;
  readonly designatedRequirement: string;
  readonly nestedCode: ReadonlyArray<{
    readonly path: string;
    readonly certificateSha1: string;
    readonly certificateSha256: string;
  }>;
}): string {
  if (input.bundleId !== DESKTOP_FORK_BUNDLE_ID) {
    throw LocalSignedAppValidationError.new("bundle-id");
  }
  if (
    input.certificateSha1 !== input.state.certificateSha1 ||
    input.certificateSha256 !== input.state.certificateSha256
  ) {
    throw LocalSignedAppValidationError.new("certificate");
  }
  for (const code of input.nestedCode) {
    if (
      code.certificateSha1 !== input.state.certificateSha1 ||
      code.certificateSha256 !== input.state.certificateSha256
    ) {
      throw LocalSignedAppValidationError.new("nested-certificate", code.path);
    }
  }

  const designatedRequirement = normalizeDesignatedRequirement(input.designatedRequirement);
  if (/\bcdhash\b/iu.test(designatedRequirement)) {
    throw LocalSignedAppValidationError.new("designated-requirement-cdhash");
  }
  if (!designatedRequirement.includes(`identifier "${DESKTOP_FORK_BUNDLE_ID}"`)) {
    throw LocalSignedAppValidationError.new("designated-requirement-identifier");
  }
  const normalizedRequirement = designatedRequirement.toLowerCase();
  const certificateSha1 = input.state.certificateSha1.toLowerCase();
  const pinsCertificate =
    normalizedRequirement.includes(`anchor h"${certificateSha1}"`) ||
    normalizedRequirement.includes(`certificate root = h"${certificateSha1}"`);
  if (!pinsCertificate) {
    throw LocalSignedAppValidationError.new("designated-requirement-certificate");
  }
  if (
    input.state.designatedRequirement !== undefined &&
    normalizeDesignatedRequirement(input.state.designatedRequirement) !== designatedRequirement
  ) {
    throw LocalSignedAppValidationError.new("designated-requirement-changed");
  }
  return designatedRequirement;
}

export async function pinLocalDesktopDesignatedRequirement(
  state: LocalDesktopSigningState,
  designatedRequirement: string,
  statePath = resolveLocalDesktopSigningStatePath(),
): Promise<LocalDesktopSigningState> {
  const normalized = normalizeDesignatedRequirement(designatedRequirement);
  if (state.designatedRequirement === normalized) return state;
  if (state.designatedRequirement !== undefined) {
    throw LocalSignedAppValidationError.new("designated-requirement-changed");
  }
  const updated = {
    ...state,
    designatedRequirement: normalized,
  } satisfies LocalDesktopSigningState;
  await writeLocalDesktopSigningState(updated, statePath);
  return updated;
}

export function localDesktopCertificateState(
  keychainPath: string,
  identity: LocalDesktopSigningIdentity,
): LocalDesktopSigningState {
  return {
    version: 1,
    commonName: LOCAL_DESKTOP_SIGNING_COMMON_NAME,
    keychainPath,
    certificateSha1: identity.certificateSha1,
    certificateSha256: identity.certificateSha256,
  };
}
