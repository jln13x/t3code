import {
  createVcsActionManager,
  createVcsEnvironmentAtoms,
} from "@t3tools/client-runtime/state/vcs";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

export const vcsEnvironment = createVcsEnvironmentAtoms(connectionAtomRuntime);
export const vcsActionManager = createVcsActionManager(connectionAtomRuntime);

/**
 * Branch handoff needs a bounded lookup so a Git failure reaches its progress
 * toast instead of entering the retrying branch-list cache used by pickers.
 */
export const listVcsRefsOnce = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "web:vcs:list-refs-once",
  tag: WS_METHODS.vcsListRefs,
});
