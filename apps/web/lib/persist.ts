import Dexie from "dexie";
import type { ControlValues, Wire } from "@esp32-sim/sim-core";
import { devices } from "@esp32-sim/devices";
import type { Lang } from "./project";
import type { PlacedView } from "./store";

export const PROJECT_VERSION = 1;

export interface SavedProject {
  version: typeof PROJECT_VERSION;
  components: PlacedView[];
  wires: Wire[];
  values: ControlValues;
  lang: Lang;
  code: Record<Lang, string>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/**
 * Validate data read from storage (or a shared link, later). Unknown device types
 * and wires pointing at missing pins are dropped instead of crashing the editor.
 */
export function parseProject(raw: unknown): SavedProject | null {
  if (!isObj(raw) || raw.version !== PROJECT_VERSION) return null;
  if (!Array.isArray(raw.components) || !Array.isArray(raw.wires)) return null;

  const components: PlacedView[] = [];
  const pins = new Set<string>();
  const seen = new Set<string>();
  for (const c of raw.components) {
    if (!isObj(c) || typeof c.id !== "string" || typeof c.type !== "string") continue;
    const def = devices[c.type];
    if (!def || seen.has(c.id)) continue;
    seen.add(c.id);
    components.push({ id: c.id, type: c.type, x: num(c.x), y: num(c.y) });
    for (const p of def.pins) pins.add(`${c.id}:${p.name}`);
  }
  const wires: Wire[] = [];
  const wireIds = new Set<string>();
  for (const w of raw.wires) {
    if (!isObj(w) || typeof w.id !== "string" || typeof w.a !== "string" || typeof w.b !== "string") continue;
    if (!pins.has(w.a) || !pins.has(w.b) || wireIds.has(w.id)) continue;
    wireIds.add(w.id);
    wires.push({ id: w.id, a: w.a, b: w.b });
  }

  const values: ControlValues = {};
  if (isObj(raw.values)) {
    for (const [id, vals] of Object.entries(raw.values)) {
      if (!seen.has(id) || !isObj(vals)) continue;
      values[id] = Object.fromEntries(
        Object.entries(vals).filter((e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1])),
      );
    }
  }

  const code = isObj(raw.code) ? raw.code : {};
  return {
    version: PROJECT_VERSION,
    components,
    wires,
    values,
    lang: raw.lang === "ino" ? "ino" : "py",
    code: {
      py: typeof code.py === "string" ? code.py : "",
      ino: typeof code.ino === "string" ? code.ino : "",
    },
  };
}

export interface ProjectStorage {
  load(): Promise<unknown | null>;
  save(project: SavedProject): Promise<void>;
}

/** IndexedDB via Dexie; a single "current" project for now. */
export function dexieStorage(): ProjectStorage {
  const db = new Dexie("esp32-sim") as Dexie & { projects: Dexie.Table<{ id: string; data: SavedProject }, string> };
  db.version(1).stores({ projects: "id" });
  return {
    async load() {
      return (await db.projects.get("current"))?.data ?? null;
    },
    async save(project) {
      await db.projects.put({ id: "current", data: project });
    },
  };
}

/**
 * Debounced saver: `schedule()` can be called on every change; only the last
 * state within `delayMs` is written. `flush()` writes immediately.
 */
export function createAutosaver(
  storage: ProjectStorage,
  snapshot: () => SavedProject,
  delayMs = 500,
  onError: (e: unknown) => void = () => {},
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = () => {
    timer = null;
    storage.save(snapshot()).catch(onError);
  };
  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(write, delayMs);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        write();
      }
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
