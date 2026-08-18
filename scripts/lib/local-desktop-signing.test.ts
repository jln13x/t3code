import { assert, it } from "@effect/vitest";

import {
  DesktopSigningModeConflictError,
  LOCAL_DESKTOP_SIGNING_COMMON_NAME,
  LocalDesktopSigningIdentityAmbiguousError,
  LocalDesktopSigningIdentityChangedError,
  LocalDesktopSigningIdentityMissingError,
  type LocalDesktopSigningIdentity,
  type LocalDesktopSigningState,
  LocalSignedAppValidationError,
  parseCodeSigningIdentities,
  parseDesignatedRequirement,
  resolveDesktopSigningMode,
  resolvePinnedLocalDesktopSigningIdentity,
  validateLocalSignedAppMetadata,
} from "./local-desktop-signing.ts";

const SHA1_A = "A".repeat(40);
const SHA256_A = "A".repeat(64);
const SHA1_B = "B".repeat(40);
const SHA256_B = "B".repeat(64);
const REQUIREMENT =
  'identifier "com.t3tools.t3code.fork" and anchor H"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"';
const ROOT_REQUIREMENT =
  'identifier "com.t3tools.t3code.fork" and certificate root = H"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"';

const pinnedState: LocalDesktopSigningState = {
  version: 1,
  commonName: LOCAL_DESKTOP_SIGNING_COMMON_NAME,
  keychainPath: "/tmp/login.keychain-db",
  certificateSha1: SHA1_A,
  certificateSha256: SHA256_A,
};

const pinnedIdentity: LocalDesktopSigningIdentity = {
  commonName: LOCAL_DESKTOP_SIGNING_COMMON_NAME,
  certificateSha1: SHA1_A,
  certificateSha256: SHA256_A,
};

it("resolves unsigned, release, and local signing as mutually exclusive modes", () => {
  assert.equal(resolveDesktopSigningMode(false, false), "unsigned");
  assert.equal(resolveDesktopSigningMode(true, false), "release");
  assert.equal(resolveDesktopSigningMode(false, true), "local");
  assert.throws(() => resolveDesktopSigningMode(true, true), DesktopSigningModeConflictError);
});

it("parses valid Keychain code-signing identities without summary lines", () => {
  assert.deepStrictEqual(
    parseCodeSigningIdentities(`  1) ${SHA1_A} "${LOCAL_DESKTOP_SIGNING_COMMON_NAME}"
     1 valid identities found
`),
    [{ commonName: LOCAL_DESKTOP_SIGNING_COMMON_NAME, certificateSha1: SHA1_A }],
  );
});

it("requires the exact pinned Keychain certificate and warns on deletion or replacement", () => {
  assert.deepStrictEqual(
    resolvePinnedLocalDesktopSigningIdentity(pinnedState, {
      identities: [pinnedIdentity],
      certificates: [pinnedIdentity],
    }),
    pinnedIdentity,
  );

  assert.throws(
    () =>
      resolvePinnedLocalDesktopSigningIdentity(pinnedState, {
        identities: [],
        certificates: [],
      }),
    LocalDesktopSigningIdentityMissingError,
  );
  assert.throws(
    () =>
      resolvePinnedLocalDesktopSigningIdentity(pinnedState, {
        identities: [],
        certificates: [pinnedIdentity],
      }),
    LocalDesktopSigningIdentityMissingError,
  );

  const replacement = {
    ...pinnedIdentity,
    certificateSha1: SHA1_B,
    certificateSha256: SHA256_B,
  };
  assert.throws(
    () =>
      resolvePinnedLocalDesktopSigningIdentity(pinnedState, {
        identities: [replacement],
        certificates: [replacement],
      }),
    LocalDesktopSigningIdentityChangedError,
  );
  assert.throws(
    () =>
      resolvePinnedLocalDesktopSigningIdentity(pinnedState, {
        identities: [],
        certificates: [replacement],
      }),
    LocalDesktopSigningIdentityChangedError,
  );
  assert.throws(
    () =>
      resolvePinnedLocalDesktopSigningIdentity(pinnedState, {
        identities: [pinnedIdentity, replacement],
        certificates: [pinnedIdentity, replacement],
      }),
    LocalDesktopSigningIdentityAmbiguousError,
  );
});

it("extracts and normalizes the designated requirement emitted by codesign", () => {
  assert.equal(
    parseDesignatedRequirement(`Executable=/tmp/T3 Code (Fork).app
designated => identifier "com.t3tools.t3code.fork"   and certificate root = H"${SHA1_A.toLowerCase()}"
`),
    ROOT_REQUIREMENT,
  );
});

it("validates bundle identity, certificate pinning, nested code, and stable requirements", () => {
  assert.equal(
    validateLocalSignedAppMetadata({
      state: pinnedState,
      bundleId: "com.t3tools.t3code.fork",
      certificateSha1: SHA1_A,
      certificateSha256: SHA256_A,
      designatedRequirement: REQUIREMENT,
      nestedCode: [
        {
          path: "Contents/Frameworks/Electron Framework.framework/Electron Framework",
          certificateSha1: SHA1_A,
          certificateSha256: SHA256_A,
        },
      ],
    }),
    REQUIREMENT,
  );
  assert.equal(
    validateLocalSignedAppMetadata({
      state: pinnedState,
      bundleId: "com.t3tools.t3code.fork",
      certificateSha1: SHA1_A,
      certificateSha256: SHA256_A,
      designatedRequirement: ROOT_REQUIREMENT,
      nestedCode: [],
    }),
    ROOT_REQUIREMENT,
  );

  const captureReason = (input: Parameters<typeof validateLocalSignedAppMetadata>[0]) => {
    try {
      validateLocalSignedAppMetadata(input);
      return assert.fail("Expected local signature validation to fail.");
    } catch (error) {
      assert.instanceOf(error, LocalSignedAppValidationError);
      return error.reason;
    }
  };
  const validInput = {
    state: pinnedState,
    bundleId: "com.t3tools.t3code.fork",
    certificateSha1: SHA1_A,
    certificateSha256: SHA256_A,
    designatedRequirement: REQUIREMENT,
    nestedCode: [],
  };
  assert.equal(
    captureReason({
      ...validInput,
      designatedRequirement: `identifier "com.t3tools.t3code.fork" and cdhash H"1234"`,
    }),
    "designated-requirement-cdhash",
  );
  assert.equal(
    captureReason({
      ...validInput,
      designatedRequirement: `identifier "com.t3tools.t3code.fork" and certificate root = H"${SHA1_B}"`,
    }),
    "designated-requirement-certificate",
  );
  assert.equal(
    captureReason({
      ...validInput,
      nestedCode: [
        {
          path: "Contents/Resources/native.node",
          certificateSha1: SHA1_B,
          certificateSha256: SHA256_B,
        },
      ],
    }),
    "nested-certificate",
  );
  assert.equal(
    captureReason({
      ...validInput,
      state: { ...pinnedState, designatedRequirement: `${REQUIREMENT} and true` },
    }),
    "designated-requirement-changed",
  );
});
