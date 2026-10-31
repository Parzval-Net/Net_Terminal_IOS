import { ArrowDownToLine, ArrowRightToLine, ClipboardCopy, Columns2, Copy, CopyX, Eraser, History, LayoutGrid, ListX, MousePointerClick, PanelLeftDashed, PanelTop, Pencil, Plus, RefreshCcw, RotateCcw, Rows2, Save, Search, Square, SquareTerminal, Undo2, Unplug, X, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { SplitLayout, layoutLabel } from "../lib/split";
import type { TabLayout } from "../lib/settings";
import type { Tab, TabState } from "../types";
import type { CloseScope } from "../lib/closeAll";
import { historyLabel, modLabel } from "../lib/platform";

/** [etiqueta, icono, acción, deshabilitado/marcado, atajo, separador antes] — formato de ContextMenu. */
export type MenuItem = [string, ReactNode, () => void, boolean?, string?, boolean?];

export interface TabMenuHandlers {
  onRename: (id: string, title: string | undefined) => void;
  onDuplicate: (id: string) => void;
  onReconnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onClearScrollback: (id: string) => void;
  onResetTerminal: (id: string) => void;
  onCopyAll: (id: string) => void;
  onClose: (id: string) => void;
  /** Acciones de sesión que ya no están en la barra de estado: Break, buscar e historial de comandos. */
  onBreak?: (id: string) => void;
  onFind?: (id: string) => void;
  onHistory?: (id: string) => void;
  onSaveAs?: (id: string) => void;
  /** Cierra varias pestañas (con un solo aviso): todas, las demás o las que siguen a `id`. */
  onCloseMany?: (scope: CloseScope, id: string) => void;
  /** Pestañas abiertas, para saber si hay otras o alguna después de esta. */
  tabs?: Tab[];
  tabLayout?: TabLayout;
  onTabLayout?: (layout: TabLayout) => void;
}

/** Menú del botón "+": terminal local, conexión rápida sin guardar y nueva sesión guardada. */
export function newTabMenuItems(p: { onNew: () => void; onQuickConnect?: () => void; onNewSession?: () => void; onNewButton?: () => void }): MenuItem[] {
  const items: MenuItem[] = [["Terminal local", <SquareTerminal size={13} />, p.onNew, false, `${modLabel}T`]];
  if (p.onQuickConnect) items.push(["Conexión rápida…", <Zap size={13} />, p.onQuickConnect, false, `${modLabel}O`]);
  if (p.onNewSession) items.push(["Nueva sesión…", <Plus size={13} />, p.onNewSession, false, `${modLabel}N`]);
  // La barra de botones se oculta sola sin botones: crear uno desde aquí la muestra.
  if (p.onNewButton) items.push(["Nuevo botón de comando…", <MousePointerClick size={13} />, p.onNewButton]);
  return items;
}

/** Ítem para alternar pestañas horizontales/verticales (vacío si no hay manejador). */
export function layoutItem(p: Pick<TabMenuHandlers, "tabLayout" | "onTabLayout">): MenuItem[] {
  const { onTabLayout } = p;
  if (!onTabLayout) return [];
  return p.tabLayout === "vertical"
    ? [["Pestañas horizontales", <PanelTop size={13} />, () => onTabLayout("horizontal")]]
    : [["Pestañas verticales", <PanelLeftDashed size={13} />, () => onTabLayout("vertical")]];
}

/** Menú contextual de una pestaña; el mismo en la barra horizontal y en la vertical. */
export function tabMenuItems(t: Tab, state: TabState | undefined, p: TabMenuHandlers, startRename: () => void): MenuItem[] {
  return [
    ["Renombrar", <Pencil size={13} />, startRename],
    ["Restaurar nombre original", <Undo2 size={13} />, () => p.onRename(t.id, undefined), !t.title],
    ["Duplicar", <Copy size={13} />, () => p.onDuplicate(t.id), false, `${modLabel}D`],
    ["Reconectar", <RotateCcw size={13} />, () => p.onReconnect(t.id)],
    ["Desconectar", <Unplug size={13} />, () => p.onDisconnect(t.id), state?.status === "closed"],
    ...(p.onFind ? ([["Buscar en la terminal", <Search size={13} />, () => p.onFind!(t.id), false, `${modLabel}F`]] as MenuItem[]) : []),
    ...(p.onHistory && !t.session.scp
      ? ([["Historial de comandos enviados…", <History size={13} />, () => p.onHistory!(t.id), false, historyLabel]] as MenuItem[])
      : []),
    // Break solo existe en seriales y telnet (consolas): el resto no lo entiende.
    ...(p.onBreak && (t.session.type === "serial" || t.session.type === "telnet")
      ? ([["Enviar Break", <Zap size={13} />, () => p.onBreak!(t.id), state?.status !== "connected"]] as MenuItem[])
      : []),
    ["Copiar toda la salida", <ClipboardCopy size={13} />, () => p.onCopyAll(t.id)],
    ["Limpiar historial", <Eraser size={13} />, () => p.onClearScrollback(t.id)],
    ["Reiniciar terminal", <RefreshCcw size={13} />, () => p.onResetTerminal(t.id)],
    // Solo pestañas abiertas por conexión rápida (sesión sin id) que no sean locales ni SCP.
    ...(p.onSaveAs && !t.session.id && t.session.type !== "local" && !t.session.scp
      ? ([["Guardar como sesión…", <Save size={13} />, () => p.onSaveAs!(t.id)]] as MenuItem[])
      : []),
    ["Cerrar", <X size={13} />, () => p.onClose(t.id)],
    ...closeManyItems(t, p),
    ...layoutItem(p),
  ];
}

/** Cerrar varias: "a la derecha" en la barra horizontal y "abajo" en la columna vertical. */
function closeManyItems(t: Tab, p: TabMenuHandlers): MenuItem[] {
  const { onCloseMany, tabs = [] } = p;
  if (!onCloseMany) return [];
  const idx = tabs.findIndex((x) => x.id === t.id);
  const vertical = p.tabLayout === "vertical";
  return [
    ["Cerrar las demás", <CopyX size={13} />, () => onCloseMany("others", t.id), tabs.length <= 1],
    [
      vertical ? "Cerrar las de abajo" : "Cerrar las de la derecha",
      vertical ? <ArrowDownToLine size={13} /> : <ArrowRightToLine size={13} />,
      () => onCloseMany("after", t.id),
      idx < 0 || idx >= tabs.length - 1,
    ],
    ["Cerrar todas las pestañas", <ListX size={13} />, () => onCloseMany("all", t.id)],
  ];
}

/** Opciones de vista dividida (el booleano marca la opción actual como deshabilitada). */
export function splitMenuItems(split: SplitLayout | null, onSplit: (layout: SplitLayout | null) => void): MenuItem[] {
  const icons = { cols: <Columns2 size={13} />, rows: <Rows2 size={13} />, grid: <LayoutGrid size={13} /> };
  return [
    ["Vista única", <Square size={13} />, () => onSplit(null), split === null],
    ...(["cols", "rows", "grid"] as SplitLayout[]).map((l) => [layoutLabel[l], icons[l], () => onSplit(l), split === l] as MenuItem),
  ];
}
