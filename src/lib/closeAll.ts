import { isQuickSession } from "../components/SessionIcon";
import { Tab, TabState, tabTitle } from "../types";

/** Qué pestañas cierra cada opción del menú: todas, las demás o las que siguen a una. */
export type CloseScope = "all" | "others" | "after";

/** Pestañas que cierra `scope` tomando como referencia `refId` (no se usa con "all"). */
export function tabsToClose(tabs: Tab[], scope: CloseScope, refId?: string): Tab[] {
  if (scope === "all") return tabs;
  const idx = tabs.findIndex((t) => t.id === refId);
  if (idx < 0) return [];
  return scope === "others" ? tabs.filter((t) => t.id !== refId) : tabs.slice(idx + 1);
}

/** Lo que se pierde al cerrar varias pestañas, para el aviso de confirmación. */
export interface CloseSummary {
  total: number;
  /** Sesiones remotas (SSH, Telnet, Serial, TCP) conectadas o conectando: se cortan. */
  connected: Tab[];
  /** Terminales locales (sin contar las de SCP/SFTP). */
  local: number;
  /** Pestañas remotas ya desconectadas. */
  disconnected: number;
  /** Pestañas SCP/SFTP con el proceso en marcha: la transferencia se cancela. */
  transfers: number;
  /** Conexiones rápidas sin guardar: su configuración se pierde. */
  quick: number;
  /** Pestañas con log activo (lo grabado ya está en disco). */
  logging: number;
}

export function summarizeClose(tabs: Tab[], states: Record<string, TabState>): CloseSummary {
  const s: CloseSummary = { total: tabs.length, connected: [], local: 0, disconnected: 0, transfers: 0, quick: 0, logging: 0 };
  for (const t of tabs) {
    const st = states[t.id];
    const live = st?.status === "connected" || st?.status === "connecting";
    if (t.session.scp) {
      if (live) s.transfers++;
      else s.disconnected++;
    } else if (t.session.type === "local") s.local++;
    else if (live) s.connected.push(t);
    else s.disconnected++;
    if (isQuickSession(t.session)) s.quick++;
    if (st?.logPath) s.logging++;
  }
  return s;
}

/** Nombres de hasta `max` sesiones y "y N más" si hay otras. */
export function namesPreview(tabs: Tab[], max = 5): string {
  const names = tabs.slice(0, max).map(tabTitle);
  const rest = tabs.length - names.length;
  if (rest > 0) return `${names.join(", ")} y ${rest} más`;
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

export { plural } from "./plural";
