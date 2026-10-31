import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Columns2, LayoutGrid, Maximize2, Minimize2, MoreVertical, Plus, Rows2, X } from "lucide-react";
import { newTabMenuItems } from "./tabMenu";
import { SplitLayout, layoutLabel } from "../lib/split";
import type { TabLayout } from "../lib/settings";
import { MenuItem, layoutItem, splitMenuItems, tabMenuItems } from "./tabMenu";
import { ConnStatus, Tab, TabState, tabTitle } from "../types";
import { ContextMenu } from "./Sidebar";
import { SessionIcon, isQuickSession } from "./SessionIcon";
import { focusLabel, modLabel } from "../lib/platform";
import type { CloseScope } from "../lib/closeAll";
import { useTabDrag } from "../lib/tabDrag";

export interface TabBarProps {
  tabs: Tab[];
  states: Record<string, TabState>;
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  /** Conexión rápida sin guardar y nueva sesión guardada (menú del "+"). */
  onQuickConnect?: () => void;
  onNewSession?: () => void;
  /** Crea un botón de la barra de botones (el menú del "+" y la paleta lo ofrecen aunque la barra esté oculta). */
  onNewButton?: () => void;
  /** Modo foco: solo pestañas y terminal. */
  focusMode?: boolean;
  onToggleFocus?: () => void;
  /** Break, buscar e historial de comandos de una pestaña (menú contextual). */
  onBreak?: (id: string) => void;
  onFind?: (id: string) => void;
  onHistory?: (id: string) => void;
  /** Guarda una pestaña abierta con conexión rápida como sesión. */
  onSaveAs?: (id: string) => void;
  /** Cerrar varias pestañas desde el menú contextual (con un solo aviso). */
  onCloseMany?: (scope: CloseScope, id: string) => void;
  onRename: (id: string, title: string | undefined) => void;
  onDuplicate: (id: string) => void;
  onReconnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onClearScrollback: (id: string) => void;
  onResetTerminal: (id: string) => void;
  onCopyAll: (id: string) => void;
  /** Pestañas con salida nueva sin ver. */
  activity: Set<string>;
  /** Vista dividida activa (null: una sola terminal). */
  split?: SplitLayout | null;
  onSplit?: (layout: SplitLayout | null) => void;
  /** Pestañas con una alerta por palabra clave sin ver. */
  alerted?: Set<string>;
  /** "vertical": las pestañas van en VerticalTabs y esta barra solo deja las acciones globales. */
  tabLayout?: TabLayout;
  onTabLayout?: (layout: TabLayout) => void;
  /** Arrastrar una pestaña: la deja antes o después de `to`. */
  onReorder?: (from: string, to: string, after: boolean) => void;
}

/** Línea que marca dónde caerá la pestaña arrastrada. */
export const dropMark = (side: "left" | "right" | "top" | "bottom") =>
  `after:content-[''] after:absolute after:bg-accent after:pointer-events-none ${
    side === "left" ? "after:left-0 after:top-1 after:bottom-1 after:w-0.5"
    : side === "right" ? "after:right-0 after:top-1 after:bottom-1 after:w-0.5"
    : side === "top" ? "after:top-0 after:left-1 after:right-1 after:h-0.5"
    : "after:bottom-0 after:left-1 after:right-1 after:h-0.5"
  }`;

export const statusColor: Record<ConnStatus, string> = {
  connecting: "var(--warn)",
  connected: "var(--ok)",
  closed: "var(--muted)",
};

/**
 * Color del punto de estado. En la pestaña activa el fondo es el del tema de terminal, que
 * puede ser claro con la interfaz oscura (o al revés): se mezcla con --term-fg para que el
 * punto mantenga >= 3:1 contra ese fondo (WCAG 1.4.11).
 */
export const dotColor = (status: ConnStatus, active: boolean) =>
  active ? `color-mix(in oklab, ${statusColor[status]} 60%, var(--term-fg))` : statusColor[status];

/**
 * Botón "cerrar" de una pestaña. La pestaña activa usa el fondo del tema de terminal, así que
 * el color va sobre --term-fg (no sobre --muted, que es de la interfaz: en modo oscuro con un
 * tema claro, o al revés, no contrasta). Siempre visible al enfocar con el teclado.
 */
export const closeBtnClass = (active: boolean) =>
  `${active ? "grid sm:hidden sm:group-hover:grid sm:focus-visible:grid" : "hidden group-hover:grid focus-visible:grid"} w-5 h-5 shrink-0 place-items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-accent ${
    active ? "text-term-fg/70 hover:text-term-fg hover:bg-term-fg/15" : "text-muted hover:text-fg hover:bg-hover"
  }`;

export const TabBar = memo(function TabBar(props: TabBarProps) {
  const {
  tabs,
  states,
  activeId,
  onSelect,
  onClose,
  onRename,
  activity,
  split = null,
  onSplit,
  alerted,
  tabLayout,
  } = props;
  const vertical = tabLayout === "vertical";
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const drag = useTabDrag("data-tab", "x", props.onReorder);
  // La pestaña activa siempre visible: con muchas pestañas o la ventana angosta quedaba fuera
  // de la franja (que se desplaza sin barra visible).
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-tab="${activeId}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length]);

  const commit = (id: string, value: string) => {
    setEditing(null);
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    const v = value.trim();
    onRename(id, v && v !== tab.session.name ? v : undefined);
  };

  // En vertical, las pestañas y sus controles (vista dividida, modo foco) viven en VerticalTabs.
  if (vertical) return null;

  const activeTab = tabs.find((t) => t.id === activeId);

  return (
    <div className="@container h-9 sm:h-[34px] shrink-0 flex items-center sm:items-end gap-1 px-1.5 bg-chrome border-b border-line">
      <div
        ref={stripRef}
        className="flex-1 min-w-0 self-stretch flex items-center sm:items-end gap-1 sm:gap-0.5 overflow-x-auto [scrollbar-width:none]"
        onContextMenu={(e) => {
          // Clic derecho en el espacio libre de la barra: alternar horizontal/vertical.
          if (e.target !== e.currentTarget || !props.onTabLayout) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, items: layoutItem(props) });
        }}
      >
        {!vertical && tabs.map((t) => {
          const active = t.id === activeId;
          const status = states[t.id]?.status ?? "connecting";
          return (
            <div
              key={t.id}
              data-tab={t.id}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(t.id);
                } else {
                  onSelect(t.id);
                  if (editing !== t.id) drag.begin(e, t.id);
                }
              }}
              onDoubleClick={() => setEditing(t.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                onSelect(t.id);
                setMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: tabMenuItems(t, states[t.id], props, () => setEditing(t.id)),
                });
              }}
              title={`${tabTitle(t)}${t.title ? ` (${t.session.name})` : ""}\nArrastra para mover · doble clic: renombrar · clic derecho: opciones · clic medio: cerrar`}
              className={`group relative flex items-center gap-1.5 h-7.5 sm:h-7 px-2.5 sm:pl-3 sm:pr-1.5 min-w-[70px] sm:min-w-[120px] max-w-[160px] sm:max-w-[220px] rounded-lg sm:rounded-b-none sm:rounded-t-lg text-[12px] sm:text-[12.5px] transition-all select-none ${
                drag.dragId === t.id ? "opacity-50" : ""
              } ${drag.target?.id === t.id ? dropMark(drag.target.after ? "right" : "left") : ""} ${
                active
                  ? "bg-panel sm:bg-term text-fg sm:text-term-fg border border-line sm:border-b-transparent sm:-mb-px shadow-xs sm:shadow-none font-medium"
                  : "text-muted hover:text-fg hover:bg-hover"
              }`}
            >
              <SessionIcon type={t.session.type} size={13} quick={isQuickSession(t.session)} />
              {editing === t.id ? (
                <input
                  autoFocus
                  className="field !h-6 !px-1.5 flex-1 min-w-0 !text-[12px]"
                  defaultValue={tabTitle(t)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => commit(t.id, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <span className={`truncate flex-1 ${t.title ? "italic" : ""}`}>{tabTitle(t)}</span>
              )}
              {alerted?.has(t.id) && !active ? (
                <span className="text-[11px] font-semibold text-danger shrink-0" title="Alerta por palabra clave">
                  ▲
                </span>
              ) : activity.has(t.id) && !active && (
                <span className="text-[11px] font-semibold text-accent shrink-0" title="Salida nueva">
                  ●
                </span>
              )}
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? "hidden sm:inline-block sm:group-hover:hidden" : "group-hover:hidden"}`}
                style={{ background: dotColor(status, active) }}
              />
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onClose(t.id)}
                title={`Cerrar (${modLabel}W)`}
                aria-label={`Cerrar ${tabTitle(t)}`}
                className={closeBtnClass(active)}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
        {!vertical && (
          <button
            // El menú se cierra con un clic fuera (mousedown): sin esto, un segundo clic en el "+" lo cierra y lo reabre.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu((m) => (m ? null : { x: r.left, y: r.bottom + 4, items: newTabMenuItems(props) }));
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, items: newTabMenuItems(props) });
            }}
            title={`Nueva pestaña: terminal local (${modLabel}T), conexión rápida (${modLabel}O) o nueva sesión`}
            aria-label="Nueva pestaña"
            aria-haspopup="menu"
            className="w-7 h-7 sm:h-6 sm:mb-[5px] ml-0.5 shrink-0 grid place-items-center rounded-lg sm:rounded-md text-muted hover:text-fg hover:bg-hover active:bg-hover select-none touch-manipulation"
          >
            <Plus size={16} />
          </button>
        )}
      </div>
      {activeTab && (
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu((m) =>
              m
                ? null
                : {
                    x: Math.max(8, r.right - 220),
                    y: r.bottom + 4,
                    items: tabMenuItems(activeTab, states[activeTab.id], props, () => setEditing(activeTab.id)),
                  },
            );
          }}
          title="Opciones de la pestaña activa (renombrar, duplicar, reconectar, buscar, historial, copiar todo…)"
          aria-label="Opciones de la pestaña activa"
          aria-haspopup="menu"
          className="w-7 h-7 sm:h-6 sm:mb-[5px] shrink-0 grid place-items-center rounded-lg sm:rounded-md text-muted hover:text-fg hover:bg-hover active:bg-hover select-none touch-manipulation"
        >
          <MoreVertical size={15} />
        </button>
      )}
      {onSplit && (
        <button
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: Math.max(8, r.right - 200), y: r.bottom + 4, items: splitMenuItems(split, onSplit) });
          }}
          title={split ? `Vista dividida: ${layoutLabel[split]}` : "Vista dividida: ver 2 o 4 pestañas a la vez"}
          aria-pressed={!!split}
          className={`hidden sm:grid mb-[5px] w-7 h-6.5 sm:h-6 shrink-0 place-items-center rounded-md hover:bg-hover active:bg-hover select-none touch-manipulation ${split ? "text-accent" : "text-muted hover:text-fg"}`}
        >
          {split === "rows" ? <Rows2 size={15} /> : split === "grid" ? <LayoutGrid size={15} /> : <Columns2 size={15} />}
        </button>
      )}
      {props.onToggleFocus && (
        <button
          onClick={props.onToggleFocus}
          title={props.focusMode ? `Salir del modo foco (${focusLabel})` : `Modo foco: solo pestañas y terminal (${focusLabel})`}
          aria-label={props.focusMode ? "Salir del modo foco" : "Modo foco"}
          aria-pressed={!!props.focusMode}
          className={`hidden sm:flex mb-[5px] h-6.5 sm:h-6 shrink-0 items-center gap-1.5 rounded-md hover:bg-hover active:bg-hover select-none touch-manipulation ${
            props.focusMode ? "px-2 text-[12px] text-accent" : "w-7 justify-center text-muted hover:text-fg"
          }`}
        >
          {props.focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          {props.focusMode && <span className="hidden sm:inline">Salir del modo foco</span>}
        </button>
      )}
    </div>
  );
});

