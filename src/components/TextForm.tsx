import { Action, ActionPanel, Form, useNavigation } from "@raycast/api";

/** Edit a block of text, e.g. typed input or a converted output. */
export function TextForm({
  title,
  initial,
  onSave,
}: {
  title: string;
  initial: string;
  onSave: (text: string) => void;
}) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle={title}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save"
            onSubmit={({ text }: { text: string }) => {
              onSave(text);
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea id="text" title={title} defaultValue={initial} autoFocus />
    </Form>
  );
}
