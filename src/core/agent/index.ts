import { aiSdkLoop } from "./ai-sdk-loop";
import type { AgentLoop } from "./loop";

// The active agent loop Brick. Swapping loops means changing this line and adding a file beside it.
export const agentLoop: AgentLoop = aiSdkLoop;
