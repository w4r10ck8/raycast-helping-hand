import { environment } from "@raycast/api";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type Chip = { label: string; tone?: "active" | "success" };

// Roughly the detail pane width, so the image renders near 1:1 and chips sit at the right edge.
const WIDTH = 440;
const HEIGHT = 34;

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function svg(title: string, chips: Array<Chip>) {
  const dark = environment.appearance === "dark";
  const palette = {
    title: dark ? "#ffffff" : "#1d1d1f",
    active: { fill: "#4a3b8c", stroke: "#8b7cf6", text: "#ece8ff" },
    success: { fill: dark ? "#1f3a2b" : "#e3f5ea", stroke: "#3fa66a", text: dark ? "#b8f0cc" : "#1d6b3d" },
    idle: dark
      ? { fill: "#2c2c2e", stroke: "#3a3a3c", text: "#d1d1d6" }
      : { fill: "#f2f2f7", stroke: "#d1d1d6", text: "#3a3a3c" },
  };
  let x = WIDTH;
  // ponytail: ~7px per glyph at 12px is an estimate; measure text if labels get clipped.
  const pills = [...chips].reverse().map(({ label, tone }) => {
    const width = label.length * 7 + 22;
    x -= width + 6;
    const color = palette[tone ?? "idle"];
    return `<rect x="${x}" y="5" width="${width}" height="24" rx="12" fill="${color.fill}" stroke="${color.stroke}"/><text x="${
      x + width / 2
    }" y="21.5" text-anchor="middle" font-size="12" font-weight="500" fill="${color.text}">${escape(label)}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="-apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif"><text x="1" y="25" font-size="22" font-weight="700" fill="${
    palette.title
  }">${escape(title)}</text>${pills.join("")}</svg>`;
}

/** Markdown image of a heading with chips right-aligned on the same row (markdown can't lay that out). */
export function headerImage(title: string, chips: Array<Chip>): string {
  const content = svg(title, chips);
  const dir = join(environment.supportPath, "headers");
  // Content-addressed so Raycast never shows a stale cached image.
  const file = join(dir, `${createHash("sha1").update(content).digest("hex").slice(0, 12)}.svg`);
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, content);
  }
  return `![${title}](${pathToFileURL(file).href}?raycast-width=${WIDTH}&raycast-height=${HEIGHT})`;
}
