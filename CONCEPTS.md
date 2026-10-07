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
