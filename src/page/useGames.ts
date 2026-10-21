import { useCallback, useEffect, useRef, useState } from "react";
import { BridgeGame, bridge, errText, selection } from "../shared";

type Wanted = { game?: string; profile?: string };

/** The profile to show for a game: the one asked for, else the active one, else the deployed one, else the first. */
export function pickProfile(game: BridgeGame, wanted?: string) {
  for (const profile of [wanted, game.active_profile, game.deployed_profile]) {
    if (profile && game.profiles.includes(profile)) return profile;
  }
  return game.profiles[0];
}

/**
 * The bridge's games and the picked game and profile. The pick is shared with
 * the QAM panel through `selection`, so it survives either closing.
 * `onNoneReady` runs when a load finds no game set up yet.
 */
export function useGames(onNoneReady: () => void) {
  const [games, setGames] = useState<BridgeGame[] | null>(null);
  const [error, setError] = useState("");
  const [game, setGame] = useState<string | undefined>(selection.game);
  const [profile, setProfile] = useState<string | undefined>(selection.profile);
  const onNoneReadyRef = useRef(onNoneReady);
  onNoneReadyRef.current = onNoneReady;

  /** Reload the games, then pick `want` (or keep the current pick when it's still there). */
  const loadGames = useCallback(async (want?: Wanted) => {
    setError("");
    try {
      const all = await bridge<BridgeGame[]>("list_games");
      setGames(all);
      const ready = all.filter((g) => g.configured);
      const chosen = ready.find((g) => g.name === (want?.game ?? selection.game)) ?? ready[0];
      setGame(chosen?.name);
      setProfile(chosen ? pickProfile(chosen, wantedProfile(chosen, want)) : undefined);
      if (!ready.length) onNoneReadyRef.current();
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  useEffect(() => {
    loadGames();
  }, [loadGames]);
  useEffect(() => {
    selection.game = game;
    selection.profile = profile;
  }, [game, profile]);

  const ready = (games ?? []).filter((g) => g.configured);
  const current = ready.find((g) => g.name === game);
  const selectGame = (name: string) => {
    const picked = ready.find((g) => g.name === name);
    setGame(name);
    setProfile(picked ? pickProfile(picked) : undefined);
  };

  return { games, error, ready, current, game, profile, setProfile, selectGame, loadGames };
}

/** The profile asked for, else the one picked last time if it's the same game. */
function wantedProfile(game: BridgeGame, want?: Wanted) {
  return want?.profile ?? (game.name === selection.game ? selection.profile : undefined);
}
