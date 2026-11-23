import { Action, ActionPanel, Color, Icon, List, useNavigation, type Image } from "@raycast/api";

/**
 * Full-view confirmation. Unlike confirmAlert, its buttons live in Raycast's action bar,
 * so they get native shortcut hints (↵ to confirm, esc to go back).
 */
export function Confirm({
  title,
  message,
  confirmTitle,
  icon = { source: Icon.Trash, tintColor: Color.Red },
  destructive = true,
  onConfirm,
}: {
  title: string;
  message?: string;
  confirmTitle: string;
  icon?: Image.ImageLike;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const { pop } = useNavigation();
  return (
    <List navigationTitle={title} searchBarPlaceholder={`↵ to ${confirmTitle.toLowerCase()}, esc to cancel`}>
      <List.EmptyView
        icon={icon}
        title={title}
        description={message}
        actions={
          <ActionPanel>
            <Action
              title={confirmTitle}
              icon={icon}
              style={destructive ? Action.Style.Destructive : Action.Style.Regular}
              onAction={async () => {
                await onConfirm();
                pop();
              }}
            />
            <Action title="Cancel" icon={Icon.XMarkCircle} onAction={pop} />
          </ActionPanel>
        }
      />
    </List>
  );
}
