import assert from "node:assert/strict";
import test from "node:test";
import { applyPrompt, mergePrompts, parsePrompts } from "./prompt.ts";
import { claudeDelta, claudeResult, lineSplitter, ollamaDelta } from "./stream.ts";

test("applyPrompt replaces placeholders, else appends", () => {
  assert.equal(applyPrompt("Fix: {clipboard}. Again {text}", "hi $&"), "Fix: hi $&. Again hi $&");
  assert.equal(applyPrompt("Make it formal.\n", "yo"), "Make it formal.\n\nyo");
});

test("parsePrompts reads snippet exports, keeps valid entries only", () => {
  const out = parsePrompts(
    JSON.stringify([{ name: "Email", text: "Rewrite {clipboard}", keyword: "!e" }, { name: 1 }]),
  );
  assert.deepEqual(
    out.map(({ name, prompt }) => ({ name, prompt })),
    [{ name: "Email", prompt: "Rewrite {clipboard}" }],
  );
  assert.throws(() => parsePrompts("{}"));
});

test("export round-trips and re-import replaces by id", () => {
  const saved = [
    { id: "a", name: "Email", prompt: "Rewrite", icon: "Envelope", color: "Blue", favourite: true, model: "codex" },
  ];
  const imported = parsePrompts(JSON.stringify(saved));
  assert.deepEqual(imported, saved);
  assert.deepEqual(
    mergePrompts(
      [
        { id: "a", name: "Old", prompt: "x" },
        { id: "b", name: "B", prompt: "y" },
      ],
      imported,
    ),
    [{ id: "b", name: "B", prompt: "y" }, ...saved],
  );
});

test("claude stream: deltas survive chunk splits, result is final text", () => {
  const delta = (text: string) =>
    JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text } },
    });
  const stdout = [delta("Hel"), delta("lo"), JSON.stringify({ type: "result", result: " Hello\n" })].join("\n") + "\n";
  let streamed = "";
  const push = lineSplitter((line) => (streamed += claudeDelta(line)));
  push(stdout.slice(0, 30));
  push(stdout.slice(30));
  assert.equal(streamed, "Hello");
  assert.equal(claudeResult(stdout), "Hello");
  assert.throws(() => claudeResult(JSON.stringify({ type: "result", is_error: true, result: "boom" })), /boom/);
});

test("ollama stream: concatenates responses, surfaces errors", () => {
  let text = "";
  const push = lineSplitter((line) => (text += ollamaDelta(line)));
  push('{"response":"Hel"}\n{"respo');
  push('nse":"lo","done":false}\n{"response":"","done":true}\n');
  assert.equal(text, "Hello");
  assert.throws(() => ollamaDelta('{"error":"model \\"x\\" not found"}'), /not found/);
});
