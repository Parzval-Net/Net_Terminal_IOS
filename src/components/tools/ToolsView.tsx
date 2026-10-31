import { Suspense, lazy, memo, useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Activity, ArrowDownUp, Calculator, DatabaseBackup, Gauge, Network, Puzzle, Radar, ScrollText, SquareTerminal, Waypoints, Wrench, X } from "lucide-react";
import { TopologyTool } from "./TopologyTool";
import type { Session } from "../../types";
import { ModuleId, Settings, SpeedResult } from "../../lib/settings";
import { MonitorStatus, MonitorTarget, Sample } from "../../lib/monitors";
import { MonitorTool } from "./MonitorTool";
import { DiagTool } from "./DiagTool";
import { SubnetTool } from "./SubnetTool";
import { PerfTool } from "./PerfTool";
import { TransferTool } from "./TransferTool";
import { SyslogTool } from "./SyslogTool";
import type { ScpRequest, TabBrief, TerminalRef } from "./FileManager";
import { persist, stored } from "../../lib/prefs";
import { isMobile, modLabel } from "../../lib/platform";

// Respaldos y diff: se cargan al abrir el módulo.
const BackupTool = lazy(() => import("./BackupTool"));
// SNMP: cliente, conjuntos de OIDs y receptor de traps, también bajo demanda.
const SnmpTool = lazy(() => import("./SnmpTool"));
// Plugins en Python (exclusivo de escritorio): se carga bajo demanda para no incluirlo en móvil.
const PluginsTool = lazy(() => import("./PluginsTool").then((m) => ({ default: m.PluginsTool })));

const NAV: { id: ModuleId; label: string; Icon: typeof Activity }[] = [
  { id: "monitor", label: "Monitoreo", Icon: Activity },
  { id: "diag", label: "Diagnóstico", Icon: Radar },
  { id: "syslog", label: "Syslog", Icon: ScrollText },
  { id: "snmp", label: "SNMP", Icon: Waypoints },
  { id: "topology", label: "Topología", Icon: Network },
  { id: "subnet", label: "Subredes", Icon: Calculator },
  { id: "perf", label: "Velocidad", Icon: Gauge },
  { id: "transfer", label: "Transferencias", Icon: ArrowDownUp },
  { id: "backup", label: "Respaldos", Icon: DatabaseBackup },
  { id: "plugins", label: "Plugins", Icon: Puzzle },
];

/** Encabezados del menú: qué se mira (Monitorear), el mapa y los cálculos (Red) y lo que se ejecuta (Operar). */
const GROUPS: { label: string; ids: ModuleId[] }[] = [
  { label: "Monitorear", ids: ["monitor", "diag", "syslog", "snmp"] },
  { label: "Red", ids: ["topology", "subnet", "perf"] },
  { label: "Operar", ids: ["transfer", "backup", "plugins"] },
];

/** Último módulo usado, para volver donde se estaba al reabrir Herramientas. */
const LAST_KEY = "toolsModule";

interface Props {
  active: boolean;
  /** Vuelve a la última terminal sin cerrar Herramientas (los módulos siguen vivos). */
  onBack: () => void;
  /** Cierra Herramientas de verdad (App avisa si hay servidores activos). */
  onClose: () => void;
  settings: Settings;
  update: (p: Partial<Settings> | ((s: Settings) => Partial<Settings>)) => void;
  monitors: {
    samples: Record<string, Sample[]>;
    status: Record<string, MonitorStatus>;
    clear: (id: string) => void;
    silence: (id: string) => void;
  };
  connId: () => string | null;
  terminals: TerminalRef[];
  sessions: Session[];
  onScp: (req: ScpRequest) => void;
  /** `background`: abre la pestaña sin activarla. Devuelve el id de la pestaña. */
  onOpenSession: (s: Session, opts?: { background?: boolean; title?: string }) => string | void;
  /** Todas las pestañas con su estado, para la ruta de Topología. */
  tabs: TabBrief[];
  /** Activa una pestaña (sale de Herramientas). */
  onFocusTab: (tabId: string) => void;
  onReconnectTab: (tabId: string) => void;
  onConfirm: (req: { title: string; message: string; label: string; danger?: boolean; action: () => void }) => void;
}

/**
 * Pestaña de herramientas. Cada módulo se monta al visitarlo y luego se mantiene
 * vivo oculto, para no perder servidores, logs ni mediciones al cambiar de sección.
 */
export const ToolsView = memo(function ToolsView({ active, onBack, onClose, settings, update, monitors, connId, terminals, tabs, sessions, onConfirm, onScp, onOpenSession, onFocusTab, onReconnectTab }: Props) {
  const enabled = NAV.filter((n) => (!isMobile || n.id !== "plugins") && settings.modules[n.id] !== false);
  const [current, setCurrent] = useState<ModuleId>(() => {
    const last = stored<ModuleId | null>(LAST_KEY, null);
    return enabled.find((n) => n.id === last)?.id ?? enabled[0]?.id ?? "monitor";
  });
  const [visited, setVisited] = useState<Set<ModuleId>>(new Set([current]));
  const [running, setRunning] = useState<string[]>([]);

  const refreshRunning = useCallback(() => {
    invoke<string[]>("server_running").then(setRunning);
  }, []);
  useEffect(refreshRunning, [refreshRunning]);

  const go = (id: ModuleId) => {
    persist(LAST_KEY, id);
    setCurrent(id);
    setVisited((v) => new Set(v).add(id));
  };

  useEffect(() => {
    if (!enabled.some((n) => n.id === current) && enabled[0]) go(enabled[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.modules]);

  const pane = (id: ModuleId) => {
    switch (id) {
      case "monitor":
        return (
          <MonitorTool
            targets={settings.monitors}
            samples={monitors.samples}
            status={monitors.status}
            onChange={(m: MonitorTarget[]) => update({ monitors: m })}
            onClear={monitors.clear}
            onSilence={monitors.silence}
          />
        );
      case "diag":
        return <DiagTool samples={monitors.samples} />;
      case "topology":
        return (
          <TopologyTool
            terminals={terminals}
            sessions={sessions}
            topo={settings.topology}
            snapshots={settings.topoSnapshots}
            onTopo={(t) => update((s) => ({ topology: typeof t === "function" ? t(s.topology) : t }))}
            onSnapshots={(topoSnapshots) => update({ topoSnapshots })}
            sources={settings.topoSources ?? {}}
            onSources={(topoSources) => update({ topoSources })}
            snmpProfiles={settings.snmpProfiles ?? []}
            visible={active && current === "topology"}
            onOpenSession={onOpenSession}
            tabs={tabs}
            onFocusTab={onFocusTab}
            onReconnectTab={onReconnectTab}
            onConfirm={onConfirm}
            lifecycle={settings.lifecycleInfo}
          />
        );
      case "subnet":
        return <SubnetTool />;
      case "perf":
        return (
          <PerfTool
            history={settings.speedHistory}
            onResult={(r: SpeedResult) => update((s) => ({ speedHistory: [r, ...s.speedHistory].slice(0, 20) }))}
            onHistory={(speedHistory: SpeedResult[]) => update({ speedHistory })}
          />
        );
      case "transfer":
        return (
          <TransferTool
            settings={settings}
            running={running}
            onChange={update}
            refreshRunning={refreshRunning}
            terminals={terminals}
            onConfirm={onConfirm}
            onScp={onScp}
          />
        );
      case "syslog":
        return <SyslogTool settings={settings} running={running} onChange={update} refreshRunning={refreshRunning} />;
      case "plugins":
        return (
          <Suspense fallback={null}>
            <PluginsTool connId={connId} onConfirm={onConfirm} />
          </Suspense>
        );
      case "snmp":
        return (
          <Suspense fallback={null}>
            <SnmpTool settings={settings} running={running} onChange={update} refreshRunning={refreshRunning} onConfirm={onConfirm} />
          </Suspense>
        );
      case "backup":
        return (
          <Suspense fallback={null}>
            <BackupTool terminals={terminals} />
          </Suspense>
        );
    }
  };

  const item = (id: ModuleId) => {
    const n = enabled.find((x) => x.id === id);
    if (!n) return null;
    const { label, Icon } = n;
    return (
      <button
        key={id}
        onClick={() => go(id)}
        title={label}
        aria-current={current === id ? "page" : undefined}
        className={`relative w-full flex items-center gap-2 px-2 h-8 rounded-md text-left ${
          current === id ? "bg-selected text-fg" : "text-muted hover:text-fg hover:bg-hover"
        }`}
      >
        <Icon size={15} className="shrink-0" />
        <span className="hidden @[44rem]:inline truncate">{label}</span>
        {(id === "transfer" && (running.includes("tftp") || running.includes("http") || running.includes("ftp"))) ||
        (id === "snmp" && running.includes("snmptrap")) ||
        (id === "syslog" && running.includes("syslog")) ? (
          <span className="absolute right-1 top-1 @[44rem]:static @[44rem]:ml-auto w-1.5 h-1.5 rounded-full bg-ok" title="Servidor activo" />
        ) : null}
      </button>
    );
  };

  return (
    <div className="@container absolute inset-0 flex flex-col bg-bg" style={{ visibility: active ? "visible" : "hidden" }}>
      {/* Encabezado: dónde estás y cómo salir. "Volver" deja Herramientas viva; la X la cierra. */}
      <div className="h-9 shrink-0 flex items-center gap-1 pl-3 pr-1.5 border-b border-line bg-chrome">
        <Wrench size={14} className="text-muted shrink-0" />
        <h2 className="flex-1 min-w-0 truncate text-[12.5px] font-medium">Herramientas</h2>
        <button
          onClick={onBack}
          title={`Volver a la terminal (${modLabel}E): Herramientas sigue abierta y sus servidores y mediciones siguen activos`}
          aria-label="Volver a la terminal"
          className="h-7 px-2 flex items-center gap-1.5 rounded-md text-[12px] text-muted hover:text-fg hover:bg-hover"
        >
          <SquareTerminal size={14} />
          <span className="hidden @[36rem]:inline">Volver a la terminal</span>
        </button>
        <button
          onClick={onClose}
          title="Cerrar Herramientas (avisa si hay servidores activos)"
          aria-label="Cerrar Herramientas"
          className="w-7 h-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover"
        >
          <X size={14} />
        </button>
      </div>
      {/* Barra horizontal de chips Material 3 en pantallas compactas (< 44rem): muestra ícono + nombre sin doble barra lateral */}
      <nav
        aria-label="Módulos de Herramientas (compacto)"
        className="flex @[44rem]:hidden items-center gap-1.5 px-2.5 py-2 border-b border-line bg-chrome overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden shrink-0"
      >
        {enabled.map(({ id, label, Icon }) => {
          const isRunning =
            (id === "transfer" && (running.includes("tftp") || running.includes("http") || running.includes("ftp"))) ||
            (id === "snmp" && running.includes("snmptrap")) ||
            (id === "syslog" && running.includes("syslog"));
          const isActive = current === id;
          return (
            <button
              key={id}
              onClick={() => go(id)}
              aria-current={isActive ? "page" : undefined}
              className={`shrink-0 flex items-center gap-1.5 px-3 h-8 rounded-full text-[12px] font-medium border transition-colors ${
                isActive
                  ? "bg-selected text-fg border-accent/40"
                  : "bg-panel text-muted border-line hover:text-fg hover:bg-hover"
              }`}
            >
              <Icon size={14} className={isActive ? "text-accent shrink-0" : "shrink-0"} />
              <span>{label}</span>
              {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-ok shrink-0" title="Servidor activo" />}
            </button>
          );
        })}
      </nav>
      <div className="flex-1 min-h-0 flex">
      {/* En tablets/escritorio (>= 44rem): barra lateral vertical agrupada */}
      <nav
        aria-label="Módulos de Herramientas"
        className="hidden @[44rem]:block w-44 shrink-0 border-r border-line bg-chrome p-2 overflow-y-auto overflow-x-hidden [scrollbar-width:thin]"
      >
        {GROUPS.map((g, i) => {
          const ids = g.ids.filter((id) => enabled.some((n) => n.id === id));
          if (!ids.length) return null;
          return (
            <div key={g.label} role="group" aria-label={g.label} className={i > 0 ? "mt-1.5 pt-1.5 border-t border-line @[44rem]:border-t-0 @[44rem]:pt-0" : ""}>
              <div className="hidden @[44rem]:block px-2 pt-1 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted">{g.label}</div>
              <div className="space-y-0.5">{ids.map(item)}</div>
            </div>
          );
        })}
        {enabled.length === 0 && <p className="p-2 text-[12px] text-muted">Activa módulos en Ajustes › Módulos.</p>}
      </nav>
      <div className="@container flex-1 min-w-0 overflow-y-auto">
        {/* Topología ocupa todo el ancho y alto disponibles; el resto mantiene el ancho de lectura. */}
        <div className={current === "topology" ? "h-full p-2 sm:p-4" : "max-w-[1200px] mx-auto p-2 sm:p-5"}>
          {enabled
            .filter((n) => visited.has(n.id))
            .map((n) => (
              <div key={n.id} hidden={n.id !== current} className={n.id === "topology" ? "h-full" : undefined}>
                {pane(n.id)}
              </div>
            ))}
        </div>
      </div>
      </div>
    </div>
  );
});
