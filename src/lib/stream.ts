/** Turn streamed stdout chunks into complete lines. */
export function lineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let buffer = "";
  return (chunk) => {
    const lines = (buffer + chunk).split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(onLine);
  };
}

type ClaudeEvent = {
  type?: string;
  event?: { delta?: { type?: string; text?: string } };
  result?: string;
  is_error?: boolean;
};

function parse(line: string): ClaudeEvent {
  try {
    return JSON.parse(line);
  } catch {
    return {};
  }
}

/** Text added by one `claude --output-format stream-json --include-partial-messages` line, or "". */
export function claudeDelta(line: string): string {
  const { type, event } = parse(line);
  return type === "stream_event" && event?.delta?.type === "text_delta" ? (event.delta.text ?? "") : "";
}

/** Final answer from the stream's `result` line. */
export function claudeResult(stdout: string): string {
  const result = stdout
    .split("\n")
    .map(parse)
    .find((event) => event.type === "result");
  if (!result || result.is_error) throw new Error(result?.result || "Claude returned no result");
  return (result.result ?? "").trim();
}

/** Text added by one `ollama /api/generate` NDJSON line; throws on an error line. */
export function ollamaDelta(line: string): string {
  if (!line.trim()) return "";
  const { response, error } = JSON.parse(line) as { response?: string; error?: string };
  if (error) throw new Error(`Ollama: ${error}`);
  return response ?? "";
}
