/** Sprint M4 client pure bits: copy truth table, onboarding questions, answer pairs, banned words. */
import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { COPY, fallbackNote, ONBOARDING_QUESTIONS, PROFILE_TEMPLATE } from "../../web/src/lib/copy";
import { answerPairs, freshState, ONBOARDING_KEY } from "../../web/src/lib/onboarding.svelte";
import { PROFILE_TEMPLATE as SERVER_TEMPLATE } from "../src/init";
import { isEmptyKb } from "../src/prompts";

const WEB = resolve(import.meta.dir, "..", "..", "web", "src");

describe("psychologist §F copy truth table (verbatim)", () => {
  test("fallback banner by cause (psychologist-AC18)", () => {
    for (const c of ["claude_missing", "timeout", "exit_1", "rate_limited"]) {
      expect(fallbackNote(c)).toBe("From the apothecary's own shelf today: Claude couldn't answer, so these come from your saved pool.");
    }
    for (const c of ["invalid_output", "ai_error"]) {
      expect(fallbackNote(c)).toBe("From the apothecary's own shelf today: Claude's draft didn't fit your rules, so these come from your saved pool.");
    }
    expect(fallbackNote("claude_not_logged_in")).toBe("From the apothecary's own shelf today: the model needs a fresh login (or a working API key) on the computer.");
  });
  test("reflect, care, stale, draft, onboarding strings", () => {
    expect(COPY.reflectNone).toBe("Nothing new to note today.");
    expect(COPY.reflectFailed).toBe("Couldn't reach Claude for reflections. Your ledger is saved.");
    expect(COPY.careNote).toBe(
      "That sounded heavy. If it's more than a hard day, please talk to someone you trust or a local crisis line. The ledger will wait.",
    );
    expect(COPY.proposalStale).toBe("This note changed in your notebook, so it was left alone.");
    expect(COPY.draftHint).toBe("Edit freely. This file is yours.");
    expect(COPY.onboardingFailed).toBe("Couldn't reach Claude. Your answers are safe.");
    expect(COPY.onboardingAsk).toBe("Ask Maomao to write my notes");
    expect(COPY.proposalKeep).toBe("Keep");
    expect(COPY.proposalSkip).toBe("Skip");
  });
  test("no banned words in any M4 string, and the UI never says Reject/wrong", () => {
    const strings: string[] = [];
    for (const v of Object.values(COPY)) {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) strings.push(...v);
      else if (typeof v === "function") {
        try {
          strings.push(String((v as (...a: unknown[]) => string)("X", 1)));
        } catch {
          strings.push(String((v as (...a: unknown[]) => string)(["X"])));
        }
      }
    }
    strings.push(...ONBOARDING_QUESTIONS.map((q) => q.text), ...ONBOARDING_QUESTIONS.flatMap((q) => q.options ?? []));
    const banned = /\b(failed|fail|missed|lost|invalid|error|should|must|reject\w*|wrong|diagnos\w*|AI)\b/;
    for (const s of strings) expect(s.replace("Nothing was lost", "")).not.toMatch(banned);
  });
});

describe("ONBOARDING_QUESTIONS (psychologist-AC1)", () => {
  test("15 questions, unique ids, options where needed", () => {
    expect(ONBOARDING_QUESTIONS).toHaveLength(15);
    expect(new Set(ONBOARDING_QUESTIONS.map((q) => q.id)).size).toBe(15);
    for (const q of ONBOARDING_QUESTIONS) {
      if (q.kind === "multi" || q.kind === "choice") expect(q.options?.length).toBeGreaterThan(1);
      expect(q.text.length).toBeLessThanOrEqual(300);
    }
  });
  test("no sensitive topics", () => {
    const text = ONBOARDING_QUESTIONS.map((q) => `${q.text} ${(q.options ?? []).join(" ")}`).join("\n");
    expect(text).not.toMatch(/\b(health|weight|diet|mood|religio\w*|politic\w*|relationship\w*|family|partner|medic\w*|sexual\w*)\b/i);
  });
});

describe("onboarding client state (designer-AC4)", () => {
  test("one storage key; answer pairs send every question, skipped ones as empty", () => {
    expect(ONBOARDING_KEY).toBe("qj:onboarding:v1");
    expect(freshState().mode).toBe("quiz");
    const pairs = answerPairs(ONBOARDING_QUESTIONS, { name: " Nurasyl ", enjoy: ["manga", "cafés"], else: "x".repeat(2000) });
    expect(pairs).toHaveLength(15);
    expect(pairs[0]).toEqual({ question: ONBOARDING_QUESTIONS[0]!.text, answer: "Nurasyl" });
    expect(pairs[3]!.answer).toBe("manga, cafés");
    expect(pairs[1]!.answer).toBe("");
    expect(pairs[14]!.answer.length).toBe(1000);
  });
  test("a multi-select's own text is appended after the chips", () => {
    const pairs = answerPairs(ONBOARDING_QUESTIONS, { enjoy: ["manga"], "enjoy:own": " chess, photography " });
    expect(pairs[3]!.answer).toBe("manga, chess, photography");
    expect(answerPairs(ONBOARDING_QUESTIONS, { "enjoy:own": "chess" })[3]!.answer).toBe("chess");
  });
  test("'Write my notes myself' template counts as an empty profile, like the server template", () => {
    expect(isEmptyKb(PROFILE_TEMPLATE)).toBe(true);
    expect(isEmptyKb(SERVER_TEMPLATE)).toBe(true);
    for (const h of ["## About me", "## Goals", "## What I enjoy", "## Limits and budget"]) {
      expect(PROFILE_TEMPLATE).toContain(h);
      expect(SERVER_TEMPLATE).toContain(h);
    }
  });
});

describe("plain-text rendering of model text (architect risk 10)", () => {
  test("M4 components never use {@html} and never linkify", async () => {
    for (const f of ["lib/components/ProposalList.svelte", "routes/Onboarding.svelte", "routes/Evening.svelte", "routes/Profile.svelte"]) {
      const text = await readFile(join(WEB, f), "utf8");
      expect(text.replace(/<!--[\s\S]*?-->/g, "")).not.toContain("{@html");
    }
  });
  test("only the onboarding module touches localStorage", async () => {
    const hits: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (/\.(svelte|ts)$/.test(e.name)) {
          const code = (await readFile(p, "utf8")).replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
          if (code.includes("localStorage")) hits.push(p.slice(WEB.length + 1));
        }
      }
    };
    await walk(WEB);
    // theme.ts stores the light/dark preference (designer, M2); onboarding is the only M4 user; settings.ts (M6,
    // designer-AC16) stores the motion + stickers display preferences, and (H1, backlog 228) the one overwrite-only
    // "<date>:<kind>" of the dismissed Today info line. No journal text ever goes to localStorage.
    expect(hits.sort()).toEqual(["lib/infoDismissed.ts", "lib/onboarding.svelte.ts", "lib/settings.ts", "lib/theme/theme.ts"]);
    const settings = await readFile(join(WEB, "lib/settings.ts"), "utf8");
    // + qj-countdown: on/off for the Today "fresh page in …" line (display preference only).
    expect([...settings.matchAll(/KEY = '([^']+)'/g)].map((m) => m[1])).toEqual(["qj-motion", "qj-countdown", "qj-stickers"]);
    const info = await readFile(join(WEB, "lib/infoDismissed.ts"), "utf8");
    expect([...info.matchAll(/KEY = '([^']+)'/g)].map((m) => m[1])).toEqual(["qj.infoDismissed"]);
  });
});
