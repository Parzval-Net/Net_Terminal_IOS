import { memo, useCallback, useState, type ReactNode } from "react";
import { BookOpen, NotebookPen, PanelLeft, Settings, SquareTerminal, Terminal, Wrench, X } from "lucide-react";
import { useLabRun } from "../lib/cliLab";
import { isMac, modLabel } from "../lib/platform";
import { ContextMenu } from "./Sidebar";
import type { MenuItem } from "./tabMenu";

interface Props {
  /** Barra de sesiones visible (acoplada o flotante). */
  sidebarOpen: boolean;
  /** Barra de sesiones flotante activa (ajuste) y cerrada: el mouse sobre Sesiones la abre. */
  floatingSessions: boolean;
  /** La vista de Herramientas es la que se ve ahora. */
  toolsActive: boolean;
  /** Herramientas montada (sus monitoreos y servidores siguen vivos aunque se vea una terminal). */
  toolsOpen: boolean;
  /** Sondas caídas. */
  alerts: number;
  labOpen: boolean;
  commandsOpen: boolean;
  notesOpen: boolean;
  settingsOpen: boolean;
  cliLabEnabled?: boolean;
  onTerminal?: () => void;
  onSessions: () => void;
  onSessionsEnter: () => void;
  onSessionsLeave: () => void;
  onTools: () => void;
  /** Cierra Herramientas de verdad (con aviso si hay algo corriendo). */
  onCloseTools: () => void;
  onLab: () => void;
  onCommands: () => void;
  onNotes: () => void;
  onSettings: () => void;
}

const COMMA = isMac ? "⌘," : "Ctrl+,";

/**
 * Barra de actividad (Material 3 Navigation Rail en tablets >= 640px y escritorio):
 * accesos a los paneles y vistas de la app, visible a la izquierda. En teléfonos (< 640px)
 * se oculta y da paso a `MobileBottomNav` siguiendo las guías de Material Design 3.
 */
export const ActivityBar = memo(function ActivityBar(p: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const lab = useLabRun();
  const labDone = lab ? lab.items.filter((i) => i.status !== "pending" && i.status !== "running").length : 0;
  const labFailed = lab ? lab.items.filter((i) => i.status === "error").length : 0;
  const labTip = lab?.running
    ? `CLI Lab ejecutando: ${labDone}/${lab.items.length} equipos terminados`
    : lab
      ? `CLI Lab: ${lab.items.length - labFailed} de ${lab.items.length} equipos OK${labFailed ? `, ${labFailed} con error` : ""}`
      : "";

  return (
    <nav
      aria-label="Barra de actividad"
      className="hidden sm:flex w-11 shrink-0 flex-col items-center gap-1 py-1.5 bg-chrome border-r border-line"
    >
      <ActivityBtn
        label="Sesiones"
        title={`Mostrar/ocultar sesiones (${modLabel}B)${p.floatingSessions ? "\nPasa el mouse para verlas sobre la terminal" : ""}`}
        sessions={{ enter: p.onSessionsEnter, leave: p.onSessionsLeave, floating: p.floatingSessions }}
        active={p.sidebarOpen}
        onClick={p.onSessions}
        icon={<PanelLeft size={18} />}
      />
      <ActivityBtn
        label="Herramientas"
        title={`Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins (${modLabel}E)${p.alerts > 0 ? `\n${p.alerts} sondas caídas` : ""}\nClic derecho: cerrar`}
        alert={p.alerts > 0 ? `${p.alerts} sondas caídas` : undefined}
        active={p.toolsActive}
        onClick={p.onTools}
        onContextMenu={
          p.toolsOpen
            ? (e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, items: [["Cerrar Herramientas", <X size={13} />, p.onCloseTools]] });
              }
            : undefined
        }
        icon={<Wrench size={18} />}
        badge={
          p.alerts > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 grid place-items-center rounded-full bg-danger text-danger-fg text-[10px] font-semibold leading-none">
              {p.alerts > 9 ? "9+" : p.alerts}
            </span>
          )
        }
      />
      {p.cliLabEnabled !== false && (
        <ActivityBtn
          label="CLI Lab"
          title={labTip || `CLI Lab (${modLabel}I): script de varias líneas en el destino elegido, leyendo cada respuesta`}
          alert={labTip || undefined}
          active={p.labOpen}
          onClick={p.onLab}
          icon={<SquareTerminal size={18} className={lab?.running ? "animate-pulse" : ""} />}
          badge={
            lab && (
              <span
                className={`absolute top-0.5 right-0.5 w-2 h-2 rounded-full ring-2 ring-[var(--chrome)] ${
                  lab.running ? "bg-warn" : labFailed ? "bg-danger" : "bg-ok"
                }`}
              />
            )
          }
        />
      )}
      <ActivityBtn
        label="Comandos"
        title={`Catálogo de comandos (${modLabel}L)`}
        active={p.commandsOpen}
        onClick={p.onCommands}
        icon={<BookOpen size={18} />}
      />
      <ActivityBtn label="Notas" title={`Notas (${modLabel}J)`} active={p.notesOpen} onClick={p.onNotes} icon={<NotebookPen size={18} />} />
      <div className="flex-1" />
      <ActivityBtn
        label="Ajustes"
        title={`Ajustes (${COMMA})`}
        active={p.settingsOpen}
        onClick={p.onSettings}
        icon={<Settings size={18} />}
      />
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </nav>
  );
});

function ActivityBtn({
  label,
  title,
  alert,
  active,
  onClick,
  onContextMenu,
  icon,
  badge,
  sessions,
}: {
  /** Solo el botón Sesiones: abre la barra flotante al pasar el mouse. */
  sessions?: { enter: () => void; leave: () => void; floating: boolean };
  /** Nombre accesible. */
  label: string;
  /** Tooltip nativo (como el resto de la app): nombre, atajo y, si hay, el estado. */
  title: string;
  /** Estado que el nombre accesible debe decir (sondas caídas, avance de CLI Lab). */
  alert?: string;
  active: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  icon: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={sessions?.floating ? sessions.enter : undefined}
      onMouseLeave={sessions?.floating ? sessions.leave : undefined}
      data-sessions-btn={sessions ? "" : undefined}
      title={title}
      aria-label={alert ? `${label}, ${alert}` : label}
      aria-pressed={active}
      className={`relative w-9 h-9 shrink-0 grid place-items-center rounded-md ${
        active ? "bg-selected text-fg" : "text-muted hover:text-fg hover:bg-hover"
      }`}
    >
      {/* Marca lateral del botón activo: se ve aunque no se distingan los colores. */}
      {active && <span aria-hidden className="absolute -left-1 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent" />}
      {icon}
      {badge}
    </button>
  );
}

/**
 * Barra de navegación inferior Material Design 3 para teléfonos Android (< 640px).
 * Libera el 100% del ancho de la pantalla para la terminal y herramientas, mostrando
 * indicadores activos tipo píldora (M3 Navigation Bar) y etiquetas claras debajo de cada ícono.
 */
export const MobileBottomNav = memo(function MobileBottomNav(p: Props) {
  const lab = useLabRun();
  const labFailed = lab ? lab.items.filter((i) => i.status === "error").length : 0;
  const terminalActive =
    !p.toolsActive && !p.sidebarOpen && !p.commandsOpen && !p.notesOpen && (!p.cliLabEnabled || !p.labOpen) && !p.settingsOpen;

  return (
    <nav
      aria-label="Navegación principal móvil"
      className="flex sm:hidden h-14 min-[400px]:h-15 shrink-0 items-center justify-around px-0.5 min-[400px]:px-1.5 bg-chrome border-t border-line select-none z-40"
    >
      <MobileNavBtn
        label="Terminal"
        active={terminalActive}
        onClick={() => p.onTerminal?.()}
        icon={<Terminal size={17} />}
      />
      <MobileNavBtn
        label="Sesiones"
        active={p.sidebarOpen}
        onClick={p.onSessions}
        icon={<PanelLeft size={17} />}
      />
      <MobileNavBtn
        label="Red"
        active={p.toolsActive && !p.sidebarOpen && !p.commandsOpen && !p.notesOpen}
        onClick={p.onTools}
        icon={<Wrench size={17} />}
        badge={
          p.alerts > 0 ? (
            <span className="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-1 grid place-items-center rounded-full bg-danger text-danger-fg text-[9px] font-bold leading-none">
              {p.alerts > 9 ? "9+" : p.alerts}
            </span>
          ) : p.toolsOpen ? (
            <span className="absolute -top-0.5 right-0.5 w-2 h-2 rounded-full bg-ok ring-2 ring-[var(--chrome)]" />
          ) : null
        }
      />
      <MobileNavBtn
        label="Comandos"
        active={p.commandsOpen}
        onClick={p.onCommands}
        icon={<BookOpen size={17} />}
      />
      <MobileNavBtn
        label="Notas"
        active={p.notesOpen}
        onClick={p.onNotes}
        icon={<NotebookPen size={17} />}
      />
      {p.cliLabEnabled && (
        <MobileNavBtn
          label="CLI Lab"
          active={p.labOpen}
          onClick={p.onLab}
          icon={<SquareTerminal size={17} className={lab?.running ? "animate-pulse" : ""} />}
          badge={
            lab ? (
              <span
                className={`absolute -top-0.5 right-0.5 w-2 h-2 rounded-full ring-2 ring-[var(--chrome)] ${
                  lab.running ? "bg-warn" : labFailed ? "bg-danger" : "bg-ok"
                }`}
              />
            ) : null
          }
        />
      )}
      <MobileNavBtn
        label="Ajustes"
        active={p.settingsOpen}
        onClick={p.onSettings}
        icon={<Settings size={17} />}
      />
    </nav>
  );
});

function MobileNavBtn({
  label,
  active,
  onClick,
  icon,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className="flex-1 min-w-0 h-12 min-[400px]:h-13 flex flex-col items-center justify-center gap-0.5 rounded-lg active:opacity-80 touch-manipulation"
    >
      <span
        className={`relative w-7 min-[340px]:w-8 min-[380px]:w-10 min-[420px]:w-11 h-5.5 min-[340px]:h-6 min-[420px]:h-6.5 rounded-full grid place-items-center transition-colors ${
          active ? "bg-selected text-accent" : "text-muted"
        }`}
      >
        {icon}
        {badge}
      </span>
      <span
        className={`text-[8.5px] min-[340px]:text-[9.5px] min-[400px]:text-[10.5px] leading-tight truncate max-w-full px-0.5 ${
          active ? "font-semibold text-fg" : "text-muted"
        }`}
      >
        {label}
      </span>
    </button>
  );
}
