#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off

import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  assertPinnedLocalDesktopSigningIdentity,
  certificateFingerprints,
  inspectLocalDesktopSigningIdentity,
  LOCAL_DESKTOP_SIGNING_COMMON_NAME,
  LocalDesktopSigningIdentityAmbiguousError,
  LocalDesktopSigningIdentityMissingError,
  LocalDesktopSigningStateMissingError,
  localDesktopCertificateState,
  readLocalDesktopSigningState,
  resolveLocalDesktopSigningStatePath,
  runLocalDesktopCommand,
  writeLocalDesktopSigningState,
} from "./lib/local-desktop-signing.ts";

function parseDefaultKeychainPath(output: string): string {
  const trimmed = output.trim();
  const keychainPath =
    trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  if (!NodePath.isAbsolute(keychainPath)) {
    throw new Error("The default user Keychain path could not be resolved.");
  }
  return keychainPath;
}

async function defaultUserKeychainPath(): Promise<string> {
  const output = await runLocalDesktopCommand("/usr/bin/security", [
    "default-keychain",
    "-d",
    "user",
  ]);
  return parseDefaultKeychainPath(output.stdout);
}

function certificateConfiguration(): string {
  return `[req]
distinguished_name = identity
prompt = no

[identity]
CN = ${LOCAL_DESKTOP_SIGNING_COMMON_NAME}
O = T3 Code Personal Fork
OU = Machine Local Signing

[extended]
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
`;
}

async function removePartiallyCreatedIdentity(
  keychainPath: string,
  certificateSha1: string,
): Promise<void> {
  for (const args of [
    ["delete-identity", "-Z", certificateSha1, keychainPath],
    ["delete-certificate", "-Z", certificateSha1, keychainPath],
  ]) {
    await runLocalDesktopCommand("/usr/bin/security", args).catch(() => undefined);
  }
}

async function createIdentity(keychainPath: string): Promise<void> {
  const temporaryDirectory = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "t3code-local-signing-"),
  );
  const configPath = NodePath.join(temporaryDirectory, "codesign.cnf");
  const privateKeyPath = NodePath.join(temporaryDirectory, "private.pem");
  const certificatePemPath = NodePath.join(temporaryDirectory, "certificate.pem");
  const certificateDerPath = NodePath.join(temporaryDirectory, "certificate.cer");
  let certificateSha1: string | undefined;

  try {
    await NodeFSP.writeFile(configPath, certificateConfiguration(), { mode: 0o600 });
    await runLocalDesktopCommand("/usr/bin/openssl", [
      "req",
      "-newkey",
      "rsa:3072",
      "-nodes",
      "-keyout",
      privateKeyPath,
      "-x509",
      "-sha256",
      "-days",
      "7300",
      "-out",
      certificatePemPath,
      "-extensions",
      "extended",
      "-config",
      configPath,
    ]);
    await runLocalDesktopCommand("/usr/bin/openssl", [
      "x509",
      "-inform",
      "PEM",
      "-in",
      certificatePemPath,
      "-outform",
      "DER",
      "-out",
      certificateDerPath,
    ]);
    certificateSha1 = certificateFingerprints(
      await NodeFSP.readFile(certificateDerPath),
    ).certificateSha1;

    // Trust and key access are deliberately scoped to the user's default
    // Keychain and /usr/bin/codesign. No certificate material enters the repo.
    await runLocalDesktopCommand("/usr/bin/security", [
      "add-trusted-cert",
      "-r",
      "trustRoot",
      "-k",
      keychainPath,
      certificateDerPath,
    ]);
    await runLocalDesktopCommand("/usr/bin/security", [
      "import",
      privateKeyPath,
      "-k",
      keychainPath,
      "-T",
      "/usr/bin/codesign",
    ]);
  } catch (error) {
    if (certificateSha1) {
      await removePartiallyCreatedIdentity(keychainPath, certificateSha1);
    }
    throw error;
  } finally {
    await NodeFSP.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function setupLocalDesktopSigning(): Promise<{
  readonly created: boolean;
  readonly statePath: string;
  readonly certificateSha256: string;
}> {
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone maintainer entry point has no Effect runtime.
  if (process.platform !== "darwin") {
    throw new Error("Local desktop signing setup must run on macOS.");
  }
  if (process.argv.length > 2) {
    throw new Error("setup:desktop:signing does not accept certificate replacement flags.");
  }

  const statePath = resolveLocalDesktopSigningStatePath();
  try {
    await readLocalDesktopSigningState(statePath);
    const pinned = await assertPinnedLocalDesktopSigningIdentity({ statePath });
    return {
      created: false,
      statePath,
      certificateSha256: pinned.identity.certificateSha256,
    };
  } catch (error) {
    if (!(error instanceof LocalDesktopSigningStateMissingError)) {
      throw error;
    }
  }

  const keychainPath = await defaultUserKeychainPath();
  let inspection = await inspectLocalDesktopSigningIdentity(keychainPath);
  if (inspection.identities.length > 1) {
    throw new LocalDesktopSigningIdentityAmbiguousError(
      inspection.identities.map((identity) => identity.certificateSha256),
    );
  }
  if (inspection.identities.length === 0 && inspection.certificates.length > 0) {
    throw new LocalDesktopSigningIdentityMissingError(
      inspection.certificates[0]!.certificateSha256,
    );
  }

  let created = false;
  if (inspection.identities.length === 0) {
    await createIdentity(keychainPath);
    created = true;
    inspection = await inspectLocalDesktopSigningIdentity(keychainPath);
  }

  if (inspection.identities.length !== 1) {
    throw new Error("The local desktop signing identity was not valid after Keychain setup.");
  }
  const identity = inspection.identities[0]!;
  await writeLocalDesktopSigningState(
    localDesktopCertificateState(keychainPath, identity),
    statePath,
  );
  return { created, statePath, certificateSha256: identity.certificateSha256 };
}

if (import.meta.main) {
  setupLocalDesktopSigning().then(
    (result) => {
      const action = result.created ? "Created and pinned" : "Verified";
      console.log(`${action} ${LOCAL_DESKTOP_SIGNING_COMMON_NAME}.`);
      console.log(`State: ${result.statePath}`);
      console.log(`Certificate SHA-256: ${result.certificateSha256}`);
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
