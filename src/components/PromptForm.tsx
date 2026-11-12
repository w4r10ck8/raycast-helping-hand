import {
  Action,
  ActionPanel,
  Color,
  Form,
  getPreferenceValues,
  Icon,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useState } from "react";
import type { SavedPrompt } from "../lib/prompt";
import { getProviders } from "../lib/providers";

const iconNames = Object.keys(Icon) as Array<keyof typeof Icon>;
const colorNames = Object.keys(Color).filter((name) => typeof Color[name as keyof typeof Color] === "string") as Array<
  keyof typeof Color
>;
const providers = getProviders();
const { defaultProvider } = getPreferenceValues<{ defaultProvider?: string }>();
const defaultTitle = providers.find((provider) => provider.id === defaultProvider)?.title ?? providers[0].title;

export function PromptForm({ initial, onSave }: { initial?: SavedPrompt; onSave: (prompt: SavedPrompt) => void }) {
  const { pop } = useNavigation();
  const [color, setColor] = useState(initial?.color ?? "");
  const tint = Color[color as keyof typeof Color] as Color | undefined;
  return (
    <Form
      navigationTitle={initial ? `Edit “${initial.name}”` : "Create Prompt"}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Prompt"
            icon={Icon.Check}
            onSubmit={({ name, prompt, icon, model }: Omit<SavedPrompt, "id">) => {
              if (!name.trim() || !prompt.trim()) {
                showToast(Toast.Style.Failure, "Name and prompt are required");
                return;
              }
              onSave({
                id: initial?.id ?? crypto.randomUUID(),
                name: name.trim(),
                prompt,
                icon,
                color: color || undefined,
                favourite: initial?.favourite,
                model: model || undefined,
              });
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="Name" placeholder="e.g. Tone casual" defaultValue={initial?.name} autoFocus />
      <Form.Dropdown id="icon" title="Icon" defaultValue={initial?.icon ?? "Wand"}>
        {iconNames.map((name) => (
          <Form.Dropdown.Item key={name} value={name} title={name} icon={{ source: Icon[name], tintColor: tint }} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="color" title="Colour" value={color} onChange={setColor}>
        <Form.Dropdown.Item
          value=""
          title="Default"
          icon={{ source: Icon.CircleFilled, tintColor: Color.PrimaryText }}
        />
        {colorNames.map((name) => (
          <Form.Dropdown.Item
            key={name}
            value={name}
            title={name}
            icon={{ source: Icon.CircleFilled, tintColor: Color[name] }}
          />
        ))}
      </Form.Dropdown>
      <Form.TextArea
        id="prompt"
        title="Prompt"
        placeholder="Rewrite {text} in a friendly, casual tone…"
        defaultValue={initial?.prompt}
        info="Use {text} or {clipboard} where your input goes. Without one, the input is appended at the end."
      />
      <Form.Dropdown
        id="model"
        title="Provider"
        defaultValue={initial?.model ?? ""}
        info="Default uses the provider picked with ⌘M, which starts at the Default Provider in Settings. Pick one to always run this prompt with it."
      >
        <Form.Dropdown.Item value="" title={`Default (${defaultTitle})`} icon={Icon.Gear} />
        <Form.Dropdown.Section title="Always Use">
          {providers.map((provider) => (
            <Form.Dropdown.Item key={provider.id} value={provider.id} title={provider.title} icon={Icon.ComputerChip} />
          ))}
        </Form.Dropdown.Section>
      </Form.Dropdown>
    </Form>
  );
}
