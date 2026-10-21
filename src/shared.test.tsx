import { describe, expect, it } from "vitest";
import { toaster } from "@decky/api";
import { bridge, launchId, startInstall } from "./shared";
import { onBridge } from "./test/deckyApi";
import { makeGame } from "./test/fixtures";

const steam = globalThis as any;

describe("launchId", () => {
  it("uses the Steam app id", () => {
    expect(launchId(makeGame({ steam_id: "489830" }))).toBe("489830");
  });

  it("turns a non-Steam shortcut's app id into its game id", () => {
    const g = makeGame({ steam_id: "489830", shortcut_appid: "3141592653" });
    expect(launchId(g)).toBe(((3141592653n << 32n) | 0x02000000n).toString());
  });

  it("falls back to a library app with the same name", () => {
    steam.collectionStore.allAppsCollection.allApps = [
      { display_name: "Fallout 4 VR", appid: 611660 },
      { display_name: "Fallout 4", appid: 377160 },
    ];
    expect(launchId(makeGame({ name: "Fallout 4", steam_id: "" }))).toBe("377160");
  });

  it("gives null when nothing matches", () => {
    expect(launchId(makeGame({ name: "Morrowind", steam_id: "" }))).toBeNull();
  });
});

describe("bridge", () => {
  it("returns the result", async () => {
    onBridge("mods", () => [{ name: "SkyUI" }]);
    await expect(bridge("mods", { game: "g" })).resolves.toEqual([{ name: "SkyUI" }]);
  });

  it("throws the backend's error text", async () => {
    onBridge("mods", () => {
      throw new Error("Wait for the current deploy/install to finish.");
    });
    await expect(bridge("mods")).rejects.toThrow("Wait for the current deploy/install to finish.");
  });
});

describe("startInstall", () => {
  it("toasts that the install started", async () => {
    onBridge("install_archive", () => ({ id: "t1" }));
    await startInstall("install_archive", { path: "/a.zip" }, "SkyUI");
    expect(toaster.toast).toHaveBeenCalledWith(expect.objectContaining({ body: "Installing SkyUI" }));
  });

  it("toasts the error instead of throwing", async () => {
    onBridge("install_archive", () => {
      throw new Error("Not an archive");
    });
    await startInstall("install_archive", { path: "/a.txt" }, "a.txt");
    expect(toaster.toast).toHaveBeenCalledWith(expect.objectContaining({ body: "Not an archive" }));
  });
});
