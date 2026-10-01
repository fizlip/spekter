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

## Development

```bash
npm run test   # unit tests (no network, no credits)
npm run lint
npm run build
```
