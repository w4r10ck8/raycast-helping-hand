export type AzureConnection = {
  id: string;
  name: string;
  orgUrl: string;
  project: string;
  pat: string;
  /** Board (team) whose areas limit searches and whose sprints `sprint:current` uses. Blank = whole project. */
  team?: string;
  /** Used when a prompt doesn't say which connection to use. */
  default?: boolean;
};

export type WorkItem = {
  id: number;
  title: string;
  type: string;
  state: string;
  assignedTo?: string;
  iteration?: string;
  changedBy?: string;
  /** ISO timestamp of the last change. */
  changedDate?: string;
  tags: Array<string>;
  description: string;
  acceptanceCriteria: string;
  url: string;
};

export const CONNECTIONS_KEY = "azureConnections";

async function request<T>(
  { orgUrl, pat }: Pick<AzureConnection, "orgUrl" | "pat">,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${orgUrl.replace(/\/+$/, "")}/${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    redirect: "manual", // an invalid PAT redirects to the sign-in page instead of returning 401
    signal: init?.signal ?? AbortSignal.timeout(15_000),
  });
  if (response.status === 401 || response.status === 203 || (response.status >= 300 && response.status < 400))
    throw new Error("Token rejected — check it hasn't expired");
  if (response.status === 404) throw new Error("Not found — check the organisation URL, project and team");
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new Error(body?.message ?? `Azure DevOps returned ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Checks the org URL and PAT work, returning the signed-in user's display name. */
export async function testConnection(connection: AzureConnection): Promise<string> {
  const data = await request<{ authenticatedUser?: { providerDisplayName?: string } }>(
    connection,
    "_apis/connectionData",
  );
  return data.authenticatedUser?.providerDisplayName ?? "you";
}

export type PullRequest = {
  /** ISO timestamp the PR was opened. */
  createdDate?: string;
  id: number;
  title: string;
  repo: string;
  repoId: string;
  author: string;
  status: string;
  sourceBranch: string;
  targetBranch: string;
  description: string;
  url: string;
};

/** `4821`, `#4821` or a pasted `…/_workitems/edit/4821` link → 4821. */
export function parseWorkItemId(text: string): number | undefined {
  const match = text.trim().match(/^#?(\d+)$/) ?? text.match(/_workitems\/edit\/(\d+)/);
  return match ? Number(match[1]) : undefined;
}

export type Filters = {
  assignee?: string;
  type?: Array<string>;
  state?: Array<string>;
  sprint?: string;
  area?: string;
  parent?: number;
  tag?: Array<string>;
};

export type BoardQuery =
  { kind: "pr"; id?: number; text: string } | { kind: "workItem"; id?: number; text: string; filters: Filters };

const TOKEN = /(?:^|\s)(?:@(\S*)|(type|state|sprint|area|parent|tag):(?:"([^"]*)"|(\S+)))/gi;

/**
 * `!123`/PR link → PR, `!text` → PR titles. Otherwise pulls out `@name` and `key:value` filter tokens
 * (`type:bug,story state:active sprint:current area:X parent:1 tag:a,b`) and treats the rest as an ID or title.
 */
export function parseQuery(input: string): BoardQuery {
  const text = input.trim();
  const prLink = text.match(/\/pullrequest\/(\d+)/);
  if (prLink) return { kind: "pr", id: Number(prLink[1]), text: "" };
  if (text.startsWith("!")) {
    const rest = text.slice(1).trim();
    return /^\d+$/.test(rest) ? { kind: "pr", id: Number(rest), text: "" } : { kind: "pr", text: rest };
  }
  const filters: Filters = {};
  const rest = text
    .replace(TOKEN, (_, assignee?: string, rawKey?: string, quoted?: string, plain?: string) => {
      const key = rawKey?.toLowerCase();
      const value = (quoted ?? plain ?? "").trim();
      const list = value
        .split(",")
        .map((each) => each.trim())
        .filter(Boolean);
      if (assignee) filters.assignee = assignee;
      else if ((key === "type" || key === "state" || key === "tag") && list.length) filters[key] = list;
      else if ((key === "sprint" || key === "area") && value) filters[key] = value;
      else if (key === "parent" && /^#?\d+$/.test(value)) filters.parent = Number(value.replace("#", ""));
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { kind: "workItem", id: parseWorkItemId(rest), text: rest, filters };
}

/** Boards (teams) in the project that the token's user belongs to. */
export async function listMyTeams(
  connection: Pick<AzureConnection, "orgUrl" | "project" | "pat">,
  signal?: AbortSignal,
): Promise<Array<string>> {
  const { value } = await request<{ value: Array<{ name: string }> }>(
    connection,
    `_apis/projects/${encodeURIComponent(connection.project)}/teams?$mine=true&api-version=7.1`,
    { signal },
  );
  return value.map((team) => team.name).sort();
}

const cache = new Map<string, Promise<unknown>>();

/** Memoises a lookup per connection for the life of the command; failures aren't cached. */
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (!cache.has(key))
    cache.set(
      key,
      load().catch((error) => {
        cache.delete(key);
        throw error;
      }),
    );
  return cache.get(key) as Promise<T>;
}

/** The connection's board, else the project's real default team (for sprints on a whole-project connection). */
export function resolveTeam(connection: AzureConnection): Promise<string> {
  if (connection.team) return Promise.resolve(connection.team);
  return cached(`team|${connection.orgUrl}|${connection.project}`, async () => {
    const project = await request<{ defaultTeam?: { name?: string } }>(
      connection,
      `_apis/projects/${encodeURIComponent(connection.project)}?api-version=7.1`,
    ).catch((error: Error) => {
      throw new Error(
        `Couldn't find the project's default team (${error.message}) — pick a Board in Manage Connections`,
      );
    });
    if (!project.defaultTeam?.name) throw new Error("Project has no default team — pick a Board in Manage Connections");
    return project.defaultTeam.name;
  });
}

export type TeamArea = { value: string; includeChildren: boolean };

/** The areas a board shows, from its team settings. */
function teamAreas(connection: AzureConnection, team: string): Promise<Array<TeamArea>> {
  return cached(`areas|${connection.orgUrl}|${connection.project}|${team}`, async () => {
    const { values } = await request<{ values: Array<TeamArea> }>(
      connection,
      `${encodeURIComponent(connection.project)}/${encodeURIComponent(team)}/_apis/work/teamsettings/teamfieldvalues?api-version=7.1`,
    );
    return values;
  });
}

const SPRINT_OFFSETS = new Map([
  ["current", ""],
  ["previous", " - 1"],
  ["next", " + 1"],
]);

const wiqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;
const anyContains = (field: string, values: Array<string>) =>
  `(${values.map((value) => `${field} CONTAINS ${wiqlString(value)}`).join(" OR ")})`;

/**
 * WIQL WHERE clauses for a title search plus filters. `sprint` must be current/previous/next or a full path.
 * `boardAreas` limits results to the board's areas unless `area:` overrides it.
 */
export function wiqlConditions(
  connection: AzureConnection,
  text: string,
  filters: Filters,
  boardAreas: Array<TeamArea> = [],
): Array<string> {
  const { project } = connection;
  const conditions = ["[System.TeamProject] = @project"];
  if (filters.assignee)
    conditions.push(
      filters.assignee.toLowerCase() === "me"
        ? "[System.AssignedTo] = @me"
        : `[System.AssignedTo] CONTAINS ${wiqlString(filters.assignee)}`,
    );
  if (filters.type?.length) conditions.push(anyContains("[System.WorkItemType]", filters.type));
  if (filters.state?.length) conditions.push(anyContains("[System.State]", filters.state));
  for (const tag of filters.tag ?? []) conditions.push(`[System.Tags] CONTAINS ${wiqlString(tag)}`);
  if (filters.parent) conditions.push(`[System.Parent] = ${filters.parent}`);
  const area = filters.area;
  if (area && area.toLowerCase() !== "all")
    conditions.push(
      `[System.AreaPath] UNDER ${wiqlString(area.includes("\\") || area.toLowerCase() === project.toLowerCase() ? area : `${project}\\${area}`)}`,
    );
  else if (!area && boardAreas.length)
    conditions.push(
      `(${boardAreas.map((each) => `[System.AreaPath] ${each.includeChildren ? "UNDER" : "="} ${wiqlString(each.value)}`).join(" OR ")})`,
    );
  if (filters.sprint) {
    const offset = SPRINT_OFFSETS.get(filters.sprint.toLowerCase());
    conditions.push(
      offset === undefined
        ? `[System.IterationPath] UNDER ${wiqlString(filters.sprint)}`
        : `[System.IterationPath] = @CurrentIteration${offset}`, // needs the team-scoped WIQL URL
    );
  }
  if (text) conditions.push(`[System.Title] CONTAINS ${wiqlString(text)}`);
  return conditions;
}

export type Iteration = { name: string; path: string; timeFrame?: string };

export async function listIterations(connection: AzureConnection, signal?: AbortSignal): Promise<Array<Iteration>> {
  const team = await resolveTeam(connection);
  const { value } = await request<{
    value: Array<{ name: string; path: string; attributes?: { timeFrame?: string } }>;
  }>(
    connection,
    `${encodeURIComponent(connection.project)}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations?api-version=7.1`,
    { signal },
  );
  return value.map(({ name, path, attributes }) => ({ name, path, timeFrame: attributes?.timeFrame }));
}

/** Work item types (minus disabled ones) with every state they use and Azure's colour per type (`#RRGGBB`). */
export async function listTypesAndStates(
  connection: AzureConnection,
): Promise<{ types: Array<string>; states: Array<string>; colors: Record<string, string> }> {
  const { value } = await request<{
    value: Array<{ name: string; color?: string; isDisabled?: boolean; states?: Array<{ name: string }> }>;
  }>(connection, `${encodeURIComponent(connection.project)}/_apis/wit/workitemtypes?api-version=7.1`);
  const enabled = value.filter((type) => !type.isDisabled);
  return {
    types: enabled.map((type) => type.name).sort(),
    states: [...new Set(enabled.flatMap((type) => type.states?.map((state) => state.name) ?? []))].sort(),
    colors: Object.fromEntries(
      value.filter((type) => /^[0-9a-f]{6}$/i.test(type.color ?? "")).map((type) => [type.name, `#${type.color}`]),
    ),
  };
}

const stripTags = (html: string) => html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");

/** `<table>` → markdown table; first row is the header. Cells are flattened to one line. */
function tableToMarkdown(inner: string): string {
  const rows = (inner.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((row) =>
    (row.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) ?? []).map((cell) =>
      htmlToMarkdown(cell.replace(/^<t[hd][^>]*>|<\/t[hd]>$/gi, ""))
        .replace(/\s*\n\s*/g, " ")
        .replace(/\|/g, "\\|"),
    ),
  );
  if (!rows.length) return "";
  const line = (cells: Array<string>) => `| ${cells.join(" | ")} |`;
  return `\n\n${[line(rows[0]), line(rows[0].map(() => "---")), ...rows.slice(1).map(line)].join("\n")}\n\n`;
}

// ponytail: regex HTML → markdown (lists flat, tables/code supported); swap for a real converter if nesting matters.
export function htmlToMarkdown(html = ""): string {
  return html
    .replace(/@<[0-9a-f-]{36}>/gi, "**@unknown**") // unresolved mention ID; would otherwise strip to a bare "@"
    .replace(/<a [^>]*data-vss-mention[^>]*>([\s\S]*?)<\/a>/gi, "**$1**")
    .replace(
      /<pre[^>]*>([\s\S]*?)<\/pre>/gi,
      (_, inner: string) => `\n\n\`\`\`\n${stripTags(inner).trim()}\n\`\`\`\n\n`,
    )
    .replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, inner: string) => tableToMarkdown(inner))
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner: string) => {
      let n = 0;
      return inner.replace(/<li[^>]*>/gi, () => `${++n}. `);
    })
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<h\d[^>]*>/gi, "### ")
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, "_$2_")
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function markdownLink({ id, title, url }: WorkItem): string {
  return `[#${id} ${title.replace(/[[\]]/g, "\\$&")}](${url})`;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Arc-style link: rich-text apps paste the HTML, plain-text apps paste the markdown. */
export function smartLink(label: string, title: string, url: string) {
  return {
    html: `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>: ${escapeHtml(title)}`,
    text: `[${label}](${url}): ${title}`,
  };
}

export function ticketMarkdown(item: WorkItem): string {
  return [
    `## ${markdownLink(item)}`,
    "### Description",
    item.description || "_Empty_",
    "### Acceptance Criteria",
    item.acceptanceCriteria || "_Empty_",
  ].join("\n\n");
}

type RawWorkItem = { id: number; fields: Record<string, unknown> };

function toWorkItem(connection: AzureConnection, { id, fields }: RawWorkItem): WorkItem {
  const project = String(fields["System.TeamProject"] ?? connection.project);
  return {
    id,
    title: String(fields["System.Title"] ?? ""),
    type: String(fields["System.WorkItemType"] ?? ""),
    state: String(fields["System.State"] ?? ""),
    assignedTo: (fields["System.AssignedTo"] as { displayName?: string } | undefined)?.displayName,
    iteration: (fields["System.IterationPath"] as string | undefined)?.split("\\").pop(),
    changedBy: (fields["System.ChangedBy"] as { displayName?: string } | undefined)?.displayName,
    changedDate: fields["System.ChangedDate"] as string | undefined,
    tags: String(fields["System.Tags"] ?? "")
      .split(";")
      .map((tag) => tag.trim())
      .filter(Boolean),
    description: htmlToMarkdown(fields["System.Description"] as string | undefined),
    acceptanceCriteria: htmlToMarkdown(fields["Microsoft.VSTS.Common.AcceptanceCriteria"] as string | undefined),
    url: `${connection.orgUrl.replace(/\/+$/, "")}/${encodeURIComponent(project)}/_workitems/edit/${id}`,
  };
}

/** An ID or link fetches that item; otherwise runs a title search with filters in the connection's project. */
export async function searchWorkItems(
  connection: AzureConnection,
  { id, text, filters }: Extract<BoardQuery, { kind: "workItem" }>,
  signal?: AbortSignal,
): Promise<Array<WorkItem>> {
  if (id === undefined) {
    const sprint = filters.sprint;
    if (sprint && !SPRINT_OFFSETS.has(sprint.toLowerCase()) && !sprint.includes("\\")) {
      const iterations = await listIterations(connection, signal);
      const needle = sprint.toLowerCase();
      const match =
        iterations.find((each) => each.name.toLowerCase() === needle) ??
        iterations.find((each) => each.name.toLowerCase().includes(needle));
      if (!match) throw new Error(`No sprint matching “${sprint}” for board ${await resolveTeam(connection)}`);
      filters = { ...filters, sprint: match.path };
    }
    const boardAreas = connection.team && !filters.area ? await teamAreas(connection, connection.team) : [];
    const query = `SELECT [System.Id] FROM WorkItems WHERE ${wiqlConditions(connection, text, filters, boardAreas).join(" AND ")} ORDER BY [System.ChangedDate] DESC`;
    // @CurrentIteration only resolves when the team is in the URL; the macro's team argument is ignored by REST.
    const teamScoped = filters.sprint && SPRINT_OFFSETS.has(filters.sprint.toLowerCase());
    const scope = [connection.project, ...(teamScoped ? [await resolveTeam(connection)] : [])]
      .map(encodeURIComponent)
      .join("/");
    return queryWorkItems(connection, query, scope, signal);
  }
  return fetchWorkItems(connection, [id], signal);
}

/** Runs a WIQL query (newest 50) and returns the full work items. */
async function queryWorkItems(
  connection: AzureConnection,
  query: string,
  scope = encodeURIComponent(connection.project),
  signal?: AbortSignal,
): Promise<Array<WorkItem>> {
  const result = await request<{ workItems: Array<{ id: number }> }>(
    connection,
    `${scope}/_apis/wit/wiql?$top=50&api-version=7.1`,
    { method: "POST", body: JSON.stringify({ query }), signal },
  );
  return fetchWorkItems(
    connection,
    result.workItems.map((item) => item.id),
    signal,
  );
}

async function fetchWorkItems(
  connection: AzureConnection,
  ids: Array<number>,
  signal?: AbortSignal,
): Promise<Array<WorkItem>> {
  if (ids.length === 0) return [];
  const { value } = await request<{ value: Array<RawWorkItem | null> }>(
    connection,
    `_apis/wit/workitems?ids=${ids.join(",")}&errorPolicy=omit&api-version=7.1`,
    { signal },
  );
  return value.filter((item): item is RawWorkItem => !!item).map((item) => toWorkItem(connection, item));
}

type RawPullRequest = {
  pullRequestId: number;
  title: string;
  status: string;
  isDraft?: boolean;
  creationDate?: string;
  description?: string;
  sourceRefName: string;
  targetRefName: string;
  createdBy?: { id?: string; displayName?: string };
  reviewers?: Array<{ id: string; displayName?: string; vote: number }>;
  repository: { id: string; name: string; project?: { name?: string } };
};

function toPullRequest(connection: AzureConnection, pr: RawPullRequest): PullRequest {
  const project = pr.repository.project?.name ?? connection.project;
  return {
    id: pr.pullRequestId,
    createdDate: pr.creationDate,
    title: pr.title,
    repo: pr.repository.name,
    repoId: pr.repository.id,
    author: pr.createdBy?.displayName ?? "Unknown",
    status: pr.isDraft && pr.status === "active" ? "draft" : pr.status,
    sourceBranch: pr.sourceRefName.replace(/^refs\/heads\//, ""),
    targetBranch: pr.targetRefName.replace(/^refs\/heads\//, ""),
    description: pr.description ?? "",
    url: `${connection.orgUrl.replace(/\/+$/, "")}/${encodeURIComponent(project)}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.pullRequestId}`,
  };
}

/** `!123` fetches that PR; `!text` filters active PR titles in the connection's project. */
export async function searchPullRequests(
  connection: AzureConnection,
  { id, text }: Extract<BoardQuery, { kind: "pr" }>,
  signal?: AbortSignal,
): Promise<Array<PullRequest>> {
  const base = `${encodeURIComponent(connection.project)}/_apis/git/pullrequests`;
  if (id !== undefined)
    return [
      toPullRequest(connection, await request<RawPullRequest>(connection, `${base}/${id}?api-version=7.1`, { signal })),
    ];
  // ponytail: the PR API has no title search, so filter the newest 100 active PRs client-side; page further if projects outgrow it.
  const { value } = await request<{ value: Array<RawPullRequest> }>(
    connection,
    `${base}?searchCriteria.status=active&$top=100&api-version=7.1`,
    { signal },
  );
  const needle = text.toLowerCase();
  return value.filter((pr) => pr.title.toLowerCase().includes(needle)).map((pr) => toPullRequest(connection, pr));
}

/** The token owner's identity ID, looked up once per connection. */
function myId(connection: AzureConnection): Promise<string> {
  return cached(`me|${connection.id}`, async () => {
    const data = await request<{ authenticatedUser?: { id?: string } }>(connection, "_apis/connectionData");
    if (!data.authenticatedUser?.id) throw new Error("Couldn't identify the token's user");
    return data.authenticatedUser.id;
  });
}

type RawThread = {
  id?: number;
  status?: string;
  isDeleted?: boolean;
  threadContext?: { filePath?: string };
  /** People referenced in the thread; content mentions them as `@<id>`. */
  identities?: Record<string, { id?: string; displayName?: string }>;
  comments?: Array<{
    author?: { id?: string; displayName?: string };
    content?: string;
    commentType?: string;
    isDeleted?: boolean;
    publishedDate?: string;
  }>;
};

/** `date` is when the reason happened (e.g. the latest comment), if known. */
export type NotedPullRequest = { pr: PullRequest; note: string; date?: string };

export type Notifications = {
  mentions: Array<WorkItem>;
  prComments: Array<NotedPullRequest>;
  toReview: Array<PullRequest>;
  myPrs: Array<NotedPullRequest>;
  changed: Array<WorkItem>;
};

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

/** Why a PR's comment threads need me: an @mention in the last 30 days, or (on my PR) active threads where someone else spoke last. */
export function threadNote(threads: Array<RawThread>, me: string, mine: boolean): string | undefined {
  const tag = `@<${me.toLowerCase()}>`;
  const live = threads.filter((thread) => !thread.isDeleted);
  const mentioned = live.some((thread) =>
    thread.comments?.some(
      (comment) =>
        !comment.isDeleted &&
        comment.author?.id !== me &&
        comment.content?.toLowerCase().includes(tag) &&
        Date.now() - Date.parse(comment.publishedDate ?? "") < THIRTY_DAYS,
    ),
  );
  const unresolved = mine
    ? live.filter((thread) => {
        const text = thread.comments?.filter((comment) => comment.commentType !== "system" && !comment.isDeleted);
        return thread.status === "active" && text?.length && text[text.length - 1].author?.id !== me;
      }).length
    : 0;
  const parts = [mentioned && "mentioned you", unresolved && `${unresolved} unresolved`].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/** Everything that likely needs my action: mentions, PR comments, reviews, PR feedback and items others changed. */
export async function fetchNotifications(connection: AzureConnection, signal?: AbortSignal): Promise<Notifications> {
  const me = await myId(connection);
  const prBase = `${encodeURIComponent(connection.project)}/_apis/git/pullrequests?searchCriteria.status=active&$top=100&api-version=7.1`;
  const [reviewing, mine, mentions, changed] = await Promise.all([
    request<{ value: Array<RawPullRequest> }>(connection, `${prBase}&searchCriteria.reviewerId=${me}`, { signal }),
    request<{ value: Array<RawPullRequest> }>(connection, `${prBase}&searchCriteria.creatorId=${me}`, { signal }),
    queryWorkItems(
      connection,
      "SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN (@RecentMentions) ORDER BY [System.ChangedDate] DESC",
      undefined,
      signal,
    ),
    queryWorkItems(
      connection,
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AssignedTo] = @me AND [System.ChangedBy] <> @me AND [System.ChangedDate] >= @today - 7 ORDER BY [System.ChangedDate] DESC",
      undefined,
      signal,
    ),
  ]);

  const toReview = reviewing.value.filter(
    (pr) =>
      !pr.isDraft && pr.createdBy?.id !== me && (pr.reviewers?.find((reviewer) => reviewer.id === me)?.vote ?? 0) === 0,
  );

  const myPrs = mine.value.flatMap((pr) => {
    const blocking = (pr.reviewers ?? []).filter((reviewer) => reviewer.vote === -5 || reviewer.vote === -10);
    if (!blocking.length) return [];
    const note = blocking
      .map(
        (reviewer) =>
          `${reviewer.vote === -10 ? "Rejected" : "Waiting for author"}: ${reviewer.displayName ?? "reviewer"}`,
      )
      .join(" · ");
    return [{ pr: toPullRequest(connection, pr), note }];
  });

  // ponytail: one threads request per PR, capped at the 30 newest involved PRs; raise the cap if mentions get missed.
  const involved = [...new Map([...mine.value, ...reviewing.value].map((pr) => [pr.pullRequestId, pr])).values()].slice(
    0,
    30,
  );
  const prComments = (
    await Promise.all(
      involved.map(async (pr) => {
        const { value } = await request<{ value: Array<RawThread> }>(
          connection,
          `${encodeURIComponent(connection.project)}/_apis/git/repositories/${pr.repository.id}/pullRequests/${pr.pullRequestId}/threads?api-version=7.1`,
          { signal },
        );
        const note = threadNote(value, me, pr.createdBy?.id === me);
        // ISO strings sort chronologically, so the max is the latest comment from someone else.
        const date = value
          .filter((thread) => !thread.isDeleted)
          .flatMap((thread) => thread.comments ?? [])
          .filter((comment) => !comment.isDeleted && comment.commentType !== "system" && comment.author?.id !== me)
          .map((comment) => comment.publishedDate ?? "")
          .sort()
          .pop();
        return note ? [{ pr: toPullRequest(connection, pr), note, date: date || undefined }] : [];
      }),
    )
  ).flat();

  return {
    mentions,
    prComments,
    toReview: toReview.map((pr) => toPullRequest(connection, pr)),
    myPrs,
    changed,
  };
}

/** One row on the comments screen: a work item comment, or a whole PR thread. */
export type CommentEntry = {
  id: string;
  author: string;
  date?: string;
  status?: string;
  context?: string;
  preview: string;
  markdown: string;
};

const preview = (markdown: string) => markdown.replace(/\s+/g, " ").trim().slice(0, 120);

/** Mention IDs → names, read from rendered HTML anchors (`data-vss-mention="version:2.0,<id>">@Name<`). */
function mentionNames(html = ""): Map<string, string> {
  return new Map(
    [...html.matchAll(/data-vss-mention="[^",]*,([0-9a-f-]{36})"[^>]*>@?([^<]*)</gi)].map(
      ([, id, name]) => [id.toLowerCase(), name.trim()] as [string, string],
    ),
  );
}

/** `@<id>` → **@Name** (or **@unknown**). */
export function withMentionNames(content: string, names: Map<string | undefined, string | undefined>): string {
  return content.replace(/@<([0-9a-f-]{36})>/gi, (_, id: string) => `**@${names.get(id.toLowerCase()) ?? "unknown"}**`);
}

/** Work item discussion, newest first. */
export async function listWorkItemComments(connection: AzureConnection, id: number): Promise<Array<CommentEntry>> {
  const { comments } = await request<{
    comments: Array<{
      id: number;
      text?: string;
      renderedText?: string;
      format?: string;
      createdBy?: { displayName?: string };
      createdDate?: string;
    }>;
  }>(
    connection,
    // renderedText has mentions as names; markdown-format `text` only has `@<id>`.
    `${encodeURIComponent(connection.project)}/_apis/wit/workItems/${id}/comments?$top=200&order=desc&$expand=renderedText&api-version=7.1-preview.4`,
  );
  return comments.map((comment) => {
    const text = comment.text ?? "";
    const isMarkdown = comment.format ? /markdown/i.test(comment.format) : !/^\s*</.test(text);
    // Markdown comments render as written (tables, code survive); their `@<id>` mentions are named from the rendered HTML.
    const markdown = isMarkdown
      ? withMentionNames(text, mentionNames(comment.renderedText))
      : htmlToMarkdown(comment.renderedText || text);
    return {
      id: String(comment.id),
      author: comment.createdBy?.displayName ?? "Unknown",
      date: comment.createdDate,
      preview: preview(markdown),
      markdown: markdown || "_Empty_",
    };
  });
}

export async function addWorkItemComment(connection: AzureConnection, id: number, text: string): Promise<void> {
  await request(
    connection,
    `${encodeURIComponent(connection.project)}/_apis/wit/workItems/${id}/comments?format=markdown&api-version=7.1-preview.4`,
    { method: "POST", body: JSON.stringify({ text }) },
  );
}

/** Starts a new active thread on the PR. */
export async function addPullRequestComment(
  connection: AzureConnection,
  pr: PullRequest,
  content: string,
): Promise<void> {
  await request(
    connection,
    `${encodeURIComponent(connection.project)}/_apis/git/repositories/${pr.repoId}/pullRequests/${pr.id}/threads?api-version=7.1`,
    {
      method: "POST",
      body: JSON.stringify({ comments: [{ parentCommentId: 0, content, commentType: 1 }], status: 1 }),
    },
  );
}

/** Replies inside an existing PR thread. */
export async function replyToPullRequestThread(
  connection: AzureConnection,
  pr: PullRequest,
  threadId: string,
  content: string,
): Promise<void> {
  await request(
    connection,
    `${encodeURIComponent(connection.project)}/_apis/git/repositories/${pr.repoId}/pullRequests/${pr.id}/threads/${threadId}/comments?api-version=7.1`,
    { method: "POST", body: JSON.stringify({ content, parentCommentId: 1, commentType: 1 }) },
  );
}

/** PR comment threads (system threads skipped), most recently active first. */
export async function listPullRequestThreads(
  connection: AzureConnection,
  pr: PullRequest,
): Promise<Array<CommentEntry>> {
  const { value } = await request<{ value: Array<RawThread> }>(
    connection,
    `${encodeURIComponent(connection.project)}/_apis/git/repositories/${pr.repoId}/pullRequests/${pr.id}/threads?api-version=7.1`,
  );
  return value
    .filter((thread) => !thread.isDeleted)
    .flatMap((thread) => {
      const comments = (thread.comments ?? []).filter(
        (comment) => comment.commentType !== "system" && !comment.isDeleted,
      );
      if (!comments.length) return [];
      const last = comments[comments.length - 1];
      const names = new Map(
        Object.values(thread.identities ?? {}).map((identity) => [identity.id?.toLowerCase(), identity.displayName]),
      );
      const withNames = (content = "") => withMentionNames(content, names);
      return [
        {
          id: String(thread.id),
          author: comments[0].author?.displayName ?? "Unknown",
          date: last.publishedDate,
          status: thread.status,
          context: thread.threadContext?.filePath,
          preview: preview(withNames(comments[0].content)),
          markdown: comments
            .map(
              (comment) =>
                `**${comment.author?.displayName ?? "Unknown"}** · ${comment.publishedDate ? new Date(comment.publishedDate).toLocaleString() : ""}\n\n${withNames(comment.content) || "_Empty_"}`,
            )
            .join("\n\n---\n\n"),
        },
      ];
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}
