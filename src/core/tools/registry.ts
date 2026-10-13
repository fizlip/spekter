import { currentTime } from "./current-time";
import type { SpekterTool } from "./types";

// The one place tools are registered; both chat endpoints offer exactly these.
export const builtinTools: SpekterTool[] = [currentTime];
