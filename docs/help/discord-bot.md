### Discord bot

A Discord Interface for Spekter: @mention the bot in a channel and it opens a
thread; messages in that thread are one conversation with the agent over the
same `/api/chat` the web UI uses.

One-time Discord setup:

1. Create an application at <https://discord.com/developers/applications>
   (New Application), then open its **Bot** page and copy the **token** into
   `.env.local` as `DISCORD_BOT_TOKEN`.
2. On the same page enable the **Message Content** intent — without it the bot
   sees empty messages.
3. Invite the bot: **OAuth2 > URL Generator**, scope `bot`, permissions
   *View Channels*, *Send Messages*, *Create Public Threads*, *Read Message
   History*, *Add Reactions*. Open the URL and pick your private server.
4. In Discord, right-click your own avatar/profile or open your profile and
   copy your **user id** (needs Developer Mode enabled in Discord settings).
   Put it in `.env.local` as `DISCORD_ALLOWED_USER_ID` — only that account gets
   replies.

Run it (two terminals, both on this machine):

```
npm run dev   # the Spekter API on 127.0.0.1:3000
npm run bot   # the bot; loads .env.local itself
```

Then @mention the bot in any channel it can see. A thread opens under your
message; keep talking inside it. Threads reopen when you message them again,
and a bot restart keeps the conversation because history is rebuilt from the
thread itself.

Notes:

- Text slash commands like `/fast` and `/plan` work inside threads, same as
  web chat.
- Attachments, stickers, and embeds can't be read — the bot says so when it
  gets one.
- A reply over Discord's 2,000-character limit arrives as several messages.
- If `next dev` isn't running the bot says it couldn't reach Spekter.
- Reactions on your message: ⏳ while it works, then ✅ when the agent used
  tools or knowledge, ⚠️ on errors, 🤷 when it couldn't read the message.
  Plain chat replies get no reaction.
