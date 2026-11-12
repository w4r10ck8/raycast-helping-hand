/** `icon` and `color` are key names from Raycast's `Icon` and `Color` enums. */
export type SavedPrompt = {
  id: string;
  name: string;
  prompt: string;
  icon?: string;
  color?: string;
  favourite?: boolean;
  /** Provider id this prompt always runs with, overriding the dropdown. */
  model?: string;
};

const PLACEHOLDER = /\{(clipboard|text|input)\}/g;

/** Drop the input into the prompt's placeholder, or append it when there isn't one. */
export function applyPrompt(prompt: string, input: string): string {
  return prompt.search(PLACEHOLDER) >= 0 ? prompt.replace(PLACEHOLDER, () => input) : `${prompt.trim()}\n\n${input}`;
}

/** Parse our own export, or a Raycast snippet export (array of { name, text, keyword? }). */
export function parsePrompts(json: string): Array<SavedPrompt> {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data)) throw new Error("Expected a JSON array of prompts or snippets");
  return data
    .map((item) => ({ ...item, prompt: item?.prompt ?? item?.text }))
    .filter((item) => typeof item.name === "string" && typeof item.prompt === "string")
    .map(({ id, name, prompt, icon, color, favourite, model }) => ({
      id: typeof id === "string" ? id : crypto.randomUUID(),
      name,
      prompt,
      ...(typeof icon === "string" && { icon }),
      ...(typeof color === "string" && { color }),
      ...(favourite === true && { favourite }),
      ...(typeof model === "string" && { model }),
    }));
}

/** Add imported prompts, replacing existing ones with the same id so re-importing an export doesn't duplicate. */
export function mergePrompts(existing: Array<SavedPrompt>, imported: Array<SavedPrompt>): Array<SavedPrompt> {
  const importedIds = new Set(imported.map((prompt) => prompt.id));
  return [...existing.filter((prompt) => !importedIds.has(prompt.id)), ...imported];
}
