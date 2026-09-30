import { beforeEach, describe, expect, it, vi } from "vitest";

const secure: Record<string, string> = {};

vi.mock("@capacitor-firebase/messaging", () => ({
  FirebaseMessaging: {
    getToken: vi.fn(async () => ({ token: "push-token" })),
    requestPermissions: vi.fn(async () => ({ receive: "granted" })),
    checkPermissions: vi.fn(async () => ({ receive: "granted" })),
    deleteToken: vi.fn(async () => {}),
  },
}));

vi.mock("./native", () => ({
  isNative: true,
  platform: "ios",
  secureGet: vi.fn(async (key: string) => secure[key] ?? ""),
  secureSet: vi.fn(async (key: string, value: string) => {
    secure[key] = value;
  }),
  secureForget: vi.fn(async (key: string) => {
    delete secure[key];
  }),
}));

vi.mock("./api", () => ({
  registerNotificationDevice: vi.fn(async () => ({
    device: {},
    installation_id: "install-1",
  })),
  deleteNotificationDevice: vi.fn(async () => {}),
}));

vi.mock("./id", () => ({
  randomID: vi.fn(() => "device-1"),
}));

vi.mock("./devicelabel", () => ({
  deviceLabel: vi.fn(async () => "Test iPhone"),
}));

import { FirebaseMessaging } from "@capacitor-firebase/messaging";
import { deleteNotificationDevice, registerNotificationDevice } from "./api";
import { randomID } from "./id";

const {
  currentDeviceID,
  enableNativePush,
  nativePermissionState,
  registerWithDaemon,
  unregisterFromDaemon,
} = await import("./push");

describe("native push registration", () => {
  beforeEach(() => {
    for (const key of Object.keys(secure)) delete secure[key];
    vi.clearAllMocks();
  });

  it("returns the current device id without creating one", async () => {
    expect(await currentDeviceID()).toBeNull();

    secure["notification-device-id"] = "device-1";
    expect(await currentDeviceID()).toBe("device-1");
    expect(randomID).not.toHaveBeenCalled();
  });

  it("creates a device id once and reuses it when registering again", async () => {
    await registerWithDaemon();
    await registerWithDaemon();

    expect(randomID).toHaveBeenCalledOnce();
    const registration = {
      device_id: "device-1",
      platform: "ios",
      label: "Test iPhone",
      push_token: "push-token",
    };
    expect(registerNotificationDevice).toHaveBeenNthCalledWith(1, registration);
    expect(registerNotificationDevice).toHaveBeenNthCalledWith(2, registration);
    expect(secure["notification-installation-id"]).toBe("install-1");
  });

  it("does not register when the push token is empty", async () => {
    vi.mocked(FirebaseMessaging.getToken).mockResolvedValueOnce({ token: "" } as never);

    await registerWithDaemon();

    expect(registerNotificationDevice).not.toHaveBeenCalled();
    expect(randomID).not.toHaveBeenCalled();
  });

  it.each([
    ["granted", "enabled"],
    ["denied", "denied"],
    ["prompt", "idle"],
  ])("maps the %s permission state to %s", async (receive, expected) => {
    vi.mocked(FirebaseMessaging.checkPermissions).mockResolvedValueOnce({ receive } as never);

    await expect(nativePermissionState()).resolves.toBe(expected);
  });

  it("reports unsupported when checking permission state throws", async () => {
    vi.mocked(FirebaseMessaging.checkPermissions).mockRejectedValueOnce(new Error("unavailable"));

    await expect(nativePermissionState()).resolves.toBe("unsupported");
  });

  it("registers after permission is granted", async () => {
    await expect(enableNativePush()).resolves.toBe("enabled");

    expect(FirebaseMessaging.requestPermissions).toHaveBeenCalledOnce();
    expect(registerNotificationDevice).toHaveBeenCalledOnce();
  });

  it("does not register when permission is denied", async () => {
    vi.mocked(FirebaseMessaging.requestPermissions).mockResolvedValueOnce({ receive: "denied" } as never);

    await expect(enableNativePush()).resolves.toBe("denied");

    expect(registerNotificationDevice).not.toHaveBeenCalled();
  });

  it("waits without registering when permission is still pending", async () => {
    vi.mocked(FirebaseMessaging.requestPermissions).mockResolvedValueOnce({ receive: "prompt" } as never);

    await expect(enableNativePush()).resolves.toBe("idle");

    expect(registerNotificationDevice).not.toHaveBeenCalled();
  });

  it("removes the local token and device id if daemon deletion fails", async () => {
    secure["notification-device-id"] = "device-1";
    vi.mocked(deleteNotificationDevice).mockRejectedValueOnce(new Error("daemon unavailable"));

    await expect(unregisterFromDaemon()).resolves.toBeUndefined();

    expect(deleteNotificationDevice).toHaveBeenCalledWith("device-1");
    expect(FirebaseMessaging.deleteToken).toHaveBeenCalledOnce();
    expect(secure["notification-device-id"]).toBeUndefined();
  });
});
