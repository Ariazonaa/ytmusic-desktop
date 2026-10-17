// Lyrics translated line by line, with MyMemory (api.mymemory.translated.net):
// no account needed, about 5000 characters a day for each address. The
// lyrics are sent in a few blocks of lines; each block keeps its line breaks.

import type { JsonResponse } from "../../shared/types";

type GetJson = (url: string) => Promise<JsonResponse>;

/** MyMemory takes at most 500 bytes per request. */
const MAX_BLOCK_BYTES = 480;

export class QuotaError extends Error {}

const bytes = (text: string): number => new TextEncoder().encode(text).length;

/** Consecutive lines in blocks short enough for one request. Empty lines stay out. */
export function blocks(lines: readonly string[]): number[][] {
  const result: number[][] = [];
  let current: number[] = [];
  let size = 0;
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    const length = bytes(line) + 1;
    if (current.length > 0 && size + length > MAX_BLOCK_BYTES) {
      result.push(current);
      current = [];
      size = 0;
    }
    current.push(index);
    size += length;
  });
  if (current.length > 0) result.push(current);
  return result;
}

export const translateUrl = (text: string, target: string): string =>
  `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`autodetect|${target}`)}`;

interface Answer {
  text: string;
  detected: string | null;
}

async function ask(getJson: GetJson, text: string, target: string): Promise<Answer> {
  const { status, data } = await getJson(translateUrl(text, target));
  const answer = (data ?? {}) as {
    quotaFinished?: unknown;
    responseData?: { translatedText?: unknown; detectedLanguage?: unknown };
  };
  if (answer.quotaFinished === true || status === 429) throw new QuotaError("the daily amount of translations is used up");
  const translated = answer.responseData?.translatedText;
  if (status !== 200 || typeof translated !== "string") throw new Error(`the translation service answered ${status}`);
  const detected = answer.responseData?.detectedLanguage;
  return { text: translated, detected: typeof detected === "string" ? detected.toLowerCase() : null };
}

const same = (a: string, b: string): boolean => a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();

/**
 * The lines in the language `target` (e.g. `de`), one for each line given;
 * empty lines stay empty. `null` if the lyrics are in that language already.
 */
export async function translateLines(getJson: GetJson, lines: readonly string[], target: string): Promise<string[] | null> {
  const translated = lines.map(() => "");
  let foreign = false;
  for (const block of blocks(lines)) {
    const answer = await ask(getJson, block.map((index) => lines[index]).join("\n"), target);
    if (answer.detected !== null && answer.detected.split("-")[0] !== target) foreign = true;
    let parts = answer.text.split("\n");
    // The line breaks did not come back as sent: line by line instead.
    if (parts.length !== block.length) {
      parts = [];
      for (const index of block) parts.push((await ask(getJson, lines[index] ?? "", target)).text);
    }
    block.forEach((index, i) => {
      const line = parts[i]?.trim() ?? "";
      // A line the service gave back as it was, at most with other spaces, gets no translation.
      translated[index] = same(line, lines[index] ?? "") ? "" : line;
    });
  }
  return foreign ? translated : null;
}
