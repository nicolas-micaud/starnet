// Issue #33: after "Do it" on the first relay, a card pushed out of the top three by the next tier's advice was marked
// "✓ Done" like the one really done, so the Counsel read as the same cards staying. Only a reached goal says Done.
import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@aurane/sim';
import { doneCards, goalReached, type ShownCard } from '../src/ui/counsel.js';

type V = Pick<PlayerView, 'me' | 'systems' | 'relays'>;
const world = (over: { relays?: V['relays']; systems?: V['systems']; notes?: string } = {}): V => ({
  me: { id: 'me', policy: { expansion: 0.5, aggression: 0.2, notes: over.notes ?? '' } } as unknown as V['me'],
  systems: over.systems ?? [],
  relays: over.relays ?? [],
});
const relay = (a: string, b: string, owner = 'me'): V['relays'][number] => ({ id: `${a}|${b}`, a, b, owner, ready: true, cut: false, readyAt: 0, cutUntil: 0, bridge: false });

const tier0: ShownCard[] = [
  { id: 'touch', title: 'Touch your star', command: null },
  { id: 'link:B', title: 'Link your neighbour', command: { type: 'build_relay', a: 'A', b: 'B' } },
  { id: 'doctrine', title: 'Your doctrine', command: null },
];

describe('counsel done marks', () => {
  it('the first relay done: only the relay card says Done, the doctrine pushed out by tier 1 leaves quietly', () => {
    const now = new Set(['enter', 'link:C', 'antenna']);
    const out = doneCards(tier0, now, world({ relays: [relay('B', 'A')] }), new Set(), new Set());
    expect(out).toEqual([{ id: 'link:B', title: 'Link your neighbour', index: 1 }]);
  });

  it('a card answered on screen (Do it, or looked at) is done even before the world shows it', () => {
    const out = doneCards(tier0, new Set(['doctrine']), world(), new Set(['touch', 'link:B']), new Set());
    expect(out.map((c) => c.id)).toEqual(['touch', 'link:B']);
  });

  it('a card set aside or already marked is never marked again', () => {
    expect(doneCards(tier0, new Set(), world({ relays: [relay('A', 'B')], notes: 'defend' }), new Set(), new Set(['link:B', 'doctrine']))).toEqual([]);
  });

  it('reads the goal from the world: relay either way round and owned, building built or queued, doctrine written', () => {
    const link = tier0[1]!;
    expect(goalReached(link, world({ relays: [relay('B', 'A')] }), new Set())).toBe(true);
    expect(goalReached(link, world({ relays: [relay('A', 'B', 'other')] }), new Set())).toBe(false);
    const antenna: ShownCard = { id: 'antenna', title: 'An Antenna', command: { type: 'build', system: 'A', building: 'antenna' } };
    const sys = (buildings: string[], queue: string[]) => [{ id: 'A', buildings, buildQueue: queue.map((b) => ({ building: b, orbit: 3, readyAt: 1 })) }] as unknown as V['systems'];
    expect(goalReached(antenna, world({ systems: sys(['extractor'], []) }), new Set())).toBe(false);
    expect(goalReached(antenna, world({ systems: sys(['extractor'], ['antenna']) }), new Set())).toBe(true);
    expect(goalReached(antenna, world({ systems: sys(['antenna'], []) }), new Set())).toBe(true);
    expect(goalReached(tier0[2]!, world({ notes: '  ' }), new Set())).toBe(false);
    expect(goalReached(tier0[2]!, world({ notes: 'Expand, trade, defend.' }), new Set())).toBe(true);
    expect(goalReached(tier0[0]!, world(), new Set())).toBe(false);
  });
});
