import { Action, ActionPanel, Color, Detail, Icon, Keyboard, List, LocalStorage } from "@raycast/api";
import { useCachedPromise, usePromise } from "@raycast/utils";
import { type ReactNode, useState } from "react";
import { AzureConnections } from "./components/azure-connections";
import { Comments } from "./components/comments";
import { WorkItemFilters } from "./components/work-item-filters";
import {
  addPullRequestComment,
  addWorkItemComment,
  type AzureConnection,
  CONNECTIONS_KEY,
  fetchNotifications,
  type Filters,
  listPullRequestThreads,
  listTypesAndStates,
  listWorkItemComments,
  smartLink,
  parseQuery,
  replyToPullRequestThread,
  type PullRequest,
  searchPullRequests,
  searchWorkItems,
  ticketMarkdown,
  type WorkItem,
} from "./lib/azure-devops";
import { badgeIcon, headerImage, idTile } from "./lib/header-image";

// Codes for common types; colours are fallbacks until the project's own colours load.
const TYPE_BADGES: Record<string, [code: string, color: string]> = {
  "User Story": ["US", "#009CCC"],
  "Product Backlog Item": ["PB", "#009CCC"],
  Bug: ["BG", "#CC293D"],
  Task: ["TK", "#F2CB1D"],
  Feature: ["FT", "#773B93"],
  Epic: ["EP", "#FF7B00"],
  "Test Case": ["TC", "#004B50"],
};

/** "Change Request" → CR, "Spike" → SP; colour from the project when known. */
function typeStyle(type: string, colors: Record<string, string> = {}) {
  const words = type.split(/\s+/).filter(Boolean);
  const [code, fallback] = TYPE_BADGES[type] ?? [
    (words.length > 1 ? words.map((word) => word[0]).join("") : type).slice(0, 2).toUpperCase() || "??",
    "#8E8E93",
  ];
  return { code, color: colors[type] ?? fallback };
}

const typeBadge = (type: string, colors?: Record<string, string>) => {
  const { code, color } = typeStyle(type, colors);
  return badgeIcon(code, color);
};

const VIEWS: Record<string, { title: string; icon: Icon; filters: Filters }> = {
  all: { title: "All", icon: Icon.AppWindowGrid3x3, filters: {} },
  sprint: { title: "Current Sprint", icon: Icon.Calendar, filters: { sprint: "current" } },
  mine: { title: "My Work", icon: Icon.Person, filters: { assignee: "me" } },
  mySprint: { title: "My Current Sprint", icon: Icon.CheckList, filters: { assignee: "me", sprint: "current" } },
};

const NOTIFICATIONS = "notifications";

const describeFilters = (filters: Filters) =>
  Object.entries(filters)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value).split("\\").pop()}`)
    .join(" · ");

const PR_COLORS: Record<string, string> = {
  active: "#2EA043",
  draft: "#8E8E93",
  completed: "#773B93",
  abandoned: "#CC293D",
};

/** Read directly (not useLocalStorage) so it can reload after Manage Connections changes them. */
async function loadConnections(): Promise<Array<AzureConnection>> {
  const raw = await LocalStorage.getItem<string>(CONNECTIONS_KEY);
  return raw ? JSON.parse(raw) : [];
}

/** Prefixes every line so the block renders with a vertical bar on the left. */
const quote = (markdown: string) =>
  markdown
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

function workItemMarkdown(item: WorkItem, colors?: Record<string, string>) {
  return [
    idTile(item.type, typeStyle(item.type, colors).color, `#${item.id}`),
    `## ${item.title}`,
    headerImage("Description", [{ label: item.description ? "Copy · ⌥⌘D" : "Empty" }]),
    quote(item.description || "_Empty_"),
    "---",
    headerImage("Acceptance Criteria", [{ label: item.acceptanceCriteria ? "Copy · ⌥⌘A" : "Empty" }]),
    quote(item.acceptanceCriteria || "_Empty_"),
  ].join("\n\n");
}

function workItemMetadata(item: WorkItem, colors?: Record<string, string>) {
  return (
    <Detail.Metadata>
      <Detail.Metadata.TagList title="Ticket">
        <Detail.Metadata.TagList.Item text={`#${item.id}`} color={Color.SecondaryText} />
        <Detail.Metadata.TagList.Item text={item.type} color={typeStyle(item.type, colors).color} />
        <Detail.Metadata.TagList.Item text={item.state} />
      </Detail.Metadata.TagList>
      {item.tags.length > 0 && (
        <Detail.Metadata.TagList title="Tags">
          {item.tags.map((tag) => (
            <Detail.Metadata.TagList.Item key={tag} text={tag} />
          ))}
        </Detail.Metadata.TagList>
      )}
      <Detail.Metadata.Label title="Assigned To" text={item.assignedTo ?? "Unassigned"} icon={Icon.Person} />
      <Detail.Metadata.Label title="Iteration" text={item.iteration ?? "—"} />
      {item.changedDate && (
        <Detail.Metadata.Label
          title="Changed"
          text={[new Date(item.changedDate).toLocaleString(), item.changedBy && `by ${item.changedBy}`]
            .filter(Boolean)
            .join(" ")}
        />
      )}
    </Detail.Metadata>
  );
}

const prMarkdown = (pr: PullRequest) =>
  [
    idTile(pr.status, PR_COLORS[pr.status] ?? "#8E8E93", `!${pr.id}`),
    `## ${pr.title}`,
    quote(pr.description || "_No description_"),
  ].join("\n\n");

function prMetadata(pr: PullRequest) {
  return (
    <Detail.Metadata>
      <Detail.Metadata.TagList title="Pull Request">
        <Detail.Metadata.TagList.Item text={`!${pr.id}`} color={Color.SecondaryText} />
        <Detail.Metadata.TagList.Item text={pr.status} color={PR_COLORS[pr.status] ?? Color.SecondaryText} />
      </Detail.Metadata.TagList>
      <Detail.Metadata.Label title="Repository" text={pr.repo} />
      <Detail.Metadata.Label title="Author" text={pr.author} icon={Icon.Person} />
      <Detail.Metadata.Label title="Branches" text={`${pr.sourceBranch} → ${pr.targetBranch}`} />
      {pr.createdDate && <Detail.Metadata.Label title="Opened" text={new Date(pr.createdDate).toLocaleString()} />}
    </Detail.Metadata>
  );
}

/** Native relative date accessory ("5m", "2d"), full timestamp on hover. */
function dateAccessory(iso: string | undefined, label: string): Array<List.Item.Accessory> {
  if (!iso) return [];
  const date = new Date(iso);
  return [{ date, tooltip: `${label} ${date.toLocaleString()}` }];
}

const CHEATSHEET = `# DevOps Board Cheatsheet

## Find something
| Type | Finds |
|---|---|
| \`4821\` · \`#4821\` · work item link | That work item |
| \`!123\` · PR link | That pull request |
| \`!login\` | Active PRs with "login" in the title (\`!\` alone = all active) |
| \`login\` | Work items with "login" in the title |

## Filter work items
Mix any of these with title text, e.g. \`@me type:bug sprint:current login\`.

| Token | Meaning |
|---|---|
| \`@me\` · \`@tom\` | Assigned to me / anyone whose name contains "tom" |
| \`type:bug,story\` | Type contains any of these |
| \`state:active\` | State contains this |
| \`sprint:current\` · \`previous\` · \`next\` | Board's current sprint, or the one before/after |
| \`sprint:42\` · \`sprint:"Sprint 42"\` | Sprint whose name contains this |
| \`area:MyFWC\` · \`area:all\` | Under that area / ignore the board's areas |
| \`parent:4821\` | Children of that work item |
| \`tag:ui,urgent\` | Has every one of these tags |

Typed tokens beat **⌘F** filters, which beat the **View** dropdown.

## Notifications
Pick **Notifications** in the View dropdown: work item @mentions (30 days), PR comments that mention you or are unresolved on your PRs, PRs waiting for your review, your PRs marked waiting-for-author/rejected, and your items changed by others (7 days). Typing filters by title; **⌘R** refreshes.

## Keys
| Key | Does |
|---|---|
| ↵ | Open in Raycast |
| ⌘↵ | Open in browser |
| ⌘⇧↵ | Copy full ticket |
| ⌘⇧C | Copy link (rich link or markdown, depending on where you paste) |
| ⌥⌘D · ⌥⌘A | Copy description / acceptance criteria |
| ⌘F · ⌘⇧F | Filter form / clear form filters |
| ⌘⇧O | Switch connection |
| ⌘⇧A | Manage connections |
| ⌘⇧M | Show comments |
| ⌘R | Refresh notifications |
| ⌘/ | This cheatsheet |
`;

/** Full-screen view pushed on ↵; its primary action opens the browser. */
function FullDetail(props: { title: string; markdown: string; metadata: ReactNode; actions: ReactNode }) {
  return (
    <Detail
      navigationTitle={props.title}
      markdown={props.markdown}
      metadata={props.metadata}
      actions={<ActionPanel>{props.actions}</ActionPanel>}
    />
  );
}

function workItemActions(item: WorkItem, connection: AzureConnection) {
  return (
    <>
      <Action.OpenInBrowser url={item.url} />
      <Action.Push
        title="Show Comments"
        icon={Icon.Bubble}
        shortcut={{ modifiers: ["cmd", "shift"], key: "m" }}
        target={
          <Comments
            title={`#${item.id} Comments`}
            url={item.url}
            load={() => listWorkItemComments(connection, item.id)}
            add={(text) => addWorkItemComment(connection, item.id, text)}
          />
        }
      />
      <ActionPanel.Section title="Copy">
        <Action.CopyToClipboard
          title="Full Ticket"
          content={ticketMarkdown(item)}
          shortcut={{ modifiers: ["cmd", "shift"], key: "return" }}
        />
        <Action.CopyToClipboard
          title="Link"
          content={smartLink(`${item.type} ${item.id}`, item.title, item.url)}
          shortcut={Keyboard.Shortcut.Common.Copy}
        />
        {item.description && (
          <Action.CopyToClipboard
            title="Description"
            content={item.description}
            shortcut={{ modifiers: ["cmd", "opt"], key: "d" }}
          />
        )}
        {item.acceptanceCriteria && (
          <Action.CopyToClipboard
            title="Acceptance Criteria"
            content={item.acceptanceCriteria}
            shortcut={{ modifiers: ["cmd", "opt"], key: "a" }}
          />
        )}
        <Action.CopyToClipboard title="ID" content={String(item.id)} shortcut={Keyboard.Shortcut.Common.CopyName} />
      </ActionPanel.Section>
    </>
  );
}

function prActions(pr: PullRequest, connection: AzureConnection) {
  return (
    <>
      <Action.OpenInBrowser url={pr.url} />
      <Action.Push
        title="Show Comments"
        icon={Icon.Bubble}
        shortcut={{ modifiers: ["cmd", "shift"], key: "m" }}
        target={
          <Comments
            title={`!${pr.id} Comments`}
            url={pr.url}
            load={() => listPullRequestThreads(connection, pr)}
            add={(text) => addPullRequestComment(connection, pr, text)}
            reply={(threadId, text) => replyToPullRequestThread(connection, pr, threadId, text)}
          />
        }
      />
      <ActionPanel.Section title="Copy">
        <Action.CopyToClipboard
          title="Link"
          content={smartLink(`Pull Request ${pr.id}`, pr.title, pr.url)}
          shortcut={Keyboard.Shortcut.Common.Copy}
        />
        <Action.CopyToClipboard title="URL" content={pr.url} shortcut={Keyboard.Shortcut.Common.CopyPath} />
        <Action.CopyToClipboard
          title="Source Branch"
          content={pr.sourceBranch}
          shortcut={{ modifiers: ["cmd", "opt"], key: "b" }}
        />
        <Action.CopyToClipboard title="ID" content={String(pr.id)} shortcut={Keyboard.Shortcut.Common.CopyName} />
      </ActionPanel.Section>
    </>
  );
}

function WorkItemRow({
  item,
  connection,
  colors,
  note,
  extraActions,
}: {
  item: WorkItem;
  connection: AzureConnection;
  colors?: Record<string, string>;
  note?: string;
  extraActions: ReactNode;
}) {
  return (
    <List.Item
      title={`#${item.id} · ${item.title}`}
      icon={{ source: typeBadge(item.type, colors), tooltip: `${item.type} #${item.id}` }}
      subtitle={note ?? item.state}
      accessories={[
        ...item.tags.slice(0, 1).map((tag) => ({ tag }) as List.Item.Accessory),
        ...(item.tags.length > 1 ? [{ text: `+${item.tags.length - 1}`, tooltip: item.tags.slice(1).join(", ") }] : []),
        ...dateAccessory(item.changedDate, "Changed"),
        {
          text: item.assignedTo?.split(" ")[0] ?? "Unassigned",
          tooltip: item.assignedTo ?? "Unassigned",
          icon: Icon.Person,
        },
      ]}
      actions={
        <ActionPanel>
          <Action.Push
            title="Open Ticket"
            icon={Icon.Sidebar}
            target={
              <FullDetail
                title={`#${item.id}`}
                markdown={workItemMarkdown(item, colors)}
                metadata={workItemMetadata(item, colors)}
                actions={workItemActions(item, connection)}
              />
            }
          />
          {workItemActions(item, connection)}
          {item.tags.length > 0 && (
            <ActionPanel.Submenu title="Tags" icon={Icon.Tag} shortcut={{ modifiers: ["cmd"], key: "t" }}>
              {item.tags.map((tag) => (
                <Action.CopyToClipboard key={tag} title={tag} content={tag} />
              ))}
            </ActionPanel.Submenu>
          )}
          {extraActions}
        </ActionPanel>
      }
    />
  );
}

function PullRequestRow({
  pr,
  connection,
  note,
  date,
  extraActions,
}: {
  pr: PullRequest;
  connection: AzureConnection;
  note?: string;
  /** Overrides the opened date, e.g. with the latest comment's time. */
  date?: string;
  extraActions: ReactNode;
}) {
  return (
    <List.Item
      icon={{
        source: badgeIcon("PR", PR_COLORS[pr.status] ?? "#8E8E93"),
        tooltip: `Pull request !${pr.id} · ${pr.status}`,
      }}
      title={`!${pr.id} · ${pr.title}`}
      subtitle={note ?? [pr.status, pr.repo].join(" · ")}
      accessories={[
        ...(date ? dateAccessory(date, "Latest comment") : dateAccessory(pr.createdDate, "Opened")),
        { text: pr.author, icon: Icon.Person },
      ]}
      actions={
        <ActionPanel>
          <Action.Push
            title="Open Pull Request"
            icon={Icon.Sidebar}
            target={
              <FullDetail
                title={`!${pr.id}`}
                markdown={prMarkdown(pr)}
                metadata={prMetadata(pr)}
                actions={prActions(pr, connection)}
              />
            }
          />
          {prActions(pr, connection)}
          {extraActions}
        </ActionPanel>
      }
    />
  );
}

export default function Command() {
  const { data: connections = [], isLoading: loadingConnections, revalidate } = usePromise(loadConnections);
  const [connectionId, setConnectionId] = useState<string>();
  const [searchText, setSearchText] = useState("");
  const [view, setView] = useState("all");
  const [formFilters, setFormFilters] = useState<Filters>({});
  const text = searchText.trim();
  const connection =
    connections.find((each) => each.id === connectionId) ?? connections.find((each) => each.default) ?? connections[0];

  const notifying = view === NOTIFICATIONS;

  // Precedence: typed tokens > ⌘F form > preset view.
  const query = parseQuery(text);
  const filters: Filters =
    query.kind === "workItem" && !notifying ? { ...VIEWS[view]?.filters, ...formFilters, ...query.filters } : {};
  const active = !notifying && (!!text || Object.keys(filters).length > 0);

  // Fetched once per open (or ⌘R); search text only filters titles locally.
  const {
    data: notifications,
    isLoading: loadingNotifications,
    revalidate: refreshNotifications,
  } = usePromise(fetchNotifications, [connection!], { execute: !!connection && notifying });
  const needle = text.toLowerCase();
  const matches = <T extends { title: string } | { pr: { title: string } }>(entries: Array<T>) =>
    entries.filter((entry) => ("pr" in entry ? entry.pr.title : entry.title).toLowerCase().includes(needle));

  const { data: typeMeta } = useCachedPromise(listTypesAndStates, [connection!], {
    execute: !!connection,
    onError: () => undefined, // badges fall back to built-in colours
  });

  const { data: results, isLoading: searching } = usePromise(
    async (selected: typeof connection, input: string, merged: Filters) => {
      const parsed = parseQuery(input);
      return parsed.kind === "pr"
        ? { workItems: [], pullRequests: await searchPullRequests(selected!, parsed) }
        : { workItems: await searchWorkItems(selected!, { ...parsed, filters: merged }), pullRequests: [] };
    },
    [connection, text, filters],
    { execute: !!connection && active },
  );
  const workItems = (active && results?.workItems) || [];
  const pullRequests = (active && results?.pullRequests) || [];
  const sprintName =
    filters.sprint && workItems.every((item) => item.iteration === workItems[0]?.iteration)
      ? workItems[0]?.iteration
      : undefined;
  const sectionTitle = [describeFilters(filters), sprintName].filter(Boolean).join(" · ");

  const manageAction = (
    <Action.Push
      title="Manage Azure DevOps Connections…"
      icon={Icon.Plug}
      shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
      target={<AzureConnections />}
      onPop={revalidate}
    />
  );

  const boardActions = (
    <ActionPanel.Section title="Board">
      {notifying && (
        <Action
          title="Refresh Notifications"
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={refreshNotifications}
        />
      )}
      {connection && (
        <Action.Push
          title="Filter Work Items…"
          icon={Icon.Filter}
          shortcut={{ modifiers: ["cmd"], key: "f" }}
          target={<WorkItemFilters connection={connection} initial={formFilters} onApply={setFormFilters} />}
        />
      )}
      {Object.keys(formFilters).length > 0 && (
        <Action
          title="Clear Filters"
          icon={Icon.XMarkCircle}
          shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
          onAction={() => setFormFilters({})}
        />
      )}
      {connections.length > 1 && (
        <ActionPanel.Submenu title="Switch Connection" icon={Icon.Plug} shortcut={Keyboard.Shortcut.Common.OpenWith}>
          {connections.map((each) => (
            <Action
              key={each.id}
              title={each.name}
              icon={each.id === connection?.id ? Icon.CheckCircle : Icon.Circle}
              onAction={() => setConnectionId(each.id)}
            />
          ))}
        </ActionPanel.Submenu>
      )}
      {manageAction}
      <Action.Push
        title="Help! I Am Overwhelmed!!"
        icon={Icon.QuestionMarkCircle}
        shortcut={{ modifiers: ["cmd"], key: "/" }}
        target={<Detail navigationTitle="DevOps Board Cheatsheet" markdown={CHEATSHEET} />}
      />
    </ActionPanel.Section>
  );

  return (
    <List
      isLoading={loadingConnections || searching || (notifying && loadingNotifications)}
      navigationTitle={connections.length > 1 && connection ? `DevOps Board · ${connection.name}` : undefined}
      throttle
      searchBarPlaceholder={
        notifying
          ? "Filter notifications by title…"
          : "#id · !pr · @me · type: state: sprint: area: parent: tag: · or titles…"
      }
      onSearchTextChange={setSearchText}
      filtering={false}
      searchBarAccessory={
        <List.Dropdown tooltip="View" storeValue onChange={setView}>
          {Object.entries(VIEWS).map(([value, each]) => (
            <List.Dropdown.Item key={value} value={value} title={each.title} icon={each.icon} />
          ))}
          <List.Dropdown.Item value={NOTIFICATIONS} title="Notifications" icon={Icon.Bell} />
        </List.Dropdown>
      }
    >
      <List.EmptyView
        icon={connection ? Icon.MagnifyingGlass : Icon.Plug}
        title={
          !connection
            ? "No Azure DevOps connection"
            : notifying
              ? loadingNotifications
                ? "Checking notifications…"
                : "Nothing needs you right now"
              : active
                ? "No matches"
                : `Search ${connection.project}`
        }
        description={
          connection
            ? "#123 → work item · !123 / !text → PRs · @me / @name → assigned · type:bug,story state:active sprint:current|next|42 area:X parent:123 tag:a,b · ⌘F filters"
            : "Add one with Manage Azure DevOps Connections (⌘⇧A)."
        }
        actions={<ActionPanel>{boardActions}</ActionPanel>}
      />
      {notifying && notifications ? (
        <>
          <List.Section title="Mentioned Me · Work Items">
            {matches(notifications.mentions).map((item) => (
              <WorkItemRow
                connection={connection!}
                key={`m-${item.id}`}
                item={item}
                colors={typeMeta?.colors}
                note={[item.state, item.changedBy && `last changed by ${item.changedBy}`].filter(Boolean).join(" · ")}
                extraActions={boardActions}
              />
            ))}
          </List.Section>
          <List.Section title="PR Comments for Me">
            {matches(notifications.prComments).map(({ pr, note, date }) => (
              <PullRequestRow
                connection={connection!}
                key={`c-${pr.id}`}
                pr={pr}
                note={`${note} · ${pr.repo}`}
                date={date}
                extraActions={boardActions}
              />
            ))}
          </List.Section>
          <List.Section title="Waiting for My Review">
            {matches(notifications.toReview).map((pr) => (
              <PullRequestRow connection={connection!} key={`r-${pr.id}`} pr={pr} extraActions={boardActions} />
            ))}
          </List.Section>
          <List.Section title="My PRs Needing Attention">
            {matches(notifications.myPrs).map(({ pr, note }) => (
              <PullRequestRow
                connection={connection!}
                key={`a-${pr.id}`}
                pr={pr}
                note={note}
                extraActions={boardActions}
              />
            ))}
          </List.Section>
          <List.Section title="My Items Changed by Others · 7 Days">
            {matches(notifications.changed).map((item) => (
              <WorkItemRow
                connection={connection!}
                key={`ch-${item.id}`}
                item={item}
                colors={typeMeta?.colors}
                note={[item.state, item.changedBy && `changed by ${item.changedBy}`].filter(Boolean).join(" · ")}
                extraActions={boardActions}
              />
            ))}
          </List.Section>
        </>
      ) : (
        <>
          <List.Section title={sectionTitle || undefined}>
            {workItems.map((item) => (
              <WorkItemRow
                connection={connection!}
                key={`wi-${item.id}`}
                item={item}
                colors={typeMeta?.colors}
                extraActions={boardActions}
              />
            ))}
          </List.Section>
          {pullRequests.map((pr) => (
            <PullRequestRow connection={connection!} key={`pr-${pr.id}`} pr={pr} extraActions={boardActions} />
          ))}
        </>
      )}
    </List>
  );
}
