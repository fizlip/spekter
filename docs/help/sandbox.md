### Sandbox

Disposable Linux VMs ("boxes") where the agent can install packages, build, and
run code without touching this Mac. `sandboxd` is a separate local service;
Spekter's `sandbox_exec` and `sandbox_destroy` tools and the `sandbox` CLI both
talk to it over `127.0.0.1` with a shared token.

One-time setup:

1. `brew install lima` (boxes are Lima VMs on Apple's Virtualization.framework).
2. Put a token in `.env.local`: `SANDBOX_TOKEN=` followed by the output of
   `openssl rand -hex 32`. The Next server, the CLI, and the daemon all read it.
3. Build the golden image, which downloads the Ubuntu base image (~600 MB,
   pinned by sha256) and installs git, build tools, Python, Node, and curl:

   ```
   npm run sandbox -- image build   # a few minutes, once
   ```

   Every box is a copy-on-write clone of it and boots in under 10 seconds.
   Without it, each box cold-boots from the base image instead, which takes
   about 2 minutes and is too slow for the agent's tool budget. Rebuild after
   changing the toolset in `src/sandbox/backend/image.ts`; boxes created while a
   build runs cold-boot.

Run it (alongside `npm run dev`):

```
npm run sandboxd
```

By hand:

```
npm run sandbox -- create [--name demo] [--ttl 3600]
npm run sandbox -- exec demo uname -a          # exit code is the command's; 124 on timeout
npm run sandbox -- exec demo -- 'cd app && npm test'
npm run sandbox -- list
npm run sandbox -- destroy demo
```

Ctrl-C on `exec` kills the command inside the box. `--json` prints raw responses.

What a box can and cannot do:

- It sees exactly one host folder: `~/spekter-workspace/<box>/`, mounted at
  `/workspace`. Anything saved there survives `destroy` and idle reaping, and
  the agent can read it with `read_file` by absolute path. Nothing cleans that
  folder up; delete old box folders yourself. Writes there land on the Mac's
  disk, outside the box's own disk cap.
- No guest port is forwarded to the Mac, so a dev server in a box is not
  reachable at `localhost`. Check it from inside the box (`curl localhost:3000`).
- A box can reach the Mac at `host.lima.internal`, which includes `sandboxd`
  and, while running, the Spekter API. `sandboxd` refuses it without the token;
  the Spekter API has no token, an accepted risk for single-user v1.
- It has unrestricted internet. The agent also sees your knowledge notes, so a
  prompt injection in something a box downloads could leak them. Fine for your
  own experiments; revisit before pointing it at repos you did not choose.

Limits (all optional, in `.env.local`): `SANDBOX_MAX_BOXES` (2),
`SANDBOX_TTL_SECONDS` idle time before a box is reaped (1800),
`SANDBOX_CPUS` / `SANDBOX_MEMORY_GIB` / `SANDBOX_DISK_GIB` (2 / 4 / 20; CPU
and memory apply to every new box, but clones keep the golden image's disk
size, so rebuild after changing the disk),
`SANDBOX_PORT` (3210). Events go to `logs/sandboxd.jsonl`; `box.ready` records
each boot time.

Troubleshooting:

- **Tool says the sandbox service is unreachable:** start `npm run sandboxd`.
- **Box creation is slow:** check for a golden image with
  `LIMA_HOME=~/.spekter-sandbox/lima limactl list` (an instance named `golden`,
  status `Stopped`); otherwise run `image build`.
- **A box is `Broken` or stuck:** `npm run sandbox -- destroy <box>`. If the
  daemon no longer knows it, restart `sandboxd`: on startup it adopts boxes
  that are still running and deletes every other sandbox instance (broken,
  stopped, or unknown; after a Mac reboot that is all of them, workspaces kept).
  The golden image is never touched. Last resort:
  `LIMA_HOME=~/.spekter-sandbox/lima limactl delete -f spekter-<box>`.
- **Daemon refuses to start:** the message names the setting; `SANDBOX_TOKEN`
  must be at least 32 characters.
