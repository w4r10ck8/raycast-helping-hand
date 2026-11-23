import assert from "node:assert/strict";
import test from "node:test";
import {
  htmlToMarkdown,
  parseQuery,
  parseWorkItemId,
  threadNote,
  ticketMarkdown,
  wiqlConditions,
  withMentionNames,
} from "./azure-devops.ts";

test("parseWorkItemId reads IDs and pasted links, ignores titles", () => {
  assert.equal(parseWorkItemId(" #4821 "), 4821);
  assert.equal(parseWorkItemId("https://dev.azure.com/org/Proj/_workitems/edit/4810/"), 4810);
  assert.equal(parseWorkItemId("Upload fails for 10 MB"), undefined);
});

test("parseQuery routes ! to PRs and pulls filter tokens out of work item searches", () => {
  assert.deepEqual(parseQuery("!123"), { kind: "pr", id: 123, text: "" });
  assert.deepEqual(parseQuery("! login fix"), { kind: "pr", text: "login fix" });
  assert.deepEqual(parseQuery("https://dev.azure.com/o/P/_git/r/pullrequest/9"), { kind: "pr", id: 9, text: "" });
  assert.deepEqual(parseQuery('@me Type:bug,story sprint:"Sprint 4" upload  tag:ui parent:#12 area:'), {
    kind: "workItem",
    id: undefined,
    text: "upload area:",
    filters: { assignee: "me", type: ["bug", "story"], sprint: "Sprint 4", tag: ["ui"], parent: 12 },
  });
  assert.deepEqual(parseQuery("#42"), { kind: "workItem", id: 42, text: "#42", filters: {} });
});

test("wiqlConditions builds filters, board areas and team-scoped sprints", () => {
  const connection = { project: "P" } as Parameters<typeof wiqlConditions>[0];
  const board = [
    { value: "P\\Web", includeChildren: true },
    { value: "P\\Ops", includeChildren: false },
  ];
  assert.deepEqual(
    wiqlConditions(connection, "it's", { assignee: "tom", type: ["bug", "story"], sprint: "next", parent: 7 }, board),
    [
      "[System.TeamProject] = @project",
      "[System.AssignedTo] CONTAINS 'tom'",
      "([System.WorkItemType] CONTAINS 'bug' OR [System.WorkItemType] CONTAINS 'story')",
      "[System.Parent] = 7",
      "([System.AreaPath] UNDER 'P\\Web' OR [System.AreaPath] = 'P\\Ops')",
      "[System.IterationPath] = @CurrentIteration + 1",
      "[System.Title] CONTAINS 'it''s'",
    ],
  );
  assert.deepEqual(wiqlConditions(connection, "", { area: "all" }, board), ["[System.TeamProject] = @project"]);
  assert.ok(wiqlConditions(connection, "", { area: "Mobile" }, board).includes("[System.AreaPath] UNDER 'P\\Mobile'"));
});

test("htmlToMarkdown keeps lists, emphasis and links", () => {
  assert.equal(
    htmlToMarkdown(
      '<div>Save &amp; <b>resume</b><br>see <a href="https://x.io">docs</a></div><ol><li>One</li><li>Two</li></ol><ul><li>Dot</li></ul>',
    ),
    "Save & **resume**\nsee [docs](https://x.io)\n1. One\n2. Two\n- Dot",
  );
  assert.equal(htmlToMarkdown(undefined), "");
});

test("ticketMarkdown links the title and marks empty sections", () => {
  const item = { id: 7, title: "Fix [draft]", url: "https://u/7", description: "Desc", acceptanceCriteria: "" };
  assert.equal(
    ticketMarkdown(item as Parameters<typeof ticketMarkdown>[0]),
    "## [#7 Fix \\[draft\\]](https://u/7)\n\n### Description\n\nDesc\n\n### Acceptance Criteria\n\n_Empty_",
  );
});

test("threadNote flags recent mentions and others' unresolved threads on my PR", () => {
  const now = new Date().toISOString();
  const threads = [
    {
      status: "active",
      comments: [
        { author: { id: "ME" }, content: "hi" },
        { author: { id: "x" }, content: "fix?" },
      ],
    },
    {
      status: "active",
      comments: [
        { author: { id: "x" }, content: "ok" },
        { author: { id: "ME" }, content: "done" },
      ],
    },
    { status: "fixed", comments: [{ author: { id: "x" }, content: "ping @<me>", publishedDate: now }] },
    { status: "active", comments: [{ author: { id: "x" }, content: "@<ME> old", publishedDate: "2020-01-01" }] },
  ];
  assert.equal(threadNote(threads, "ME", true), "mentioned you · 2 unresolved");
  assert.equal(threadNote(threads, "ME", false), "mentioned you");
  assert.equal(threadNote(threads.slice(1, 2), "ME", true), undefined);
});

test("htmlToMarkdown keeps mention names and never leaves a bare @", () => {
  assert.equal(
    htmlToMarkdown('<div>cc <a href="#" data-vss-mention="version:2.0,abc">@Ananya Shah</a></div>'),
    "cc **@Ananya Shah**",
  );
  assert.equal(htmlToMarkdown("cc @<6F3A1B2C-0000-0000-0000-000000000000>"), "cc **@unknown**");
});

test("htmlToMarkdown converts tables and code; withMentionNames names markdown mentions", () => {
  assert.equal(
    htmlToMarkdown(
      "<table><tr><th>#</th><th>setting</th></tr><tr><td>1</td><td><code>AUTH_SECRET</code> a|b</td></tr></table><pre>x &lt; 1</pre>",
    ),
    "| # | setting |\n| --- | --- |\n| 1 | `AUTH_SECRET` a\\|b |\n\n```\nx < 1\n```",
  );
  const id = "6f3a1b2c-0000-0000-0000-000000000000";
  assert.equal(withMentionNames(`cc @<${id.toUpperCase()}>`, new Map([[id, "ITEX-JP"]])), "cc **@ITEX-JP**");
});
