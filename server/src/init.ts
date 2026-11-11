/**
 * Data-repo init (milestone 1). Creates DATA_DIR and its layout, copies the seed YAML files
 * byte-for-byte, writes kb templates, and `git init`s the repo. Never overwrites an existing file.
 */
import { constants } from "node:fs";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertSafeDataDir } from "./config";
import type { Git } from "./git";

export const PROFILE_TEMPLATE = `# Profile

> Written by you. The onboarding quiz can draft this page later. Nothing here is filled in yet.

## About me

## Goals

## What I enjoy

## Limits and budget
`;

export const INSIGHTS_TEMPLATE = `# Insights
`;

export const DATA_GITIGNORE = `.obsidian/workspace*
*.swp
*~
.#*
*.tmp-*
.trash/
.cache/
# Photos stay on this machine only (never committed).
media/
`;

export const DATA_DIRS = ["days", "weeks", "kb", "kb/proposals"] as const;
export const SEED_FILES = ["quests.yaml", "rewards.yaml"] as const;

export interface InitResult {
  dataDir: string;
  created: string[];
  skipped: string[];
  warnings: string[];
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function writeIfMissing(path: string, content: string): Promise<boolean> {
  try {
    await writeFile(path, content, { flag: "wx" });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}

async function copyIfMissing(src: string, dest: string): Promise<boolean> {
  try {
    await copyFile(src, dest, constants.COPYFILE_EXCL);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}

export async function initDataRepo(opts: { dataDir: string; seedDir: string; git?: Git }): Promise<InitResult> {
  const dataDir = resolve(opts.dataDir);
  assertSafeDataDir(dataDir);
  const res: InitResult = { dataDir, created: [], skipped: [], warnings: [] };

  await mkdir(dataDir, { recursive: true });
  for (const d of DATA_DIRS) {
    const p = join(dataDir, d);
    if (await exists(p)) continue;
    await mkdir(p, { recursive: true });
    res.created.push(`${d}/`);
  }

  const files: [string, string][] = [
    [".gitignore", DATA_GITIGNORE],
    ["kb/profile.md", PROFILE_TEMPLATE],
    ["kb/insights.md", INSIGHTS_TEMPLATE],
  ];
  for (const [rel, content] of files) {
    (await writeIfMissing(join(dataDir, rel), content) ? res.created : res.skipped).push(rel);
  }

  for (const name of SEED_FILES) {
    const src = join(opts.seedDir, name);
    if (!(await exists(src))) {
      res.warnings.push(`seed file missing: ${src}`);
      continue;
    }
    (await copyIfMissing(src, join(dataDir, name)) ? res.created : res.skipped).push(name);
  }

  if (opts.git) {
    await opts.git.init();
    if (res.created.length > 0) opts.git.touch({ kind: "init" });
  }
  return res;
}
