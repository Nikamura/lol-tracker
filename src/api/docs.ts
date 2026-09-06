import { readFile } from "node:fs/promises";
import type { Context } from "hono";

// src/api and dist/api have the same relative path to the packaged guide.
const guideUrl = new URL("../../API.md", import.meta.url);

export async function serveApiDocs(c: Context) {
  const markdown = await readFile(guideUrl, "utf8");
  return c.body(markdown, 200, {
    "Content-Type": "text/markdown; charset=utf-8",
    "Cache-Control": "no-cache",
  });
}
