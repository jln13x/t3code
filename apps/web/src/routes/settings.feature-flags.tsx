import { createFileRoute } from "@tanstack/react-router";

import { PersonalFeatureFlagsSettingsPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/feature-flags")({
  component: PersonalFeatureFlagsSettingsPanel,
});
