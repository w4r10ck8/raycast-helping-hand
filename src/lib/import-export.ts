import { showInFinder, showToast, Toast } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parsePrompts, type SavedPrompt } from "./prompt";

function friendlyError(error: unknown): string {
  if (error instanceof SyntaxError) return "That file isn't valid JSON.";
  if ((error as NodeJS.ErrnoException)?.code) return "Couldn't read that file. Check it still exists.";
  return "Expected a Helping Hand export or a Raycast snippet export.";
}

/** Pick a Helping Hand or Raycast snippet export in Finder; undefined if cancelled or invalid. */
export async function importPrompts(): Promise<Array<SavedPrompt> | undefined> {
  let file: string;
  try {
    file = (
      await runAppleScript(
        'POSIX path of (choose file with prompt "Choose a Helping Hand or Raycast snippet export" of type {"public.json"})',
      )
    ).trim();
  } catch {
    return undefined; // cancelled
  }
  try {
    const imported = parsePrompts(await readFile(file, "utf8"));
    if (imported.length === 0) {
      await showToast(Toast.Style.Failure, "No prompts found", "Each entry needs a name and a prompt (or text).");
      return undefined;
    }
    await showToast(Toast.Style.Success, `Imported ${imported.length} prompt${imported.length === 1 ? "" : "s"}`);
    return imported;
  } catch (error) {
    await showToast(Toast.Style.Failure, "Couldn't import", friendlyError(error));
    return undefined;
  }
}

export async function exportPrompts(prompts: Array<SavedPrompt>) {
  const file = join(homedir(), "Downloads", `helping-hand-prompts-${new Date().toISOString().slice(0, 10)}.json`);
  try {
    await writeFile(file, JSON.stringify(prompts, null, 2));
    await showToast(Toast.Style.Success, `Exported ${prompts.length} prompts`, "Saved to Downloads");
    await showInFinder(file);
  } catch (error) {
    await showToast(Toast.Style.Failure, "Export failed", String(error));
  }
}
