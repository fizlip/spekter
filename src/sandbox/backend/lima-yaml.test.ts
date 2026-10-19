import { describe, expect, it } from "vitest";
import { DEFAULT_IMAGE, limaConfig } from "./lima-yaml";

const caps = { cpus: 2, memoryGiB: 4, diskGiB: 20 };

describe("limaConfig", () => {
  const config = limaConfig({ workspaceDir: "/Users/f/spekter-workspace/b1", image: DEFAULT_IMAGE, ...caps });

  it("mounts exactly the box workspace at /workspace and no other host path", () => {
    expect(config.mounts).toEqual([{ location: "/Users/f/spekter-workspace/b1", mountPoint: "/workspace", writable: true }]);
  });

  it("generates a mount-less config for the golden instance", () => {
    expect(limaConfig({ workspaceDir: null, image: DEFAULT_IMAGE, ...caps }).mounts).toEqual([]);
  });

  it("ignores every guest port so a guest can never squat a host loopback port", () => {
    expect(config.portForwards).toEqual([
      { guestIP: "127.0.0.1", guestPortRange: [1, 65535], proto: "any", ignore: true },
      { guestIP: "0.0.0.0", guestPortRange: [1, 65535], proto: "any", ignore: true },
    ]);
  });

  it("forwards nothing from the host environment into the guest", () => {
    expect(config).not.toHaveProperty("env");
    expect(config.propagateProxyEnv).toBe(false);
    expect(config.ssh).toEqual({ localPort: 0, loadDotSSHPubKeys: false, forwardAgent: false, forwardX11: false });
  });

  it("pins the image by digest and applies the resource caps", () => {
    expect(config).toMatchObject({
      vmType: "vz",
      arch: "aarch64",
      images: [{ location: DEFAULT_IMAGE.location, arch: "aarch64", digest: DEFAULT_IMAGE.digest }],
      cpus: 2,
      memory: "4GiB",
      disk: "20GiB",
    });
  });

  it.each([undefined, "", "md5:abc", "sha256:short"])("refuses an image without a sha256 digest (%j)", (digest) => {
    expect(() => limaConfig({ workspaceDir: null, image: { location: "https://x/img", digest: digest as string }, ...caps })).toThrow(
      "Sandbox image must be pinned by a sha256 digest",
    );
  });
});
