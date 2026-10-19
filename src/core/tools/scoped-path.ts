import { lstat, realpath, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

export const DEFAULT_FILE_DIRS = ["skills", "knowledge"];

// Directories the file tools may touch, relative to the project root.
// Editable via SPEKTER_FILE_DIRS (comma-separated).
export function fileToolDirs(env = process.env): string[] {
  const configured = env.SPEKTER_FILE_DIRS?.split(",").map((dir) => dir.trim()).filter(Boolean);
  return configured?.length ? configured : DEFAULT_FILE_DIRS;
}

const isInside = (file: string, dirs: string[]) => dirs.some((dir) => file === dir || file.startsWith(dir + sep));

// Real path of the nearest existing ancestor plus the not-yet-created remainder. A link that
// exists but cannot be resolved (dangling) is returned as-is, so it can never pass containment
// and a write through it can never create its target somewhere else.
async function canonicalPath(path: string): Promise<string | null> {
  const rest: string[] = [];
  for (let current = path; ; current = dirname(current)) {
    try {
      return join(await realpath(current), ...rest.reverse());
    } catch {
      if (await lstat(current).then(() => true, () => false)) return null;
      if (dirname(current) === current) return path;
      rest.push(basename(current));
    }
  }
}

// Resolves a model-supplied path and rejects anything outside an allowed directory —
// absolute paths, .. escapes, the allowed dirs themselves, and symlinks (anywhere in the path)
// whose real target leaves them. Returns the real path, so callers operate on the target
// they were checked against.
export async function resolveScopedPath(path: string, env = process.env): Promise<string> {
  const file = resolve(path);
  const allowed = fileToolDirs(env).map((dir) => resolve(dir));
  const reject = () => new Error(`Path must stay inside one of: ${fileToolDirs(env).join(", ")}`);
  if (!isInside(file, allowed)) throw reject();

  const realFile = await canonicalPath(file);
  const realAllowed = await Promise.all(allowed.map(async (dir) => (await canonicalPath(dir)) ?? dir));
  if (!realFile || !isInside(realFile, realAllowed)) throw reject();
  return realFile;
}

// Stats for an existing path, null when nothing is there. Callers reject anything that is not a
// regular file: a FIFO would block a read forever and a device or socket is never a note.
export async function statIfExists(file: string): Promise<Stats | null> {
  return stat(file).catch(() => null);
}
