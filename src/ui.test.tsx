import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { toaster } from "@decky/api";
import { formatSize, useRows } from "./ui";
import { deferred } from "./test/fixtures";

describe("formatSize", () => {
  it.each([
    [0, ""],
    [null, ""],
    [undefined, ""],
    [-5, ""],
    [512, "512 B"],
    [1536, "1.5 KB"],
    [1024 * 1024, "1 MB"],
    [150 * 1024 * 1024, "150 MB"],
    [2.25 * 1024 ** 3, "2.3 GB"],
    [5 * 1024 ** 5, "5120 TB"],
  ])("%s -> %j", (bytes, text) => {
    expect(formatSize(bytes)).toBe(text);
  });
});

describe("useRows", () => {
  const load = () => Promise.resolve(["a", "b", "c"]);

  it("loads the rows", async () => {
    const { result } = renderHook(() => useRows(load, []));
    expect(result.current.rows).toBeNull();
    await waitFor(() => expect(result.current.rows).toEqual(["a", "b", "c"]));
  });

  it("shows a load error", async () => {
    const { result } = renderHook(() => useRows(() => Promise.reject(new Error("No profile")), []));
    await waitFor(() => expect(result.current.error).toBe("No profile"));
  });

  it("applies an edit at once, then takes the bridge's rows", async () => {
    const { result } = renderHook(() => useRows(load, []));
    await waitFor(() => expect(result.current.rows).not.toBeNull());
    const call = deferred<string[]>();
    let saved: Promise<void>;
    act(() => {
      saved = result.current.save(["a", "b"], () => call.promise);
    });
    expect(result.current.rows).toEqual(["a", "b"]);
    expect(result.current.saving).toBe(true);
    await act(async () => {
      call.resolve(["b", "a"]);
      await saved;
    });
    expect(result.current.rows).toEqual(["b", "a"]);
    expect(result.current.saving).toBe(false);
  });

  it("rolls back and toasts when the save fails", async () => {
    const { result } = renderHook(() => useRows(load, []));
    await waitFor(() => expect(result.current.rows).not.toBeNull());
    const call = deferred<string[]>();
    let saved: Promise<void>;
    act(() => {
      saved = result.current.save(["a"], () => call.promise);
    });
    expect(result.current.rows).toEqual(["a"]);
    await act(async () => {
      call.reject(new Error("Mod is locked"));
      await saved;
    });
    expect(result.current.rows).toEqual(["a", "b", "c"]);
    expect(toaster.toast).toHaveBeenCalledWith(expect.objectContaining({ body: "Mod is locked" }));
  });
});
