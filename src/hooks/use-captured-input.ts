import { Clipboard, getFrontmostApplication } from "@raycast/api";
import { useEffect, useState } from "react";

export type InputSource = "clipboard" | "typed";
export type Input = { text: string; source: InputSource };
export type Captured = { clipboard?: string; app?: string };

/** Clipboard text and the app Raycast was opened from, captured on launch. */
export function useCapturedInput() {
  const [captured, setCaptured] = useState<Captured>({});
  const [input, setInput] = useState<Input>({ text: "", source: "clipboard" });

  async function capture() {
    const app = await getFrontmostApplication().then(
      ({ name }) => name,
      () => undefined,
    );
    const clipboard = (await Clipboard.readText()) || undefined;
    setCaptured({ clipboard, app });
    setInput({ text: clipboard ?? "", source: "clipboard" });
  }

  useEffect(() => {
    capture();
  }, []);

  return { input, setInput, captured, capture };
}
