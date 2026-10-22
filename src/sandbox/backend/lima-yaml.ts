// Per-box Lima configuration. JSON is valid YAML, so limactl reads this as-is.
// Every field here is a security decision, not a default — see R7, R22, R27, R28.

export type ImageRef = { location: string; digest: string };

// Ubuntu 26.04 arm64 cloud image, digest as published in Lima 2.2.1's own template. Lima
// verifies the download against it and refuses a mismatch.
export const DEFAULT_IMAGE: ImageRef = {
  location: "https://cloud-images.ubuntu.com/releases/resolute/release-20260927/ubuntu-26.04-server-cloudimg-arm64.img",
  digest: "sha256:63a93bd5a8d76e33b15ceb5daa3657bd79be804748051ab178e643b0f5da22e7",
};

export type LimaConfigInput = {
  // The box's host workspace; null for the golden instance, which mounts nothing.
  workspaceDir: string | null;
  image: ImageRef;
  cpus: number;
  memoryGiB: number;
  diskGiB: number;
};

const ALL_PORTS = [1, 65535];

export function limaConfig({ workspaceDir, image, cpus, memoryGiB, diskGiB }: LimaConfigInput) {
  if (!/^sha256:[0-9a-f]{64}$/.test(image.digest ?? "")) {
    throw new Error(`Sandbox image must be pinned by a sha256 digest: ${image.location}`);
  }
  return {
    vmType: "vz",
    arch: "aarch64",
    images: [{ location: image.location, arch: "aarch64", digest: image.digest }],
    cpus,
    memory: `${memoryGiB}GiB`,
    disk: `${diskGiB}GiB`,
    // Replaces Lima's default home-folder mount: the box sees its own workspace and nothing else.
    mounts: workspaceDir ? [{ location: workspaceDir, mountPoint: "/workspace", writable: true }] : [],
    mountType: "virtiofs",
    containerd: { system: false, user: false },
    ssh: { localPort: 0, loadDotSSHPubKeys: false, forwardAgent: false, forwardX11: false },
    // Lima otherwise forwards every port a guest listens on to host 127.0.0.1, letting a guest
    // squat sandboxd's or Next's port whenever they are down.
    portForwards: [
      { guestIP: "127.0.0.1", guestPortRange: ALL_PORTS, proto: "any", ignore: true },
      { guestIP: "0.0.0.0", guestPortRange: ALL_PORTS, proto: "any", ignore: true },
    ],
    // Lima otherwise copies host proxy variables (which can carry credentials) into the guest.
    propagateProxyEnv: false,
  };
}
