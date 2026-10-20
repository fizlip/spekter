# Spekter

My personal AI lab. See [STRATEGY.md](STRATEGY.md) for what it is and why.

## Getting started

```bash
npm install
cp .env.example .env.local   # then add your OpenRouter key
npm run dev
```

The dev server listens on `http://127.0.0.1:3000` only, so nothing on your network can reach the API.

The app itself has three pages: `/` is the chat — streaming replies, reasoning traces, tool-call status, slash-command autocomplete, and a model picker fed by `GET /api/models` — `/files` lists the knowledge notes, and `/logs` renders the request log.

## Core chat API

`POST /api/chat` takes a conversation and returns the assistant's next reply as one complete message. It is stateless: send the full history every time. The model comes from an optional `model` field on the request, falling back to `SPEKTER_MODEL` in `.env.local`. `GET /api/models` returns the models available to the configured key, sorted by id and cached for an hour — the web chat's model picker reads it.

The model's instructions come from one markdown file, pointed at by `SPEKTER_SYSTEM_PROMPT` and read fresh on every request, so editing the file takes effect on the next request with no restart. Both endpoints get the same instructions. Unset or an empty file sends no instructions, exactly as before; a configured file that cannot be read fails as `not_configured`, naming the file.

Knowledge comes from a folder of markdown notes, pointed at by `SPEKTER_KNOWLEDGE_DIR`. Every `.md` file in it, subfolders included, is read fresh on every request and sent to the model as its own block after the instructions, each note labelled with its path inside the folder. Hidden files and folders, symlinks, and empty notes are skipped. All notes go to OpenRouter on every request, so they cost tokens each time and leave the machine. Unset or a folder with no notes sends no knowledge; a configured folder or note that cannot be read fails as `not_configured`, naming it. Notes too large for the model fail as `provider_error` with a message giving the note count and size.

The model can call tools, get their results back, and keep going before it replies. Tools are registered in `src/core/tools/registry.ts`, and both endpoints offer the same ones. Today there are eight: `current_time` returns the server's current date, time, and timezone; `list_files`, `read_file`, `write_file`, `edit_file`, and `delete_file` touch files; `sandbox_exec` and `sandbox_destroy` run shell commands in disposable Linux VMs through the sandbox service (see below). The file tools only see the folders named by `SPEKTER_FILE_DIRS` (default `skills,knowledge,~/spekter-workspace`; relative paths resolve against the server directory and `~` against your home); paths outside them, `..` escapes, and symlinks leading out are rejected, `list_files` returns at most 1000 files, `write_file` creates parent folders, `edit_file` replaces a string that must match exactly once, and `delete_file` refuses directories. Each request runs at most `SPEKTER_MAX_STEPS` model steps (default 5). The last step always runs with tools turned off, and the model is told so, so it answers with what it has gathered rather than looping. A tool that fails sends its error back to the model, which can explain or work around it; the request itself does not fail. An invalid `SPEKTER_MAX_STEPS` fails as `not_configured`. The loop sits behind Spekter's own interface in `src/core/agent/`, so it can be swapped without touching the endpoints or the tools.

`skills/` and `knowledge/` are gitignored — the model can create and edit their contents, so they hold runtime state rather than source, and a fresh clone starts with empty folders.

The sandbox tools talk to `sandboxd`, a separate local service (`npm run sandboxd`, needs `brew install lima` and `SANDBOX_TOKEN` in `.env.local`). `sandbox_exec` without a `box` creates one and returns its id, which later calls and turns reuse; each call is one blocking command (60 s by default, at most 110 s) whose output is trimmed to 8,000 characters per stream, keeping both ends. A box's `/workspace` is `~/spekter-workspace/<box>/` on the host, survives the box, and is readable with the file tools by absolute path. Idle boxes are reaped; a stale id comes back as an error naming the live boxes. If the service is down, the tools fail with a message saying so and the request carries on. Guests have unrestricted internet access while the agent also sees your knowledge notes, so a prompt injection in content a box pulls in could leak them — fine for your own experiments, not for running repos you did not choose. The `sandbox` CLI (`npm run sandbox -- create|exec|list|inspect|destroy`) drives the same service by hand, and `npm run sandbox -- image build` builds the golden image boxes clone from (boot drops from about 2 minutes to under 10 seconds). Setup and operation: [`docs/help/sandbox.md`](docs/help/sandbox.md).

Slash commands are message-scoped: a `/token` in the last user message applies to that request only, then is stripped before the model sees the text. A token counts only at the start of the message or after whitespace, so `docs/help/HELP.md` never parses; unregistered `/tokens` pass through untouched, and a message made only of command tokens reaches the model intact. The registry lives in `src/core/chat/commands.meta.ts` (client-safe data); resolution is in `commands.ts`. Three kinds:

- `reply` answers the request itself, without a model call — `/help` returns the contents of `docs/help/HELP.md`. The reply reports `model: "spekter"`.
- `context` appends text or a file to the system prompt for that request — `/plan`, `/recap` (inline text), `/sales-prep` (reads `skills/sales-prep/SKILL.md`). Every file a command pulls in becomes a `command_file` source.
- `options` sets per-request behavior — `/fast` (no reasoning), `/smart` (medium reasoning). An options command can also pin a `model`, which beats both the request's `model` field and `SPEKTER_MODEL`.

A command file that cannot be read fails as `not_configured`, naming the file.

```bash
curl -s http://127.0.0.1:3000/api/chat \
  -H 'content-type: application/json' \
  -d '{
    "messages": [
      { "role": "user", "content": "My name is Filip." },
      { "role": "assistant", "content": "Nice to meet you, Filip." },
      { "role": "user", "content": "What is my name?" }
    ]
  }'
```

A successful reply:

```json
{
  "message": { "role": "assistant", "content": "Your name is Filip." },
  "model": "anthropic/claude-haiku-4.5",
  "sources": [{ "type": "knowledge_file", "path": "people/filip.md" }]
}
```

`sources` lists the external sources that went into the reply, and is `[]` when there were none. Each entry has a `type`:

- `knowledge_file`, whose `path` is relative to `SPEKTER_KNOWLEDGE_DIR`. Every note in the folder is sent with every request, so these show what the model was given, not what it relied on.
- `command_file`, whose `path` is a file a slash command pulled in.
- `tool`, whose `name` is a tool that returned a result for this reply. Each tool is listed once, after the files, in the order it was first called. Failed tool calls are not listed.

When the model writes text before calling a tool, `message.content` holds only the text from its last step. The stream sends all of it as it arrives.

Rules: send `Content-Type: application/json`, roles are `user` or `assistant`, content must not be empty or whitespace, and the last message must be from the user. Requests must be addressed to `127.0.0.1` or `localhost`.

Errors always have the shape `{ "error": { "code", "message" } }`:

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | Body is not JSON or the conversation breaks the rules above |
| 403 | `forbidden` | The request was not addressed to `127.0.0.1` or `localhost` |
| 503 | `not_configured` | `OPENROUTER_API_KEY` or `SPEKTER_MODEL` is missing, the `SPEKTER_SYSTEM_PROMPT` file, `SPEKTER_KNOWLEDGE_DIR` folder, or a slash-command file cannot be read, or `SPEKTER_MAX_STEPS` is not a positive whole number |
| 502 | `provider_error` | OpenRouter or the model failed, the conversation and notes exceed the model's context limit, or the model returned an empty or cut-off reply (including still asking for tools after its last step); the message says why |
| 500 | `internal_error` | Something unexpected went wrong on the server |

### Streaming

`POST /api/chat/stream` takes exactly the same request and streams the reply as it is generated. The web chat uses this route.

```bash
curl -sN http://127.0.0.1:3000/api/chat/stream \
  -H 'content-type: application/json' \
  -d '{ "messages": [{ "role": "user", "content": "Count to five." }] }'
```

The response is `application/x-ndjson`: one JSON frame per line.

```text
{"type":"delta","text":"1, 2, "}
{"type":"delta","text":"3, 4, 5."}
{"type":"done","model":"anthropic/claude-haiku-4.5","sources":[]}
```

| Frame | Meaning |
| --- | --- |
| `{ "type": "delta", "text" }` | The next piece of the reply; join them in order |
| `{ "type": "reasoning", "text" }` | The next piece of the model's reasoning, when it exposes any; join them in order |
| `{ "type": "sources", "sources" }` | Sent first when external sources were read for this reply, so clients can show them before the text arrives |
| `{ "type": "tool_call", "id", "name", "input" }` | The model called the tool `name`; `id` identifies this call and `input` holds its arguments |
| `{ "type": "tool_result", "id", "name", "ok" }` | The call with that `id` finished; `ok` is `false` when the tool failed |
| `{ "type": "done", "model", "sources" }` | The reply is complete; `sources` is the same list `POST /api/chat` returns |
| `{ "type": "error", "code", "message" }` | The reply failed; any text already received is not a complete reply |

Every stream ends with exactly one `done` or `error` frame. Problems found before streaming starts (bad request, missing config) return the same JSON errors and statuses as `POST /api/chat`. A failure after streaming starts, such as the provider breaking off, rejecting a context that is too long, or returning an empty or cut-off reply, arrives as an `error` frame with code `provider_error`, because the 200 status has already been sent. Closing the connection cancels the model call.

### Request log

Every request that reaches either chat endpoint appends one JSON line to `logs/requests.jsonl` (gitignored; set `SPEKTER_REQUEST_LOG` to write elsewhere). Entries hold metrics only, never message content:

```json
{"timestamp":"2026-10-08T10:00:00.000Z","endpoint":"chat_stream","model":"anthropic/claude-haiku-4.5","outcome":"reply","durationMs":1834}
```

| Field | Meaning |
| --- | --- |
| `timestamp` | When the request arrived (UTC) |
| `endpoint` | `chat` or `chat_stream` |
| `model` | `SPEKTER_MODEL` at the time, or `null` if unset — per-request picks and command overrides are not reflected |
| `outcome` | `reply`, `error`, or `aborted` (the client closed a stream before it finished) |
| `errorCode` | Only on errors: one of the error codes above |
| `durationMs` | Time until the reply completed, failed, or was stopped |

Requests turned away by the localhost and JSON checks above (`403 forbidden`, or `400` for a missing `Content-Type`) never reach an endpoint and are not logged.

Success rate and median latency per model, leaving out aborted requests:

```bash
python3 - <<'EOF'
import json, statistics, collections
by_model = collections.defaultdict(list)
for line in open("logs/requests.jsonl"):
    entry = json.loads(line)
    if entry["outcome"] != "aborted":
        by_model[entry["model"]].append(entry)
for model, entries in by_model.items():
    replies = [e["durationMs"] for e in entries if e["outcome"] == "reply"]
    median = statistics.median(replies) if replies else None
    print(f"{model}: {len(entries)} requests, {len(replies) / len(entries):.0%} success, median {median} ms")
EOF
```

A log line that cannot be written is reported on the server console and never affects the reply.

## Development

```bash
npm run test   # unit tests (no network, no credits)
npm run lint
npm run build
```
