import { Action, ActionPanel, Color, Detail, Icon, Keyboard, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { CommentForm } from "./comment-form";
import type { CommentEntry } from "../lib/azure-devops";

const STATUS_COLORS: Record<string, Color> = {
  active: Color.Orange,
  pending: Color.Orange,
  fixed: Color.Green,
  closed: Color.SecondaryText,
  wontFix: Color.SecondaryText,
  byDesign: Color.SecondaryText,
};

const commentMarkdown = (comment: CommentEntry) =>
  [comment.context && `\`${comment.context}\``, comment.markdown].filter(Boolean).join("\n\n");

/** Comments (work item) or comment threads (PR): one row each, full text in the detail pane. */
export function Comments({
  title,
  url,
  load,
  add,
  reply,
}: {
  title: string;
  url: string;
  load: () => Promise<Array<CommentEntry>>;
  add: (text: string) => Promise<void>;
  /** PR threads only. */
  reply?: (threadId: string, text: string) => Promise<void>;
}) {
  const { data = [], isLoading, revalidate } = usePromise(load);
  const addAction = (
    <Action.Push
      title="Add Comment"
      icon={Icon.Plus}
      shortcut={Keyboard.Shortcut.Common.New}
      target={
        <CommentForm
          title={`${title} · New`}
          onPost={async (text) => {
            await add(text);
            revalidate();
          }}
        />
      }
    />
  );
  return (
    <List
      navigationTitle={title}
      isLoading={isLoading}
      isShowingDetail={data.length > 0}
      searchBarPlaceholder="Filter comments…"
    >
      <List.EmptyView
        icon={Icon.Bubble}
        title={isLoading ? "Loading comments…" : "No comments yet"}
        actions={<ActionPanel>{addAction}</ActionPanel>}
      />
      {data.map((comment) => (
        <List.Item
          key={comment.id}
          icon={Icon.Bubble}
          title={comment.author}
          keywords={comment.preview.split(" ")}
          accessories={[
            ...(comment.status
              ? [{ tag: { value: comment.status, color: STATUS_COLORS[comment.status] ?? Color.SecondaryText } }]
              : []),
            ...(comment.date
              ? [{ date: new Date(comment.date), tooltip: new Date(comment.date).toLocaleString() }]
              : []),
          ]}
          detail={<List.Item.Detail markdown={commentMarkdown(comment)} />}
          actions={
            <ActionPanel>
              <Action.Push
                title="Open Comment"
                icon={Icon.Maximize}
                target={
                  <Detail
                    navigationTitle={`${title} · ${comment.author}`}
                    markdown={`## ${comment.author}${comment.date ? ` · ${new Date(comment.date).toLocaleString()}` : ""}\n\n${commentMarkdown(comment)}`}
                    actions={
                      <ActionPanel>
                        <Action.OpenInBrowser url={url} />
                        <Action.CopyToClipboard title="Copy Comment" content={comment.markdown} />
                      </ActionPanel>
                    }
                  />
                }
              />
              {reply && (
                <Action.Push
                  title="Reply"
                  icon={Icon.Reply}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
                  target={
                    <CommentForm
                      title={`${title} · Reply to ${comment.author}`}
                      onPost={async (text) => {
                        await reply(comment.id, text);
                        revalidate();
                      }}
                    />
                  }
                />
              )}
              {addAction}
              <Action.OpenInBrowser url={url} />
              <Action.CopyToClipboard title="Copy Comment" content={comment.markdown} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
