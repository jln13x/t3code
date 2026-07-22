import { useNavigation } from "@react-navigation/native";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { VcsRef } from "@t3tools/contracts";
import {
  parsePullRequestReference,
  resolveChangeRequestPresentation,
} from "@t3tools/shared/sourceControl";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useThemeColor } from "../../lib/useThemeColor";
import { gitEnvironment } from "../../state/git";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { useNewTaskFlow, branchBadgeLabel } from "./new-task-flow-provider";
import { resolveBranchCheckoutMode } from "./newTaskCheckoutSelection";

function sectionLabel(value: string) {
  return (
    <Text className="px-1 text-2xs font-t3-bold tracking-[1px] text-foreground-secondary uppercase">
      {value}
    </Text>
  );
}

function CheckoutRow(props: {
  readonly icon: "arrow.triangle.branch" | "arrow.triangle.pull";
  readonly title: string;
  readonly subtitle: string;
  readonly badge?: string | null;
  readonly disabled?: boolean;
  readonly pending?: boolean;
  readonly selected?: boolean;
  readonly onPress: () => void;
}) {
  const iconColor = useThemeColor("--color-icon");
  const subtleIconColor = useThemeColor("--color-icon-subtle");

  return (
    <Pressable
      accessibilityRole="button"
      className="min-h-[64px] flex-row items-center gap-3 rounded-[18px] border border-border bg-card px-4 py-3 disabled:opacity-[0.45]"
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <View className="h-9 w-9 items-center justify-center rounded-full bg-subtle">
        <SymbolView name={props.icon} size={16} tintColor={iconColor} type="monochrome" />
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className="min-w-0 flex-1 text-base font-t3-bold" numberOfLines={1}>
            {props.title}
          </Text>
          {props.badge ? (
            <Text className="text-2xs font-t3-bold tracking-[0.7px] text-foreground-muted uppercase">
              {props.badge}
            </Text>
          ) : null}
        </View>
        <Text className="text-xs leading-snug text-foreground-muted" numberOfLines={2}>
          {props.subtitle}
        </Text>
      </View>
      {props.pending ? (
        <ActivityIndicator size="small" />
      ) : (
        <SymbolView
          name={props.selected ? "checkmark" : "chevron.right"}
          size={13}
          tintColor={subtleIconColor}
          type="monochrome"
        />
      )}
    </Pressable>
  );
}

function branchSubtitle(branch: VcsRef): string {
  if (branch.current) return "Use the project's current checkout";
  if (branch.worktreePath) return "Reuse the existing worktree checkout";
  if (branch.isRemote) return "Create a new worktree from this remote branch";
  return "Create a new worktree from this branch";
}

export function NewTaskCheckoutScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const flow = useNewTaskFlow();
  const [preparingReference, setPreparingReference] = useState<string | null>(null);
  const selectedProject = flow.selectedProject;
  const query = flow.branchQuery.trim();
  const normalizedQuery = query.toLowerCase();
  const parsedReference = parsePullRequestReference(query);
  const filteredBranches = useMemo(() => {
    if (!normalizedQuery) return flow.checkoutBranches;
    return flow.checkoutBranches.filter((branch) =>
      branch.name.toLowerCase().includes(normalizedQuery),
    );
  }, [flow.checkoutBranches, normalizedQuery]);
  const preparePullRequest = useAtomCommand(gitEnvironment.preparePullRequestThread, {
    reportFailure: false,
  });
  const gitStatus = useEnvironmentQuery(
    selectedProject
      ? vcsEnvironment.status({
          environmentId: selectedProject.environmentId,
          input: { cwd: selectedProject.workspaceRoot },
        })
      : null,
  );
  const currentBranch =
    flow.availableBranches.find((branch) => branch.current) ??
    flow.availableBranches.find((branch) => branch.isDefault) ??
    null;
  const sourceControlPresentation = resolveChangeRequestPresentation(
    gitStatus.data?.sourceControlProvider,
  );

  const selectBranch = (branch: VcsRef) => {
    flow.selectBranch(branch, resolveBranchCheckoutMode(branch));
    flow.setBranchQuery("");
    navigation.goBack();
  };

  const selectPullRequest = async (reference: string) => {
    if (!selectedProject || preparingReference !== null) return;
    setPreparingReference(reference);
    const result = await preparePullRequest({
      environmentId: selectedProject.environmentId,
      input: {
        cwd: selectedProject.workspaceRoot,
        reference,
        mode: "worktree",
      },
    });
    setPreparingReference(null);

    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        Alert.alert(
          `Unable to prepare ${sourceControlPresentation.shortName}`,
          error instanceof Error
            ? error.message
            : `The ${sourceControlPresentation.longName} could not be prepared.`,
        );
      }
      return;
    }

    flow.selectPreparedCheckout({
      branch: result.value.branch,
      worktreePath: result.value.worktreePath,
      changeRequest: result.value.changeRequest,
    });
    flow.setBranchQuery("");
    navigation.goBack();
  };

  const refreshing = flow.branchesLoading && flow.checkoutBranches.length === 0;

  return (
    <View className="flex-1 bg-sheet">
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentInset={{ bottom: Math.max(insets.bottom, 18) + 18 }}
        contentContainerClassName="gap-5 px-5 pt-3"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void flow.loadBranches();
              gitStatus.refresh();
            }}
          />
        }
      >
        <View className="gap-2">
          <TextInput
            accessibilityLabel="Search branches or pull requests"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Search branches, or enter a PR URL or #"
            returnKeyType="search"
            value={flow.branchQuery}
            onChangeText={flow.setBranchQuery}
          />
          <Text className="px-1 text-xs leading-snug text-foreground-muted">
            Existing checkouts are reused. Other branches and pull requests open in a new worktree.
          </Text>
        </View>

        {parsedReference ? (
          <View className="gap-2">
            {sectionLabel(`Open ${sourceControlPresentation.shortName}`)}
            <CheckoutRow
              icon="arrow.triangle.pull"
              title={`Checkout ${query.startsWith("#") ? query : `#${parsedReference}`}`}
              subtitle={`Resolve and open this ${sourceControlPresentation.longName} in a new worktree`}
              disabled={preparingReference !== null}
              pending={preparingReference === parsedReference}
              onPress={() => void selectPullRequest(parsedReference)}
            />
          </View>
        ) : null}

        <View className="gap-2">
          {sectionLabel("Branches")}
          {flow.branchesLoading && flow.availableBranches.length === 0 ? (
            <View className="items-center py-4">
              <ActivityIndicator />
            </View>
          ) : null}
          {!flow.branchesLoading && filteredBranches.length === 0 ? (
            <Text className="px-1 text-sm text-foreground-muted">No matching branches.</Text>
          ) : null}
          {filteredBranches.map((branch) => {
            const selected =
              flow.selectedBranchName === branch.name &&
              (flow.selectedWorktreePath ?? null) ===
                (branch.worktreePath === selectedProject?.workspaceRoot
                  ? null
                  : branch.worktreePath);
            return (
              <CheckoutRow
                key={`${branch.isRemote ? "remote" : "local"}:${branch.name}`}
                icon="arrow.triangle.branch"
                title={branch.name}
                subtitle={branchSubtitle(branch)}
                badge={branchBadgeLabel({ branch, project: selectedProject })}
                disabled={preparingReference !== null}
                selected={
                  selected || (flow.selectedBranchName === null && branch === currentBranch)
                }
                onPress={() => selectBranch(branch)}
              />
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
