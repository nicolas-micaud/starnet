import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { DECREES, type Command, type Resource } from '@aurane/protocol';
import { AGENT_COST_INFLUENCE, BUILDING_ORBIT, DECREE_COST_CREDITS, DECREE_HOURS, counselLine, counselTitle, type PlayerView, type ShowTarget, type SystemView } from '@aurane/sim';
import { GalaxyMap } from '../map/GalaxyMap.js';
import { act, addPasskey, answerCounsel, confirmDoctrine, discardDoctrine, eraseMemory, exportMemory, fetchAccount, fetchBriefing, fetchCounsel, fetchEntitlements, fetchPendingDoctrine, fetchPublicConfig, fetchSessions, fetchTalk, logout, paidReturn, startCheckout, type PaymentsConfig, passkeysSupported, removeEmail, removePasskey, revokeSession, startEmail, status, talk as sendTalk, toast, verifyEmail, view, requestLink, type AccountInfo, type CounselCard, type CounselView, type SessionInfo, type Turn } from '../net.js';
import { lang, setLang, t, tError } from '../i18n/index.js';
import { useSig } from './useSig.js';
import { Icon } from './Icon.js';
import { SystemMode } from './SystemView.js';
import { LogisticsPanel } from './Logistics.js';
import { InstallButton, RES, UpdateBanner, fmt, hms } from './bits.js';
import { decreeLabel, describeEvent, describeNote, etaText, stamp } from './feed.js';
import { CARD_LINES, cardAfterTalk, cardFromPending, pendingLineKey, visibleLines, type PendingCard } from './doctrine.js';
import { doneCards, type ShownCard } from './counsel.js';
import { marketPrefill, pendingDemo, pointAt, sceneFlashReq, stopTeaching, teach, teachClass, teachKey } from './teach.js';

type Tab = 'colony' | 'system' | 'logistics' | 'market' | 'fleets' | 'diplomacy' | 'general' | 'log' | 'account';
type TplKey = 'tplForge' | 'tplOasis' | 'tplCrossroads' | 'tplGraveyard' | 'tplSanctuary' | 'tplLair' | 'tplBurnt';
const TPL_KEY: Record<string, TplKey> = { forge: 'tplForge', oasis: 'tplOasis', crossroads: 'tplCrossroads', graveyard: 'tplGraveyard', sanctuary: 'tplSanctuary', lair: 'tplLair', burnt: 'tplBurnt' };
const selected = signal<string | null>(null);
const linkFrom = signal<string | null>(null);
const LINK_MODE_MS = 45000;
// Back from Stripe's checkout: straight to the Account tab, where the thanks and the title wait.
const tab = signal<Tab>(paidReturn.value ? 'account' : 'colony');
const briefing = signal<{ text: string; source: string } | null>(null);
/** The system whose plateau is open full-screen, or null for the galaxy. */
export const systemMode = signal<string | null>(null);
/** Bumped when something asks the panel to unfold (the Counsel's "Show me" on a phone), or to fold so the map shows. */
const openPanel = signal(paidReturn.value ? 1 : 0);
const foldPanel = signal(0);

export function Game() {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<GalaxyMap | null>(null);
  const v = useSig(view)!;
  const st = useSig(status);
  const toastV = useSig(toast);
  const linkV = useSig(linkFrom);
  const selV = useSig(selected);
  const sysMode = useSig(systemMode);

  useEffect(() => {
    const m = new GalaxyMap({
      onSelect: (id) => {
        if (linkFrom.value && id && id !== linkFrom.value) {
          const from = linkFrom.value;
          linkFrom.value = null;
          void act({ type: 'build_relay', a: from, b: id }).then((ok) => { if (!ok && toast.value) toast.value = { text: tError(toast.value.text), kind: 'err' }; });
          selected.value = id;
          tab.value = 'system';
          return;
        }
        selected.value = id;
        if (id) tab.value = 'system';
      },
    });
    map.current = m;
    void m.mount(host.current!).then(() => m.update(view.value!));
    return () => m.destroy();
  }, []);

  useEffect(() => { map.current?.update(v); }, [v]);
  // First contact: when the neighbour's relay lights up, its star flashes on the galaxy once (the Journal and the General say the rest).
  const lastContact = useRef<number>(0);
  useEffect(() => {
    const e = v.events.filter((x) => x.kind === 'contact.first' && x.actors[0] === v.me.id).pop();
    if (!e || e.at <= lastContact.current) return;
    lastContact.current = e.at;
    const sys = (e.data as { system?: string } | undefined)?.system;
    if (sys && map.current) setTimeout(() => map.current?.flash(sys), 400);
  }, [v]);
  useEffect(() => { void fetchBriefing(lang.value).then((b) => { if (b && b.awaySeconds >= 600) briefing.value = b; }); }, []);
  const brief = useSig(briefing);
  useEffect(() => { map.current?.setSelection(selV); }, [selV]);
  useEffect(() => { map.current?.setLinkFrom(linkV); }, [linkV]);
  // The link mode is a lesson, not a state to live in: it closes itself if no star is tapped for a while (issue #33).
  useEffect(() => {
    if (!linkV) return;
    const id = setTimeout(() => { if (linkFrom.value === linkV) linkFrom.value = null; }, LINK_MODE_MS);
    return () => clearTimeout(id);
  }, [linkV]);
  // The General points at a button: bring it into view; the lesson ends when the player taps it.
  const teachV = useSig(teach);
  useEffect(() => {
    if (!teachV || teachV.done || !teachV.key) return;
    const id = setTimeout(() => document.querySelector('.teach')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 400);
    return () => clearTimeout(id);
  }, [teachV]);
  const onTap = (e: MouseEvent): void => { if ((e.target as HTMLElement | null)?.closest?.('.teach')) setTimeout(stopTeaching, 150); };

  return (
    <div class="game" onClickCapture={onTap}>
      <div class="map" ref={host} />
      <Hud v={v} map={map} />
      {st !== 'online' && <div class="banner">{t('offline')}</div>}
      {toastV && <div class={`toast ${toastV.kind}`}>{toastV.text}</div>}
      {linkV && !teachV && <div class="hint">{t('tapToLink')} <button onClick={() => { linkFrom.value = null; }}>{t('cancel')}</button></div>}
      {teachV && <div class={`hint teachbar ${teachV.done ? 'done' : ''}`}><span>{teachV.hint}</span><button onClick={stopTeaching}>✕</button></div>}
      {brief && (
        <div class="briefing">
          <h3>{t('briefing')} · {t(v.me.persona as 'vane')}</h3>
          <pre>{brief.text}</pre>
          <button class="primary" onClick={() => { briefing.value = null; }}>{t('dismiss')}</button>
        </div>
      )}
      <Panel v={v} map={map} />
      {sysMode && <SystemMode v={v} systemId={sysMode} onLeave={() => { systemMode.value = null; selected.value = sysMode; tab.value = 'system'; }} />}
    </div>
  );
}

/** Live alerts: fights and blockades first, then hostile fleets on their way (with the hour of arrival), then what waits for an answer. */
function Alerts({ v }: { v: PlayerView }) {
  const [, force] = useState(0);
  useEffect(() => { const i = setInterval(() => force((x) => x + 1), 30000); return () => clearInterval(i); }, []);
  const name = (id: string): string => v.colonies.find((c) => c.id === id)?.name ?? id;
  const mine = new Set(v.systems.filter((s) => s.owner === v.me.id).map((s) => s.id));
  const rows: { key: string; kind: 'hot' | 'inbound' | 'soft'; text: string; cta: string; go: () => void }[] = [];
  for (const s of v.systems) if (mine.has(s.id) && (s.engaged || s.blockadedBy)) rows.push({ key: `hot-${s.id}`, kind: 'hot', text: (s.engaged ? t('alertBattle') : t('alertBlockade')).replace('{s}', s.name), cta: t('enter'), go: () => { systemMode.value = s.id; } });
  const now = v.time + ((Date.now() - hudReceivedAt) / 1000) * v.timeScale;
  for (const f of v.fleets) {
    if (f.owner === v.me.id || !f.destination || !mine.has(f.destination) || f.combat === 0 || f.at !== null) continue;
    if (v.colonies.find((c) => c.id === f.owner)?.ally) continue;
    const sys = v.systems.find((x) => x.id === f.destination);
    rows.push({ key: `in-${f.id}`, kind: 'inbound', text: t('alertInbound').replace('{n}', String(f.combat)).replace('{a}', name(f.owner)).replace('{s}', sys?.name ?? f.destination).replace('{t}', etaText(f.arriveAt - now)), cta: t('enter'), go: () => { systemMode.value = f.destination; } });
  }
  for (const b of v.barters) if (b.to === v.me.id && !b.accepted) rows.push({ key: `offer-${b.id}`, kind: 'soft', text: t('alertOffer').replace('{a}', name(b.from)), cta: t('review'), go: () => { tab.value = 'market'; } });
  for (const p of v.proposals) if (p.to === v.me.id) rows.push({ key: `prop-${p.from}-${p.kind}`, kind: 'soft', text: t('alertProposal').replace('{a}', name(p.from)).replace('{k}', t(p.kind as 'nap')), cta: t('review'), go: () => { tab.value = 'diplomacy'; } });
  for (const i of v.invites) rows.push({ key: `inv-${i.alliance}`, kind: 'soft', text: t('alertInvite').replace('{a}', i.name), cta: t('review'), go: () => { tab.value = 'diplomacy'; } });
  if (!rows.length) return null;
  const shown = rows.slice(0, 3);
  return (
    <div class="alerts">
      {shown.map((r) => (
        <button key={r.key} class={`alert ${r.kind}`} onClick={r.go}>
          <i /> <span>{r.text}</span> <b>{r.cta} ›</b>
        </button>
      ))}
      {rows.length > shown.length && <small class="muted">{t('alertsMore').replace('{n}', String(rows.length - shown.length))}</small>}
    </div>
  );
}

function Hud({ v, map }: { v: PlayerView; map: { current: GalaxyMap | null } }) {
  const [, force] = useState(0);
  const [legend, setLegend] = useState(false);
  useEffect(() => { const i = setInterval(() => force((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  const secondsLeft = Math.max(0, v.nextDrawAt - v.time - ((Date.now() - hudReceivedAt) / 1000) * v.timeScale);
  const frac = 1 - secondsLeft / 3600;
  const ev = v.draw?.event.kind ?? 'none';
  const evLabel = ev === 'eruption' ? t('drawEventEruption') : ev === 'storm' ? t('drawEventStorm') : ev === 'echo' ? t('drawEventEcho') : t('drawEventNone');
  return (
    <div class="hud">
      <div class="chips">
        {RES.map((r) => (
          <span class={`chip r-${r}`} key={r} title={`${t(r)} — ${t(`${r}Desc`)}`}>
            <Icon name={r} /> <b>{fmt(v.me.stock[r])}</b><small>+{fmt(v.me.lastProduced[r])}</small><em>{t(r)}</em>
          </span>
        ))}
        <span class="chip r-credits" title={`${t('credits')} — ${t('creditsDesc')}`}><Icon name="credits" /> <b>{fmt(v.me.credits)}</b><em>{t('credits')}</em></span>
        <span class="chip r-influence" title={`${t('influence')} — ${t('influenceDesc')}`}><Icon name="influence" /> <b>{fmt(v.me.influence)}</b><em>{t('influence')}</em></span>
        <button class="chip help" onClick={() => setLegend(!legend)} title={t('help')}><Icon name="help" /></button>
      </div>
      <div class="status">
        <span class="draw" title={t('nextDraw')}>
          <svg width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="10" fill="none" stroke="#2a3760" stroke-width="3" /><circle cx="13" cy="13" r="10" fill="none" stroke="#7dd3fc" stroke-width="3" stroke-dasharray={`${Math.max(0, frac) * 62.8} 62.8`} transform="rotate(-90 13 13)" /></svg>
          <span>{t('nextDraw')} <b>{hms(secondsLeft)}</b></span>
        </span>
        {v.draw && <span title={t('bands')}>{t('bands')} <b>{v.draw.bands.join(' · ')}</b> · <b class={`ev-${ev}`}>{evLabel}</b></span>}
        <span>{t('score')} <b>{v.me.score.toFixed(1)}</b> · <b>{v.me.connectedCount}</b> {t('connected')}</span>
        {v.me.shielded && <span class="tag">{t('shielded')}</span>}
      </div>
      {legend && (
        <div class="legend" onClick={() => setLegend(false)}>
          <h3>{t('legend')}</h3>
          {RES.map((r) => <p key={r}><span class={`r-${r}`}><Icon name={r} /></span> <b>{t(r)}</b> — {t(`${r}Desc`)}</p>)}
          <p><span class="r-credits"><Icon name="credits" /></span> <b>{t('credits')}</b> — {t('creditsDesc')}</p>
          <p><span class="r-influence"><Icon name="influence" /></span> <b>{t('influence')}</b> — {t('influenceDesc')}</p>
          <p class="muted">{t('coach3')}</p>
          <InstallButton compact />
        </div>
      )}
      <UpdateBanner />
      <Alerts v={v} />
      {v.me.counsel.length > 0 ? <Counsel v={v} map={map} /> : <Coach v={v} />}
    </div>
  );
}

/** The Draw Counsel (0009): the Partner's cards. In the General's voice when the LLM layer wrote them (one fetch
 *  per Draw), else the simulation's cards with fixed lines. "Show me" opens the screen, "Do it" runs the ready
 *  command, "Not now" hides the card for this Draw; the General remembers both answers. */
const skippedCounsel = signal<Set<string>>(new Set());
const voiceCounsel = signal<CounselView | null>(null);
let counselFetching = false;

type UiCard = { id: string; title: string; line: string; command: Command | null; hasCommand: boolean; urgency: 0 | 1 | 2; voice: boolean; go: () => void; run: () => Promise<boolean> };

type TKey = Parameters<typeof t>[0];
const T = (k: string): string => String(t(k as TKey));
const SEP = ' › ';

/** The voice layer's `show` (packages/general) as the simulation's target, so one function shows both; the
 *  simulation's own target rides along as `raw` when the card came from its Counsel. */
function fromVoiceShow(sh: CounselCard['show'], raw?: unknown): ShowTarget | null {
  const r = raw as { kind?: unknown } | undefined;
  if (r && (r.kind === 'star' || r.kind === 'link' || r.kind === 'plateau' || r.kind === 'tab')) return r as ShowTarget;
  if (!sh) return null;
  if (sh.screen === 'system' && sh.system) {
    if (sh.slot === 'link') return { kind: 'link', from: sh.system, to: null };
    if (sh.slot || sh.poi) { const o = Number(sh.slot); return { kind: 'plateau', system: sh.system, orbit: o === 1 || o === 2 || o === 3 ? o : null }; }
    return { kind: 'star', system: sh.system };
  }
  if (sh.screen === 'journal') return { kind: 'tab', tab: 'log' };
  if (sh.screen === 'colony' || sh.screen === 'market' || sh.screen === 'general') return { kind: 'tab', tab: sh.screen };
  return null; // the galaxy
}

/** Where a card without a ready command takes the player, with the path said out loud. */
function showTarget(show: ShowTarget | null, v: PlayerView, map: GalaxyMap | null): void {
  const sys = (id: string): string => v.systems.find((x) => x.id === id)?.name ?? id;
  const here = (key: string | null, path: string[]): void => pointAt(key, t('hereIsWhere').replace('{path}', path.join(SEP)) + (key ? ` ${t('tapBlink')}` : ''));
  if (!show) { systemMode.value = null; tab.value = 'colony'; }
  else if (show.kind === 'star') { systemMode.value = null; selected.value = show.system; tab.value = 'system'; map?.centerOn(show.system); map?.flash(show.system); here(`enter:${show.system}`, [sys(show.system), t('tabSystem'), t('enterSystem')]); }
  else if (show.kind === 'link') { systemMode.value = null; selected.value = show.from; tab.value = 'system'; linkFrom.value = show.from; map?.centerOn(show.from); map?.flash(show.from); here(show.to ? `link:${show.to}` : null, [sys(show.from), t('tabSystem'), t('linkMode'), ...(show.to ? [sys(show.to)] : [])]); }
  else if (show.kind === 'plateau') { pendingDemo.value = { system: show.system, dock: 'plateau', orbit: show.orbit }; systemMode.value = show.system; here(null, [sys(show.system), t('enterSystem'), t('plateau'), ...(show.orbit ? [T(`orbit${show.orbit}`)] : [])]); }
  else { systemMode.value = null; tab.value = show.tab; here(show.tab === 'general' ? 'say' : show.tab === 'log' ? 'recap' : null, [T(`tab${show.tab[0]!.toUpperCase()}${show.tab.slice(1)}`)]); }
  openPanel.value++;
}

/** The path to the button that sends this command, in the words of the screens. */
function pathOf(cmd: Command, v: PlayerView): string {
  const sys = (id: string): string => v.systems.find((x) => x.id === id)?.name ?? id;
  const who = (id: string): string => v.colonies.find((c) => c.id === id)?.name ?? id;
  switch (cmd.type) {
    case 'build_relay': return [sys(cmd.a), t('tabSystem'), t('linkMode'), sys(cmd.b)].join(SEP);
    case 'build': return [sys(cmd.system), t('enterSystem'), t('plateau'), T(`orbit${BUILDING_ORBIT[cmd.building]}`), T(cmd.building)].join(SEP);
    case 'train': return [sys(cmd.system), t('enterSystem'), t('plateau'), t('train'), T(cmd.unit)].join(SEP);
    case 'fleet_order': return [sys(cmd.target.split(':')[0]!), t('enterSystem'), t('tabFleets'), T(cmd.order)].join(SEP);
    case 'market_order': return [t('tabMarket'), `${T(cmd.side)} ${T(cmd.resource)}`, t('place')].join(SEP);
    case 'treaty': return [t('tabDiplomacy'), who(cmd.with), T(cmd.kind)].join(SEP);
    case 'decree': return [t('tabColony'), t('decrees'), decreeLabel(cmd.kind)].join(SEP);
    default: return '';
  }
}

/** Take the player to the button a command would press and make it blink ("Show me"), or leave the path after the
 *  General pressed it ("Do it", done = true). */
function demonstrate(cmd: Command, v: PlayerView, map: GalaxyMap | null, done = false): void {
  const key = teachKey(cmd);
  const path = pathOf(cmd, v);
  if (!done) {
    switch (cmd.type) {
      case 'build_relay': systemMode.value = null; selected.value = cmd.a; tab.value = 'system'; linkFrom.value = cmd.a; map?.centerOn(cmd.a); map?.flash(cmd.a); openPanel.value++; break;
      case 'build': pendingDemo.value = { system: cmd.system, dock: 'plateau', orbit: BUILDING_ORBIT[cmd.building] }; systemMode.value = cmd.system; break;
      case 'train': pendingDemo.value = { system: cmd.system, dock: 'plateau', orbit: null }; systemMode.value = cmd.system; break;
      case 'fleet_order': { const at = cmd.target.split(':')[0]!; pendingDemo.value = { system: at, dock: 'fleets', orbit: null }; systemMode.value = at; break; }
      case 'market_order': systemMode.value = null; marketPrefill.value = { region: cmd.region, resource: cmd.resource, side: cmd.side, qty: cmd.qty, price: cmd.price }; tab.value = 'market'; openPanel.value++; break;
      case 'treaty': systemMode.value = null; tab.value = 'diplomacy'; openPanel.value++; break;
      case 'decree': systemMode.value = null; tab.value = 'colony'; openPanel.value++; break;
      default: break;
    }
  }
  if (!path) return;
  if (done) pointAt(null, t('howTo').replace('{path}', path), true, 12000);
  else pointAt(key, t('hereIsWhere').replace('{path}', path) + (key ? ` ${t('tapBlink')}` : ''));
}

/** The star a command acts on, to show where the General just did something. */
function commandTarget(cmd: Command | null): string | null {
  if (!cmd) return null;
  switch (cmd.type) {
    case 'build_relay': return cmd.b;
    case 'build': case 'train': return cmd.system;
    case 'fleet_order': return cmd.target.split(':')[0]!;
    default: return null;
  }
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Cards the player set aside with "Not now" (hidden for the Draw, no "done" mark), and the look-only cards already
 *  answered as seen (sent once). */
const dismissedCounsel = signal<Set<string>>(new Set());
const lookedAt = new Set<string>();
/** Cards that just left the Counsel because their goal is reached: shown "✓ Done" for a moment, then gone. */
const doneCounsel = signal<Map<string, { title: string; index: number }>>(new Map());
/** Cards that came in as others were done (the next tier's advice): they arrive visibly, not in place of the old. */
const freshCounsel = signal<Set<string>>(new Set());
const DONE_MS = 4000;
let lastShown: ShownCard[] = [];
let lastShownDraw = -1;
/** What the Counsel wants from the voice layer right now; a fetch that answered for another tier is retried once. */
let counselWanted = { draw: -1, tier: -1 };

function markDone(cards: { id: string; title: string; index: number }[], fresh: string[]): void {
  if (!cards.length) return;
  const next = new Map(doneCounsel.value);
  for (const c of cards) next.set(c.id, { title: c.title, index: c.index });
  doneCounsel.value = next;
  if (fresh.length) freshCounsel.value = new Set([...freshCounsel.value, ...fresh]);
  setTimeout(() => {
    const m = new Map(doneCounsel.value); for (const c of cards) m.delete(c.id); doneCounsel.value = m;
    const f = new Set(freshCounsel.value); for (const id of fresh) f.delete(id); freshCounsel.value = f;
  }, DONE_MS);
}

function Counsel({ v, map }: { v: PlayerView; map: { current: GalaxyMap | null } }) {
  const skipped = useSig(skippedCounsel);
  const dismissed = useSig(dismissedCounsel);
  const done = useSig(doneCounsel);
  const fresh = useSig(freshCounsel);
  const voice = useSig(voiceCounsel);
  const sel = useSig(selected);
  const sysMode = useSig(systemMode);
  const curTab = useSig(tab);
  const nextDraw = Math.floor(v.time / 3600) + 1;
  const tier = v.me.onboarding?.tier ?? 6;
  // One fetch per Draw and per onboarding tier: the voice cards are cached server-side until the Draw, rewritten
  // when a tier opens, and re-checked against the world on every read.
  counselWanted = { draw: nextDraw, tier };
  // A tier that opens while a fetch is in flight (a quick "Do it" on the first relay) must not be lost: the answer
  // for the old tier is retried once for the tier the colony is at now.
  const refetch = (retry = true): void => {
    if (counselFetching) return;
    counselFetching = true;
    void fetchCounsel(lang.value).then((c) => { if (c) voiceCounsel.value = c; }).finally(() => {
      counselFetching = false;
      const c = voiceCounsel.value;
      if (retry && c && (c.drawIndex !== counselWanted.draw || (c.tier !== undefined && c.tier !== counselWanted.tier))) refetch(false);
    });
  };
  useEffect(() => { if (!voice || voice.drawIndex !== nextDraw || (voice.tier !== undefined && voice.tier !== tier)) refetch(); }, [nextDraw, tier]);
  // A card whose goal is a place to look is done once the player is there, however they got there.
  useEffect(() => {
    for (const c of v.me.counsel) {
      if (c.command || lookedAt.has(c.id)) continue;
      const there = (c.kind === 'touch_star' && sel === v.me.capital) || (c.kind === 'enter_system' && sysMode === v.me.capital) || (c.kind === 'read_recap' && curTab === 'log');
      if (there) { lookedAt.add(c.id); void act({ type: 'counsel_answer', id: c.id, taken: true }); }
    }
  }, [sel, sysMode, curTab, v.me.counsel.map((c) => c.id).join()]);
  const answer = (id: string, taken: boolean, viaVoice: boolean) => {
    if (!taken) dismissedCounsel.value = new Set([...dismissedCounsel.value, id]);
    skippedCounsel.value = new Set([...skippedCounsel.value, id]);
    if (viaVoice) void answerCounsel(id, taken); else void act({ type: 'counsel_answer', id, taken });
  };
  // "Do it" teaches: go where the button is, let the player see it, act, then show what appeared and leave the path.
  const doIt = async (cmd: Command, send: () => Promise<{ ok: boolean; reply: string | null; gone?: boolean }>): Promise<boolean> => {
    demonstrate(cmd, v, map.current);
    await wait(cmd.type === 'build_relay' ? 700 : 1100);
    if (systemMode.value) sceneFlashReq.value++;
    const r = await send();
    // The demonstration opened the link mode to show the button; the General pressed it (or could not): close it,
    // or "Tap a green star to link it" stays on screen as if something were still expected.
    if (cmd.type === 'build_relay' && linkFrom.value === cmd.a) linkFrom.value = null;
    // Already done (by hand, meanwhile) or no longer on the table: the card leaves, nothing to press.
    if (r.gone) { stopTeaching(); refetch(); return true; }
    if (!r.ok) { stopTeaching(); return false; }
    demonstrate(cmd, v, map.current, true);
    const target = commandTarget(cmd);
    if (target && !systemMode.value) { selected.value = target; map.current?.centerOn(target); map.current?.flash(target); foldPanel.value++; }
    const reply = r.reply ?? t('counselDone');
    toast.value = { text: reply, kind: 'ok' }; setTimeout(() => { if (toast.value?.text === reply) toast.value = null; }, 4000);
    return true;
  };
  // "Show me": the button itself when the card carries a command, else the screen the card is about.
  const showMe = (cmd: Command | null, show: ShowTarget | null): void => { if (cmd) demonstrate(cmd, v, map.current); else showTarget(show, v, map.current); };
  // The voice cards are written once per Draw. The simulation's options move with the game (a relay opens tier 1
  // within the first minute), so a voice card stays while its option is still on the table, and a live option the
  // voice has not phrased shows with the fixed line: the General's words when it has them, never stale advice.
  const voiceCards = voice && voice.drawIndex === nextDraw ? voice.cards : [];
  const liveIds = new Set(v.me.counsel.map((c) => c.id));
  const spoken = new Set(voiceCards.map((c) => c.id));
  const firstWords = voiceCards.length > 0 && voiceCards.every((c) => c.id.startsWith('first-')) && tier <= 0;
  const fromVoice: UiCard[] = voiceCards.filter((c) => firstWords || liveIds.has(c.id)).map((c) => ({ id: c.id, title: c.title, line: c.line, command: c.command, hasCommand: !!c.command, urgency: 1 as const, voice: true, go: () => showMe(c.command, fromVoiceShow(c.show, c.raw)),
    run: () => doIt(c.command!, () => answerCounsel(c.id, true)) }));
  const fromSim: UiCard[] = v.me.counsel.filter((c) => !spoken.has(c.id)).map((c) => ({ id: c.id, title: counselTitle(c, lang.value), line: counselLine(c, lang.value), command: c.command, hasCommand: !!c.command, urgency: c.urgency, voice: false, go: () => showMe(c.command, c.show),
    run: () => doIt(c.command!, async () => ({ ok: await act(c.command!), reply: null })) }));
  const order = new Map(v.me.counsel.map((c, i) => [c.id, i]));
  const cards = [...fromVoice, ...fromSim].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  const shown = cards.filter((c) => !skipped.has(c.id));
  // A card that was on screen and left because its goal is reached (taken, looked at, or done by hand) says so; a
  // card only pushed out of the top three by the next tier's advice leaves quietly (issue #33).
  useEffect(() => {
    const ids = new Set(shown.map((c) => c.id));
    // A new Draw renews the whole Counsel: nothing was "done", the hour turned.
    if (lastShownDraw === nextDraw) {
      const answered = new Set([...[...skipped].filter((id) => !dismissed.has(id)), ...lookedAt]);
      const gone = doneCards(lastShown, ids, v, answered, new Set([...dismissed, ...done.keys()]));
      const before = new Set(lastShown.map((c) => c.id));
      markDone(gone, shown.filter((c) => !before.has(c.id)).map((c) => c.id));
    }
    lastShown = shown.map((c) => ({ id: c.id, title: c.title, command: c.command }));
    lastShownDraw = nextDraw;
  });
  // The "✓ Done" cards keep their place for a moment, so the stack does not jump under the finger.
  const rows: ({ kind: 'card'; c: UiCard } | { kind: 'done'; id: string; title: string })[] = shown.map((c) => ({ kind: 'card' as const, c }));
  for (const [id, d] of [...done].sort((a, b) => a[1].index - b[1].index)) if (!shown.some((c) => c.id === id)) rows.splice(Math.min(rows.length, d.index), 0, { kind: 'done', id, title: d.title });
  if (rows.length === 0) return null;
  return (
    <div class={`counsel ${tier <= 1 ? 'first' : ''}`}>
      <small class="who">{t(v.me.persona as 'vane')} · {t('counselTitle')}</small>
      {rows.map((r) => r.kind === 'done' ? (
        <div key={r.id} class="card done" aria-live="polite"><p><b>✓ {t('counselDoneMark')}</b> · {r.title}</p></div>
      ) : (
        <div key={r.c.id} class={`card u${r.c.urgency} ${fresh.has(r.c.id) ? 'fresh' : ''}`}>
          <p><b>{r.c.title}</b> · {r.c.line}</p>
          <div class="acts">
            <button onClick={r.c.go}>{t('showMe')}</button>
            {r.c.hasCommand && <button class="primary" onClick={() => { const c = r.c; void c.run().then((ok) => { if (ok) { skippedCounsel.value = new Set([...skippedCounsel.value, c.id]); if (!c.voice) void act({ type: 'counsel_answer', id: c.id, taken: true }); } }); }}>{t('doIt')}</button>}
            <button class="link" onClick={() => answer(r.c.id, false, r.c.voice)}>{t('notNow')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** First minutes: objectives that tick themselves off as the player acts, each with a way in. */
const COACH_KEY = 'aurane.coach';
const coachDone = signal<number>((() => { try { return Number(localStorage.getItem(COACH_KEY) ?? 0); } catch { return 0; } })());
const enteredSystem = signal(false);
systemMode.subscribe((id) => { if (id) enteredSystem.value = true; });

function Coach({ v }: { v: PlayerView }) {
  const done = useSig(coachDone);
  const entered = useSig(enteredSystem);
  const sel = useSig(selected);
  const owned = v.systems.filter((s) => s.owner === v.me.id);
  const built = owned.some((s) => (s.buildings?.length ?? 0) > 2 || (s.buildQueue?.length ?? 0) > 0);
  const steps: { text: string; why: string; met: boolean; go?: () => void }[] = [
    { text: t('coach1'), why: t('coach1Why'), met: sel !== null, go: () => { selected.value = v.me.capital; tab.value = 'system'; } },
    { text: t('coach2'), why: t('coach2Why'), met: v.me.connectedCount >= 2 || v.relays.some((r) => r.owner === v.me.id), go: () => { selected.value = v.me.capital; tab.value = 'system'; linkFrom.value = v.me.capital; } },
    { text: t('coach6'), why: t('coach6Why'), met: entered, go: () => { systemMode.value = v.me.capital; } },
    { text: t('coach7'), why: t('coach7Why'), met: built, go: () => { systemMode.value = v.me.capital; } },
    { text: t('coach8'), why: t('coach8Why'), met: (v.me.policy.notes ?? '').length > 0, go: () => { tab.value = 'general'; } },
    { text: t('coach3'), why: t('coach3Why'), met: (v.draw?.index ?? -1) >= 0 && v.me.lastProduced.metal > 0, go: () => { tab.value = 'logistics'; } },
  ];
  // Objectives are ordered; the first unmet one is shown, earlier ones count as done once met.
  const idx = Math.max(done, steps.findIndex((s) => !s.met));
  const current = idx < 0 || idx >= steps.length ? null : steps[idx]!;
  useEffect(() => {
    // Persist progress when the current objective becomes met.
    if (current?.met) { const n = idx + 1; coachDone.value = n; try { localStorage.setItem(COACH_KEY, String(n)); } catch { /* ignore */ } }
  }, [current?.met, idx]);
  if (!current) return null;
  const skip = () => { const n = idx + 1; coachDone.value = n; try { localStorage.setItem(COACH_KEY, String(n)); } catch { /* ignore */ } };
  return (
    <div class="coach">
      <span class="step">{idx + 1}/{steps.length}</span>
      <div class="text"><p>{current.text}</p><small>{current.why}</small></div>
      {current.go && <button class="primary" onClick={current.go}>{t('show')}</button>}
      <button onClick={skip} title={t('skip')}>✕</button>
    </div>
  );
}

let hudReceivedAt = Date.now();
view.subscribe(() => { hudReceivedAt = Date.now(); });

const isNarrow = (): boolean => window.innerWidth < 900;

function Panel({ v, map }: { v: PlayerView; map: { current: GalaxyMap | null } }) {
  const [open, setOpen] = useState(() => !isNarrow());
  const [more, setMore] = useState(false);
  const current = useSig(tab);
  const sel = useSig(selected);
  // On a phone the panel stays folded until something is selected or a tab is tapped: the map comes first.
  useEffect(() => { if (sel && isNarrow()) setOpen(true); }, [sel]);
  const openReq = useSig(openPanel);
  useEffect(() => { if (openReq > 0) setOpen(true); }, [openReq]);
  const foldReq = useSig(foldPanel);
  useEffect(() => { if (foldReq > 0 && isNarrow()) setOpen(false); }, [foldReq]);
  // Progressive onboarding: a tab appears with its tier (docs/design/ONBOARDING-S0.md), the General says why.
  const tier = v.me.onboarding?.tier ?? 6;
  const TAB_TIER: Partial<Record<Tab, number>> = { logistics: 1, market: 2, fleets: 3, diplomacy: 5 };
  const all: Tab[] = (['colony', 'system', 'logistics', 'market', 'fleets', 'diplomacy', 'general', 'log', 'account'] as Tab[]).filter((k) => (TAB_TIER[k] ?? 0) <= tier);
  const primary: Tab[] = ['colony', 'system', 'general', 'log'];
  useEffect(() => { if (!all.includes(current)) tab.value = 'colony'; }, [tier]);
  const pendingV = useSig(pendingDoctrine);
  useEffect(() => { loadPendingDoctrine(); }, []);
  const read = useSig(logRead);
  const unread = current === 'log' ? 0 : v.events.filter((e) => e.at > read && e.kind !== 'draw').length;
  useEffect(() => { if (current === 'log') markLogRead(v); }, [current, v.events.length]);
  const tabs: Tab[] = isNarrow() && !more ? [...primary, ...(primary.includes(current) ? [] : [current])] : all;
  const labels: Record<Tab, string> = { colony: t('tabColony'), system: t('tabSystem'), logistics: t('tabLogistics'), market: t('tabMarket'), fleets: t('tabFleets'), diplomacy: t('tabDiplomacy'), general: t('tabGeneral'), log: t('tabLog'), account: t('tabAccount') };
  return (
    <div class={`panel ${open ? 'open' : ''}`}>
      <div class="tabs" onClick={() => setOpen(true)}>
        {tabs.map((k) => <button key={k} class={current === k ? 'on' : ''} onClick={(e) => { e.stopPropagation(); tab.value = k; setOpen(true); setMore(false); }}>{labels[k]}{k === 'log' && unread > 0 ? <i class="badge">{unread > 9 ? '9+' : unread}</i> : null}{k === 'general' && pendingV && current !== 'general' ? <i class="dotn" /> : null}</button>)}
        {isNarrow() && <button class={more ? 'on' : ''} onClick={(e) => { e.stopPropagation(); setMore(!more); }} title={t('more')}>⋯</button>}
        <button class="collapse" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>{open ? '▾' : '▴'}</button>
      </div>
      <div class="body">
        {current === 'colony' && <ColonyPanel v={v} map={map} />}
        {current === 'system' && <SystemPanel v={v} map={map} />}
        {current === 'logistics' && <LogisticsPanel v={v} onCenter={(id) => { selected.value = id; map.current?.centerOn(id); }} />}
        {current === 'market' && <MarketPanel v={v} />}
        {current === 'fleets' && <FleetsPanel v={v} map={map} />}
        {current === 'diplomacy' && <DiplomacyPanel v={v} />}
        {current === 'general' && <GeneralPanel v={v} />}
        {current === 'log' && <LogPanel v={v} />}
        {current === 'account' && <AccountPanel v={v} />}
      </div>
    </div>
  );
}

/** The capital, whatever was selected last (a relay just built leaves the panel on the new star): selected and
 *  centred, or its plateau opened straight away. */
function goCapital(v: PlayerView, map: GalaxyMap | null, enter = false): void {
  selected.value = v.me.capital;
  tab.value = 'system';
  map?.centerOn(v.me.capital);
  if (enter) systemMode.value = v.me.capital;
}

function ColonyPanel({ v, map }: { v: PlayerView; map: { current: GalaxyMap | null } }) {
  const mine = v.systems.filter((s) => s.owner === v.me.id);
  const capName = v.systems.find((s) => s.id === v.me.capital)?.name ?? v.me.capital;
  return (
    <div>
      <h2>{v.me.name} <small class={`f-${v.me.faction}`}>{t(v.me.faction as 'guild')}</small></h2>
      <p>{t(v.me.persona as 'vane')} · {v.me.watching ? t('watching') : ''}</p>
      <div class="actions"><button class="enter" onClick={() => goCapital(v, map.current, true)}>◎ {t('enterSystem')} · {capName} ★</button></div>
      <ul class="list">
        {mine.map((s) => (
          <li key={s.id} onClick={() => { selected.value = s.id; tab.value = 'system'; map.current?.centerOn(s.id); }}>
            <span class={`dot r-${s.resource}`} /> {s.name} {s.id === v.me.capital ? '★' : ''} <small>{s.connected ? '●' : '○'} {t('band')} {s.band}</small>
            <small>{(s.buildings ?? []).map((b) => t(b)).join(', ')}</small>
          </li>
        ))}
      </ul>
      {v.ended && <p class="tag">{v.ended.reason === 'silence' ? t('ended') : t('renaissance')}</p>}
      <Decrees v={v} />
    </div>
  );
}

/** Decrees: three public, temporary bonuses bought with Credits (GDD § 8). */
function Decrees({ v }: { v: PlayerView }) {
  const now = v.time;
  const desc = { range: t('decreeRangeDesc'), freefees: t('decreeFreefeesDesc'), longwatch: t('decreeLongwatchDesc') } as const;
  const tv = useSig(teach);
  return (
    <div class="decrees">
      <h3>{t('decrees')} <small>{Math.floor(v.me.credits)} {t('credits')}</small></h3>
      <p class="muted small">{t('decreesHint')}</p>
      <div class="cards">
        {DECREES.map((k) => {
          const active = v.me.decrees.find((d) => d.kind === k && d.until > now);
          const cost = DECREE_COST_CREDITS[k];
          return (
            <button key={k} class={`card-btn ${active ? 'has' : ''} ${teachClass(tv, `decree:${k}`)}`} disabled={!!active || v.me.credits < cost} onClick={() => void act({ type: 'decree', kind: k })}>
              <b>{decreeLabel(k)}</b><small>{desc[k]}</small>
              {active ? <small class="ok">{t('inForce')} · {hms(active.until - now)} {t('remaining')}</small> : <small class="r-credits">{cost} {t('credits')} · {DECREE_HOURS[k]} h</small>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SystemPanel({ v, map }: { v: PlayerView; map: { current: GalaxyMap | null } }) {
  const sel = useSig(selected);
  const tv = useSig(teach);
  const s = v.systems.find((x) => x.id === sel);
  const capName = v.systems.find((x) => x.id === v.me.capital)?.name ?? v.me.capital;
  const toCapital = <button class="capjump" onClick={() => goCapital(v, map.current)} title={t('capitalTag')}>★ {capName}</button>;
  if (!s) return <div><p class="muted">{t('selectHint')}</p>{toCapital}</div>;
  const mine = s.owner === v.me.id;
  const ownerName = s.owner ? v.colonies.find((c) => c.id === s.owner)?.name ?? s.owner : t('unclaimed');
  const totalSlots = s.slots + (s.id === v.me.capital ? 3 : 0);
  const free = s.buildings ? totalSlots - s.buildings.length : 0;
  const fleetsHere = v.fleets.filter((f) => f.at === s.id && f.owner === v.me.id);
  const drawn = v.draw?.bands.includes(s.band) ?? false;
  const targets = v.linkTargets[s.id]?.length ?? 0;
  const linking = useSig(linkFrom) === s.id;
  return (
    <div>
      {s.id !== v.me.capital && toCapital}
      <h2><span class={`r-${s.resource}`}><Icon name={s.resource} size={18} /></span> {s.name} {s.id === v.me.capital && <span class="tag">{t('capitalTag')}</span>} {s.kind === 'pulsar' && <span class="tag">{t('kindPulsar')}</span>} {s.kind === 'beacon' && <span class="tag">{t('kindBeacon')}</span>}</h2>
      <div class="facts">
        <span><b class={`r-${s.resource}`}>{t(s.resource)}</b> · {t(`${s.resource}Desc`)}</span>
        <span>{t('band')} <b class={drawn ? 'ev-eruption' : ''}>{s.band}</b>{drawn ? ` ×3 ${t('yieldNow')}` : ''} · {t('slots')} <b>{totalSlots}</b> · {t('owner')}: <b>{ownerName}</b>{s.connected ? ' ●' : ''}</span>
        <span>{t(TPL_KEY[s.template] ?? 'tplForge')} · <b>{s.pois}</b> {t('bodies')}{s.signature ? <> · <b class="bad">{t('hiddenOwner')}</b></> : null}</span>
        {s.population !== null && <span>{t('population')} <b>{(s.population * 100).toFixed(0)} %</b></span>}
        {s.stationHp !== null && <span>{t('station')} <b>{Math.round(s.stationHp)}</b> / 300{s.engaged ? ` · ${t('underAttack')}` : ''}</span>}
        {s.stock && <span>{t('localStock')} : {RES.map((r) => <b key={r} class={`r-${r}`}> {Math.round(s.stock![r])}</b>)} <small>/ {s.capacity}</small></span>}
      </div>
      <div class="actions">
        <button class={`enter ${s.engaged ? 'hot' : ''} ${teachClass(tv, `enter:${s.id}`)}`} onClick={() => { systemMode.value = s.id; }}>◎ {t('enterSystem')}</button>
        <button class="primary" onClick={() => { linkFrom.value = linking ? null : s.id; }} disabled={!s.connected || targets === 0}>{t('linkMode')} {s.connected ? `(${targets} ${t('inRange')})` : ''}</button>
        {s.kind === 'beacon' && mine && !s.lit && <button onClick={() => void act({ type: 'light_beacon', system: s.id })}>{t('lightBeacon')}</button>}
        {!mine && <button disabled={v.me.influence < AGENT_COST_INFLUENCE.probe} onClick={() => void act({ type: 'agent_mission', mission: 'probe', target: s.id })}>{t('probe')} ★{AGENT_COST_INFLUENCE.probe}</button>}
        {s.lit && <span class="tag">{t('lit')} {t('by')} {v.colonies.find((c) => c.id === s.lit!.by)?.name}</span>}
      </div>
      {linking && <LinkTargets v={v} from={s.id} />}
      {mine && s.buildings && <p class="muted small">{t('buildHint')} · {free > 0 ? `${free}/${totalSlots} ${t('slots').toLowerCase()}` : t('noSlot')}</p>}
      {fleetsHere.length > 0 && <FleetList v={v} fleets={fleetsHere} />}
      {!mine && s.owner && <SystemHostile v={v} s={s} />}
    </div>
  );
}

/** Link mode: the systems a relay can reach from here, with their cost. Tap a row to build; no need to find the star. */
function LinkTargets({ v, from }: { v: PlayerView; from: string }) {
  const cands = (v.linkTargets[from] ?? []).map((c) => ({ ...c, sys: v.systems.find((x) => x.id === c.to) })).filter((c) => c.sys);
  const stock = v.systems.find((x) => x.id === from)?.stock ?? v.me.stock;
  const tv = useSig(teach);
  return (
    <div class="linktargets">
      <h3>{t('targetsInRange')} <small>{cands.length}</small></h3>
      {cands.length === 0 && <p class="muted small">{t('noTargets')}</p>}
      <ul class="list">
        {cands.map((c) => {
          const afford = c.metal <= Math.max(stock.metal, v.me.stock.metal) && c.energy <= Math.max(stock.energy, v.me.stock.energy);
          return (
            <li key={c.to}>
              <span class={`dot r-${c.sys!.resource}`} /> <b>{c.sys!.name}</b> <small>{t(c.sys!.resource)} · {t('band')} {c.sys!.band}</small>
              <span class="cost"><span class="r-metal"><Icon name="metal" size={12} />{c.metal}</span><span class="r-energy"><Icon name="energy" size={12} />{c.energy}</span></span>
              <button class={`primary ${teachClass(tv, `link:${c.to}`)}`} disabled={!afford} onClick={() => { linkFrom.value = null; void act({ type: 'build_relay', a: from, b: c.to }).then((ok) => { if (!ok && toast.value) toast.value = { text: tError(toast.value.text), kind: 'err' }; }); }}>{t('linkTo')}</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SystemHostile({ v, s }: { v: PlayerView; s: SystemView }) {
  const idle = v.fleets.filter((f) => f.owner === v.me.id && f.at !== null && f.order === 'idle');
  const relays = v.relays.filter((r) => r.owner === s.owner && (r.a === s.id || r.b === s.id) && r.ready && !r.cut);
  return (
    <div>
      {idle.length > 0 && (
        <div class="actions">
          <button onClick={() => void act({ type: 'fleet_order', fleet: idle[0]!.id, order: 'blockade', target: s.id })}>{t('blockade')}</button>
          {s.owner && <button onClick={() => void act({ type: 'fleet_order', fleet: idle[0]!.id, order: 'raid', target: s.id })}>{t('raid')}</button>}
        </div>
      )}
      <h3>{t('agents')} <small>{Math.floor(v.me.influence)} {t('influence')}</small></h3>
      <div class="cards">
        <button class="card-btn" disabled={v.me.influence < AGENT_COST_INFLUENCE.spy} onClick={() => void act({ type: 'agent_mission', mission: 'spy', target: s.sector })}><b>{t('spy')}</b><small>{t('spyDesc')}</small><small class="r-influence">★ {AGENT_COST_INFLUENCE.spy}</small></button>
        {relays[0] && <button class="card-btn" disabled={v.me.influence < AGENT_COST_INFLUENCE.sabotage} onClick={() => void act({ type: 'agent_mission', mission: 'sabotage', target: relays[0]!.id })}><b>{t('sabotage')}</b><small>{t('sabotageDesc')}</small><small class="r-influence">★ {AGENT_COST_INFLUENCE.sabotage}</small></button>}
        {s.owner && <button class="card-btn" disabled={v.me.influence < AGENT_COST_INFLUENCE.envoy} onClick={() => void act({ type: 'agent_mission', mission: 'envoy', target: s.owner! })}><b>{t('envoy')}</b><small>{t('envoyDesc')}</small><small class="r-influence">★ {AGENT_COST_INFLUENCE.envoy}</small></button>}
      </div>
    </div>
  );
}

function FleetList({ v, fleets }: { v: PlayerView; fleets: PlayerView['fleets'] }) {
  return (
    <ul class="list">
      {fleets.map((f) => (
        <li key={f.id}>
          <b>{f.units ? `${f.units.corvette}c ${f.units.frigate}f ${f.units.cruiser}k` : f.size}</b> · {f.order}
          {f.at ? ` ${t('at')} ${v.systems.find((s) => s.id === f.at)?.name ?? f.at}` : ` ${t('inTransit')}`}
          {f.owner === v.me.id && f.at && f.order !== 'blockade' && selected.value && selected.value !== f.at && (
            <span class="actions inline">
              <button onClick={() => void act({ type: 'fleet_order', fleet: f.id, order: 'move', target: selected.value! })}>{t('move')}</button>
              <button onClick={() => void act({ type: 'fleet_order', fleet: f.id, order: 'defend', target: selected.value! })}>{t('defend')}</button>
            </span>
          )}
          {f.owner === v.me.id && f.at && f.at !== v.me.capital && <button onClick={() => void act({ type: 'fleet_order', fleet: f.id, order: 'return', target: v.me.capital })}>{t('return')}</button>}
        </li>
      ))}
    </ul>
  );
}

function FleetsPanel({ v, map }: { v: PlayerView; map: { current: GalaxyMap | null } }) {
  const mine = v.fleets.filter((f) => f.owner === v.me.id);
  if (!mine.length) return <p class="muted">—</p>;
  return (
    <div>
      <FleetList v={v} fleets={mine} />
      <p class="muted" onClick={() => mine[0]?.at && map.current?.centerOn(mine[0].at)}>{t('selectHint')}</p>
    </div>
  );
}

function MarketPanel({ v }: { v: PlayerView }) {
  const [region, setRegion] = useState(v.me.regions[0]?.key ?? '');
  const [res, setRes] = useState<Resource>('food');
  const [side, setSide] = useState<'buy' | 'sell'>('sell');
  const [qty, setQty] = useState(20);
  const [price, setPrice] = useState(1);
  const tv = useSig(teach);
  const pre = useSig(marketPrefill);
  useEffect(() => { if (!pre) return; setRegion(pre.region); setRes(pre.resource); setSide(pre.side); setQty(pre.qty); setPrice(pre.price); marketPrefill.value = null; }, [pre]);
  if (!v.me.regions.length) return <p class="muted">{t('noMarket')}</p>;
  const last = v.clearing.find((c) => c.region === region && c.resource === res);
  return (
    <div>
      <h3>{t('lastPrice')}</h3>
      <table class="prices"><thead><tr><th>{t('region')}</th>{RES.map((r) => <th key={r} class={`r-${r}`}><Icon name={r} size={12} /></th>)}</tr></thead>
        <tbody>{v.me.regions.map((rg) => <tr key={rg.key} class={rg.key === region ? 'on' : ''} onClick={() => setRegion(rg.key)}><td>{rg.name}</td>{RES.map((r) => { const c = v.clearing.find((x) => x.region === rg.key && x.resource === r); return <td key={r}>{c ? c.price : '—'}</td>; })}</tr>)}</tbody></table>
      <div class="row">
        <label>{t('region')}<select value={region} onChange={(e) => setRegion((e.target as HTMLSelectElement).value)}>{v.me.regions.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select></label>
        <label>{t(res)}<select value={res} onChange={(e) => setRes((e.target as HTMLSelectElement).value as Resource)}>{RES.map((r) => <option key={r} value={r}>{t(r)}</option>)}</select></label>
      </div>
      <div class="seg wide"><button class={side === 'buy' ? 'on' : ''} onClick={() => setSide('buy')}>{t('buy')}</button><button class={side === 'sell' ? 'on' : ''} onClick={() => setSide('sell')}>{t('sell')}</button></div>
      <div class="row">
        <label>{t('qty')}<input type="number" min={1} value={qty} onInput={(e) => setQty(Number((e.target as HTMLInputElement).value))} /></label>
        <label>{t('price')}<input type="number" min={0.1} step={0.1} value={price} onInput={(e) => setPrice(Number((e.target as HTMLInputElement).value))} /></label>
        <button class={`primary ${teachClass(tv, 'market:place')}`} onClick={() => void act({ type: 'market_order', region, resource: res, side, qty, price })}>{t('place')}</button>
      </div>
      {last && <p class="muted">{t('lastPrice')}: {last.price} ({last.qty})</p>}
      <h3>{t('myOrders')}</h3>
      <ul class="list">{v.orders.map((o) => <li key={o.id}>{t(o.side)} {o.qty} {t(o.resource)} @ {o.price} <button onClick={() => void act({ type: 'cancel_order', order: o.id })}>{t('cancel')}</button></li>)}</ul>
      <Barter v={v} />
    </div>
  );
}

function Barter({ v }: { v: PlayerView }) {
  const partners = v.colonies.filter((c) => c.id !== v.me.id).sort((a, b) => (b.ally ? 1 : 0) - (a.ally ? 1 : 0) || b.score - a.score).slice(0, 40);
  const [to, setTo] = useState(partners[0]?.id ?? '');
  const [giveR, setGiveR] = useState<Resource>('food');
  const [giveQ, setGiveQ] = useState(20);
  const [wantR, setWantR] = useState<Resource>('energy');
  const [wantQ, setWantQ] = useState(10);
  const name = (id: string): string => v.colonies.find((c) => c.id === id)?.name ?? id;
  const fmtStock = (st: Partial<Record<Resource, number | undefined>>): string => RES.filter((r) => st[r]).map((r) => `${st[r]} ${t(r)}`).join(' + ');
  return (
    <div>
      <h3>{t('barter')}</h3>
      <div class="row">
        <label>{t('offerTo')}<select value={to} onChange={(e) => setTo((e.target as HTMLSelectElement).value)}>{partners.map((c) => <option key={c.id} value={c.id}>{c.name}{c.ally ? ' ✓' : ''}{c.npc ? ' (PNJ)' : ''}</option>)}</select></label>
      </div>
      <div class="row">
        <label>{t('give')}<div class="seg"><input type="number" min={1} value={giveQ} onInput={(e) => setGiveQ(Number((e.target as HTMLInputElement).value))} /><select value={giveR} onChange={(e) => setGiveR((e.target as HTMLSelectElement).value as Resource)}>{RES.map((r) => <option key={r} value={r}>{t(r)}</option>)}</select></div></label>
        <label>{t('want')}<div class="seg"><input type="number" min={1} value={wantQ} onInput={(e) => setWantQ(Number((e.target as HTMLInputElement).value))} /><select value={wantR} onChange={(e) => setWantR((e.target as HTMLSelectElement).value as Resource)}>{RES.map((r) => <option key={r} value={r}>{t(r)}</option>)}</select></div></label>
        <button class="primary" disabled={!to} onClick={() => void act({ type: 'barter_offer', to, give: { [giveR]: giveQ }, want: { [wantR]: wantQ } })}>{t('send')}</button>
      </div>
      <p class="muted">{t('settledAtDraw')}</p>
      {v.barters.length > 0 && <h3>{t('offers')}</h3>}
      <ul class="list">
        {v.barters.map((b) => (
          <li key={b.id}>
            <span>{name(b.from)} → {name(b.to)}: <b>{fmtStock(b.give)}</b> ⇄ <b>{fmtStock(b.want)}</b> {b.accepted ? '✓' : ''}</span>
            {b.to === v.me.id && !b.accepted && <button class="primary" onClick={() => void act({ type: 'barter_accept', offer: b.id })}>{t('accept')}</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DiplomacyPanel({ v }: { v: PlayerView }) {
  const [name, setName] = useState('');
  const others = v.colonies.filter((c) => c.id !== v.me.id).sort((a, b) => b.score - a.score).slice(0, 30);
  const tv = useSig(teach);
  return (
    <div>
      <h3>{t('alliance')}</h3>
      {v.me.alliance ? <p>{v.colonies.find((c) => c.id === v.me.id)?.allianceName}</p> : (
        <div class="row"><input placeholder={t('createAlliance')} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /><button onClick={() => void act({ type: 'alliance_create', name })} disabled={name.length < 2}>{t('createAlliance')}</button></div>
      )}
      {v.invites.map((i) => <p key={i.alliance}>{i.name} <button onClick={() => void act({ type: 'alliance_join', alliance: i.alliance })}>{t('join')}</button></p>)}
      <h3>{t('treaties')}</h3>
      <ul class="list">{v.treaties.map((tr) => <li key={tr.id}>{t(tr.kind as 'nap')} — {v.colonies.find((c) => c.id === tr.with)?.name}</li>)}</ul>
      <ul class="list">
        {others.map((c) => (
          <li key={c.id}>
            <span class={`f-${c.faction}`}>{c.name}</span> <small>{c.score} {c.npc ? '· PNJ' : ''} {c.ally ? '· ✓' : ''}</small>
            <span class="actions inline">
              {(['nap', 'trade', 'transit'] as const).map((k) => <button key={k} class={teachClass(tv, `treaty:${k}:${c.id}`)} onClick={() => void act({ type: 'treaty', with: c.id, kind: k })}>{t(k)}</button>)}
              {v.me.alliance && <button onClick={() => void act({ type: 'alliance_invite', colony: c.id })}>+</button>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const talk = signal<Turn[]>([]);
let talkLoaded = false;
/** The doctrine waiting for the player's yes (DOCTRINE_CONFIRM): restored from the server once per load. */
const pendingDoctrine = signal<PendingCard | null>(null);
let pendingLoaded = false;
view.subscribe((v) => { if (!v) { pendingLoaded = false; pendingDoctrine.value = null; } }); // logged out: the next Colony loads its own
function loadPendingDoctrine(force = false): void {
  if (pendingLoaded && !force) return;
  pendingLoaded = true;
  void fetchPendingDoctrine().then((b) => { pendingDoctrine.value = cardFromPending(b); });
}

/** « Voici ce que je ferai en ton absence »: the lines the General will play by, and the player's yes or no. */
function DoctrineCard({ v, card }: { v: PlayerView; card: PendingCard }) {
  const [busy, setBusy] = useState(false);
  const say = (text: string, kind: 'ok' | 'err' = 'ok'): void => { toast.value = { text, kind }; setTimeout(() => { if (toast.value?.text === text) toast.value = null; }, 3500); };
  const apply = async (): Promise<void> => {
    setBusy(true);
    const r = await confirmDoctrine(card.id);
    setBusy(false);
    if (r === 'ok') { pendingDoctrine.value = null; say(t('pendingApplied')); }
    else if (r === 'gone') { say(t('pendingGone'), 'err'); loadPendingDoctrine(true); }
    else say(t('generalOffline'), 'err');
  };
  const notThat = async (): Promise<void> => {
    setBusy(true);
    const ok = await discardDoctrine();
    setBusy(false);
    if (!ok) { say(t('generalOffline'), 'err'); return; }
    pendingDoctrine.value = null;
    say(t('pendingDiscarded'));
    (document.querySelector('.generalpanel .say textarea') as HTMLTextAreaElement | null)?.focus();
  };
  // On a phone the buttons come right under the title, before the lines, and the list folds after a few lines: the
  // yes and the no stay in view above the composer (390x844), the rest is one tap away.
  const [all, setAll] = useState(false);
  useEffect(() => setAll(false), [card.id]);
  const { shown, hidden } = visibleLines(card.readable, all);
  return (
    <div class="doctrine-card" role="region" aria-label={t('pendingTitle')}>
      <small class="who">{t(v.me.persona as 'vane')}</small>
      <p class="title"><b>{t('pendingTitle')}</b></p>
      <p class="voice">{t(pendingLineKey(v.me.persona))}</p>
      {card.question && <p class="question">{card.question}</p>}
      <div class="acts">
        <button class="primary" disabled={busy} onClick={() => void apply()}>{t('pendingApply')}</button>
        <button disabled={busy} onClick={() => void notThat()}>{t('pendingNotThat')}</button>
      </div>
      {card.readable.length > 0 ? (
        <>
          <ul>{shown.map((l, i) => <li key={i}>{l}</li>)}</ul>
          {hidden > 0 && <button class="link more" onClick={() => setAll(true)}>{t('pendingSeeAll').replace('{n}', String(hidden))}</button>}
          {all && card.readable.length > CARD_LINES + 1 && <button class="link more" onClick={() => setAll(false)}>{t('pendingSeeLess')}</button>}
        </>
      ) : <p class="muted small">{t('pendingNothing')}</p>}
    </div>
  );
}

function GeneralPanel({ v }: { v: PlayerView }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const thread = useSig(talk);
  const card = useSig(pendingDoctrine);
  const endRef = useRef<HTMLDivElement>(null);
  const p = v.me.policy;
  useEffect(() => { if (!talkLoaded) { talkLoaded = true; void fetchTalk().then((h) => { if (h.length) talk.value = h; }); } loadPendingDoctrine(); }, []);
  // The General speaks first when a hostile fleet heads our way: pick up its line when such an event lands.
  const inboundCount = v.events.filter((e) => e.kind === 'fleet.inbound' && e.actors[1] === v.me.id).length;
  // Whenever the General may have spoken first (hostile fleet, new tier, first contact), the thread is refetched: the
  // view push carries the event, not the words.
  const spokeCount = v.events.filter((e) => (e.kind === 'fleet.inbound' && e.actors[1] === v.me.id) || ((e.kind === 'onboarding.unlocked' || e.kind === 'contact.first') && e.actors[0] === v.me.id)).length;
  useEffect(() => {
    if (!talkLoaded || (spokeCount === 0 && inboundCount === 0)) return;
    const timer = setTimeout(() => void fetchTalk().then((h) => { const last = talk.value[talk.value.length - 1]; if (h.length && (h.length !== talk.value.length || h[h.length - 1]!.at !== last?.at)) talk.value = h; }), 300);
    return () => clearTimeout(timer);
  }, [spokeCount, inboundCount]);
  // What the General did; the player's answers to the Counsel are the player's, they live in the memory.
  const journal = v.me.journal.filter((n) => !n.kind.startsWith('counsel.')).reverse().slice(0, 12);
  const tv = useSig(teach);
  const cardRef = useRef<HTMLDivElement>(null);
  // A new doctrine card opens on its title (« Voici ce que je ferai… »), not on its last line; otherwise follow the thread.
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [thread.length, busy]);
  useEffect(() => { if (card) cardRef.current?.scrollIntoView({ block: 'start' }); }, [card?.id]);
  const submit = async () => {
    const said = text.trim();
    if (!said) return;
    setBusy(true); setText('');
    talk.value = [...talk.value, { who: 'me', text: said, at: Date.now() }];
    const r = await sendTalk(said, lang.value);
    setBusy(false);
    if (r) { talk.value = r.history; pendingDoctrine.value = cardAfterTalk(pendingDoctrine.value, r); if (r.policyChanged) toast.value = { text: t('compiled'), kind: 'ok' }; }
    else talk.value = [...talk.value, { who: 'general', text: t('generalOffline'), at: Date.now() }];
  };
  return (
    <div class="generalpanel">
      <h2>{t(v.me.persona as 'vane')} <small class="muted">{t(`${v.me.persona}Desc` as 'vaneDesc')}</small></h2>
      {(v.me.onboarding?.tier ?? 6) < 6 && (
        <p class="tag">{t('tierOpened').replace('{k}', t(`tier${v.me.onboarding.tier}` as 'tier1'))} · <button class="link" onClick={() => void act({ type: 'onboarding_unlock' }, t('showMeAllDone'))}>{t('showMeAll')}</button></p>
      )}
      <div class="talk">
        {thread.length === 0 && <p class="bubble general">{t('generalHello')}</p>}
        {thread.slice(-12).map((m, i) => <p key={`${m.at}-${i}`} class={`bubble ${m.who}`}>{m.text}</p>)}
        {busy && <p class="bubble general muted">{t('thinking')}</p>}
      </div>
      <div ref={cardRef}>{card && <DoctrineCard v={v} card={card} />}</div>
      <div class={`say ${teachClass(tv, 'say')}`}>
        <textarea rows={2} value={text} placeholder={t('doctrinePlaceholder')} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} onFocus={(e) => setTimeout(() => (e.target as HTMLElement).scrollIntoView({ block: 'nearest' }), 250)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }} />
        <button class="primary" disabled={busy || text.trim().length < 1} onClick={() => void submit()}>{t('send')}</button>
      </div>
      <div ref={endRef} />
      {p.notes && <p class="muted small">{t('doctrine')} : {p.notes}</p>}
      <h3>{t('journalGeneral')}</h3>
      {journal.length === 0 ? <p class="muted small">{t('journalEmpty')}</p> : (
        <ul class="list journal">{journal.map((n, i) => <li key={`${n.at}-${i}`}><small>{stamp(n.at)}</small> <span>{describeNote(n, v)}</span></li>)}</ul>
      )}
      <h3>{t('policy')}</h3>
      <p>{t('expansion')}: {(p.expansion * 100).toFixed(0)} % · {t('aggression')}: {(p.aggression * 100).toFixed(0)} %</p>
      <div class="row">
        <label>{t('expansion')}<input type="range" min={0} max={1} step={0.1} value={p.expansion} onChange={(e) => void act({ type: 'set_policy', policy: { ...p, expansion: Number((e.target as HTMLInputElement).value) } })} /></label>
        <label>{t('aggression')}<input type="range" min={0} max={1} step={0.1} value={p.aggression} onChange={(e) => void act({ type: 'set_policy', policy: { ...p, aggression: Number((e.target as HTMLInputElement).value) } })} /></label>
      </div>
      <button onClick={() => void fetchBriefing(lang.value).then((b) => { if (b) briefing.value = b; })}>{t('briefing')}</button>
    </div>
  );
}

/** The Account tab (decision 0010, lot A): who I am, the devices holding this Colony, the General's memory, language,
 *  installation, and the way out. Guests are told what leaving costs; the passkey comes with lot B. */
/** The rescue e-mail (decision 0010, lot C): address, then the six-digit code, typed here, never a link. */
function EmailSection({ email, onChange, say }: { email: string | null; onChange: () => void; say: (text: string, kind?: 'ok' | 'err') => void }) {
  const [step, setStep] = useState<'idle' | 'address' | 'code'>('idle');
  const [addr, setAddr] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const l = useSig(lang);
  const send = async (e: Event) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const r = await startEmail(addr.trim(), l);
    setBusy(false);
    if (r.ok) { setStep('code'); setCode(''); } else setErr(tError(r.reason ?? ''));
  };
  const confirm = async (e: Event) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const r = await verifyEmail(code);
    setBusy(false);
    if (r.ok) { say(t('emailAdded')); setStep('idle'); onChange(); } else setErr(tError(r.reason ?? ''));
  };
  const drop = async () => { if (await removeEmail()) { say(t('emailRemoved')); onChange(); } };
  if (step === 'idle') {
    return (
      <>
        <p class="muted small">{t('rescueEmailHelp')}</p>
        {email ? (
          <ul class="list"><li><span><b>{email}</b></span><span class="actions"><button onClick={() => { setAddr(email); setStep('address'); }}>{t('changeEmail')}</button><button onClick={() => void drop()}>{t('emailRemove')}</button></span></li></ul>
        ) : <button class="primary" onClick={() => setStep('address')}>{t('addEmail')}</button>}
      </>
    );
  }
  return (
    <form class="selbox emailform" onSubmit={(e) => void (step === 'address' ? send(e) : confirm(e))}>
      {step === 'address' ? (
        <label>{t('emailAddress')}<input type="email" inputMode="email" autoComplete="email" value={addr} onInput={(e) => setAddr((e.target as HTMLInputElement).value)} required autoFocus /></label>
      ) : (
        <>
          <p class="muted small">{t('codeSentTo').replace('{e}', addr.trim().toLowerCase())}</p>
          <label>{t('typeCode')}<input class="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} required autoFocus /></label>
        </>
      )}
      {err && <p class="error">{err}</p>}
      <div class="actions">
        <button class="primary" disabled={busy || (step === 'address' ? !addr.includes('@') : code.replace(/\D/g, '').length !== 6)}>{step === 'address' ? t('sendCode') : t('confirmCode')}</button>
        {step === 'code' && <button type="button" disabled={busy} onClick={() => setStep('address')}>{t('back')}</button>}
        <button type="button" onClick={() => { setStep('idle'); setErr(null); }}>{t('cancel')}</button>
      </div>
    </form>
  );
}

/** « Soutenir Aurane » (decision 0011): a one-off purchase, a cosmetic founder title held by the account, zero effect on
 *  the game. Hidden when the server has no payment provider, unless the title is already owned. */
function SupportSection({ accountId, say }: { accountId: string | null; say: (text: string, kind?: 'ok' | 'err') => void }) {
  const l = useSig(lang);
  const ret = useSig(paidReturn);
  const [cfg, setCfg] = useState<PaymentsConfig | null>(null);
  const [ent, setEnt] = useState<Awaited<ReturnType<typeof fetchEntitlements>>>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void fetchPublicConfig().then((c) => setCfg(c.payments ?? { enabled: false, skus: [] })); }, []);
  // The webhook may land a few seconds after Stripe sends the player back: poll until the title exists (30 s at most).
  useEffect(() => {
    let stop = false; let tries = 0;
    const load = async (): Promise<void> => {
      const e = await fetchEntitlements();
      if (stop) return;
      setEnt(e);
      const has = e?.entitlements.some((x) => x.sku === 'support_founder' && x.active) ?? false;
      if (!has && ret && ret !== 'cancel' && tries++ < 15) setTimeout(() => void load(), 2000);
    };
    void load();
    return () => { stop = true; };
  }, [ret, accountId]);
  const owned = ent?.entitlements.some((x) => x.sku === 'support_founder' && x.active) ?? false;
  const offer = cfg?.enabled ? cfg.skus.find((x) => x.id === 'support_founder') : undefined;
  const back = ret !== null && ret !== 'cancel';
  if (!owned && !offer && !back) return null;
  const price = offer ? String(offer.priceChf) : '5';
  const buy = async () => {
    setBusy(true);
    const r = await startCheckout('support_founder', l);
    setBusy(false);
    say(t('supportFailed').replace('{r}', tError(r.reason)), 'err');
  };
  return (
    <>
      <h3>{t('supportTitle')}</h3>
      {owned ? (
        <>
          <p><span class="tag ok founder">✦ {t('founderTitle')}</span></p>
          <p class="muted small">{back ? t('supportThanks') : t('supportOwned')}</p>
        </>
      ) : back ? (
        <p class="muted small">{t('supportPending')}</p>
      ) : (
        <>
          {ret === 'cancel' && <p class="muted small">{t('supportCancelled')}</p>}
          <p class="muted small">{t('supportText').replace('{p}', price)}</p>
          <p class="muted small">{t('supportLegal')}</p>
          {ent && !ent.account ? <p class="muted small">{t('supportNeedsAccount')}</p> : <button class="primary" disabled={busy || !ent} onClick={() => void buy()}>{t('supportButton').replace('{p}', price)}</button>}
        </>
      )}
    </>
  );
}

function AccountPanel({ v }: { v: PlayerView }) {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [keying, setKeying] = useState(false);
  const l = useSig(lang);
  const load = () => { void fetchSessions().then(setSessions); void fetchAccount().then(setAccount); };
  useEffect(load, []);
  const hasKeys = (account?.passkeys.length ?? 0) > 0;
  const hasEmail = !!account?.account?.email;
  const protectedBy = hasKeys || hasEmail;
  const say = (text: string, kind: 'ok' | 'err' = 'ok') => { toast.value = { text, kind }; setTimeout(() => { if (toast.value?.text === text) toast.value = null; }, 3000); };
  const enroll = async () => {
    setKeying(true);
    const r = await addPasskey(l);
    setKeying(false);
    if (r.ok) { say(t('passkeyAdded')); load(); }
    else if (r.reason === 'cancelled') say(t('passkeyCancelled'), 'err');
    else say(t('passkeyFailed').replace('{r}', r.reason ?? ''), 'err');
  };
  const drop = async (id: string) => { if (await removePasskey(id)) load(); };
  const when = (ms: number | null): string => (ms ? new Date(ms).toLocaleString(l === 'fr' ? 'fr-CH' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }) : t('neverSeen'));
  const cut = async (id: string) => { if (await revokeSession(id)) { toast.value = { text: t('cutOffDone'), kind: 'ok' }; setTimeout(() => { toast.value = null; }, 2500); load(); } };
  const download = async () => {
    const data = await exportMemory();
    if (data === null) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `aurane-memory-${v.me.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const erase = async () => { setErasing(false); if (await eraseMemory()) { toast.value = { text: t('erased'), kind: 'ok' }; setTimeout(() => { toast.value = null; }, 2500); } };
  return (
    <div class="account">
      <h2>{v.me.name} <small class={`f-${v.me.faction}`}>{t(v.me.faction as 'guild')}</small></h2>
      <p class="muted">{t(v.me.persona as 'vane')} · <span class={`tag ${protectedBy ? 'ok' : ''}`}>{protectedBy ? t('accountProtected') : t('accountGuest')}</span></p>
      <p class="muted small">{hasKeys ? t('accountProtectedHelp') : hasEmail ? t('accountProtectedEmail') : t('accountGuestHelp')}</p>
      <h3>{t('passkeys')} {account && account.passkeys.length > 0 && <small>{account.passkeys.length}</small>}</h3>
      {!protectedBy && <p class="muted small">{t('addPasskeyHelp')}</p>}
      <ul class="list">
        {(account?.passkeys ?? []).map((k) => (
          <li key={k.id}>
            <span><b>{k.label || '—'}</b> <small>· {t('lastUsed')} {when(k.lastUsedAt)}</small></span>
            <button onClick={() => void drop(k.id)}>{t('removePasskey')}</button>
          </li>
        ))}
      </ul>
      {passkeysSupported() ? <button class="primary" disabled={keying} onClick={() => void enroll()}>{t('addPasskey')}</button> : <p class="muted small">{t('passkeyUnsupported')}</p>}
      <h3>{t('rescueEmail')}</h3>
      <EmailSection email={account?.account?.email ?? null} onChange={load} say={say} />
      <SupportSection accountId={account?.account?.id ?? null} say={say} />
      <h3>{t('devices')} {sessions && <small>{sessions.length}</small>}</h3>
      <ul class="list">
        {(sessions ?? []).map((s) => (
          <li key={s.id}>
            <span><b>{s.label || '—'}</b>{s.current ? <span class="tag"> {t('thisDevice')}</span> : null} <small>· {t('lastSeen')} {when(s.lastSeenAt ?? s.createdAt)}</small></span>
            {!s.current && <button onClick={() => void cut(s.id)}>{t('cutOff')}</button>}
          </li>
        ))}
      </ul>
      <DeviceLink />
      <h3>{t('memoryTitle')}</h3>
      <p class="muted small">{t('memoryHelp')}</p>
      <div class="actions">
        <button onClick={() => void download()}>{t('exportMemory')}</button>
        {!erasing ? <button onClick={() => setErasing(true)}>{t('eraseMemory')}</button> : <><span class="bad small">{t('eraseMemoryConfirm')}</span> <button class="primary" onClick={() => void erase()}>{t('eraseMemory')}</button> <button onClick={() => setErasing(false)}>{t('cancel')}</button></>}
      </div>
      <h3>{t('language')}</h3>
      <div class="lang"><button class={l === 'fr' ? 'on' : ''} onClick={() => setLang('fr')}>FR</button><button class={l === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button></div>
      <div class="actions"><InstallButton compact /><a class="link" href={`/c/${encodeURIComponent(v.me.id)}`} target="_blank" rel="noopener">{t('colonyPage')} ›</a></div>
      <h3>{t('logout')}</h3>
      {!leaving ? <button onClick={() => setLeaving(true)}>{t('logout')}</button> : protectedBy ? (
        <div class="selbox">
          <p class="muted">{hasKeys ? t('logoutSafe') : t('logoutSafeEmail')}</p>
          <div class="actions"><button class="primary" onClick={() => void logout()}>{t('logout')}</button><button onClick={() => setLeaving(false)}>{t('cancel')}</button></div>
        </div>
      ) : (
        <div class="selbox">
          <p class="bad">{t('logoutWarn')}</p>
          <div class="actions">
            {passkeysSupported() && <button class="primary" disabled={keying} onClick={() => void enroll()}>{t('addPasskey')}</button>}
            <button onClick={() => void logout()}>{t('logoutAnyway')}</button>
            <button onClick={() => setLeaving(false)}>{t('cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A 24 h link to open this colony on another device (phone, laptop). */
function DeviceLink() {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div class="devicelink">
      {!url && <button onClick={() => void requestLink().then((r) => setUrl(r?.url ?? null))}>{t('linkDevice')}</button>}
      {url && (
        <>
          <p class="muted">{t('linkDeviceHelp')}</p>
          <input readOnly value={url} onFocus={(e) => (e.target as HTMLInputElement).select()} />
          <button onClick={() => { void navigator.clipboard?.writeText(url).then(() => setCopied(true)); }}>{copied ? t('copied') : t('copy')}</button>
        </>
      )}
    </div>
  );
}

const LOG_READ_KEY = 'aurane.logread';
const logRead = signal<number>((() => { try { return Number(localStorage.getItem(LOG_READ_KEY) ?? -1); } catch { return -1; } })());
function markLogRead(v: PlayerView): void {
  const last = v.events.length ? v.events[v.events.length - 1]!.at : v.time;
  if (last <= logRead.value) return;
  logRead.value = last;
  try { localStorage.setItem(LOG_READ_KEY, String(last)); } catch { /* ignore */ }
}

/** The living log: one readable line per event, the hourly recap as a card, newest first. */
function LogPanel({ v }: { v: PlayerView }) {
  const lines = v.events.map((e, i) => describeEvent(e, v, i)).filter((x): x is NonNullable<typeof x> => x !== null).reverse();
  const tv = useSig(teach);
  const firstRecap = lines.find((l) => l.recap)?.key;
  if (!lines.length) return <p class="muted">{t('noEvents')}</p>;
  return (
    <ul class="list feed">
      {lines.map((l) => (
        <li key={l.key} class={`tone-${l.tone} ${l.system ? 'has-sys' : ''}`} onClick={l.system ? () => { selected.value = l.system; } : undefined}>
          {l.recap ? (
            <div class={`recap ${l.key === firstRecap ? teachClass(tv, 'recap') : ''}`}>
              <div class="head"><b>{l.text}</b> <small>{stamp(l.at)}</small></div>
              <div class="chips">
                {RES.map((r) => <span key={r} class={`chip r-${r}`}><Icon name={r} size={12} /> <b>+{fmt(l.recap!.produced[r] ?? 0)}</b></span>)}
                <span class="chip r-credits"><Icon name="credits" size={12} /> <b>+{l.recap.credits}</b></span>
              </div>
              <small class="muted">{l.recap.productive} {t('recapSystems')} · {l.recap.drawn} {t('recapDrawn')}{l.recap.overflow > 0 ? <> · <span class="bad">{l.recap.overflow} {t('recapLost')}</span></> : null}{l.recap.unpowered > 0 ? <> · <span class="bad">{l.recap.unpowered} {t('recapUnpowered')}</span></> : null}</small>
            </div>
          ) : (
            <><i /> <span>{l.text}</span> <small>{stamp(l.at)}</small></>
          )}
        </li>
      ))}
    </ul>
  );
}
