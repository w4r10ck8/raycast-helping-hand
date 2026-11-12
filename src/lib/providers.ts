import { AI, environment, getPreferenceValues } from "@raycast/api";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { claudeDelta, claudeResult, lineSplitter, ollamaDelta } from "./stream";

export type ProviderId = "claude" | "codex" | "apple" | "raycast" | "ollama";

/** `onText` receives output as it streams (Codex only reports the final message). */
export type RunOptions = { signal?: AbortSignal; onText?: (text: string) => void };

export type Provider = {
  id: ProviderId;
  title: string;
  /** Why it can't run right now (shown in the model dropdown), or undefined when ready. */
  status: () => Promise<string | undefined>;
  run: (prompt: string, options?: RunOptions) => Promise<string>;
};

// Raycast launches with a bare PATH, so add the usual CLI install locations.
const PATH = [join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", process.env.PATH].join(":");
const OUTPUT_ONLY = "Follow the user's instructions exactly. Output only the resulting text, no preamble.";

function exec(
  command: string,
  args: Array<string>,
  stdin: string,
  { signal, onStdout }: { signal?: AbortSignal; onStdout?: (chunk: string) => void } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      { cwd: tmpdir(), env: { ...process.env, PATH }, maxBuffer: 10 * 1024 * 1024, timeout: 180_000, signal },
      (error, stdout, stderr) => (error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout.trim())),
    );
    if (onStdout) child.stdout?.on("data", onStdout);
    child.stdin?.end(stdin);
  });
}

function onPath(binary: string): boolean {
  return PATH.split(":").some((dir) => dir && existsSync(join(dir, binary)));
}

const { claudeModel, codexModel, ollamaModel } = getPreferenceValues<{
  claudeModel?: string;
  codexModel?: string;
  ollamaModel?: string;
}>();
const OLLAMA = "http://localhost:11434";
const applePath = join(environment.assetsPath, "apple-ai");

const PROVIDERS: Array<Provider> = [
  {
    id: "claude",
    title: "Claude",
    status: async () => (onPath("claude") ? undefined : "Not installed"),
    run: async (prompt, { signal, onText } = {}) =>
      claudeResult(
        await exec(
          "claude",
          [
            "-p",
            // No user settings (hooks, plugins) or tools: plain text in, text out.
            ...["--setting-sources", "", "--tools", "", "--no-session-persistence"],
            ...["--system-prompt", OUTPUT_ONLY],
            ...["--output-format", "stream-json", "--verbose", "--include-partial-messages"],
            ...(claudeModel ? ["--model", claudeModel] : []),
          ],
          prompt,
          {
            signal,
            onStdout:
              onText &&
              lineSplitter((line) => {
                const text = claudeDelta(line);
                if (text) onText(text);
              }),
          },
        ),
      ),
  },
  {
    id: "codex",
    title: "Codex",
    status: async () => (onPath("codex") ? undefined : "Not installed"),
    run: async (prompt, { signal } = {}) => {
      // codex logs progress to stdout, so read the final message from a file instead.
      const outFile = join(tmpdir(), `helping-hand-${crypto.randomUUID()}.txt`);
      try {
        await exec(
          "codex",
          [
            "exec",
            ...["--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-o", outFile],
            ...(codexModel ? ["-m", codexModel] : []),
          ],
          `${OUTPUT_ONLY}\n\n${prompt}`,
          { signal },
        );
        return (await readFile(outFile, "utf8")).trim();
      } finally {
        await rm(outFile, { force: true });
      }
    },
  },
  {
    id: "apple",
    title: "Apple Intelligence",
    status: async () => (existsSync(applePath) ? undefined : "Not built"),
    run: (prompt, { signal, onText } = {}) => exec(applePath, [], prompt, { signal, onStdout: onText }),
  },
  {
    id: "raycast",
    title: "Raycast AI",
    status: async () => (environment.canAccess(AI) ? undefined : "Needs Raycast Pro"),
    run: async (prompt, { signal, onText } = {}) => {
      const answer = AI.ask(`${OUTPUT_ONLY}\n\n${prompt}`, { signal });
      if (onText) answer.on("data", onText);
      return (await answer).trim();
    },
  },
  {
    id: "ollama",
    title: "Ollama (local)",
    status: () =>
      fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(1000) }).then(
        () => undefined,
        () => "Not running",
      ),
    run: async (prompt, { signal, onText } = {}) => {
      const response = await fetch(`${OLLAMA}/api/generate`, {
        method: "POST",
        signal,
        body: JSON.stringify({ model: ollamaModel || "llama3.2", system: OUTPUT_ONLY, prompt, stream: true }),
      });
      if (!response.ok || !response.body) throw new Error(`Ollama: ${(await response.text()) || response.statusText}`);
      let text = "";
      const push = lineSplitter((line) => {
        const delta = ollamaDelta(line);
        text += delta;
        if (delta) onText?.(delta);
      });
      const decoder = new TextDecoder();
      for await (const chunk of response.body) push(decoder.decode(chunk, { stream: true }));
      push("\n");
      return text.trim();
    },
  },
];

export function getProviders(): Array<Provider> {
  return PROVIDERS;
}
