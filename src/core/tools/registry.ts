import { currentTime } from "./current-time";
import { deleteFileTool } from "./delete-file";
import { editFileTool } from "./edit-file";
import { listFilesTool } from "./list-files";
import { readFileTool } from "./read-file";
import { sandboxDestroyTool } from "./sandbox-destroy";
import { sandboxExecTool } from "./sandbox-exec";
import type { SpekterTool } from "./types";
import { writeFileTool } from "./write-file";

// The one place tools are registered; both chat endpoints offer exactly these.
export const builtinTools: SpekterTool[] = [
  currentTime,
  listFilesTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  sandboxExecTool,
  sandboxDestroyTool,
];
