/**
 * Let the app run on its own for a moment: pending fake-backend replies
 * resolve and React renders them. Like Testing Library's waitFor, this turns
 * React's act() checks off while it waits, because these updates come from
 * promises and timers, not from the test.
 */
export async function settle(ms = 10) {
  const g = globalThis as any;
  const before = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    await new Promise((r) => setTimeout(r, ms));
  } finally {
    g.IS_REACT_ACT_ENVIRONMENT = before;
  }
}
