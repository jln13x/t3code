import {
  createAssetEnvironmentAtoms,
  createProjectFaviconUrlAtomFamily,
} from "@t3tools/client-runtime/state/assets";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { projectFaviconCache } from "../assets/projectFaviconCache";
import { environmentSession } from "./session";

export const assetEnvironment = createAssetEnvironmentAtoms(connectionAtomRuntime);
export const createAssetUrlOnce = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "web:assets:create-url-once",
  tag: WS_METHODS.assetsCreateUrl,
});

export const projectFaviconUrlAtom = createProjectFaviconUrlAtomFamily({
  imageCache: projectFaviconCache,
  createUrl: assetEnvironment.createUrl,
  preparedConnection: environmentSession.preparedConnectionValueAtom,
});
