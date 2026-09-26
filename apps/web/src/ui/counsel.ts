// The Counsel's bookkeeping without a browser (decision 0009, issue #33): which card that left the stack reached its
// goal and earns a "✓ Done" mark, and which only made room for the next tier's advice. Game.tsx renders; this decides.
import type { Command } from '@aurane/protocol';
import type { PlayerView } from '@aurane/sim';

/** A card as it was on screen: enough to tell later whether its goal was reached. */
export interface ShownCard { id: string; title: string; command: Command | null }

/**
 * Whether the goal of a card that left the Counsel is reached. The simulation only sends its top three options, so
 * a card also leaves when a more urgent one pushes it out (the first relay opens tier 1 and the doctrine card drops
 * below "Enter your system"): that card is not done and must not say so. Done means: the player answered it
 * (Do it, or went where a look-only card pointed), or the world shows its goal (the relay stands, the building is
 * there or queued, the doctrine is written).
 */
export function goalReached(card: ShownCard, v: Pick<PlayerView, 'me' | 'systems' | 'relays'>, answered: ReadonlySet<string>): boolean {
  if (answered.has(card.id)) return true;
  const cmd = card.command;
  if (cmd?.type === 'build_relay') {
    const key = [cmd.a, cmd.b].sort().join('|');
    return v.relays.some((r) => r.owner === v.me.id && [r.a, r.b].sort().join('|') === key);
  }
  if (cmd?.type === 'build') {
    const s = v.systems.find((x) => x.id === cmd.system);
    return !!s && (!!s.buildings?.includes(cmd.building) || !!s.buildQueue?.some((j) => j.building === cmd.building));
  }
  if (card.id === 'doctrine') return !!(v.me.policy.notes ?? '').trim();
  return false;
}

/** The cards that were on screen, are gone now, and reached their goal: the ones that say "✓ Done". */
export function doneCards(before: readonly ShownCard[], nowIds: ReadonlySet<string>, v: Pick<PlayerView, 'me' | 'systems' | 'relays'>, answered: ReadonlySet<string>, skip: ReadonlySet<string>): { id: string; title: string; index: number }[] {
  return before.map((c, index) => ({ c, index }))
    .filter(({ c }) => !nowIds.has(c.id) && !skip.has(c.id) && goalReached(c, v, answered))
    .map(({ c, index }) => ({ id: c.id, title: c.title, index }));
}
