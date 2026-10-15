import { resolve, sep } from "node:path";

export const DEFAULT_FILE_DIRS = ["skills", "knowledge"];

// Directories the file tools may touch, relative to the project root.
// Editable via SPEKTER_FILE_DIRS (comma-separated).
export function fileToolDirs(env = process.env): string[] {
  const configured = env.SPEKTER_FILE_DIRS?.split(",").map((dir) => dir.trim()).filter(Boolean);
  return configured?.length ? configured : DEFAULT_FILE_DIRS;
}

// Resolves a model-supplied path and rejects anything outside an allowed
// directory — absolute paths, .. escapes, and the allowed dirs themselves.
export function resolveScopedPath(path: string, env = process.env): string {
  const file = resolve(path);
  const allowed = fileToolDirs(env).map((dir) => resolve(dir));
  if (allowed.some((dir) => file === dir || file.startsWith(dir + sep))) return file;
  throw new Error(`Path must stay inside one of: ${fileToolDirs(env).join(", ")}`);
}
