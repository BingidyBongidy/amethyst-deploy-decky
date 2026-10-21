/** Loaded before every test file (vitest.config.ts setupFiles). */
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { closeAllModals } from "./deckyUi";
import { resetBackend } from "./deckyApi";

vi.mock("@decky/ui", () => import("./deckyUi"));
vi.mock("@decky/api", () => import("./deckyApi"));

// What Testing Library sets up itself when vitest globals are on: tells React
// that updates in tests run inside act().
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Steam's globals (shared.tsx: launchId, runApp).
const steam = globalThis as any;
steam.SteamClient = { Apps: { RunGame: vi.fn() } };
steam.collectionStore = { allAppsCollection: { allApps: [] } };

beforeEach(() => {
  resetBackend();
  steam.collectionStore.allAppsCollection.allApps = [];
});

afterEach(() => {
  closeAllModals();
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});
