# Concepts

> Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Architecture

### Core
The small part of Spekter that Filip owns and writes himself, which every Interface calls and every Brick plugs into.
The Core depends on no web framework, so it can run headless and serve any Interface the same way. It is stateless between requests: the caller supplies the whole conversation each time.

### Brick
A swappable module that plugs into the Core, such as a model provider, an agent loop, memory, or a tool source.
*Avoid:* plugin, adapter (when meaning a swappable part)

A Brick can be replaced without changing the Core or any Interface; third-party frameworks are Bricks, never the Core itself.

### Interface
Any client through which Filip talks to the Core, such as the web chat, a command-line call, or a messaging bot.
Every Interface uses the same contract with the Core and gets no special treatment, so adding or removing one never changes the Core.

### Assembly point
The single core function where the model call is assembled — messages, model, and provider options brought together for both chat endpoints.
Instructions, knowledge, and tools attach there, so every Interface gets them without changing the caller contract.

### Agent loop
The Brick that runs a model call over as many steps as it needs: the model calls tools, gets their results back, and continues until it replies or reaches the step limit.
Callers depend only on Spekter's own loop interface, so one loop (the AI SDK's today, a hand-rolled one or LangGraph later) can replace another without changing the endpoints or the tools.

### Tool
Something the model can call during a reply to get information or act, defined in Spekter's own shape and registered in one place so every Interface gets the same tools.
A tool that returned a result for a reply is listed among that reply's sources.

### Source
Something external that went into a reply, such as a knowledge note given to the model or a tool that returned a result; every successful reply lists its sources.
Each source names its kind, so new knowledge Bricks and tools add new kinds rather than new response fields.
