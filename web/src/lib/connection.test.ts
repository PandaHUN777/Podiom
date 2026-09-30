import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth.svelte", () => ({
  auth: { hydrate: vi.fn(), setToken: vi.fn(), invalidate: vi.fn() },
  readStoredToken: vi.fn(),
  TOKEN_HEADER: "x-podiom-token",
}));

import { normalizeAddress, probe } from "./connection";

describe("normalizeAddress", () => {
  it("adds http to bare hosts", () => {
    expect(normalizeAddress("podiom.local").toString()).toBe("http://podiom.local/");
  });

  it("adds http to a bare host:port", () => {
    expect(normalizeAddress("192.168.1.20:8080").toString()).toBe("http://192.168.1.20:8080/");
    expect(normalizeAddress("podiom.local:8080").toString()).toBe("http://podiom.local:8080/");
  });

  it("keeps explicit schemes", () => {
    expect(normalizeAddress("https://podiom.local").toString()).toBe("https://podiom.local/");
  });

  it("preserves a reverse proxy directory", () => {
    expect(normalizeAddress("http://podiom.local/podiom").toString()).toBe("http://podiom.local/podiom/");
  });

  it("trims input and removes query/hash", () => {
    expect(normalizeAddress("  https://podiom.local/path?x=1#token  ").toString()).toBe(
      "https://podiom.local/path/",
    );
  });

  it("rejects an empty address", () => {
    expect(() => normalizeAddress("   ")).toThrow("empty address");
  });
});

describe("probe", () => {
  const address = new URL("https://podiom.local/base/");
  const health = (body: unknown = { status: "ok", version: "1.2.3" }) => ({
    ok: true,
    json: vi.fn().mockResolvedValue(body),
  });

  it.each([
    ["bad status", { ok: false }, "not-podiom"],
    ["wrong body", health({ status: "bad", version: "1" }), "not-podiom"],
    ["missing version", health({ status: "ok" }), "not-podiom"],
  ])("reports %s", async (_name, response, reason) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(probe(address, "token")).resolves.toEqual({ ok: false, reason });
  });

  it("treats network and invalid JSON errors separately", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    await expect(probe(address, "token")).resolves.toEqual({ ok: false, reason: "unreachable" });
    expect(fetch).toHaveBeenCalledTimes(1);

    fetch.mockReset().mockResolvedValue({ ok: true, json: vi.fn().mockRejectedValue(new Error("html")) });
    await expect(probe(address, "token")).resolves.toEqual({ ok: false, reason: "not-podiom" });
  });

  it("reports unreachable when the auth check fails at the network level", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(health()).mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    await expect(probe(address, "token")).resolves.toEqual({ ok: false, reason: "unreachable" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ ok: false, status: 401 }, "token-rejected"],
    [{ ok: false, status: 500 }, "unreachable"],
  ])("maps auth response %#o to %s", async (auth, reason) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(health()).mockResolvedValueOnce(auth));
    await expect(probe(address, "secret")).resolves.toEqual({ ok: false, reason });
  });

  it("returns the version after both checks succeed", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(health()).mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetch);
    await expect(probe(address, "secret")).resolves.toEqual({ ok: true, version: "1.2.3" });
    expect(fetch.mock.calls[0][0].href).toBe("https://podiom.local/base/healthz");
    expect(fetch.mock.calls[1][0].href).toBe("https://podiom.local/base/api/auth/check");
    expect(fetch.mock.calls[1][1].headers).toEqual({ "x-podiom-token": "secret" });
  });
});

const STORAGE_ADDRESS_KEY = "instance-address";

async function importConnectionWithStorageMocks(options: {
  isNative: boolean;
  storedAddress?: string;
}) {
  vi.resetModules();

  const auth = {
    hydrate: vi.fn(),
    setToken: vi.fn(),
    invalidate: vi.fn(),
  };
  const readStoredToken = vi.fn().mockResolvedValue("stored-token");
  const setEndpoint = vi.fn();
  const secureGet = vi.fn().mockResolvedValue(options.storedAddress ?? "");
  const secureSet = vi.fn().mockResolvedValue(undefined);
  const secureForget = vi.fn().mockResolvedValue(undefined);

  vi.doMock("./auth.svelte", () => ({
    auth,
    readStoredToken,
    TOKEN_HEADER: "x-podiom-token",
  }));
  vi.doMock("./base", () => ({ setEndpoint }));
  vi.doMock("./native", () => ({
    isNative: options.isNative,
    secureGet,
    secureSet,
    secureForget,
  }));

  return {
    connection: await import("./connection"),
    auth,
    readStoredToken,
    setEndpoint,
    secureGet,
    secureSet,
    secureForget,
  };
}

describe("connection storage lifecycle", () => {
  afterEach(() => {
    vi.doUnmock("./auth.svelte");
    vi.doUnmock("./base");
    vi.doUnmock("./native");
    vi.resetModules();
  });

  it("does not hydrate browser storage or override the browser endpoint", async () => {
    const mocks = await importConnectionWithStorageMocks({ isNative: false });

    await mocks.connection.hydrate();

    expect(mocks.secureGet).not.toHaveBeenCalled();
    expect(mocks.readStoredToken).not.toHaveBeenCalled();
    expect(mocks.setEndpoint).not.toHaveBeenCalled();
    expect(mocks.auth.hydrate).not.toHaveBeenCalled();
  });

  it("leaves authentication alone when no native address is stored", async () => {
    const mocks = await importConnectionWithStorageMocks({ isNative: true });

    await mocks.connection.hydrate();

    expect(mocks.secureGet).toHaveBeenCalledWith(STORAGE_ADDRESS_KEY);
    expect(mocks.readStoredToken).not.toHaveBeenCalled();
    expect(mocks.setEndpoint).not.toHaveBeenCalled();
    expect(mocks.auth.hydrate).not.toHaveBeenCalled();
  });

  it("normalizes the stored address before restoring the token", async () => {
    const mocks = await importConnectionWithStorageMocks({
      isNative: true,
      storedAddress: "podiom.local:8787/podiom",
    });

    await mocks.connection.hydrate();

    expect(mocks.setEndpoint).toHaveBeenCalledWith(new URL("http://podiom.local:8787/podiom/"));
    expect(mocks.readStoredToken).toHaveBeenCalledOnce();
    expect(mocks.auth.hydrate).toHaveBeenCalledWith("stored-token");
  });

  it("forgets an unparseable address without hydrating authentication", async () => {
    const mocks = await importConnectionWithStorageMocks({
      isNative: true,
      storedAddress: "http://[",
    });

    await mocks.connection.hydrate();

    expect(mocks.secureForget).toHaveBeenCalledWith(STORAGE_ADDRESS_KEY);
    expect(mocks.setEndpoint).not.toHaveBeenCalled();
    expect(mocks.readStoredToken).not.toHaveBeenCalled();
    expect(mocks.auth.hydrate).not.toHaveBeenCalled();
  });

  it("sets the endpoint before persisting the serialized address and token", async () => {
    const mocks = await importConnectionWithStorageMocks({ isNative: true });
    let finishSecureSet!: () => void;
    mocks.secureSet.mockImplementation(
      () => new Promise<void>((resolve) => {
        finishSecureSet = resolve;
      }),
    );
    const address = new URL("https://podiom.local/podiom/?source=manual#connection");

    const saving = mocks.connection.save(address, "new-token");

    expect(mocks.setEndpoint).toHaveBeenCalledWith(address);
    expect(mocks.secureSet).toHaveBeenCalledWith(STORAGE_ADDRESS_KEY, address.toString());
    expect(mocks.setEndpoint.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.secureSet.mock.invocationCallOrder[0],
    );
    expect(mocks.auth.setToken).not.toHaveBeenCalled();

    finishSecureSet();
    await saving;

    expect(mocks.auth.setToken).toHaveBeenCalledWith("new-token");
    expect(mocks.secureSet.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.auth.setToken.mock.invocationCallOrder[0],
    );
  });

  it("invalidates authentication, clears the endpoint, and forgets the address", async () => {
    const mocks = await importConnectionWithStorageMocks({ isNative: true });

    await mocks.connection.clear();

    expect(mocks.auth.invalidate).toHaveBeenCalledOnce();
    expect(mocks.setEndpoint).toHaveBeenCalledWith(null);
    expect(mocks.secureForget).toHaveBeenCalledWith(STORAGE_ADDRESS_KEY);
  });

  it("returns no stored address in a browser", async () => {
    const mocks = await importConnectionWithStorageMocks({
      isNative: false,
      storedAddress: "https://podiom.local/",
    });

    await expect(mocks.connection.storedAddress()).resolves.toBe("");
    expect(mocks.secureGet).not.toHaveBeenCalled();
  });

  it("returns the stored address on native", async () => {
    const mocks = await importConnectionWithStorageMocks({
      isNative: true,
      storedAddress: "https://podiom.local/podiom/",
    });

    await expect(mocks.connection.storedAddress()).resolves.toBe("https://podiom.local/podiom/");
    expect(mocks.secureGet).toHaveBeenCalledWith(STORAGE_ADDRESS_KEY);
  });
});
