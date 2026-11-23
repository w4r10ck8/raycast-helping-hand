import { Action, ActionPanel, Detail, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { useState } from "react";

/** Markdown comment editor; stays open if posting fails so nothing is lost. */
export function CommentForm({ title, onPost }: { title: string; onPost: (text: string) => Promise<void> }) {
  const { pop } = useNavigation();
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const post = async () => {
    if (!text.trim()) return setError("Comment can't be empty");
    const toast = await showToast({ style: Toast.Style.Animated, title: "Posting comment…" });
    try {
      await onPost(text);
      toast.style = Toast.Style.Success;
      toast.title = "Comment posted";
      pop();
    } catch (failure) {
      toast.hide();
      await showFailureToast(failure, { title: "Couldn't post comment" });
    }
  };

  return (
    <Form
      navigationTitle={title}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Post Comment" icon={Icon.Upload} onSubmit={post} />
          <Action.Push
            title="Preview"
            icon={Icon.Eye}
            shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
            target={<Detail navigationTitle={`${title} · Preview`} markdown={text.trim() || "_Nothing to preview_"} />}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="text"
        title="Comment"
        placeholder="Markdown supported · ⌘⇧P to preview"
        enableMarkdown
        autoFocus
        value={text}
        error={error}
        onChange={(value) => {
          setText(value);
          setError(undefined);
        }}
      />
    </Form>
  );
}
