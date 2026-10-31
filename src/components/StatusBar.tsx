import { memo, useEffect, useState } from "react";
import { ArrowLeftRight, KeyRound, Bot, Circle, CircleDot, History, RotateCcw, Search, ShieldAlert, ShieldCheck, Unplug } from "lucide-react";
import {
  DeviceInfo,
  LIFE_LABEL,
  LifeLevel,
  Lifecycle,
  OsEntry,
  behind,
  findLifecycle,
  findOs,
  lifeDetail,
  lifeLevel,
  loadLifecycle,
  loadOs,
  osDetail,
  osTarget,
} from "../lib/lifecycle";
import { Tab, TabState, sessionTarget, tunnelLabel } from "../types";
import { BroadcastTargetPicker } from "./BroadcastTarget";
import { QuickBolt, typeLabel } from "./SessionIcon";
import { statusColor } from "./TabBar";
import { historyLabel, isMobile, modLabel } from "../lib/platform";

/** Etiquetas de los botones accionables: con la barra angosta (ventana mínima o vista con barra
 *  lateral) solo queda el icono y el title. Comandos, Notas, CLI Lab y Ajustes viven en la barra
 *  de actividad; Buscar, Historial y Log quedan aquí; Break, en el menú de la pestaña y la paleta (⌘K). */
const LBL = "hidden @[52rem]:inline";

const statusText = { connecting: "Conectando", connected: "Conectado", closed: "Desconectado" };

interface Props {
  tab: Tab | undefined;
  state: TabState | undefined;
  onToggleLog: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
  aiEnabled: boolean;
  onAi: () => void;
  /** Guarda la conexión rápida de la pestaña como sesión. */
  onSaveAs?: () => void;
  /** Abre la búsqueda de texto en la salida de la pestaña activa. */
  onFind: () => void;
  /** Abre el historial de comandos enviados (alterna: un segundo clic lo cierra). */
  onHistory: () => void;
  historyOpen: boolean;
  /** Modelo y versión leídos de la pantalla (show version): ciclo de vida del equipo. */
  device?: DeviceInfo;
}

/**
 * Barra de estado: informa (estado, tipo, destino, túneles, ciclo de vida, contraseña) y solo
 * deja como acciones el Log y Desconectar/Reconectar, que son indicadores con estado.
 */
export const StatusBar = memo(function StatusBar({
  tab,
  state,
  onToggleLog,
  onReconnect,
  onDisconnect,
  aiEnabled,
  onAi,
  onSaveAs,
  onFind,
  onHistory,
  historyOpen,
  device,
}: Props) {
  const ai = aiEnabled && !isMobile && (
    <BarBtn onClick={onAi} title="Servidor MCP activo: los agentes de IA pueden conectarse" className="!text-accent">
      <Bot size={12} />
      <span className={LBL}>IA</span>
    </BarBtn>
  );
  if (!tab || !state)
    return (
      <div className="@container h-7 shrink-0 flex items-center justify-end px-3 bg-chrome border-t border-line text-[11.5px] text-muted">
        {ai}
      </div>
    );
  const { session } = tab;
  const logging = !!state.logPath;
  const connected = state.status === "connected";

  return (
    <div className="@container h-7 shrink-0 flex items-center gap-2 @[40rem]:gap-3 px-3 bg-chrome border-t border-line text-[11.5px] text-muted overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <span className="flex items-center gap-1.5 shrink-0 whitespace-nowrap" title={statusText[state.status]}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor[state.status] }} />
        {/* Barra muy angosta: queda el punto de color (el estado va en el tooltip). */}
        <span className="hidden @[34rem]:inline">{statusText[state.status]}</span>
      </span>
      <span className="font-medium text-fg/80 shrink-0 whitespace-nowrap">{typeLabel[session.type]}</span>
      <span className="truncate min-w-0 max-w-[130px] @[36rem]:max-w-none">{sessionTarget(session)}</span>
      {session.type === "ssh" && !!session.tunnels?.length && (
        <span
          className="flex items-center gap-1 shrink-0 text-fg/80"
          title={`Túneles${connected ? " activos" : ""}:\n${session.tunnels.map(tunnelLabel).join("\n")}`}
        >
          <ArrowLeftRight size={11} />
          {session.tunnels.length === 1 ? tunnelLabel(session.tunnels[0]) : `${session.tunnels.length} túneles`}
        </span>
      )}

      {onSaveAs && !session.id && session.type !== "local" && !session.scp && (
        <BarBtn onClick={onSaveAs} title="Conexión rápida sin guardar: guardar como sesión">
          <QuickBolt size={12} />
          <span className={LBL}>Guardar como sesión…</span>
        </BarBtn>
      )}

      {session.save_password && session.type !== "local" && (
        <span
          className="flex items-center shrink-0 text-fg/80"
          title="Contraseña guardada: se completa sola en el primer pedido de contraseña al conectar"
        >
          <KeyRound size={11} />
        </span>
      )}

      {device?.model && <LifecycleChip model={device.model} version={device.version} name={device.name} />}

      <div className="ml-auto shrink-0 flex items-center gap-0.5">
        {/* Destino único de Notas, catálogo, botones y scripts: siempre a la vista. */}
        <BroadcastTargetPicker />
        <span className="w-px h-3.5 mx-1 bg-line" />
        <BarBtn onClick={onFind} title={`Buscar en la sesión (${modLabel}F)`} aria-label="Buscar en la sesión">
          <Search size={12} />
          <span className={LBL}>Buscar</span>
        </BarBtn>
        {!session.scp && (
          <BarBtn
            onClick={onHistory}
            data-history-btn=""
            title={`Historial de comandos enviados (${historyLabel})`}
            aria-label="Historial de comandos enviados"
            aria-pressed={historyOpen}
            className={historyOpen ? "!text-accent" : ""}
          >
            <History size={12} />
            <span className={LBL}>Historial</span>
          </BarBtn>
        )}
        <BarBtn
          onClick={onToggleLog}
          disabled={!connected && !logging}
          title={logging ? `Grabando en ${state.logPath}` : "Grabar la sesión en un archivo de texto"}
          className={logging ? "!text-danger" : ""}
        >
          {logging ? <CircleDot size={12} /> : <Circle size={12} />}
          <span className={LBL}>{logging ? "Grabando" : "Log"}</span>
        </BarBtn>
        {connected || state.status === "connecting" ? (
          <BarBtn onClick={onDisconnect} title="Desconectar (la pestaña queda abierta)">
            <Unplug size={12} />
            <span className={LBL}>Desconectar</span>
          </BarBtn>
        ) : (
          <BarBtn onClick={onReconnect} title="Reconectar (o Enter en la terminal)" className="!text-accent">
            <RotateCcw size={12} />
            <span className={LBL}>Reconectar</span>
          </BarBtn>
        )}
        {ai && <span className="w-px h-3.5 mx-1 bg-line" />}
        {ai}
      </div>
    </div>
  );
});

function BarBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`shrink-0 whitespace-nowrap flex items-center justify-center gap-1 h-6 min-w-6 px-1.5 rounded hover:bg-hover active:bg-hover hover:text-fg select-none touch-manipulation disabled:opacity-40 disabled:hover:bg-transparent ${props.className ?? ""}`}
    />
  );
}

const LIFE_CLASS: Record<LifeLevel, string> = {
  ldos: "text-danger",
  eosw: "text-danger",
  eos: "text-warn",
  announced: "text-warn",
  none: "text-fg/80",
  unknown: "text-warn",
};

/**
 * Modelo y etapa del ciclo de vida (fin de venta, de software, de soporte). La base se descarga
 * recién aquí, la primera vez que una pestaña muestra un modelo.
 */
export function LifecycleChip({ model, version, name }: { model: string; version?: string; name?: string }) {
  const [life, setLife] = useState<{ model: string; l: Lifecycle | null; os: OsEntry | null } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([loadLifecycle(), loadOs()])
      .then(([db, os]) => live && setLife({ model, l: findLifecycle(db, model), os: findOs(os.db, os.res, model) }))
      .catch(() => live && setLife(null));
    return () => {
      live = false;
    };
  }, [model]);
  if (!life || life.model !== model) return null;
  const level = lifeLevel(life.l, new Date().toISOString().slice(0, 10));
  const late = behind(life.os, version);
  const bad = level !== "none" || late === true;
  const tip = [
    name && `Equipo: ${name}`,
    lifeDetail(model, life.l, version),
    ...osDetail(life.os, version),
    "Se actualiza con cada show version (o equivalente) que ejecutes.",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span
      className={`flex items-center gap-1 min-w-0 shrink ${level === "none" && late ? "text-warn" : LIFE_CLASS[level]}`}
      title={tip}
      aria-label={`${model}: ${LIFE_LABEL[level]}${late ? `, actualizable a ${osTarget(life.os!)}` : ""}`}
    >
      {bad ? <ShieldAlert size={11} className="shrink-0" /> : <ShieldCheck size={11} className="shrink-0" />}
      <span className="truncate">
        <span className="font-medium">{model}</span>
        {version && <span className="hidden @[60rem]:inline text-muted"> · {version}</span>} · {LIFE_LABEL[level]}
        {late && <span className="hidden @[52rem]:inline"> · actualizar a {osTarget(life.os!)}</span>}
      </span>
    </span>
  );
}
