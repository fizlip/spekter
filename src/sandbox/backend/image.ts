import type { Env } from "../config";
import { GOLDEN, limactlRunner, type Caps, type Spawn } from "./lima";
import type { ImageRef } from "./lima-yaml";

export { GOLDEN };

// Baked into the golden instance once, so boxes start with the usual toolset instead of each
// spending its first command on apt. Idempotent: rerunning it converges on the same state.
export const PROVISION_SCRIPT = `set -eu
export DEBIAN_FRONTEND=noninteractive
sudo -E apt-get update -q
sudo -E apt-get install -y -q --no-install-recommends \\
  git build-essential pkg-config python3 python3-pip python3-venv python-is-python3 \\
  nodejs npm curl wget ca-certificates unzip zip jq less file
sudo apt-get clean
sudo rm -rf /var/lib/apt/lists/*
# netplan makes boot wait for "eth0", which a clone only gets once cloud-init rewrites the
# MAC-pinned config, and cloud-init is ordered after that wait: a 2-minute deadlock per boot.
# Sorts after netplan's 10-netplan.conf, so its ExecStart reset wins.
sudo mkdir -p /etc/systemd/system/systemd-networkd-wait-online.service.d
printf '[Service]\\nExecStart=\\nExecStart=/usr/lib/systemd/systemd-networkd-wait-online --any --timeout=15\\n' |
  sudo tee /etc/systemd/system/systemd-networkd-wait-online.service.d/zz-spekter.conf >/dev/null
# Clones copy the disk; an empty machine-id makes each one generate its own on boot.
sudo truncate -s 0 /etc/machine-id
sudo rm -f /var/lib/dbus/machine-id`;

export type BuildOptions = {
  limaHome: string;
  configDir: string;
  image: ImageRef;
  caps: Caps;
  spawn?: Spawn;
  env?: Env;
  progress: (message: string) => void;
};

// Builds the golden instance from the generated config (no mounts, no port forwarding, pinned
// image; never Lima's default template) and leaves it stopped as the clone source.
export async function buildGoldenImage({ limaHome, configDir, image, caps, spawn, env, progress }: BuildOptions) {
  const { run, runOrThrow, createFromConfig } = limactlRunner({ limaHome, spawn, env });
  const remove = () => run(["delete", "-f", "--tty=false", GOLDEN]);

  progress("Removing any previous golden instance");
  await remove();
  try {
    progress("Creating the golden instance (downloads the base image on first run)");
    await createFromConfig(GOLDEN, configDir, { workspaceDir: null, image, ...caps });
    progress("Booting it");
    await runOrThrow(["start", "--tty=false", GOLDEN]);
    progress("Installing the toolset (a few minutes)");
    const provision = await run(["shell", "--tty=false", GOLDEN, "--", "bash", "-c", PROVISION_SCRIPT]);
    if (provision.code !== 0) {
      throw new Error(`Provisioning failed (exit ${provision.code}):\n${provision.stderr.trim().split("\n").slice(-20).join("\n")}`);
    }
    progress("Stopping it");
    await runOrThrow(["stop", "--tty=false", GOLDEN]);
  } catch (error) {
    await remove();
    throw error;
  }
}
