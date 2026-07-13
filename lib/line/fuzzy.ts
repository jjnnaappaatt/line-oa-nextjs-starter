/**
 * Fuzzy command matcher for the chat bot. `normalize()` strips punctuation/whitespace and lowercases
 * (keeping Unicode letters/numbers/marks, so it works for non-Latin scripts too); `matchCommand()`
 * does an exact-alias lookup, then a difflib-style similarity match so small typos still resolve.
 *
 * Language-agnostic engine — swap the alias tables below for your own commands (any language).
 */
export type CommandKey = "help" | "list" | "status" | "manage" | "report" | "cancel";

// canonical label + accepted aliases (add your own; mix languages freely)
const COMMANDS: Record<Exclude<CommandKey, "cancel">, [string, string[]]> = {
  help: ["help", ["help", "menu", "start", "hi", "hello", "commands", "?"]],
  list: ["my projects", ["list", "projects", "my projects", "mine", "submit"]],
  status: ["status", ["status", "check", "progress", "this month"]],
  manage: ["manage", ["manage", "settings", "subscriptions", "unsubscribe list"]],
  report: ["report an issue", ["report", "issue", "bug", "problem", "support", "help me"]],
};

export function normalize(text: string): string {
  return (text || "").replace(/[^\p{L}\p{N}\p{M}]/gu, "").toLowerCase();
}

// normalized alias → canonical command key
const ALIAS = new Map<string, Exclude<CommandKey, "cancel">>();
for (const [cmd, [, aliases]] of Object.entries(COMMANDS) as [Exclude<CommandKey, "cancel">, [string, string[]]][]) {
  for (const a of aliases) ALIAS.set(normalize(a), cmd);
}

export function labelOf(cmd: CommandKey): string {
  return cmd === "cancel" ? "cancel" : COMMANDS[cmd]?.[0] ?? cmd;
}

const CANCEL_PREFIXES = ["cancel", "stop", "unsub", "unsubscribe", "quit"];
export function isCancel(text: string): boolean {
  const n = normalize(text);
  return CANCEL_PREFIXES.some((p) => n.startsWith(normalize(p)));
}

/** difflib.SequenceMatcher.ratio() equivalent (gestalt matching), sufficient for short command strings. */
function seqRatio(a: string, b: string): number {
  const matches = (x: string, y: string): number => {
    if (!x.length || !y.length) return 0;
    const bIndex = new Map<string, number[]>();
    for (let j = 0; j < y.length; j++) (bIndex.get(y[j]) ?? bIndex.set(y[j], []).get(y[j])!).push(j);
    let best = { aStart: 0, bStart: 0, len: 0 };
    let j2len = new Map<number, number>();
    for (let i = 0; i < x.length; i++) {
      const next = new Map<number, number>();
      for (const j of bIndex.get(x[i]) ?? []) {
        const k = (j2len.get(j - 1) ?? 0) + 1;
        next.set(j, k);
        if (k > best.len) best = { aStart: i - k + 1, bStart: j - k + 1, len: k };
      }
      j2len = next;
    }
    if (best.len === 0) return 0;
    return best.len
      + matches(x.slice(0, best.aStart), y.slice(0, best.bStart))
      + matches(x.slice(best.aStart + best.len), y.slice(best.bStart + best.len));
  };
  const total = a.length + b.length;
  return total ? (2 * matches(a, b)) / total : 0;
}

const RESOLVE = 0.84, SUGGEST = 0.6;

/**
 * → [command, exact, suggestions].
 *  - command set with exact=true  → an exact alias match
 *  - command set with exact=false → high-confidence fuzzy match
 *  - suggestions non-empty        → ambiguous; offer a "did you mean …?"
 */
export function matchCommand(text: string): [Exclude<CommandKey, "cancel"> | null, boolean, Exclude<CommandKey, "cancel">[]] {
  const n = normalize(text);
  if (!n) return [null, false, []];
  const exact = ALIAS.get(n);
  if (exact) return [exact, true, []];

  const best = new Map<Exclude<CommandKey, "cancel">, number>();
  for (const [alias, cmd] of ALIAS) {
    const s = seqRatio(n, alias);
    if (s > (best.get(cmd) ?? 0)) best.set(cmd, s);
  }
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return [null, false, []];
  const [topCmd, topScore] = ranked[0];
  const secondScore = ranked[1]?.[1] ?? 0;
  if (topScore >= RESOLVE && topScore - secondScore >= 0.05) return [topCmd, false, []];
  if (topScore >= SUGGEST) return [null, false, ranked.filter(([, s]) => s >= SUGGEST).slice(0, 3).map(([c]) => c)];
  return [null, false, []];
}
