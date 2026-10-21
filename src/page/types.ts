import type { TabProps } from "../shared";

/** TabProps with the game by name, for the tabs that only need its name. */
export type TabContext = Omit<TabProps, "game"> & { game: string };
