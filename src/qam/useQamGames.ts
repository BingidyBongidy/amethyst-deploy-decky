import { Navigation } from "@decky/ui";
import { useCallback, useEffect, useState } from "react";
import { Game, GamesResult, listGames, selection } from "../shared";

// The last game list, kept while the QAM panel is closed and reopened.
let cache: GamesResult | null = null;

/** Rescan the next time the panel opens (deploy state, games or profiles may have changed). */
export function clearGamesCache() {
  cache = null;
}

export function openFullUI() {
  clearGamesCache(); // games or profiles may change in there; rescan when the panel reopens
  Navigation.Navigate("/amethyst");
  Navigation.CloseSideMenus();
}

/** The deployed profile if the game has it, else its first profile. */
export function defaultProfile(game: Game | undefined): string | undefined {
  if (game?.deployed_profile && game.profiles.includes(game.deployed_profile)) return game.deployed_profile;
  return game?.profiles[0];
}

/**
 * The panel's game list (list_games, cached across openings) and the picked
 * game and profile, shared with the full-screen page through `selection`.
 */
export function useQamGames() {
  const [data, setData] = useState<GamesResult | null>(cache);
  const [loading, setLoading] = useState(false);
  const [game, setGame] = useState<string | undefined>(selection.game);
  const [profile, setProfile] = useState<string | undefined>(selection.profile);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listGames();
      cache = result;
      setData(result);
      if (result.ok && result.games.length) {
        // read the module-level selection, not state - this closure can be stale
        const picked = result.games.find((g) => g.name === selection.game) ?? result.games[0];
        const kept = picked.name === selection.game ? selection.profile : undefined;
        setGame(picked.name);
        setProfile(kept && picked.profiles.includes(kept) ? kept : defaultProfile(picked));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!cache) refresh();
  }, [refresh]);

  useEffect(() => {
    selection.game = game;
    selection.profile = profile;
  }, [game, profile]);

  const selectGame = (name: string) => {
    setGame(name);
    setProfile(defaultProfile(data?.games.find((g) => g.name === name)));
  };
  const current = data?.games.find((g) => g.name === game);

  return { data, loading, refresh, game, profile, setProfile, selectGame, current };
}
