/**
 * Envío a varias sesiones (difusión). Estado global mínimo con useSyncExternalStore:
 * el selector de destino vive en paneles memorizados y no debe forzar renders de App.
 * Solo la interfaz (Notas, catálogo, botones) puede iniciar una difusión; el servidor
 * MCP no tiene acceso a este camino.
 */
import { useSyncExternalStore } from "react";
import type { ConnStatus, Session, Tab } from "../types";
import { tabTitle } from "../types";
import { isWithin, normPath } from "./folders";
import { store } from "./store";

export type TargetMode = "current" | "tabs" | "folder" | "panes";

export interface BroadcastTarget {
  mode: TargetMode;
  /** Pestañas elegidas (modo "tabs"). */
  tabIds: string[];
  /** Carpeta de sesiones (modo "folder"). */
  folder: string;
}

/** Lo que el selector necesita saber del espacio de trabajo. */
export interface WorkspaceSnapshot {
  tabs: { id: string; title: string; session: Session; status: ConnStatus }[];
  /** Pestañas en paneles visibles; null si la vista dividida está apagada. */
  panes: string[] | null;
  activeId: string | null;
}

export type ItemStatus = "pending" | "sending" | "ok" | "error" | "skipped" | "stopped";

export interface RunItem {
  tabId: string;
  name: string;
  host?: string;
  status: ItemStatus;
  reason?: string;
}

export interface BroadcastRun {
  items: RunItem[];
  running: boolean;
  lines: number;
}

const DEFAULT_TARGET: BroadcastTarget = { mode: "current", tabIds: [], folder: "" };
const targetStore = store<BroadcastTarget>(DEFAULT_TARGET);
const workspaceStore = store<WorkspaceSnapshot>({ tabs: [], panes: null, activeId: null });
const runStore = store<BroadcastRun | null>(null);
let stopFlag = false;

export const useBroadcastTarget = () => useSyncExternalStore(targetStore.subscribe, targetStore.get);
export const getBroadcastTarget = targetStore.get;
export const setBroadcastTarget = (patch: Partial<BroadcastTarget>) => targetStore.set({ ...targetStore.get(), ...patch });

export const useWorkspace = () => useSyncExternalStore(workspaceStore.subscribe, workspaceStore.get);
export const publishWorkspace = (ws: WorkspaceSnapshot) => workspaceStore.set(ws);

export const useBroadcastRun = () => useSyncExternalStore(runStore.subscribe, runStore.get);
export const isBroadcastRunning = () => !!runStore.get()?.running;
export const getBroadcastRun = runStore.get;
export const stopBroadcast = () => {
  stopFlag = true;
};
export const clearBroadcast = () => {
  if (!runStore.get()?.running) runStore.set(null);
};

/** Carpetas de las sesiones abiertas (con sus ancestros), para el selector. */
export function openFolders(ws: WorkspaceSnapshot): string[] {
  const out = new Set<string>();
  for (const t of ws.tabs) {
    const parts = normPath(t.session.folder).split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join("/"));
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

export interface Resolved {
  targets: Tab[];
  skipped: { tab: Tab; reason: string }[];
}

/** Pestañas destino según el modo; las locales y las desconectadas se omiten con su motivo. */
export function resolveTargets(
  target: BroadcastTarget,
  tabs: Tab[],
  status: (id: string) => ConnStatus | undefined,
  activeId: string | null,
  panes: string[] | null,
): Resolved {
  let chosen: Tab[];
  switch (target.mode) {
    case "tabs":
      chosen = tabs.filter((t) => target.tabIds.includes(t.id));
      break;
    case "folder":
      chosen = target.folder ? tabs.filter((t) => isWithin(normPath(t.session.folder), target.folder)) : [];
      break;
    case "panes":
      chosen = tabs.filter((t) => (panes ?? (activeId ? [activeId] : [])).includes(t.id));
      break;
    default:
      chosen = tabs.filter((t) => t.id === activeId);
  }
  const out: Resolved = { targets: [], skipped: [] };
  for (const t of chosen) {
    if (t.session.type === "local") out.skipped.push({ tab: t, reason: "Terminal local" });
    else if (status(t.id) !== "connected") out.skipped.push({ tab: t, reason: "Desconectada" });
    else out.targets.push(t);
  }
  return out;
}

/** Texto corto del destino para los paneles ("3 pestañas", "Carpeta Core"). */
export function targetLabel(t: BroadcastTarget, ws: WorkspaceSnapshot): string {
  switch (t.mode) {
    case "tabs":
      return `${t.tabIds.filter((id) => ws.tabs.some((x) => x.id === id)).length} pestañas elegidas`;
    case "folder":
      return t.folder ? `Carpeta ${t.folder}` : "Carpeta (elige una)";
    case "panes":
      return ws.panes ? `${ws.panes.length} paneles visibles` : "Paneles visibles (vista única)";
    default:
      return "Pestaña actual";
  }
}

export interface Sender {
  isConnected: () => boolean;
  send: (text: string, lineDelayMs: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Envía `body` a cada destino en orden, con `deviceDelayMs` entre equipos. "Detener"
 * deja sin enviar los que faltan. Una pestaña que se desconecta en el camino se omite.
 */
export async function runBroadcast(
  targets: Tab[],
  skipped: Resolved["skipped"],
  body: string,
  opts: { lineDelayMs: number; deviceDelayMs: number },
  sender: (tabId: string) => Sender | undefined,
) {
  if (isBroadcastRunning()) return;
  stopFlag = false;
  const items: RunItem[] = [
    ...targets.map((t) => ({ tabId: t.id, name: tabTitle(t), host: t.session.host, status: "pending" as ItemStatus })),
    ...skipped.map((s) => ({ tabId: s.tab.id, name: tabTitle(s.tab), host: s.tab.session.host, status: "skipped" as ItemStatus, reason: s.reason })),
  ];
  const lines = body.replace(/\s+$/, "").split("\n").length;
  const publish = (running: boolean) => runStore.set({ items: items.map((x) => ({ ...x })), running, lines });
  publish(true);
  for (let i = 0; i < targets.length; i++) {
    if (stopFlag) {
      for (let j = i; j < targets.length; j++) items[j].status = "stopped";
      break;
    }
    const s = sender(targets[i].id);
    if (!s || !s.isConnected()) {
      items[i].status = "skipped";
      items[i].reason = "Se desconectó";
      publish(true);
      continue;
    }
    items[i].status = "sending";
    publish(true);
    try {
      await s.send(body, opts.lineDelayMs);
      items[i].status = "ok";
    } catch (e) {
      items[i].status = "error";
      items[i].reason = String(e);
    }
    publish(true);
    // Pausa entre equipos, cortada en tramos para que "Detener" responda rápido.
    if (i < targets.length - 1)
      for (let w = 0; w < opts.deviceDelayMs && !stopFlag; w += 100) await sleep(Math.min(100, opts.deviceDelayMs - w));
  }
  publish(false);
}
