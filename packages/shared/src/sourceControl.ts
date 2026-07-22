import type {
  ChangeRequestAssociation,
  SourceControlProviderInfo,
  SourceControlProviderKind,
  VcsStatusResult,
} from "@t3tools/contracts";

const GITHUB_PULL_REQUEST_URL_PATTERN =
  /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)(?:[/?#].*)?$/i;
const GITLAB_MERGE_REQUEST_URL_PATTERN =
  /^https:\/\/[^/\s]*gitlab[^/\s]*\/.+\/-\/merge_requests\/(\d+)(?:[/?#].*)?$/i;
const AZURE_DEVOPS_PULL_REQUEST_URL_PATTERN =
  /^https:\/\/(?:dev\.azure\.com\/[^/\s]+\/[^/\s]+|[^/\s]+\.visualstudio\.com\/[^/\s]+)\/_git\/[^/\s]+\/pullrequest\/(\d+)(?:[/?#].*)?$/i;
const PULL_REQUEST_NUMBER_PATTERN = /^#?(\d+)$/;
const GITHUB_CLI_PR_CHECKOUT_PATTERN = /^gh\s+pr\s+checkout\s+(.+)$/i;
const GITLAB_CLI_MR_CHECKOUT_PATTERN = /^glab\s+mr\s+checkout\s+(.+)$/i;
const AZURE_DEVOPS_CLI_PR_CHECKOUT_PATTERN = /^az\s+repos\s+pr\s+checkout\s+(.+)$/i;

function parseAzureDevOpsCheckoutReference(args: string): string | null {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  for (const [index, part] of parts.entries()) {
    if (part === "--id" || part === "-i") {
      return parts[index + 1] ?? null;
    }
    if (part.startsWith("--id=")) {
      return part.slice("--id=".length) || null;
    }
  }
  return parts.find((part) => !part.startsWith("-")) ?? null;
}

export function parsePullRequestReference(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const ghCliCheckoutMatch = GITHUB_CLI_PR_CHECKOUT_PATTERN.exec(trimmed);
  const glabCliCheckoutMatch = GITLAB_CLI_MR_CHECKOUT_PATTERN.exec(trimmed);
  const azureDevOpsCliCheckoutMatch = AZURE_DEVOPS_CLI_PR_CHECKOUT_PATTERN.exec(trimmed);
  const normalizedInput =
    ghCliCheckoutMatch?.[1]?.trim() ??
    glabCliCheckoutMatch?.[1]?.trim() ??
    (azureDevOpsCliCheckoutMatch?.[1]
      ? parseAzureDevOpsCheckoutReference(azureDevOpsCliCheckoutMatch[1])
      : null) ??
    trimmed;
  if (normalizedInput.length === 0) return null;

  const urlMatch =
    GITHUB_PULL_REQUEST_URL_PATTERN.exec(normalizedInput) ??
    GITLAB_MERGE_REQUEST_URL_PATTERN.exec(normalizedInput) ??
    AZURE_DEVOPS_PULL_REQUEST_URL_PATTERN.exec(normalizedInput);
  if (urlMatch?.[1]) return normalizedInput;

  return PULL_REQUEST_NUMBER_PATTERN.exec(normalizedInput)?.[1] ?? null;
}

export interface ThreadChangeRequestStatusInput {
  readonly threadBranch: string | null;
  readonly changeRequest?: ChangeRequestAssociation;
  readonly gitStatus: VcsStatusResult | null;
  readonly durableChangeRequestStatusEnabled: boolean;
}

function normalizeChangeRequestUrl(url: string): string {
  return url.trim().replace(/\/+$/u, "");
}

function statusMatchesChangeRequest(
  status: NonNullable<VcsStatusResult["pr"]>,
  changeRequest: ChangeRequestAssociation,
): boolean {
  return (
    status.number === changeRequest.number &&
    normalizeChangeRequestUrl(status.url) === normalizeChangeRequestUrl(changeRequest.url)
  );
}

function storedChangeRequestStatus(
  changeRequest: ChangeRequestAssociation,
): NonNullable<VcsStatusResult["pr"]> {
  return {
    number: changeRequest.number,
    title: changeRequest.title,
    url: changeRequest.url,
    baseRef: changeRequest.baseRefName,
    headRef: changeRequest.headRefName,
    state: changeRequest.state,
    stale: true,
  };
}

/**
 * Whether a thread has enough identity to request source-control status.
 *
 * Inferred status remains branch-bound. A durable association is sufficient
 * without a branch, but only while the fork-specific feature is enabled.
 */
export function shouldQueryThreadVcsStatus(
  input: Pick<
    ThreadChangeRequestStatusInput,
    "threadBranch" | "changeRequest" | "durableChangeRequestStatusEnabled"
  >,
): boolean {
  return (
    input.threadBranch !== null ||
    (input.durableChangeRequestStatusEnabled && input.changeRequest !== undefined)
  );
}

/**
 * Resolve the PR/MR shown for a thread without conflating durable identity
 * with the currently checked-out branch.
 *
 * Explicit associations may render from their persisted snapshot before a
 * refresh completes or when no local repository is available. Inferred
 * results still require an exact checked-out branch match.
 */
export function resolveThreadChangeRequestStatus(
  input: ThreadChangeRequestStatusInput,
): VcsStatusResult["pr"] {
  const explicitChangeRequest = input.durableChangeRequestStatusEnabled
    ? input.changeRequest
    : undefined;
  if (explicitChangeRequest) {
    const refreshed = input.gitStatus?.pr;
    return refreshed && statusMatchesChangeRequest(refreshed, explicitChangeRequest)
      ? refreshed
      : storedChangeRequestStatus(explicitChangeRequest);
  }

  if (
    input.threadBranch === null ||
    input.gitStatus === null ||
    input.gitStatus.refName !== input.threadBranch ||
    (input.gitStatus.changeRequestRefName !== undefined &&
      input.gitStatus.changeRequestRefName !== input.threadBranch)
  ) {
    return null;
  }

  return input.gitStatus.pr ?? null;
}

export function resolveThreadChangeRequestProviderKind(
  input: Pick<
    ThreadChangeRequestStatusInput,
    "changeRequest" | "gitStatus" | "durableChangeRequestStatusEnabled"
  >,
): SourceControlProviderKind | null {
  return (
    (input.durableChangeRequestStatusEnabled ? input.changeRequest?.provider : undefined) ??
    input.gitStatus?.sourceControlProvider?.kind ??
    null
  );
}

export interface ChangeRequestPresentation {
  readonly icon: "github" | "gitlab" | "azure-devops" | "bitbucket" | "change-request";
  readonly providerName: string;
  readonly shortName: string;
  readonly longName: string;
  readonly pluralLongName: string;
  readonly providerLongName: string;
  readonly checkoutCommandExample?: string;
  readonly urlExample: string;
}

export interface ChangeRequestTerminology {
  readonly shortLabel: string;
  readonly singular: string;
}

export const DEFAULT_CHANGE_REQUEST_TERMINOLOGY: ChangeRequestTerminology = {
  shortLabel: "PR",
  singular: "pull request",
};

const GITHUB_CHANGE_REQUEST_PRESENTATION: ChangeRequestPresentation = {
  icon: "github",
  providerName: "GitHub",
  shortName: "PR",
  longName: "pull request",
  pluralLongName: "pull requests",
  providerLongName: "GitHub pull request",
  checkoutCommandExample: "gh pr checkout 123",
  urlExample: "https://github.com/owner/repo/pull/42",
};

const GITLAB_CHANGE_REQUEST_PRESENTATION: ChangeRequestPresentation = {
  icon: "gitlab",
  providerName: "GitLab",
  shortName: "MR",
  longName: "merge request",
  pluralLongName: "merge requests",
  providerLongName: "GitLab merge request",
  checkoutCommandExample: "glab mr checkout 123",
  urlExample: "https://gitlab.com/group/project/-/merge_requests/42",
};

const AZURE_DEVOPS_CHANGE_REQUEST_PRESENTATION: ChangeRequestPresentation = {
  icon: "azure-devops",
  providerName: "Azure DevOps",
  shortName: "PR",
  longName: "pull request",
  pluralLongName: "pull requests",
  providerLongName: "Azure DevOps pull request",
  checkoutCommandExample: "az repos pr checkout --id 123",
  urlExample: "https://dev.azure.com/org/project/_git/repo/pullrequest/42",
};

const BITBUCKET_CHANGE_REQUEST_PRESENTATION: ChangeRequestPresentation = {
  icon: "bitbucket",
  providerName: "Bitbucket",
  shortName: "PR",
  longName: "pull request",
  pluralLongName: "pull requests",
  providerLongName: "Bitbucket pull request",
  urlExample: "https://bitbucket.org/workspace/repo/pull-requests/42",
};

const GENERIC_CHANGE_REQUEST_PRESENTATION: ChangeRequestPresentation = {
  icon: "change-request",
  providerName: "source control",
  shortName: "change request",
  longName: "change request",
  pluralLongName: "change requests",
  providerLongName: "change request",
  urlExample: "#42",
};

export function resolveChangeRequestPresentation(
  provider: SourceControlProviderInfo | SourceControlProviderKind | null | undefined,
): ChangeRequestPresentation {
  switch (typeof provider === "string" ? provider : provider?.kind) {
    case "github":
    case undefined:
      return GITHUB_CHANGE_REQUEST_PRESENTATION;
    case "gitlab":
      return GITLAB_CHANGE_REQUEST_PRESENTATION;
    case "azure-devops":
      return AZURE_DEVOPS_CHANGE_REQUEST_PRESENTATION;
    case "bitbucket":
      return BITBUCKET_CHANGE_REQUEST_PRESENTATION;
    case "unknown":
      return GENERIC_CHANGE_REQUEST_PRESENTATION;
  }
}

export function resolveChangeRequestPresentationForKind(
  kind: SourceControlProviderKind,
): ChangeRequestPresentation {
  return resolveChangeRequestPresentation({ kind, name: "", baseUrl: "" });
}

export function formatChangeRequestAction(
  verb: "View" | "Create",
  presentation: ChangeRequestPresentation,
): string {
  return `${verb} ${presentation.shortName}`;
}

export function formatCreateChangeRequestPhrase(presentation: ChangeRequestPresentation): string {
  return `create ${presentation.shortName}`;
}

export function getChangeRequestTerminology(
  provider: SourceControlProviderInfo | null | undefined,
): ChangeRequestTerminology {
  if (!provider) {
    return DEFAULT_CHANGE_REQUEST_TERMINOLOGY;
  }

  const presentation = resolveChangeRequestPresentation(provider);
  return {
    shortLabel: presentation.shortName,
    singular: presentation.longName,
  };
}

export function getChangeRequestTerminologyForKind(
  kind: SourceControlProviderKind,
): ChangeRequestTerminology {
  const presentation = resolveChangeRequestPresentationForKind(kind);
  return {
    shortLabel: presentation.shortName,
    singular: presentation.longName,
  };
}

function parseRemoteHost(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith("git@")) {
    const hostWithPath = trimmed.slice("git@".length);
    const separatorIndex = hostWithPath.search(/[:/]/);
    if (separatorIndex <= 0) {
      return null;
    }
    return hostWithPath.slice(0, separatorIndex).toLowerCase();
  }

  try {
    return new URL(trimmed).host.toLowerCase();
  } catch {
    return null;
  }
}

function parseHostName(host: string): string {
  try {
    return new URL(`https://${host}`).hostname.toLowerCase();
  } catch {
    return host.replace(/:\d+$/u, "").toLowerCase();
  }
}

function toBaseUrl(host: string): string {
  return `https://${host}`;
}

function isGitHubHost(host: string): boolean {
  return host === "github.com" || host.includes("github");
}

function isGitLabHost(host: string): boolean {
  return host === "gitlab.com" || host.includes("gitlab");
}

function isAzureDevOpsHost(host: string): boolean {
  return host === "dev.azure.com" || host.endsWith(".visualstudio.com");
}

function isBitbucketHost(host: string): boolean {
  return host === "bitbucket.org" || host.includes("bitbucket");
}

export function detectSourceControlProviderFromRemoteUrl(
  remoteUrl: string,
): SourceControlProviderInfo | null {
  const host = parseRemoteHost(remoteUrl);
  if (!host) {
    return null;
  }
  const hostname = parseHostName(host);

  if (isGitHubHost(hostname)) {
    return {
      kind: "github",
      name: hostname === "github.com" ? "GitHub" : "GitHub Self-Hosted",
      baseUrl: toBaseUrl(host),
    };
  }

  if (isGitLabHost(hostname)) {
    return {
      kind: "gitlab",
      name: hostname === "gitlab.com" ? "GitLab" : "GitLab Self-Hosted",
      baseUrl: toBaseUrl(host),
    };
  }

  if (isAzureDevOpsHost(hostname)) {
    return {
      kind: "azure-devops",
      name: "Azure DevOps",
      baseUrl: toBaseUrl(host),
    };
  }

  if (isBitbucketHost(hostname)) {
    return {
      kind: "bitbucket",
      name: hostname === "bitbucket.org" ? "Bitbucket" : "Bitbucket Self-Hosted",
      baseUrl: toBaseUrl(host),
    };
  }

  return {
    kind: "unknown",
    name: host,
    baseUrl: toBaseUrl(host),
  };
}
