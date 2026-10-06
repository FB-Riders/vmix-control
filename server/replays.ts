import type { VmixParams } from './vmix';

/** One marked scene. It lives in the event tab of its period and, as a highlight, as a copy in the highlight tab. */
export interface Scene {
  id: number;
  period: number; // index into the configured periods
  time: string; // game clock when it was marked
  cams: string[];
  type: string;
  fav: boolean; // starred by the operator
}

export interface ReplayBookData {
  scenes: Scene[];
  tabs: Record<string, number[]>;
  nextId: number;
}

type Call = (params: VmixParams) => Promise<void>;

/**
 * The panel's picture of vMix Replay's event tabs ("Events 1" to "Events 20").
 *
 * vMix does not report which events a tab holds, so this book is the only record: for every tab it keeps the scene
 * ids in the order vMix holds them (oldest first). vMix can only act on the last or the selected event of the tab
 * that is showing, so every operation first switches to the tab, then selects the last event and steps back to the
 * one that is meant. This stays correct as long as events are created, copied and deleted only through the panel.
 */
export class ReplayBook {
  private scenes: Scene[] = [];
  private tabs: Record<number, number[]> = {};
  private nextId = 1;

  constructor(
    private readonly call: Call,
    private readonly periodTabs: number[],
    private readonly highlightTab: number,
    data?: ReplayBookData,
  ) {
    if (data?.tabs) {
      this.scenes = data.scenes;
      this.nextId = data.nextId;
      for (const [tab, ids] of Object.entries(data.tabs)) this.tabs[Number(tab)] = ids;
    }
  }

  toJSON(): ReplayBookData {
    return { scenes: this.scenes, tabs: this.tabs, nextId: this.nextId };
  }

  reset(): void {
    this.scenes = [];
    this.tabs = {};
  }

  // ---------- reading the model ----------

  /** All scenes, newest first. */
  all(): Scene[] { return [...this.scenes].reverse(); }
  find(id: number): Scene | undefined { return this.scenes.find((s) => s.id === id); }
  tabOf(period: number): number { return this.periodTabs[period] ?? this.periodTabs[0]; }
  count(tab: number): number { return this.tabs[tab]?.length ?? 0; }
  isHighlight(id: number): boolean { return !!this.tabs[this.highlightTab]?.includes(id); }

  /** Scenes of a tab in the order vMix plays them. */
  inTab(tab: number): Scene[] {
    return (this.tabs[tab] ?? []).flatMap((id) => this.find(id) ?? []);
  }

  highlights(): Scene[] { return this.inTab(this.highlightTab); }

  // ---------- talking to vMix ----------

  private show(tab: number): Promise<void> {
    return this.call({ Function: `ReplaySelectEvents${tab}` });
  }

  /** Runs a replay function on one scene's event in one tab: the "LastEvent" variant if it is the newest there. */
  private async on(tab: number, id: number, lastFn: string, selectedFn: string, value?: string | number): Promise<void> {
    const ids = this.tabs[tab] ?? [];
    const back = ids.length - 1 - ids.indexOf(id);
    await this.show(tab);
    if (back === 0) { await this.call({ Function: lastFn, Value: value }); return; }
    await this.call({ Function: 'ReplaySelectLastEvent' });
    for (let i = 0; i < back; i++) await this.call({ Function: 'ReplaySelectPreviousEvent' });
    await this.call({ Function: selectedFn, Value: value });
  }

  /** Every tab that holds the scene: its period tab, and the highlight tab if it was copied there. */
  private tabsOf(scene: Scene): number[] {
    return [this.tabOf(scene.period), ...(this.isHighlight(scene.id) ? [this.highlightTab] : [])];
  }

  /** Creates an event of the last `seconds` in the period's tab, with the given replay cameras. */
  async mark(period: number, seconds: number, cameras: number[], scene: Omit<Scene, 'id' | 'period'>): Promise<Scene> {
    const tab = this.tabOf(period);
    await this.show(tab);
    await this.call({ Function: 'ReplayMarkInOutLive', Value: seconds });
    await this.call({ Function: 'ReplayLastEventSingleCameraOn', Value: cameras[0] });
    for (const n of cameras.slice(1)) await this.call({ Function: 'ReplayLastEventCameraOn', Value: n });
    await this.call({ Function: 'ReplaySetLastEventText', Value: scene.type }).catch(() => {});
    const created: Scene = { ...scene, id: this.nextId++, period };
    this.scenes.push(created);
    this.tabs[tab] = [...(this.tabs[tab] ?? []), created.id];
    return created;
  }

  async setType(scene: Scene, type: string): Promise<void> {
    for (const tab of this.tabsOf(scene)) await this.on(tab, scene.id, 'ReplaySetLastEventText', 'ReplaySetSelectedEventText', type);
    scene.type = type;
  }

  async setCamera(scene: Scene, camera: number, on: boolean, cams: string[]): Promise<void> {
    const [last, selected] = on ? ['ReplayLastEventCameraOn', 'ReplaySelectedEventCameraOn'] : ['ReplayLastEventCameraOff', 'ReplaySelectedEventCameraOff'];
    for (const tab of this.tabsOf(scene)) await this.on(tab, scene.id, last, selected, camera);
    scene.cams = cams;
  }

  /** Copies the scene into the highlight tab, or deletes that copy again. */
  async setHighlight(scene: Scene, on: boolean): Promise<void> {
    if (on === this.isHighlight(scene.id)) return;
    const hl = this.highlightTab;
    if (on) {
      // vMix numbers the target tab from 0.
      await this.on(this.tabOf(scene.period), scene.id, 'ReplayCopyLastEvent', 'ReplayCopySelectedEvent', hl - 1);
      this.tabs[hl] = [...(this.tabs[hl] ?? []), scene.id];
    } else {
      await this.on(hl, scene.id, 'ReplayDeleteLastEvent', 'ReplayDeleteSelectedEvent');
      this.tabs[hl] = this.tabs[hl].filter((x) => x !== scene.id);
    }
  }

  async play(scene: Scene, toOutput: boolean): Promise<void> {
    const suffix = toOutput ? 'ToOutput' : '';
    await this.on(this.tabOf(scene.period), scene.id, `ReplayPlayLastEvent${suffix}`, `ReplayPlaySelectedEvent${suffix}`);
  }

  /** Deletes the scene everywhere: its copy in the highlight tab and the event in its period tab. */
  async remove(scene: Scene): Promise<void> {
    await this.setHighlight(scene, false);
    const tab = this.tabOf(scene.period);
    await this.on(tab, scene.id, 'ReplayDeleteLastEvent', 'ReplayDeleteSelectedEvent');
    this.tabs[tab] = this.tabs[tab].filter((x) => x !== scene.id);
    this.scenes = this.scenes.filter((s) => s !== scene);
  }

  /** Plays a whole tab to output. False if the book knows the tab to be empty. */
  async playTab(tab: number, channel: string): Promise<boolean> {
    if (!this.count(tab)) return false;
    await this.show(tab);
    await this.call({ Function: 'ReplayPlayAllEventsToOutput', Channel: channel });
    return true;
  }
}
