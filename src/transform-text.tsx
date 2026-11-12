import {
  Action,
  ActionPanel,
  Color,
  getPreferenceValues,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useLocalStorage, usePromise } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";
import { Confirm } from "./components/Confirm";
import { PromptForm } from "./components/PromptForm";
import { TextForm } from "./components/TextForm";
import { type Input, type InputSource, useCapturedInput } from "./hooks/useCapturedInput";
import { applyPrompt, mergePrompts, type SavedPrompt } from "./lib/prompt";
import { headerImage } from "./lib/headerImage";
import { exportPrompts, importPrompts } from "./lib/importExport";
import { getProviders } from "./lib/providers";

type Output = { text: string; provider: string; ms?: number; stopped?: boolean };

const providers = getProviders();
const { defaultProvider } = getPreferenceValues<{ defaultProvider?: string }>();
const FAVOURITE_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

function promptIcon({ icon, color }: SavedPrompt) {
  return {
    source: Icon[icon as keyof typeof Icon] ?? Icon.Wand,
    tintColor: Color[color as keyof typeof Color] as Color | undefined,
  };
}

const SOURCES: Array<[InputSource, string]> = [
  ["clipboard", "Clipboard ⌘⌥1"],
  ["typed", "Typed ⌘⌥2"],
];

function detailMarkdown(prompt: SavedPrompt, input: Input, app?: string, output?: Output, running?: boolean) {
  const inputHeader = headerImage(
    "Input",
    SOURCES.map(([source, label]) => ({ label, tone: source === input.source ? "active" : undefined })),
  );
  const inputPart = input.text
    ? `${inputHeader}\n\n${input.text}\n\n_${input.text.length} characters${
        input.source === "typed" ? "" : " · captured when Raycast opened"
      }_`
    : `${inputHeader}\n\n_${
        input.source === "typed"
          ? "Type your input in the search bar above."
          : "Clipboard is empty. Press ⌘⌥2 to type input."
      }_`;
  const outputPart = running
    ? `${headerImage("Output", [{ label: `Streaming · ${output?.provider}` }])}\n\n${output?.text || "_Converting…_"}`
    : output
      ? `${headerImage("Output", [
          output.stopped
            ? { label: "Stopped" }
            : { label: `Default: Paste to ${app ?? "Active App"}`, tone: "success" },
        ])}\n\n${output.text}\n\n_${output.provider} · ${((output.ms ?? 0) / 1000).toFixed(1)} s · Edit inline with ⌘⇧E · Regenerate with ⌘R_`
      : `${headerImage("Output", [])}\n\n_Press ↵ to convert with “${prompt.name}”._`;
  return `${inputPart}\n\n---\n\n${outputPart}`;
}

export default function Command() {
  const { value: prompts = [], setValue: setPrompts, isLoading } = useLocalStorage<Array<SavedPrompt>>("prompts", []);
  const [providerId, setProviderId] = useState<string>(defaultProvider ?? providers[0].id);
  // Why each provider can't run (undefined = ready); undefined while still checking.
  const { data: statuses } = usePromise(async () =>
    Object.fromEntries(await Promise.all(providers.map(async (provider) => [provider.id, await provider.status()]))),
  );
  const { input, setInput, captured, capture } = useCapturedInput();
  const [outputs, setOutputs] = useState<Record<string, Output>>({});
  const [runningId, setRunningId] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [searchText, setSearchText] = useState("");
  // In Typed mode the search bar is the input box, since Raycast has no text field inside a List.
  const typing = input.source === "typed";
  const abortRef = useRef<AbortController>(undefined);
  const { push } = useNavigation();

  useEffect(() => setOutputs({}), [input]);
  // Fall back to the first ready provider if the default one isn't available.
  useEffect(() => {
    const ready = providers.find((provider) => statuses && !statuses[provider.id]);
    if (statuses?.[providerId] && ready) setProviderId(ready.id);
  }, [statuses]);
  // Don't leave a CLI running after Raycast closes.
  useEffect(() => () => abortRef.current?.abort(), []);

  const favourites = prompts.filter((prompt) => prompt.favourite);
  const others = prompts.filter((prompt) => !prompt.favourite);

  function upsert(saved: SavedPrompt) {
    const exists = prompts.some((prompt) => prompt.id === saved.id);
    setPrompts(exists ? prompts.map((prompt) => (prompt.id === saved.id ? saved : prompt)) : [...prompts, saved]);
  }

  function duplicate(source: SavedPrompt) {
    const copy = { ...source, id: crypto.randomUUID(), name: `${source.name} Copy`, favourite: undefined };
    const index = prompts.indexOf(source);
    setPrompts([...prompts.slice(0, index + 1), copy, ...prompts.slice(index + 1)]);
    setSelectedId(copy.id);
  }

  async function runImport() {
    const imported = await importPrompts();
    if (imported) setPrompts(mergePrompts(prompts, imported));
  }

  async function convert(prompt: SavedPrompt) {
    const provider = providers.find((candidate) => candidate.id === (prompt.model ?? providerId)) ?? providers[0];
    const unavailable = statuses?.[provider.id];
    if (unavailable) {
      await showToast(Toast.Style.Failure, `${provider.title}: ${unavailable}`, "Pick another provider with ⌘M");
      return;
    }
    if (!input.text.trim()) {
      await showToast(Toast.Style.Failure, "No input", "Copy some text, or press ⌘⌥2 to type it");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const update = (change: (output: Output) => Output) =>
      setOutputs((current) => ({ ...current, [prompt.id]: change(current[prompt.id]) }));
    const started = Date.now();
    setSelectedId(prompt.id);
    setRunningId(prompt.id);
    setOutputs((current) => ({ ...current, [prompt.id]: { text: "", provider: provider.title } }));
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Converting…",
      primaryAction: { title: "Stop", onAction: () => controller.abort() },
    });
    try {
      const text = await provider.run(applyPrompt(prompt.prompt, input.text), {
        signal: controller.signal,
        onText: (delta) => update((output) => ({ ...output, text: output.text + delta })),
      });
      update((output) => ({ ...output, text, ms: Date.now() - started }));
      toast.style = Toast.Style.Success;
      toast.title = "Converted";
    } catch (error) {
      if (abortRef.current !== controller) return; // superseded by a newer conversion
      update((output) => ({ ...output, ms: Date.now() - started, stopped: controller.signal.aborted }));
      toast.style = controller.signal.aborted ? Toast.Style.Success : Toast.Style.Failure;
      toast.title = controller.signal.aborted ? "Stopped" : `${provider.title} failed`;
      toast.message = controller.signal.aborted ? undefined : error instanceof Error ? error.message : String(error);
    } finally {
      if (abortRef.current === controller) setRunningId(undefined);
    }
  }

  const manageActions = (
    <ActionPanel.Section>
      <Action.Push
        title="Create Prompt"
        icon={Icon.Plus}
        shortcut={Keyboard.Shortcut.Common.New}
        target={<PromptForm onSave={upsert} />}
      />
      <Action
        title="Import Prompts…"
        icon={Icon.Download}
        shortcut={{ modifiers: ["cmd", "shift"], key: "i" }}
        onAction={runImport}
      />
      {prompts.length > 0 && (
        <Action
          title="Export Prompts"
          icon={Icon.Upload}
          shortcut={{ modifiers: ["cmd", "opt"], key: "e" }}
          onAction={() => exportPrompts(prompts)}
        />
      )}
    </ActionPanel.Section>
  );

  const inputActions = (
    <ActionPanel.Section title="Input">
      {captured.clipboard && (
        <Action
          title="Use Clipboard"
          icon={Icon.Clipboard}
          shortcut={{ modifiers: ["cmd", "opt"], key: "1" }}
          onAction={() => setInput({ text: captured.clipboard ?? "", source: "clipboard" })}
        />
      )}
      <Action
        title="Type Input"
        icon={Icon.Text}
        shortcut={{ modifiers: ["cmd", "opt"], key: "2" }}
        onAction={() => setInput({ text: "", source: "typed" })}
      />
      <Action.Push
        title="Edit Input in Larger Editor"
        icon={Icon.AppWindow}
        target={<TextForm title="Input" initial={input.text} onSave={(text) => setInput({ text, source: "typed" })} />}
      />
      <Action
        title="Reload Input from Clipboard"
        icon={Icon.ArrowClockwise}
        shortcut={{ modifiers: ["cmd", "shift"], key: "v" }}
        onAction={capture}
      />
    </ActionPanel.Section>
  );

  function renderItem(prompt: SavedPrompt) {
    const running = runningId === prompt.id;
    const output = outputs[prompt.id]?.text && !running ? outputs[prompt.id] : undefined;
    const favouriteIndex = favourites.indexOf(prompt);
    const status = running
      ? "Running…"
      : output
        ? output.stopped
          ? "Stopped"
          : "Done"
        : favouriteIndex >= 0 && favouriteIndex < FAVOURITE_KEYS.length
          ? `⌘${favouriteIndex + 1}`
          : undefined;
    return (
      <List.Item
        key={prompt.id}
        id={prompt.id}
        title={prompt.name}
        icon={promptIcon(prompt)}
        accessories={[
          ...(prompt.model
            ? [
                {
                  tag: providers.find((provider) => provider.id === prompt.model)?.title,
                  tooltip: "Pinned provider (change in Edit, ⌘E)",
                },
              ]
            : []),
          ...(status ? [{ text: status }] : []),
        ]}
        detail={
          <List.Item.Detail
            isLoading={running}
            markdown={detailMarkdown(prompt, input, captured.app, outputs[prompt.id], running)}
          />
        }
        actions={
          <ActionPanel>
            <ActionPanel.Section title={output ? "Output" : undefined}>
              {running && <Action title="Stop" icon={Icon.Stop} onAction={() => abortRef.current?.abort()} />}
              {output && (
                <>
                  <Action.Paste title={`Paste to ${captured.app ?? "Active App"}`} content={output.text} />
                  <Action.CopyToClipboard
                    title="Copy Output"
                    content={output.text}
                    shortcut={{ modifiers: ["cmd"], key: "return" }}
                  />
                  <Action
                    title="Regenerate"
                    icon={Icon.ArrowClockwise}
                    shortcut={Keyboard.Shortcut.Common.Refresh}
                    onAction={() => convert(prompt)}
                  />
                  <Action.Push
                    title="Edit Output"
                    icon={Icon.Pencil}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "e" }}
                    target={
                      <TextForm
                        title="Output"
                        initial={output.text}
                        onSave={(text) => setOutputs((current) => ({ ...current, [prompt.id]: { ...output, text } }))}
                      />
                    }
                  />
                  <Action
                    title="Use Output as Input"
                    icon={Icon.ArrowUp}
                    shortcut={{ modifiers: ["cmd"], key: "u" }}
                    onAction={() => setInput({ text: output.text, source: "typed" })}
                  />
                </>
              )}
              {!running && !output && <Action title="Convert" icon={Icon.Wand} onAction={() => convert(prompt)} />}
            </ActionPanel.Section>
            <ActionPanel.Section title="Prompt">
              <Action.Push
                title={`Edit “${prompt.name}”`}
                icon={Icon.Pencil}
                shortcut={Keyboard.Shortcut.Common.Edit}
                target={<PromptForm initial={prompt} onSave={upsert} />}
              />
              <Action
                title="Duplicate"
                icon={Icon.Duplicate}
                shortcut={Keyboard.Shortcut.Common.Duplicate}
                onAction={() => duplicate(prompt)}
              />
              <ActionPanel.Submenu
                title="Change Provider…"
                icon={Icon.ComputerChip}
                shortcut={{ modifiers: ["cmd"], key: "m" }}
              >
                {providers.map((provider) => (
                  <Action
                    key={provider.id}
                    title={statuses?.[provider.id] ? `${provider.title} · ${statuses[provider.id]}` : provider.title}
                    icon={statuses && !statuses[provider.id] ? "dot-ready.svg" : "dot-off.svg"}
                    onAction={() => setProviderId(provider.id)}
                  />
                ))}
                {prompt.model && (
                  <Action
                    title={`Unpin ${providers.find((provider) => provider.id === prompt.model)?.title} from This Prompt`}
                    icon={Icon.PinDisabled}
                    onAction={() => upsert({ ...prompt, model: undefined })}
                  />
                )}
              </ActionPanel.Submenu>
              <Action
                title="Delete Prompt"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                shortcut={{ modifiers: ["ctrl"], key: "x" }}
                onAction={() =>
                  push(
                    <Confirm
                      title={`Delete “${prompt.name}”?`}
                      message="The prompt is removed. Outputs you've already pasted or copied aren't affected."
                      confirmTitle="Delete"
                      onConfirm={() => setPrompts(prompts.filter((each) => each.id !== prompt.id))}
                    />,
                  )
                }
              />
            </ActionPanel.Section>
            <ActionPanel.Section title="Favourites">
              {favourites.slice(0, FAVOURITE_KEYS.length).map((favourite, index) => (
                <Action
                  key={favourite.id}
                  title={`Convert with ${favourite.name}`}
                  icon={promptIcon(favourite)}
                  shortcut={{ modifiers: ["cmd"], key: FAVOURITE_KEYS[index] }}
                  onAction={() => convert(favourite)}
                />
              ))}
              <Action
                title={prompt.favourite ? "Remove from Favourites" : "Add to Favourites"}
                icon={prompt.favourite ? Icon.StarDisabled : Icon.Star}
                shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
                onAction={() => upsert({ ...prompt, favourite: !prompt.favourite || undefined })}
              />
            </ActionPanel.Section>
            {inputActions}
            {manageActions}
          </ActionPanel>
        }
      />
    );
  }

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={prompts.length > 0}
      searchBarPlaceholder={typing ? "Type your input…" : "Pick a prompt…"}
      filtering={!typing}
      searchText={typing ? input.text : searchText}
      onSearchTextChange={(text) => (typing ? setInput({ text, source: "typed" }) : setSearchText(text))}
      selectedItemId={selectedId}
      onSelectionChange={(id) => setSelectedId(id ?? undefined)}
      searchBarAccessory={
        <List.Dropdown
          tooltip="Provider for this run (⌘M). A prompt can pin its own in Edit (⌘E)."
          value={providerId}
          onChange={setProviderId}
        >
          <List.Dropdown.Section title="Provider">
            {providers.map((provider) => {
              const status = statuses?.[provider.id];
              return (
                <List.Dropdown.Item
                  key={provider.id}
                  value={provider.id}
                  title={status ? `${provider.title} · ${status}` : provider.title}
                  icon={statuses && !status ? "dot-ready.svg" : "dot-off.svg"}
                />
              );
            })}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {prompts.length === 0 && (
        <List.EmptyView
          icon={{ source: Icon.Wand, tintColor: "#5FD0C5" }}
          title="No prompts yet"
          description="Save the instructions you keep retyping. Run them on the clipboard or anything you type here."
          actions={
            <ActionPanel>
              <Action.Push title="Create Prompt" icon={Icon.Plus} target={<PromptForm onSave={upsert} />} />
              <Action
                title="Import from File…"
                icon={Icon.Download}
                shortcut={{ modifiers: ["cmd", "shift"], key: "i" }}
                onAction={runImport}
              />
            </ActionPanel>
          }
        />
      )}
      <List.Section title="Favourites">{favourites.map(renderItem)}</List.Section>
      <List.Section title="All Prompts">{others.map(renderItem)}</List.Section>
    </List>
  );
}
