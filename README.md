# Spekter

My personal AI lab. See [STRATEGY.md](STRATEGY.md) for what it is and why.

## Getting started

```bash
npm install
cp .env.example .env.local   # then add your OpenRouter key
npm run dev
```

The dev server listens on `http://127.0.0.1:3000` only, so nothing on your network can reach the API.

## Core chat API

`POST /api/chat` takes a conversation and returns the assistant's next reply as one complete message. It is stateless: send the full history every time. The model is set by `SPEKTER_MODEL` in `.env.local`.

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
{ "message": { "role": "assistant", "content": "Your name is Filip." }, "model": "anthropic/claude-haiku-4.5" }
```

Rules: send `Content-Type: application/json`, roles are `user` or `assistant`, content must not be empty or whitespace, and the last message must be from the user. Requests must be addressed to `127.0.0.1` or `localhost`.

Errors always have the shape `{ "error": { "code", "message" } }`:

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | Body is not JSON or the conversation breaks the rules above |
| 403 | `forbidden` | The request was not addressed to `127.0.0.1` or `localhost` |
| 503 | `not_configured` | `OPENROUTER_API_KEY` or `SPEKTER_MODEL` is missing |
| 502 | `provider_error` | OpenRouter or the model failed, or the model returned an empty or cut-off reply; the message says why |
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
{"type":"done","model":"anthropic/claude-haiku-4.5"}
```

| Frame | Meaning |
| --- | --- |
| `{ "type": "delta", "text" }` | The next piece of the reply; join them in order |
| `{ "type": "done", "model" }` | The reply is complete |
| `{ "type": "error", "code", "message" }` | The reply failed; any text already received is not a complete reply |

Every stream ends with exactly one `done` or `error` frame. Problems found before streaming starts (bad request, missing config) return the same JSON errors and statuses as `POST /api/chat`. A failure after streaming starts, such as the provider breaking off or returning an empty or cut-off reply, arrives as an `error` frame with code `provider_error`, because the 200 status has already been sent. Closing the connection cancels the model call.

## Development

```bash
npm run test   # unit tests (no network, no credits)
npm run lint
npm run build
```
