---
name: Spekter
last_updated: 2026-10-01
---

# Spekter Strategy

## Purpose

Filip wants to get good at AI engineering, but off-the-shelf agent tools hide how they work. He can't open them up, tweak the internals, and see what actually makes an agent more efficient or reliable.

## Positioning

Filip owns a small core, and everything else plugs in as a swappable Lego brick, frameworks like LangGraph included, so he can replace any piece and see how it changes the whole system.

## Users

**Primary:** Filip, in evening experiment sessions or when implementing an AI pattern he just read about, not for real work. He's using Spekter as a system he can take apart, rebuild, and learn from.

## Boundaries

- Spekter isn't used for real client work, even when a flow works well.
- Spekter runs locally until local becomes the limit. Always-on hosting comes later, and the core stays able to run headless.
- No custom dashboards. Instrumentation writes plain logs, and visualization is left to whatever tool fits.
- UX and UI polish come after speed, reliability and room to experiment.

_Resist a change when:_ it ties the core to one framework, interface, or tool, or when it serves real work rather than experiments.

## Key metrics

- **Experiment log** - share of sessions that end working and understood; a two-line entry per session in a markdown file in the repo.
- **Latency** - time from request to complete reply; recorded by the API.
- **Success rate** - share of requests that return a real reply rather than an error; recorded by the API.
- **Swap time** - rough time to replace one module; noted in the experiment log.
- **Cost** - monthly spend, kept under $1,000 as a guardrail rather than a goal; read from the OpenRouter dashboard.

## Tracks

### Backend

The small core and its swappable modules: model provider, memory, agent loop.

_Why it serves the approach:_ it's the part Filip owns, and the modules are the Lego bricks.

### Tools and knowledge

MCP servers, Google Docs, `.md` files: everything the agent can reach.

_Why it serves the approach:_ these are the bricks swapped most often, so they test whether the core really stays small.

### Interfaces

The web chat, Telegram, WhatsApp, Discord, each just another client of the core.

_Why it serves the approach:_ keeping every interface outside the core means no interface can tie it down.

### Instrumentation

Latency, success rate, cost, and the experiment log, written as plain logs that any tool can visualize.

_Why it serves the approach:_ it turns "swap a module" into "see how it changed the system."

## Brand

**One-liner:** Spekter: my personal AI lab.
