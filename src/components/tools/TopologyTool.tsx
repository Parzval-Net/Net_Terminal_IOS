import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Activity,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileCode2,
  GitCompare,
  Lightbulb,
  Maximize2,
  Network,
  PanelRight,
  PanelRightClose,
  Pencil,
  Plus,
  SquareTerminal,
  ListFilter,
  Radar,
  Route,
  Search,
  Trash2,
  TriangleAlert,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { runOnDevice } from "../../lib/deviceRun";
import {
  ADDRESS_COMMANDS,
  CommandOutput,
  FALLBACK_COMMANDS,
  LIMITS,
  LINK_LEGEND,
  LinkSuggestion,
  LinkTraffic,
  MAC_COMMANDS,
  MacPort,
  NEIGHBOR_COMMANDS,
  Neighbor,
  PortInfo,
  PORT_COMMANDS,
  Pt,
  quad,
  ROUTING_COMMANDS,
  SUGGESTERS,
  TOPO_SOURCES,
  DismissedMap,
  PendingFollow,
  TopoLink,
  TopoNode,
  TopoResult,
  TopoSnapshot,
  TopoSources,
  TopoVendor,
  Topology,
  UTIL_LEGEND,
  UtilLevel,
  acceptSuggestion,
  addDismissed,
  addManualLink,
  addManualNode,
  buildMacPorts,
  collectSuggestions,
  deleteManualLink,
  deleteManualNode,
  diffTopology,
  dismissedSet,
  fmtBps,
  followedTerminal,
  hopCommand,
  isCliError,
  isIpv4,
  isIpv6,
  isPhysicalProto,
  isRoutingProto,
  isUserProto,
  junosDetailCommand,
  knownAddrs,
  layout,
  linkDash,
  linkGeometry,
  linkGroup,
  linkKey,
  macPortLinked,
  macPortsFromRows,
  macVendors,
  mergeNeighbors,
  nodeId,
  parseNeighbors,
  parseDismissed,
  parseOwnAddresses,
  parsePortInfo,
  parseRoutingNeighbors,
  pathToText,
  portOf,
  promptName,
  vendorFromPrompt,
  protoLabel,
  shortestPath,
  sourceOn,
  toCsv,
  toDrawio,
  toMermaid,
  toSvg,
  shortName,
  trafficShort,
  updateManualLink,
  updateManualNode,
  utilLevel,
  flowTiming,
} from "../../lib/topology";
import { pinchMetrics, pinchZoom, wheelFactor, wheelIntent } from "../../lib/mapZoom";
import {
  HopAction,
  HopJob,
  HopWaiting,
  OpenChoice,
  PROMPT_WAIT_MS,
  PlanTab,
  TabRoute,
  CameFrom,
  afterEcho,
  classifyHopScreen,
  discoveryIdentity,
  hopCredResult,
  hopTabSession,
  hopWaiting,
  isNxos,
  isReplayable,
  newCameFrom,
  newHopChain,
  planNode,
  planOpen,
  reconcileRoute,
  routeNames,
  routeTitle,
  routeTooltip,
  stepHop,
  tabAtDevice,
  tabDevice,
  truncateRoute,
  vendorOfPlatform,
} from "../../lib/hopTab";
import { HopCredInfo, hopCredKey, isIpLiteral } from "../../lib/hopCred";
import { HopPasswordDialog } from "./HopPasswordDialog";
import { ConnectPanel, HopCards, HopView } from "./TopoConnect";
import { CredStatus, credStatus } from "../../lib/credentials";
import {
  ARP_FALLBACK,
  LLDP_V2_FALLBACK,
  MAX_VLAN_READS,
  TopoRead,
  VLAN_FDB_WALKS,
  VLAN_LIST,
  VlanRead,
  activeVlans,
  needsArpFallback,
  needsLldpV2Fallback,
  needsVlanFdb,
  parseSnmpDiscovery,
  snmpDiscoveryPlan,
} from "../../lib/topoSnmp";
import { LEVEL_RANK, LinkLevel, UTIL_HIGH, UTIL_SATURATED, linkTraffic } from "../../lib/topoTraffic";
import {
  LinkDetail,
  NO_FILTER,
  NO_SCOPE,
  NodeRole,
  NodeState,
  NodeVendor,
  ROLE_LABEL,
  STATE_LABEL,
  SearchHit,
  TopoFilter,
  TopoScope,
  VENDOR_LABEL,
  filterActive,
  filterView,
  ageText,
  attentionRows,
  checkCoverage,
  linkChecks,
  linkDetail,
  linkLevelOf,
  markEnds,
  nodeRole,
  nodeState,
  nodeVendor,
  parseCidrs,
  scopeNeighbors,
  searchTopo,
  unknownL2,
  worstSev,
} from "../../lib/topoInsights";
import { SnmpProfile, targetParams } from "../../lib/snmp";
import { TRAFFIC_INTERVALS, TrafficInterval, useTopoTraffic } from "./useTopoTraffic";
import { vendorFor } from "../../lib/commands";
import type { Session } from "../../types";
import type { TabBrief, TerminalRef } from "./FileManager";
import { Btn, Collapsible, CountBadge, Label, Toggle } from "./ui";
import { ContextMenu } from "../Sidebar";
import { LifecycleChip } from "../StatusBar";
import { isMac } from "../../lib/platform";
import { modelFromPlatform } from "../../lib/lifecycle";
import type { MenuItem } from "../tabMenu";

import { plural } from "../../lib/plural";
import type { LinkIssue, UnknownL2 } from "../../lib/topoInsights";
type Menu = { x: number; y: number; items: MenuItem[] };

/** Salto en curso en una pestaña (una pestaña, un salto). */
interface HopRun {
  tabId: string;
  job: HopJob;
  /** Ruta completa que se reproduce: la sesión del pivote y todos los saltos. */
  route: TabRoute;
  /** Pasos de la ruta que la pestaña ya tenía recorridos (saltar en una pestaña existente). */
  base: number;
  /** La sesión del pivote tiene contraseña guardada: la credencial del pivote se puede escribir. */
  pivotCred: boolean;
  openedAt: number;
  inplace: boolean;
}
const W = 170;
const H = 54;
/** Nodo virtual "L2 desconocido" (puertos activos sin vecino). */
const L2W = 128;
const L2H = 38;
/** Sobre esta cantidad de equipos con puertos sin vecino, el nodo L2 se dibuja solo para el seleccionado. */
const MAX_L2_NODES = 120;
/** Límites del zoom del mapa (botones, pellizco y Ctrl/⌘ + rueda). */
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 4;
/** Separación entre enlaces paralelos del mismo par de equipos. */
const PARALLEL_GAP = 26;
/** Máximo de interfaces que se consultan en detalle (Junos) para no saturar la sesión. */
const MAX_DETAIL = 32;
const MAX_SNAPSHOTS = 20;
const VENDORS: { id: TopoVendor; label: string }[] = [
  { id: "cisco", label: "Cisco (CDP + LLDP)" },
  { id: "huawei", label: "Huawei (LLDP)" },
  { id: "juniper", label: "Juniper (LLDP)" },
  { id: "fortinet", label: "Fortinet (LLDP)" },
];
const CONFIDENCE_COLOR = { alta: "var(--ok)", media: "var(--warn)", baja: "var(--muted)" } as const;

type ManualForm =
  | { kind: "node"; editId?: string; name: string; ip: string; platform: string }
  | { kind: "link"; edit?: TopoLink; a: string; aPort: string; b: string; bPort: string };

/** Secciones del panel lateral. */
type PanelSection = "fuentes" | "alcance" | "filtros" | "atencion" | "trafico" | "sugerencias" | "detalle" | "ruta" | "manual" | "snapshots" | "leyenda";
type DiscoveryMode = "cli" | "snmp";
/**
 * Estado visual de la herramienta (panel, secciones, modo de descubrimiento, intervalo y animación
 * del tráfico). Es comodidad de interfaz: no va a Ajustes. El tráfico y la lectura por consola se
 * recuerdan (parten apagados la primera vez): sin eso había que activarlos en cada apertura.
 */
interface TopoUi {
  panel: boolean;
  sec: Partial<Record<PanelSection, boolean>>;
  mode: DiscoveryMode;
  snmpProfile: string;
  interval: TrafficInterval;
  anim: boolean;
  /** Tráfico en enlaces encendido (se recuerda entre aperturas). */
  traffic: boolean;
  /** Lectura del tráfico también por consola (envía comandos de consulta a la sesión conectada). */
  cli: boolean;
  /** Puntas de flecha por sentido sobre cada enlace con tráfico. */
  arrows: boolean;
  /** Etiqueta de tasas (↑ ↓ y %) junto a cada enlace con tráfico. */
  rates: boolean;
  /** Color y grosor del enlace según su utilización (verde, amarillo, rojo). Solo en la vista detallada. */
  color: boolean;
  /**
   * Vista detallada (para expertos): colores continuos, rótulo en cada enlace con tráfico, flechas y
   * animación. Apagada, el mapa es por excepción: lo normal queda gris y solo se resalta lo alto,
   * saturado o caído.
   */
  detail: boolean;
  /** Puertos activos sin vecino dibujados como "L2 desconocido" junto a su equipo. */
  l2: boolean;
  /** Alcance del descubrimiento: qué vecinos nuevos se incorporan. */
  scope: TopoScope;
  /** Equipos que el usuario marcó (o que ya se alcanzaron por un salto) como no accesibles directo desde este PC. */
  pivot: Record<string, true>;
}
const UI_KEY = "topoUi";
const UI_DEFAULT: TopoUi = {
  panel: true,
  sec: { fuentes: false, atencion: true, trafico: false, sugerencias: false, detalle: true, ruta: true, manual: false, snapshots: false, leyenda: false },
  mode: "cli",
  snmpProfile: "",
  interval: 30,
  anim: false,
  traffic: false,
  cli: false,
  arrows: true,
  rates: true,
  color: true,
  detail: false,
  l2: true,
  scope: NO_SCOPE,
  pivot: {},
};

/** Versión de las preferencias de estilo del tráfico guardadas en topoUi. */
const UI_VERSION = 4;

function loadUi(): TopoUi {
  try {
    const v = JSON.parse(localStorage.getItem(UI_KEY) ?? "null") as Partial<TopoUi> | null;
    // Ventana angosta: el panel lateral se abre encima del diagrama y lo tapa; parte cerrado.
    const roomy = typeof window === "undefined" || window.innerWidth >= 1100;
    if (!v || typeof v !== "object") return { ...UI_DEFAULT, panel: roomy };
    const sec = v.sec && typeof v.sec === "object" ? v.sec : {};
    const ver = typeof (v as { ver?: unknown }).ver === "number" ? (v as { ver: number }).ver : 0;
    return {
      panel: v.panel !== false && roomy,
      sec: { ...UI_DEFAULT.sec, ...sec },
      mode: v.mode === "snmp" ? "snmp" : "cli",
      snmpProfile: typeof v.snmpProfile === "string" ? v.snmpProfile.slice(0, 64) : "",
      interval: TRAFFIC_INTERVALS.includes(v.interval as TrafficInterval) ? (v.interval as TrafficInterval) : 30,
      // Lo guardado antes de la versión 4 (flechas, tasas, color y animación) era de diseños
      // anteriores: se parte del estilo vigente (vista por excepción; el estilo previo es "Vista detallada").
      anim: ver >= UI_VERSION && v.anim === true,
      traffic: v.traffic === true,
      // La lectura por consola envía comandos sola: se confirma en cada apertura de la app (no se recuerda).
      cli: false,
      arrows: ver < UI_VERSION || v.arrows !== false,
      rates: ver < UI_VERSION || v.rates !== false,
      color: ver < UI_VERSION || v.color !== false,
      detail: v.detail === true,
      l2: v.l2 !== false,
      scope: {
        skipEndpoints: v.scope?.skipEndpoints === true,
        cidrs: typeof v.scope?.cidrs === "string" ? v.scope.cidrs.slice(0, 500) : "",
        maxDepth: Number.isInteger(v.scope?.maxDepth) && v.scope!.maxDepth > 0 && v.scope!.maxDepth <= 20 ? v.scope!.maxDepth : 0,
      },
      // Solo ids de equipo (texto corto): lo guardado en el navegador es editable.
      pivot: Object.fromEntries(
        Object.keys(v.pivot && typeof v.pivot === "object" ? v.pivot : {})
          .filter((k) => k.length <= 128)
          .slice(0, 500)
          .map((k) => [k, true as const]),
      ),
    };
  } catch {
    return UI_DEFAULT;
  }
}

/** Color del tema por nivel de utilización (sin velocidad conocida: gris violeta, distinto del azul de selección y ruta). */
const UTIL_VAR: Record<UtilLevel, string> = { ok: "var(--ok)", warn: "var(--warn)", crit: "var(--danger)", none: "var(--util-unknown)" };

/** Sugerencias descartadas por equipo: comodidad de este navegador, con tope. */
const DISMISSED_KEY = "topoDismissed";
function loadDismissed(): DismissedMap {
  try {
    return parseDismissed(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "null"));
  } catch {
    return {};
  }
}

type ConfirmReq = { title: string; message: string; label: string; danger?: boolean; defaultCancel?: boolean; action: () => void };

/** El sistema pide reducir movimiento (se respeta aunque "Animación" esté activa). */
const reducedQuery = () =>
  typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => !!reducedQuery()?.matches);
  // Una sola suscripción: la topología se vuelve a dibujar con cada muestra del monitoreo.
  useEffect(() => {
    const q = reducedQuery();
    if (!q) return;
    const on = () => setReduced(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * Un sentido del tráfico: puntos que viajan junto al enlace (un trazo de largo cero con punta
 * redonda es un círculo), con un borde del color del fondo para que se lean sobre cualquier línea.
 */
function FlowLane({ d, color, style, reverse }: { d: string; color: string; style: React.CSSProperties; reverse?: boolean }) {
  const cls = `topo-flow${reverse ? " topo-flow-rev" : ""}`;
  return (
    <>
      <path className={cls} style={style} d={d} fill="none" stroke="var(--panel)" strokeWidth={6} strokeLinecap="round" />
      <path className={cls} style={style} d={d} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" />
    </>
  );
}

/** Duración y pasos del carril animado (ver flowTiming). */
function flowStyle(bps: number | null, speed: number | undefined): React.CSSProperties {
  const { dur, steps } = flowTiming(bps, speed);
  return { animationDuration: `${dur}s`, animationTimingFunction: `steps(${steps})` };
}

/** Desplaza una curva cuadrática en paralelo (un carril por sentido). */
function lanePath(a: Pt, c: Pt, b: Pt, off: number): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * off;
  const ny = (dx / len) * off;
  return `M ${a.x + nx} ${a.y + ny} Q ${c.x + nx} ${c.y + ny} ${b.x + nx} ${b.y + ny}`;
}

/** Punta de flecha sobre la curva en t, hacia B (forward) o hacia A, en su carril. */
function arrowHead(a: Pt, c: Pt, b: Pt, t: number, forward: boolean, off: number): string {
  const px = (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t ** 2 * b.x;
  const py = (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t ** 2 * b.y;
  let tx = 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x);
  let ty = 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y);
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl;
  ty /= tl;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const cx = px + (-dy / len) * off;
  const cy = py + (dx / len) * off;
  const s = forward ? 1 : -1;
  const [ux, uy] = [tx * s, ty * s];
  const [nx, ny] = [-uy, ux];
  const pts = [
    [cx + ux * 6, cy + uy * 6],
    [cx - ux * 4 + nx * 4, cy - uy * 4 + ny * 4],
    [cx - ux * 4 - nx * 4, cy - uy * 4 - ny * 4],
  ];
  return pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ");
}

/** Resumen de los vecinos que quedaron fuera del alcance (los primeros tres, con su motivo). */
const scopeNote = (skipped: string[]) =>
  skipped.length ? `${skipped.length} fuera de alcance: ${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? "…" : ""}` : "";

/** Mismo equipo salvo la posición (los objetos anidados se conservan al mover un nodo). */
function samePayload(a: TopoNode, b: TopoNode): boolean {
  if (a === b) return true;
  for (const k in b) if (k !== "x" && k !== "y" && a[k as keyof TopoNode] !== b[k as keyof TopoNode]) return false;
  for (const k in a) if (!(k in b)) return false;
  return true;
}

/**
 * Los nodos como datos: devuelve el arreglo anterior mientras solo cambien posiciones, para que
 * lo que no depende de x/y no se recalcule en cada cuadro de un arrastre.
 */
function useNodeData(nodes: TopoNode[]): TopoNode[] {
  const ref = useRef(nodes);
  const prev = ref.current;
  if (prev !== nodes && !(prev.length === nodes.length && prev.every((p, i) => samePayload(p, nodes[i])))) ref.current = nodes;
  return ref.current;
}

function saveUi(ui: TopoUi) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ ...ui, ver: UI_VERSION }));
  } catch {
    // Almacenamiento bloqueado o lleno: la herramienta sigue funcionando sin recordar el estado.
  }
}

/** Topología guardada por versiones anteriores en el almacenamiento del navegador. */
function legacyTopo(): Topology | null {
  try {
    const t = JSON.parse(localStorage.getItem("topology") ?? "null") as Topology | null;
    return t?.nodes?.length ? t : null;
  } catch {
    return null;
  }
}

/** Muestra de línea para la leyenda (mismo trazo que el diagrama). */
function LegendLine({ dash }: { dash?: string }) {
  return (
    <svg width="34" height="8" aria-hidden className="shrink-0">
      <line x1="2" y1="4" x2="32" y2="4" stroke="var(--muted)" strokeWidth={2} strokeDasharray={dash} strokeLinecap="round" />
    </svg>
  );
}

/** Geometría de un enlace más su clave (linkKey), calculada una vez por enlace y no en cada redibujo. */
type Geo = ReturnType<typeof linkGeometry>[number] & { k: string };

/** Estado de un puerto para el tooltip del enlace (estado, velocidad, grupo y descripción). */
const portLine = (n: TopoNode | undefined, port: string) => {
  const p = port ? portOf(n, port) : undefined;
  return p ? [p.status, p.speed, p.group, p.desc].filter(Boolean).join(" · ") : "";
};
/** Segunda línea del equipo en el mapa: IP de gestión o cómo se conoce. */
const nodeSub = (n: TopoNode, ghost: boolean) =>
  ghost
    ? "ya no aparece"
    : n.ip && n.ip !== n.name
      ? n.ip
      : n.addrOnly
        ? "visto por ruteo"
        : n.manual
          ? "manual"
          : n.explored
            ? "explorado"
            : "sin IP de gestión";

interface TrafficRow {
  key: string;
  lt: LinkTraffic;
}

/** Máximo de enlaces animados a la vez (los más cargados): medido en una topología de 400 equipos. */
const FLOW_MAX = 60;

/** Bits por segundo con coma decimal ("9,7 Gb/s"). */
const bpsEs = (bps: number | null | undefined) => fmtBps(bps).replace(".", ",");

/** Color del tema por estado (normal: gris). El rojo es solo de saturado; caído va en gris oscuro punteado. */
const LEVEL_COLOR: Record<TrafficLevelName, string> = { normal: "var(--muted)", high: "var(--warn)", saturated: "var(--danger)" };
type TrafficLevelName = "normal" | "high" | "saturated";

/** Tono de las píldoras: fondo tenue del color, borde del color y texto del mismo tono más oscuro. */
const PILL_TONE: Record<"high" | "saturated" | "down", string> = { high: "var(--warn)", saturated: "var(--danger)", down: "var(--muted)" };
const pillStyle = (tone: keyof typeof PILL_TONE): React.CSSProperties => ({
  fill: `color-mix(in srgb, ${PILL_TONE[tone]} 16%, var(--panel))`,
  stroke: PILL_TONE[tone],
});
const pillTextStyle = (tone: keyof typeof PILL_TONE): React.CSSProperties => ({
  fill: `color-mix(in srgb, ${PILL_TONE[tone]} 40%, var(--text))`,
  fontVariantNumeric: "tabular-nums",
});

// ---------- Ficha del enlace (al pasar el mouse o enfocar) ----------

/** Qué enlaces muestra la ficha y dónde (coordenadas de pantalla del puntero, o del enlace enfocado). */
interface TipState {
  keys: string[];
  x: number;
  y: number;
  focus: boolean;
}

/**
 * Estado de la ficha fuera de React: el puntero cambia de posición decenas de veces por segundo y
 * solo la ficha (LinkTip) debe redibujarse, no la herramienta ni las capas del mapa.
 */
class TipStore {
  private state: TipState | null = null;
  private subs = new Set<() => void>();
  /** Mientras se arrastra un equipo o el fondo no se muestra la ficha. */
  blocked: () => boolean = () => false;
  subscribe = (f: () => void) => {
    this.subs.add(f);
    return () => {
      this.subs.delete(f);
    };
  };
  get = () => this.state;
  show = (keys: string[], x: number, y: number, focus = false) => {
    if (this.blocked()) return this.hide();
    const s = this.state;
    if (s && s.x === x && s.y === y && s.focus === focus && s.keys.length === keys.length && s.keys.every((k, i) => k === keys[i])) return;
    this.state = { keys, x, y, focus };
    this.subs.forEach((f) => f());
  };
  hide = () => {
    if (!this.state) return;
    this.state = null;
    this.subs.forEach((f) => f());
  };
}

const LEVEL_LABEL: Record<LinkLevel, string> = { normal: "Normal", high: "Alto", saturated: "Saturado", down: "Caído" };

/** Barra de uso de un sentido: su color sigue el estado de ese sentido (gris si es normal). */
function DirBar({ d, approx }: { d: LinkDetail["dirs"][number]; approx?: boolean }) {
  const pct = d.util === undefined ? undefined : Math.round(d.util * 100);
  return (
    <div className="mt-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate">
          <span className="font-semibold">{d.label}</span>
          <span className="text-muted"> {d.from} → {d.to}</span>
        </span>
        <span className="shrink-0 tabular-nums">
          <span className={d.level === "normal" ? "" : "font-semibold"} style={d.level === "normal" ? undefined : { color: `color-mix(in srgb, ${LEVEL_COLOR[d.level]} 55%, var(--text))` }}>
            {pct === undefined ? "?" : `${approx ? "≈" : ""}${pct} %`}
          </span>
          <span className="text-[10.5px] text-muted"> {bpsEs(d.bps)}</span>
        </span>
      </div>
      <div className="mt-0.5 h-1.5 rounded-full bg-line overflow-hidden" aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct ?? 0)}%`, background: d.level === "normal" ? "var(--muted)" : LEVEL_COLOR[d.level], opacity: d.level === "normal" ? 0.55 : 1 }} />
      </div>
    </div>
  );
}

/** Cuerpo de la ficha de un enlace (título, interfaces, barras Baja y Sube, hallazgos y fuente). */
function LinkTipBody({ d, now }: { d: LinkDetail; now: number }) {
  const chip = d.level === "normal" ? null : LEVEL_LABEL[d.level];
  const chipColor = d.level === "down" ? "var(--muted)" : LEVEL_COLOR[d.level];
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="min-w-0 truncate text-[12px] font-semibold">
          {d.aName} → {d.bName}
        </span>
        <span className="shrink-0 text-[10.5px] text-muted">{d.proto}</span>
        {chip && (
          <span className="ml-auto shrink-0 rounded-full px-1.5 text-[10.5px] font-semibold" style={{ background: `color-mix(in srgb, ${chipColor} 18%, var(--panel))`, color: `color-mix(in srgb, ${chipColor} 40%, var(--text))` }}>
            {chip}
          </span>
        )}
        {d.state && <span className="ml-auto shrink-0 text-[10.5px] text-muted">{d.state === "removed" ? "ya no aparece" : "nuevo"}</span>}
      </div>
      {d.ends.map((e, i) => (
        <p key={i} className="mt-0.5 text-muted [overflow-wrap:anywhere]">
          {e.name && <span className="text-fg">{e.name} </span>}
          <span className="font-mono text-[11px]">{e.text}</span>
        </p>
      ))}
      {d.group && (
        <p className="mt-0.5 text-muted [overflow-wrap:anywhere]">
          <span className="font-medium text-accent">
            {d.group} ×{d.members.length}
          </span>{" "}
          {d.members.map((m) => `${m.aPort}${m.lag ? ` (${m.lag})` : ""}`).join(", ")}
        </p>
      )}
      {d.dirs.length ? (
        <>
          {d.dirs.map((x) => (
            <DirBar key={x.label} d={x} approx={d.approx} />
          ))}
          {d.approx && <p className="mt-0.5 text-[10.5px] text-muted">≈ velocidad del BW configurado (aproximada)</p>}
          {!d.speed && <p className="mt-0.5 text-[10.5px] text-muted">Velocidad del enlace desconocida: sin % de uso.</p>}
        </>
      ) : (
        <p className="mt-1.5 text-muted">Sin lectura de tráfico</p>
      )}
      <div className="mt-1.5 space-y-0.5">
        {d.findings.length ? (
          d.findings.map((f, i) => (
            <p key={i} className="flex items-start gap-1.5">
              <span className="mt-[1px] grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full text-[9.5px] font-bold" style={{ background: "var(--warn)", color: "var(--panel)" }} aria-hidden>
                !
              </span>
              <span className="[overflow-wrap:anywhere]">{f.text}</span>
            </p>
          ))
        ) : (
          <p className="text-muted">{d.hasPortData ? "Sin errores" : "Sin datos de interfaz (lee el estado de puertos)"}</p>
        )}
      </div>
      {d.ts && d.source && (
        <p className="mt-1 text-[10.5px] text-muted">
          {d.source} · {ageText(d.ts, now)}
        </p>
      )}
    </div>
  );
}

/**
 * Ficha propia del enlace: aparece al pasar el mouse sobre el trazo o su píldora, o al enfocarlo con
 * el teclado. Va dentro del mapa (sin salirse de él), no captura el puntero y se oculta con Escape,
 * al mover el mapa o al hacer zoom.
 */
const LinkTip = memo(function LinkTip({ store, box, detailsFor }: { store: TipStore; box: React.RefObject<HTMLDivElement | null>; detailsFor: (keys: string[]) => LinkDetail[] }) {
  const tip = useSyncExternalStore(store.subscribe, store.get);
  const ref = useRef<HTMLDivElement>(null);
  const keyId = tip?.keys.join("\n") ?? "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const details = useMemo(() => (tip ? detailsFor(tip.keys) : []), [keyId, detailsFor]);
  useEffect(() => {
    if (!tip) return;
    const hide = () => store.hide();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && store.hide();
    const el = box.current;
    window.addEventListener("keydown", onKey);
    el?.addEventListener("wheel", hide, { passive: true });
    el?.addEventListener("scroll", hide, { capture: true, passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      el?.removeEventListener("wheel", hide);
      el?.removeEventListener("scroll", hide, { capture: true });
    };
  }, [!!tip, store, box]);
  useLayoutEffect(() => {
    const el = ref.current;
    const b = box.current;
    if (!tip || !el || !b) return;
    const r = b.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const m = 6;
    let x = tip.x - r.left + 14;
    let y = tip.y - r.top + 16;
    // Sin espacio a la derecha o abajo, pasa al otro lado del puntero; siempre dentro del mapa.
    if (x + w > r.width - m) x = tip.x - r.left - w - 14;
    if (y + h > r.height - m) y = tip.y - r.top - h - 14;
    x = Math.max(m, Math.min(x, r.width - w - m));
    y = Math.max(m, Math.min(y, r.height - h - m));
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }, [tip, details, box]);
  if (!tip || !details.length) return null;
  const now = Date.now();
  return (
    <div
      ref={ref}
      role="tooltip"
      data-link-tip
      className="absolute left-0 top-0 z-30 w-[300px] max-w-[calc(100%-12px)] max-h-[calc(100%-12px)] overflow-hidden pointer-events-none rounded-lg border border-line bg-panel shadow-pop px-3 py-2 text-[11.5px] leading-snug text-fg"
    >
      {details.slice(0, 3).map((d, i) => (
        <div key={d.key} className={i ? "mt-2 border-t border-line pt-2" : ""}>
          <LinkTipBody d={d} now={now} />
        </div>
      ))}
      {details.length > 3 && <p className="mt-2 text-muted">y {details.length - 3} más</p>}
    </div>
  );
});

/**
 * Un enlace del diagrama. Memorizado: al arrastrar un equipo solo se redibujan sus enlaces (los
 * demás conservan la misma geometría y props). El detalle (interfaces, tráfico, hallazgos) sale en la
 * ficha propia (LinkTip) y no en un <title>: el tooltip nativo del SVG depende del webview, tarda
 * y desaparece con cada redibujo del mapa.
 */
const LinkView = memo(function LinkView({
  g,
  aName,
  bName,
  ga,
  gb,
  state,
  isRoute,
  hot,
  dim,
  lt,
  level,
  nIssues,
  detail,
  color: byUtil,
  arrows,
  animate,
  noGroup,
  tips,
}: {
  g: Geo;
  aName: string;
  bName: string;
  /** Extremos a la vista (con fantasma): el grupo (Port-channel) del enlace. */
  ga: TopoNode | undefined;
  gb: TopoNode | undefined;
  state: "removed" | "added" | null;
  isRoute: boolean;
  hot: boolean;
  dim: boolean;
  lt: LinkTraffic | undefined;
  /** Estado del enlace: normal, alto, saturado o caído. */
  level: LinkLevel;
  nIssues: number;
  /** Vista detallada: colores continuos por utilización, flechas y animación. */
  detail: boolean;
  color: boolean;
  arrows: boolean;
  animate: boolean;
  /** El par lleva píldora de tráfico: su rótulo de agregado ("Po1 ×2") ya va dentro de ella. */
  noGroup: boolean;
  tips: TipStore;
}) {
  // Textos por enlace aquí y no en el padre: con cientos de enlaces, cada redibujo del mapa solo
  // los rehace para los que cambiaron (al arrastrar un equipo, los suyos).
  const grp = noGroup ? undefined : (portOf(ga, g.l.aPort)?.group ?? portOf(gb, g.l.bPort)?.group);
  const [lit, setLit] = useState(false);
  const detailLevel = detail && lt && byUtil ? utilLevel(lt.util) : undefined;
  const down = level === "down" && !state;
  const color = state === "removed" ? "var(--danger)" : state === "added" ? "var(--ok)" : down ? "var(--text)" : detail ? (detailLevel ? UTIL_VAR[detailLevel] : hot ? "var(--accent)" : "var(--muted)") : level === "saturated" ? "var(--danger)" : level === "high" ? "var(--warn)" : hot ? "var(--accent)" : "var(--muted)";
  const base = g.l.logical ? 1.25 : 1.5;
  const width = down ? 2 : detail ? (lt && byUtil ? 1.75 + 3 * Math.min(1, lt.util ?? 0) : hot || state ? 2.5 : base) : level === "saturated" ? 5 : level === "high" ? 4 : hot || state ? 2.5 : base;
  const strokeWidth = isRoute ? Math.max(3.5, width) : width;
  const showGroup = grp && g.pair.length > 1 && g.pair.indexOf(g.l) === 0;
  const dash = state === "removed" ? "6 5" : down ? "5 5" : linkDash(g.l);
  // Sin color de utilización, las flechas van en el tono neutro del texto.
  const dirColor = (bps: number | null) => (byUtil ? UTIL_VAR[lt?.speed && bps !== null ? utilLevel(bps / lt.speed) : "none"] : "var(--muted)");
  const label = `${aName} ${g.l.aPort || "?"} a ${bName} ${g.l.bPort || "?"}, ${protoLabel(g.l)}${down ? ", caído" : level === "high" ? ", uso alto" : level === "saturated" ? ", saturado" : ""}${nIssues ? `, ${nIssues} ${nIssues === 1 ? "hallazgo" : "hallazgos"}` : ""}`;
  const key = g.k;
  return (
    <g
      opacity={dim ? 0.25 : 1}
      tabIndex={0}
      role="group"
      aria-label={label}
      style={{ outline: "none" }}
      onPointerEnter={() => setLit(true)}
      onPointerMove={(e) => tips.show([key], e.clientX, e.clientY)}
      onPointerLeave={() => {
        setLit(false);
        tips.hide();
      }}
      onFocus={(e) => {
        // Solo con el teclado: un clic también enfoca el elemento y no debe abrir la ficha.
        let kb = false;
        try {
          kb = e.currentTarget.matches(":focus-visible");
        } catch {
          kb = true;
        }
        if (!kb) return;
        setLit(true);
        const r = e.currentTarget.getBoundingClientRect();
        tips.show([key], r.left + r.width / 2, r.top + r.height / 2, true);
      }}
      onBlur={() => {
        setLit(false);
        tips.hide();
      }}
      onKeyDown={(e) => e.key === "Escape" && tips.hide()}
    >
      {lit && <path d={g.d} fill="none" stroke={down || detailLevel || level !== "normal" ? color : "var(--accent)"} strokeOpacity={0.25} strokeWidth={strokeWidth + 8} strokeLinecap="round" />}
      <path
        d={g.d}
        fill="none"
        stroke={color}
        strokeOpacity={down ? 0.65 : undefined}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
        strokeLinecap={dash ? "round" : undefined}
      />
      {detail && lt && (
        <>
          {/* Un carril por sentido (A→B y B→A): puntos en movimiento con animación, flechas fijas sin ella. */}
          {animate && !!lt.ab && <FlowLane d={lanePath(g.a, g.c, g.b, 5)} color={dirColor(lt.ab)} style={flowStyle(lt.ab, lt.speed)} />}
          {animate && !!lt.ba && <FlowLane d={lanePath(g.a, g.c, g.b, -5)} color={dirColor(lt.ba)} style={flowStyle(lt.ba, lt.speed)} reverse />}
          {arrows && !animate && (
            <>
              <polygon points={arrowHead(g.a, g.c, g.b, 0.4, true, 5)} fill={dirColor(lt.ab)} stroke="var(--panel)" strokeWidth={0.75} />
              <polygon points={arrowHead(g.a, g.c, g.b, 0.6, false, -5)} fill={dirColor(lt.ba)} stroke="var(--panel)" strokeWidth={0.75} />
            </>
          )}
        </>
      )}
      {/* Área de hover y clic más ancha que la línea: 14 px de pantalla a cualquier zoom. */}
      <path d={g.d} fill="none" stroke="transparent" strokeWidth={14} vectorEffect="non-scaling-stroke" />
      {(
        [
          [g.pa, g.l.aPort],
          [g.pb, g.l.bPort],
        ] as [Pt, string][]
      )
        .filter(([, label]) => label)
        .map(([pt, label], j) => (
          <text key={j} x={pt.x} y={pt.y} fontSize={11} textAnchor="middle" fill="var(--text)" stroke="var(--panel)" strokeWidth={4} paintOrder="stroke">
            {label}
          </text>
        ))}
      {showGroup ? (
        <text x={g.mid.x} y={g.mid.y + 4} fontSize={11} fontWeight={600} textAnchor="middle" fill="var(--accent)" stroke="var(--panel)" strokeWidth={4} paintOrder="stroke">
          {grp} ×{g.pair.length}
        </text>
      ) : (
        (isRoutingProto(g.l.proto) || g.l.proto === "MAC/OUI") && (
          <text x={g.mid.x} y={g.mid.y + 4} fontSize={10} fontWeight={600} textAnchor="middle" fill="var(--muted)" stroke="var(--panel)" strokeWidth={4} paintOrder="stroke">
            {protoLabel(g.l)}
          </text>
        )
      )}
    </g>
  );
});

type L2Geo = { id: string; x: number; y: number; from: TopoNode; info: UnknownL2 };

/** Nodo virtual "L2 desconocido": puertos activos sin vecino de un equipo explorado. */
const L2View = memo(function L2View({ v, faded, onPick }: { v: L2Geo; faded: boolean; onPick: (id: string) => void }) {
  const { ports, macs, vendors } = v.info;
  return (
    <g style={{ cursor: "pointer" }} opacity={faded ? 0.35 : 1} onClick={() => onPick(v.id)}>
      <title>
        {[
          `${v.from.name}: ${plural(ports.length, "puerto activo", "puertos activos")} sin vecino CDP/LLDP`,
          `${ports.slice(0, 24).join(", ")}${ports.length > 24 ? "…" : ""}`,
          macs ? `${macs} MAC${vendors.length ? `: ${vendors.join(", ")}` : ""}` : "",
          "Hay algo conectado que no anuncia CDP/LLDP (PC, AP, cámara, switch no administrable). Con la fuente MAC/OUI se ve qué es.",
        ]
          .filter(Boolean)
          .join("\n")}
      </title>
      <line x1={v.from.x} y1={v.from.y} x2={v.x} y2={v.y} stroke="var(--muted)" strokeWidth={1.25} strokeDasharray="2 4" />
      <rect x={v.x - L2W / 2} y={v.y - L2H / 2} width={L2W} height={L2H} rx={8} fill="var(--panel)" stroke="var(--field-border)" strokeDasharray="3 3" />
      <text x={v.x} y={v.y - 2} fontSize={11.5} fontWeight={600} textAnchor="middle" fill="var(--text)">
        L2 desconocido
      </text>
      <text x={v.x} y={v.y + 12} fontSize={10.5} textAnchor="middle" fill="var(--muted)">
        {plural(ports.length, "puerto", "puertos")}
        {macs ? ` · ${macs} MAC` : ""}
      </text>
    </g>
  );
});

/** Un equipo del diagrama (memorizado: al arrastrar solo se redibuja el que se mueve). */
const NodeView = memo(function NodeView({
  n,
  ghost,
  isNew,
  onRoute,
  selected,
  faded,
  onDown,
  onMenu,
  onOpen,
}: {
  n: TopoNode;
  ghost: boolean;
  isNew: boolean;
  onRoute: boolean;
  selected: boolean;
  faded: boolean;
  onDown: (e: React.PointerEvent<SVGGElement>, n: TopoNode) => void;
  onMenu: (e: React.MouseEvent<SVGGElement>, n: TopoNode) => void;
  onOpen: (n: TopoNode) => void;
}) {
  const tentative = n.manual || n.addrOnly;
  const sub = nodeSub(n, ghost);
  return (
    <g style={{ cursor: ghost ? "default" : "grab" }} opacity={faded ? 0.35 : 1} onPointerDown={(e) => !ghost && e.button === 0 && onDown(e, n)}
      onDoubleClick={() => !ghost && onOpen(n)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!ghost) onMenu(e, n);
      }}
    >
      {/* Fondo opaco: el relleno de los explorados es translúcido y dejaba ver los enlaces. */}
      <rect x={n.x - W / 2} y={n.y - H / 2} width={W} height={H} rx={10} fill="var(--panel)" />
      <rect
        x={n.x - W / 2}
        y={n.y - H / 2}
        width={W}
        height={H}
        rx={10}
        fill={n.explored ? "var(--selected)" : "var(--chrome)"}
        stroke={ghost ? "var(--danger)" : isNew ? "var(--ok)" : selected || onRoute ? "var(--accent)" : n.explored ? "var(--accent)" : "var(--field-border)"}
        strokeDasharray={ghost ? "5 4" : tentative ? "4 3" : undefined}
        strokeWidth={selected || onRoute || ghost || isNew ? 2.5 : 1.5}
      />
      <text x={n.x} y={n.y - 4} fontSize={13} fontWeight={600} textAnchor="middle" fill="var(--text)">
        {n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name}
      </text>
      <text x={n.x} y={n.y + 14} fontSize={11} textAnchor="middle" fill="var(--muted)">
        {sub}
      </text>
    </g>
  );
});

/** Píldora sobre un enlace (o el centro de un par de paralelos): % de uso o "caído". */
interface Pill {
  key: string;
  x: number;
  y: number;
  text: string;
  /** Color de la vista detallada (continuo por utilización). */
  color: string;
  /** Estado resaltado de la vista por excepción: alto, saturado o caído. */
  tone?: keyof typeof PILL_TONE;
  dim: boolean;
  keys: string[];
}

/** Marcador "!" de un problema de interfaz, en el extremo del puerto afectado. */
interface Mark {
  key: string;
  k: string;
  x: number;
  y: number;
  /** Equipo del extremo afectado (al hacer clic se elige y se abre el panel). */
  node: string;
  dim: boolean;
}

/**
 * Capas del mapa (enlaces, nodos L2, equipos, píldoras y marcadores). Memorizadas: el zoom, el
 * arrastre del fondo, los mensajes y el panel cambian el estado de la herramienta sin tocar el
 * diagrama, y con cientos de equipos rehacer y comparar los elementos de cada enlace y equipo
 * costaba decenas de ms por redibujo.
 */
const TopoLayers = memo(function TopoLayers({
  geometry,
  nodes,
  l2Nodes,
  pills,
  byId,
  shownById,
  snapshot,
  hasRoute,
  routeKeys,
  routeNodes,
  removed,
  added,
  ghostIds,
  newIds,
  selected,
  focusLink,
  linkRates,
  detail,
  color,
  arrows,
  animate,
  animKeys,
  pillPairs,
  checks,
  tips,
  onIssue,
  onNodeDown,
  onNodeMenu,
  onNodeOpen,
  onPick,
}: {
  geometry: Geo[];
  nodes: TopoNode[];
  l2Nodes: L2Geo[];
  /** Píldoras de los enlaces que lo merecen (alto, saturado, caído; en la vista detallada, todos con tráfico). */
  pills: Pill[];
  byId: Map<string, TopoNode>;
  shownById: Map<string, TopoNode>;
  snapshot: TopoSnapshot | undefined;
  hasRoute: boolean;
  routeKeys: Set<string>;
  routeNodes: Set<string>;
  removed: Set<string>;
  added: Set<string>;
  ghostIds: Set<string>;
  newIds: Set<string>;
  selected: string | null;
  focusLink: string | null;
  linkRates: Map<string, LinkTraffic>;
  detail: boolean;
  color: boolean;
  arrows: boolean;
  animate: boolean;
  animKeys: Set<string>;
  pillPairs: Set<string>;
  checks: Map<string, LinkIssue[]>;
  tips: TipStore;
  onIssue: (id: string) => void;
  onNodeDown: (e: React.PointerEvent<SVGGElement>, n: TopoNode) => void;
  onNodeMenu: (e: React.MouseEvent<SVGGElement>, n: TopoNode) => void;
  onNodeOpen: (n: TopoNode) => void;
  onPick: (id: string) => void;
}) {
  /** Nombre del equipo en el diagrama o en el snapshot (los ids son nombres normalizados en minúscula). */
  const anyName = (id: string) => byId.get(id)?.name ?? snapshot?.topo.nodes.find((n) => n.id === id)?.name ?? id;
  // Marcadores "!" en el extremo del puerto afectado, a un tercio del trazo desde su equipo.
  const marks = useMemo(() => {
    const out: Mark[] = [];
    for (const g of geometry) {
      const k = g.k;
      if (removed.has(k)) continue;
      const m = markEnds(checks.get(k));
      if (!m.a && !m.b) continue;
      const t = g.pair.length > 1 ? 0.4 : 0.33;
      const dim = hasRoute && !routeKeys.has(k);
      if (m.a) out.push({ key: `${k}|a|${g.l.proto}`, k, ...quad(g.a, g.c, g.b, t), node: g.l.a, dim });
      if (m.b) out.push({ key: `${k}|b|${g.l.proto}`, k, ...quad(g.a, g.c, g.b, 1 - t), node: g.l.b, dim });
    }
    return out;
  }, [geometry, checks, removed, hasRoute, routeKeys]);
  return (
    <>
      {geometry.map((g) => {
        const k = g.k;
        const isRoute = routeKeys.has(k);
        const state = removed.has(k) ? "removed" : added.has(k) ? "added" : null;
        const a = byId.get(g.l.a);
        const b = byId.get(g.l.b);
        const issues = state === "removed" ? undefined : checks.get(k);
        const lt = state ? undefined : linkRates.get(k);
        return (
          <LinkView
            key={`${k}|${g.l.proto}`}
            g={g}
            aName={a?.name ?? anyName(g.l.a)}
            bName={b?.name ?? anyName(g.l.b)}
            ga={shownById.get(g.l.a)}
            gb={shownById.get(g.l.b)}
            state={state}
            isRoute={isRoute}
            hot={isRoute || focusLink === k || selected === g.l.a || selected === g.l.b}
            dim={hasRoute && !isRoute}
            lt={lt}
            level={linkLevelOf(issues, lt)}
            nIssues={issues?.length ?? 0}
            detail={detail}
            color={color}
            arrows={arrows}
            animate={animate && animKeys.has(k)}
            noGroup={pillPairs.has(k)}
            tips={tips}
          />
        );
      })}
      {l2Nodes.map((v) => (
        <L2View key={`l2:${v.id}`} v={v} faded={hasRoute && !routeNodes.has(v.id)} onPick={onPick} />
      ))}
      {nodes.map((n) => {
        const ghost = ghostIds.has(n.id);
        const onRoute = routeNodes.has(n.id);
        return (
          <NodeView
            key={n.id}
            n={n}
            ghost={ghost}
            isNew={newIds.has(n.id)}
            onRoute={onRoute}
            selected={selected === n.id}
            faded={hasRoute && !onRoute && !ghost}
            onDown={onNodeDown}
            onMenu={onNodeMenu}
            onOpen={onNodeOpen}
          />
        );
      })}
      {/* Las píldoras van en una capa propia sobre los equipos: un enlace corto no las tapa. Reciben el puntero para mostrar la ficha. */}
      {pills.map((t) => {
        const w = t.text.length * 6.4 + 12;
        return (
          <g
            key={t.key}
            opacity={t.dim ? 0.25 : 1}
            onPointerMove={(e) => tips.show(t.keys, e.clientX, e.clientY)}
            onPointerLeave={tips.hide}
          >
            <rect x={t.x - w / 2} y={t.y - 9} width={w} height={18} rx={9} fill="var(--panel)" stroke={t.color} strokeWidth={1.25} style={t.tone ? pillStyle(t.tone) : undefined} />
            <text x={t.x} y={t.y + 3.8} fontSize={11} fontWeight={600} textAnchor="middle" fill={t.color} style={t.tone ? pillTextStyle(t.tone) : { fontVariantNumeric: "tabular-nums" }} pointerEvents="none">
              {t.text}
            </text>
          </g>
        );
      })}
      {/* Marcadores de problemas de interfaz: sobre equipos y píldoras, en el extremo del puerto. */}
      {marks.map((m) => (
        <g
          key={m.key}
          style={{ cursor: "pointer" }}
          opacity={m.dim ? 0.35 : 1}
          onClick={() => onIssue(m.node)}
          onPointerMove={(e) => tips.show([m.k], e.clientX, e.clientY)}
          onPointerLeave={tips.hide}
        >
          <circle cx={m.x} cy={m.y} r={8.5} fill="var(--warn)" stroke="var(--panel)" strokeWidth={2} />
          <text x={m.x} y={m.y + 4} fontSize={12} fontWeight={800} textAnchor="middle" fill="var(--panel)" pointerEvents="none">
            !
          </text>
        </g>
      ))}
    </>
  );
});

/** Hora actual refrescada cada `ms` mientras `on`: el "hace N s" del encabezado envejece sin lecturas nuevas. */
function useNow(ms: number, on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms, on]);
  return now;
}

/**
 * Resumen del mapa (arriba a la derecha): "Todo normal salvo N enlaces", de dónde y cuándo se leyó.
 * Un clic abre "Requieren atención" en el panel.
 */
const MapSummary = memo(function MapSummary({
  trafficOn,
  visible,
  last,
  snmp,
  cli,
  count,
  hasData,
  onOpen,
}: {
  trafficOn: boolean;
  visible: boolean;
  last: number | undefined;
  snmp: boolean;
  cli: boolean;
  count: number;
  hasData: boolean;
  onOpen: () => void;
}) {
  const now = useNow(5000, trafficOn && visible && !!last);
  if (!trafficOn && !count) return null;
  const src = snmp && cli ? "SNMP y consola" : snmp ? "SNMP" : cli ? "Consola" : "";
  const head = trafficOn && !hasData ? (last ? "Sin tasas aún" : "Leyendo tráfico…") : count ? (trafficOn ? `Todo normal salvo ${plural(count, "enlace", "enlaces")}` : `${plural(count, "enlace requiere", "enlaces requieren")} atención`) : "Todo normal";
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Ver los enlaces que requieren atención"
      className="absolute top-2 right-2 z-10 max-w-[calc(100%-1rem)] inline-flex items-center gap-2 rounded-lg border border-line bg-panel shadow-pop px-2.5 h-7 text-[11.5px] hover:bg-hover"
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: count ? "var(--warn)" : "var(--ok)" }} aria-hidden />
      <span className="font-medium truncate">{head}</span>
      {trafficOn && last && src && (
        <span className="text-muted truncate">
          {src} · {ageText(last, now)}
        </span>
      )}
    </button>
  );
});

export function TopologyTool({
  terminals,
  sessions,
  topo,
  snapshots,
  sources,
  snmpProfiles,
  visible,
  onTopo,
  onSnapshots,
  onSources,
  onOpenSession,
  tabs,
  onFocusTab,
  onReconnectTab,
  onConfirm,
  lifecycle = false,
}: {
  terminals: TerminalRef[];
  sessions: Session[];
  topo: Topology;
  snapshots: TopoSnapshot[];
  sources: TopoSources;
  /** Perfiles de Herramientas › SNMP (sin secretos: viven en la bóveda). */
  snmpProfiles: SnmpProfile[];
  /** La herramienta está a la vista: sin ella no se leen contadores de tráfico. */
  visible: boolean;
  onTopo: (t: Topology | ((t: Topology) => Topology)) => void;
  onSnapshots: (s: TopoSnapshot[]) => void;
  onSources: (s: TopoSources) => void;
  /** `background`: abre la pestaña sin activarla (Topología sigue a la vista). Devuelve el id de la pestaña. */
  onOpenSession: (s: Session, opts?: { background?: boolean; title?: string }) => string | void;
  /** Todas las pestañas con su estado (las caídas no están en `terminals`). */
  tabs: TabBrief[];
  /** Activa una pestaña: sale de Herramientas, a pedido del usuario. */
  onFocusTab: (tabId: string) => void;
  onReconnectTab: (tabId: string) => void;
  /** Confirmación de la app (ConfirmDialog) para borrar o reemplazar el diagrama y los snapshots. */
  onConfirm: (req: ConfirmReq) => void;
  /** Ciclo de vida activado en Ajustes: muestra EoL y versión en el detalle del equipo. */
  lifecycle?: boolean;
}) {
  const [connId, setConnId] = useState("");
  const term = terminals.find((t) => t.connId === connId);
  const [vendor, setVendor] = useState<TopoVendor>("cisco");
  const [readPorts, setReadPorts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [exportMenu, setExportMenu] = useState<Menu | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [proto, setProto] = useState<"ssh" | "telnet">("ssh");
  const [path, setPath] = useState<{ from?: string; to?: string }>({});
  const [compareId, setCompareId] = useState("");
  const [snapName, setSnapName] = useState<string | null>(null);
  const [form, setForm] = useState<ManualForm | null>(null);
  const [formErr, setFormErr] = useState("");
  const [dismissedMap, setDismissedMap] = useState<DismissedMap>(loadDismissed);
  const dismissed = useMemo(() => dismissedSet(dismissedMap), [dismissedMap]);
  const dismiss = (id: string) =>
    setDismissedMap((m) => {
      const next = addDismissed(m, id);
      try {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
      } catch {
        /* solo comodidad */
      }
      return next;
    });
  const [pendingFollow, setPendingFollow] = useState<PendingFollow | null>(null);
  /**
   * Ruta de cada pestaña abierta por un salto (por id de pestaña): el pivote y los saltos hasta el
   * equipo donde está. Cada equipo de la ruta tiene su propia pestaña, así que el tráfico de toda la
   * ruta se lee por consola, cada uno por la suya. No se persiste: las pestañas tampoco.
   */
  const [routes, setRoutes] = useState<Record<string, TabRoute>>({});
  const routesRef = useRef(routes);
  routesRef.current = routes;
  /**
   * De dónde salió cada equipo descubierto (id): el equipo que lo descubrió y la ruta de la pestaña que estaba en él.
   * "Abrir terminal" salta con esa ruta más un paso, no con otra por el diagrama. No se persiste (las pestañas tampoco).
   */
  const cameFromRef = useRef(new Map<string, CameFrom>());
  /** Pestaña con la que se descubre (la de "Equipo", o la de un equipo con "Descubrir vecinos de X"). */
  const discConn = useRef("");
  const [hopUser, setHopUser] = useState("");
  /** Credencial del pivote en esta ruta: desmarcada por defecto y por cada salto (no se recuerda). */
  const [usePivotCred, setUsePivotCred] = useState(false);
  /** No usar las contraseñas guardadas de los vecinos en este salto (se desmarca solo tras cada salto). */
  const [skipSavedCred, setSkipSavedCred] = useState(false);
  /** Vecinos con contraseña guardada (IP|usuario) y estado de la bóveda. Solo claves: nunca contraseñas. */
  const [savedHops, setSavedHops] = useState<Set<string>>(new Set());
  const [vault, setVault] = useState<CredStatus | null>(null);
  const refreshCreds = useCallback(() => {
    credStatus().then(setVault).catch(() => setVault(null));
    invoke<HopCredInfo[]>("hop_cred_list")
      .then((l) => setSavedHops(new Set(l.map((x) => hopCredKey(x.ip, x.user)))))
      .catch(() => setSavedHops(new Set()));
  }, []);
  useEffect(() => refreshCreds(), [refreshCreds]);
  /** Contraseñas tecleadas por el usuario en un salto: se ofrece guardarlas (el campo oculto las pide aparte). */
  const [saveOffers, setSaveOffers] = useState<{ to: string; ip: string; user: string; update?: boolean }[]>([]);
  const [pwDialog, setPwDialog] = useState<{ to: string; ip: string; user: string; update?: boolean } | null>(null);
  /** Saltos en curso por pestaña (una pestaña, un salto): cada uno espera el prompt antes de enviar el comando. */
  const hopRuns = useRef(new Map<string, HopRun>());
  const [hopRunning, setHopRunning] = useState<string[]>([]);
  /** Lo que se muestra de cada salto (en curso o terminado hace poco) en el panel de Topología. */
  const [hopViews, setHopViews] = useState<HopView[]>([]);
  /** Contraseñas guardadas o del pivote que se rechazaron: se avisa y las escribe el usuario. */
  const [credAlerts, setCredAlerts] = useState<{ tabId: string; to: string; ip: string; user: string; source: "saved" | "pivot" }[]>([]);
  const drag = useRef<{ id: string; sx: number; sy: number; x: number; y: number; w: number; h: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const [ui, setUi] = useState<TopoUi>(loadUi);
  // El descubrimiento tarda segundos: el alcance se evalúa contra el diagrama vigente al terminar.
  const topoRef = useRef(topo);
  topoRef.current = topo;
  // Arrastrar un equipo solo cambia x/y: revisiones, sugerencias, conteos y búsqueda no se recalculan.
  const dataNodes = useNodeData(topo.nodes);
  const topoData = useMemo(() => ({ nodes: dataNodes, links: topo.links }), [dataNodes, topo.links]);
  const [filter, setFilter] = useState<TopoFilter>(NO_FILTER);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusReq, setFocusReq] = useState<string | Pt | null>(null);
  /** Enlace elegido en la tabla de tráfico: se resalta y se centra en el mapa. */
  const [focusLink, setFocusLink] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const manualRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const legendId = useId();
  const isOpen = (s: PanelSection) => !!ui.sec[s];
  const setOpen = (s: PanelSection, open: boolean) => setUi((u) => ({ ...u, sec: { ...u.sec, [s]: open } }));
  const setPanel = (panel: boolean) => setUi((u) => ({ ...u, panel }));

  useEffect(() => saveUi(ui), [ui]);

  // Descubrimiento por SNMP: perfiles v2c o v3 (GETBULK); v1 no se ofrece.
  const mode = ui.mode;
  const profiles = useMemo(() => snmpProfiles.filter((p) => p.version !== "1" && p.host.trim()), [snmpProfiles]);
  const profile = profiles.find((p) => p.id === ui.snmpProfile) ?? profiles[0];

  // Tráfico en enlaces y lectura por consola (envía comandos de consulta): parten apagados la primera
  // vez y después se recuerdan, para no activarlos en cada apertura.
  const trafficOn = ui.traffic;
  const trafficCli = ui.cli;
  const setTrafficOn = (traffic: boolean) => setUi((u) => ({ ...u, traffic }));
  const setTrafficCli = (cli: boolean) => setUi((u) => ({ ...u, cli }));
  const reducedMotion = useReducedMotion();
  const trafficTerminals = useMemo(() => terminals.filter((t) => !t.tabId || !hopRunning.includes(t.tabId)), [terminals, hopRunning]);
  const traffic = useTopoTraffic({
    topo,
    profiles: snmpProfiles,
    // Una pestaña con un salto en curso no se lee: está cambiando de equipo y recibiendo comandos.
    terminals: trafficTerminals,
    opts: { on: trafficOn, cli: trafficCli, interval: ui.interval },
    visible,
    routes,
  });

  // Migra el diagrama de versiones anteriores (antes vivía en el navegador, fuera de la carpeta de datos).
  useEffect(() => {
    const old = legacyTopo();
    if (old && !topo.nodes.length) onTopo(old);
    if (old) localStorage.removeItem("topology");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Por defecto la sesión más reciente.
  useEffect(() => {
    if (!term && terminals.length) setConnId(terminals[terminals.length - 1].connId);
  }, [terminals, term]);
  // "Conectar y seguir la ruta": en cuanto la sesión abierta queda conectada, se elige sola en "Equipo".
  useEffect(() => {
    if (!pendingFollow) return;
    const t = followedTerminal(terminals, pendingFollow);
    if (!t) return;
    setConnId(t.connId);
    setPendingFollow(null);
    setMsg(`${t.name} conectado y elegido en "Equipo": pulsa "Descubrir vecinos" para seguir la ruta.`);
  }, [terminals, pendingFollow]);
  useEffect(() => {
    if (!term) return;
    const v = vendorFor(term.highlight);
    if (VENDORS.some((x) => x.id === v)) setVendor(v as TopoVendor);
  }, [term]);

  /** Ejecuta un comando; si el equipo no lo reconoce, prueba la sintaxis alternativa. */
  const run = async (cmd: string): Promise<string> => {
    setMsg(`Ejecutando: ${cmd}`);
    const conn = discConn.current || term!.connId;
    const out = await runOnDevice(conn, cmd, 60);
    const alt = FALLBACK_COMMANDS[cmd];
    if (alt && isCliError(out)) {
      setMsg(`Ejecutando: ${alt}`);
      return runOnDevice(conn, alt, 60);
    }
    return out;
  };

  const routingOn = sourceOn(sources, "routing");
  const macOn = sourceOn(sources, "mac");

  const selectedVendor = vendor;
  const discover = async (forced?: TopoVendor, over?: TerminalRef): Promise<void> => {
    const tab = over ?? term;
    if (!tab) return;
    discConn.current = tab.connId;
    const vendor = forced ?? selectedVendor;
    setBusy(true);
    setMsg("");
    try {
      const outputs: string[] = [];
      for (const cmd of NEIGHBOR_COMMANDS[vendor]) {
        const out = await run(cmd);
        // Tras un salto el equipo puede ser de otra marca: su prompt lo dice y se repite con su sintaxis.
        if (!forced && !outputs.length) {
          const seen = vendorFromPrompt(out);
          if (seen && seen !== vendor) {
            setVendor(seen);
            return await discover(seen, over);
          }
        }
        outputs.push(out);
      }
      // "% CDP is not enabled", "% LLDP is not enabled" o comando inexistente en todos.
      const l2Off = outputs.every(isCliError);
      let neighbors = parseNeighbors(vendor, outputs);
      // Junos: la tabla resumida no trae IP de gestión; se pide el detalle por interfaz.
      if (vendor === "juniper" && neighbors.some((n) => !n.ip)) {
        const ifaces = [...new Set(neighbors.filter((n) => !n.ip).map((n) => n.localPort))].slice(0, MAX_DETAIL);
        for (const iface of ifaces) {
          // La interfaz viene de la salida del equipo: solo se reenvía si es un nombre válido.
          const cmd = junosDetailCommand(iface);
          if (cmd) outputs.push(await run(cmd));
        }
        neighbors = parseNeighbors(vendor, outputs);
      }
      // Vecinos de ruteo: solo con la fuente activa (apagada no se envía ningún comando).
      let routing: Neighbor[] = [];
      let addrs: string[] | undefined;
      if (routingOn && ROUTING_COMMANDS[vendor].length) {
        const results: CommandOutput[] = [];
        for (const cmd of ROUTING_COMMANDS[vendor]) results.push({ cmd, out: await run(cmd) });
        const r = parseRoutingNeighbors(results);
        routing = r.neighbors;
        addrs = r.selfAddrs;
        outputs.push(...results.map((x) => x.out));
        // Direcciones propias: para reconocer este equipo cuando otro lo reporta por IP.
        const addrCmd = ADDRESS_COMMANDS[vendor];
        if (addrCmd && (routing.length || topo.nodes.some((n) => n.addrOnly))) {
          const out = await run(addrCmd);
          addrs = [...addrs, ...parseOwnAddresses([out])];
          outputs.push(out);
        }
      }
      let ports: Record<string, PortInfo> | undefined;
      if (readPorts && PORT_COMMANDS[vendor].length) {
        const portOuts: string[] = [];
        for (const cmd of PORT_COMMANDS[vendor]) portOuts.push(await run(cmd));
        ports = parsePortInfo(portOuts);
        outputs.push(...portOuts);
      }
      // Tablas MAC y ARP: solo con la fuente MAC/OUI activa (apagada no se envía ningún comando).
      // Los datos OUI se cargan recién aquí, en un módulo aparte, para no pesar en el arranque.
      let macs: Record<string, MacPort> | undefined;
      if (macOn && MAC_COMMANDS[vendor].length) {
        const results: CommandOutput[] = [];
        for (const cmd of MAC_COMMANDS[vendor]) results.push({ cmd, out: await run(cmd) });
        const { lookupOui } = await import("../../lib/oui");
        macs = buildMacPorts(results, lookupOui);
        outputs.push(...results.map((x) => x.out));
      }
      const last = [...outputs].reverse().find((o) => o.trim()) ?? "";
      const seenName = promptName(last) ?? tab.name;
      // Dentro de un salto la IP es la del equipo de la ruta donde está la pestaña, no la de la sesión del PC.
      const route = tab.tabId ? routesRef.current[tab.tabId] : undefined;
      const who = discoveryIdentity({ name: tab.name, host: tab.host, session: tab.session, hasTabId: !!tab.tabId }, route, seenName);
      // Con el nombre del diagrama (el prompt puede traer otro dominio, guion bajo o mayúsculas): sin equipos duplicados.
      const { name, ip, upto } = who;
      // La ruta se ajusta a lo que dice el prompt (un "exit" tecleado a mano también cuenta).
      if (route && upto && who.at < route.steps.length) setRoutes((m) => ({ ...m, [tab.tabId!]: upto }));
      const before = topoRef.current;
      const sc = scopeNeighbors(before, name, [...neighbors, ...routing], ui.scope);
      // Los equipos nuevos recuerdan desde dónde se descubrieron: saltar a ellos usa esa ruta más un paso.
      if (upto) {
        const fresh = newCameFrom({ ids: new Set(before.nodes.map((n) => n.id)), addrs: before.nodes.flatMap((n) => knownAddrs(n)) }, sc.kept, nodeId(name), upto, cameFromRef.current);
        for (const [id, cf] of fresh) cameFromRef.current.set(id, cf);
        while (cameFromRef.current.size > 5000) cameFromRef.current.delete(cameFromRef.current.keys().next().value!);
      }
      onTopo((t) => mergeNeighbors(t, { name, ip, ports, addrs, macs }, sc.kept));
      setSelected(nodeId(name));
      const parts = [
        `${plural(neighbors.length, "vecino", "vecinos")} CDP/LLDP`,
        routingOn && ROUTING_COMMANDS[vendor].length ? `${routing.length} de ruteo` : "",
        macs ? `${Object.keys(macs).length} puertos con MAC` : "",
        scopeNote(sc.skipped),
      ].filter(Boolean);
      const l2Hint =
        vendor === "fortinet"
          ? "Habilita la recepción LLDP (set lldp-reception enable) en la interfaz."
          : l2Off
            ? "CDP/LLDP no está habilitado en el equipo."
            : "";
      const routingHint =
        !neighbors.length && !routing.length && !routingOn && ROUTING_COMMANDS[vendor].length
          ? 'Activa "Vecinos de ruteo" en Fuentes de descubrimiento o agrega los enlaces a mano.'
          : "";
      // Vecinos descartados por el alcance (profundidad, redes, teléfonos): se dice cómo traerlos, no queda en silencio.
      const scopeHint = sc.skipped.length ? 'Cambia el "Alcance del descubrimiento" (panel) y vuelve a descubrir para traerlos.' : "";
      setMsg([`${name}: ${parts.join(", ")}.`, neighbors.length ? "" : l2Hint, routingHint, scopeHint].filter(Boolean).join(" "));
    } catch (e) {
      setMsg(String(e));
    }
    discConn.current = "";
    setBusy(false);
  };

  /** "Descubrir vecinos de X": con la pestaña que está en ese equipo (la deja elegida en "Equipo"). */
  const discoverFromTab = (tabId: string) => {
    const t = liveRef.current.terminals.find((x) => x.tabId === tabId);
    if (!t) return setMsg("Esa pestaña ya no está conectada.");
    setConnId(t.connId);
    void discover(undefined, t);
  };

  /**
   * Descubrimiento con un perfil SNMP: solo lectura (GET y GETBULK de las tablas permitidas en el
   * backend), con las mismas fuentes activas que por consola. Los secretos salen de la bóveda.
   */
  const discoverSnmp = async () => {
    const p = profile;
    if (!p) return;
    if (!p.saved) {
      setMsg(`El perfil "${p.name || p.host}" no tiene secretos guardados: guárdalos en Herramientas › SNMP (bóveda cifrada).`);
      return;
    }
    setBusy(true);
    setMsg(`Leyendo por SNMP ${p.host} (LLDP, CDP${routingOn ? ", OSPF, BGP" : ""}${macOn ? ", tabla MAC y ARP" : ""})…`);
    try {
      const opts = { routing: routingOn, mac: macOn, ports: readPorts };
      const plan = snmpDiscoveryPlan(opts);
      const target = targetParams(p, { community: "", authPass: "", privPass: "" });
      let r = await invoke<TopoRead>("snmp_topo_read", { target, gets: plan.gets, walks: plan.walks });
      // Alternativas en lecturas aparte: ARP antiguo y LLDP-V2-MIB (802.1AB-2009) si la de 2005 vino vacía.
      const extra = [...(opts.mac && needsArpFallback(r) ? ARP_FALLBACK : []), ...(needsLldpV2Fallback(r) ? LLDP_V2_FALLBACK : [])];
      if (extra.length) {
        const r2 = await invoke<TopoRead>("snmp_topo_read", { target, gets: [], walks: extra });
        r = { ...r, walks: [...r.walks, ...r2.walks], ms: r.ms + r2.ms };
      }
      // Cisco: la tabla MAC de BRIDGE-MIB es por VLAN (community@vlan en v2c, contexto vlan-N en v3).
      const vlanReads: VlanRead[] = [];
      let vlanNote = "";
      if (opts.mac && needsVlanFdb(r)) {
        const list = await invoke<TopoRead>("snmp_topo_read", { target, gets: [], walks: VLAN_LIST });
        r = { ...r, walks: [...r.walks, ...list.walks], ms: r.ms + list.ms };
        const { vlans, total } = activeVlans(list);
        for (const [i, vlan] of vlans.entries()) {
          setMsg(`Leyendo la tabla MAC de la VLAN ${vlan} (${i + 1} de ${vlans.length})…`);
          try {
            const read = await invoke<TopoRead>("snmp_topo_read", { target, gets: [], walks: VLAN_FDB_WALKS, vlan });
            vlanReads.push({ vlan, read });
            r = { ...r, ms: r.ms + read.ms };
          } catch (e) {
            vlanNote = `VLAN ${vlan}: ${String(e)}`;
          }
        }
        if (total > vlans.length) vlanNote = `Tabla MAC: se leyeron ${vlans.length} de ${total} VLAN (tope ${MAX_VLAN_READS}).`;
      }
      const d = parseSnmpDiscovery(r, opts, vlanReads);
      if (vlanNote) d.notes.push(vlanNote);
      let macs: Record<string, MacPort> | undefined;
      if (opts.mac) {
        const { lookupOui } = await import("../../lib/oui");
        macs = macPortsFromRows(d.macRows, d.arpRows, lookupOui);
      }
      const host = p.host.trim();
      const name = d.name ?? (p.name.trim() || host);
      const sc = scopeNeighbors(topoRef.current, name, [...d.neighbors, ...d.routing], ui.scope);
      onTopo((t) => mergeNeighbors(t, { name, ip: isIpv4(host) || isIpv6(host) ? host : undefined, ports: d.ports, addrs: d.addrs, macs }, sc.kept));
      setSelected(nodeId(name));
      traffic.prime(nodeId(name), p.id, d.ifIndex);
      const parts = [
        `${plural(d.neighbors.length, "vecino", "vecinos")} CDP/LLDP`,
        routingOn ? `${d.routing.length} de ruteo` : "",
        macs ? `${Object.keys(macs).length} puertos con MAC` : "",
        scopeNote(sc.skipped),
      ].filter(Boolean);
      const l2 = d.l2Empty
        ? "LLDP y CDP vacíos por SNMP: el protocolo está apagado en el equipo (o su agente no publica LLDP-MIB, LLDP-V2-MIB ni CISCO-CDP-MIB)."
        : "";
      const notes = d.notes.length ? `Avisos: ${d.notes.slice(0, 3).join("; ")}${d.notes.length > 3 ? ` y ${d.notes.length - 3} más` : ""}.` : "";
      setMsg([`${name}: ${parts.join(", ")} por SNMP en ${(r.ms / 1000).toFixed(1)} s.`, l2, notes].filter(Boolean).join(" "));
    } catch (e) {
      setMsg(`SNMP: ${String(e)}`);
    }
    setBusy(false);
  };

  // Índice por id: buscar con find por cada enlace era O(enlaces × equipos) en cada render.
  const topoById = useMemo(() => new Map(topo.nodes.map((n) => [n.id, n])), [topo.nodes]);
  const node = (id: string) => topoById.get(id);
  const sel = selected ? node(selected) : undefined;

  // Comparación con un snapshot: los enlaces y equipos que ya no están se dibujan fantasma.
  const snapshot = snapshots.find((s) => s.id === compareId);
  /** Nombre del equipo en el diagrama o en el snapshot (los ids son nombres normalizados en minúscula). */
  const anyName = (id: string) => node(id)?.name ?? snapshot?.topo.nodes.find((n) => n.id === id)?.name ?? id;
  const diff = useMemo(() => (snapshot ? diffTopology(snapshot.topo, topo) : null), [snapshot, topo]);
  // Arrastre: la posición vive aquí mientras se mueve y se guarda una vez al soltar (antes cada
  // cuadro actualizaba los ajustes de toda la app).
  const liveTopo = useMemo(
    () => (dragPos ? { ...topo, nodes: topo.nodes.map((n) => (n.id === dragPos.id ? { ...n, x: dragPos.x, y: dragPos.y } : n)) } : topo),
    [topo, dragPos],
  );
  const view: Topology = useMemo(() => {
    const topo = liveTopo;
    if (!diff || !snapshot) return topo;
    // Los equipos que ya no están usan la posición del snapshot; si quedan encima de uno
    // actual se corren a la derecha para que ambos se lean.
    const placed = [...topo.nodes];
    const ghosts = diff.removedNodes.map((n) => {
      const g = { ...n, explored: false };
      while (placed.some((o) => Math.abs(o.x - g.x) < W + 10 && Math.abs(o.y - g.y) < H + 10)) g.x += W + 30;
      placed.push(g);
      return g;
    });
    return { nodes: [...topo.nodes, ...ghosts], links: [...topo.links, ...diff.removedLinks] };
  }, [diff, snapshot, liveTopo]);
  // Filtros: solo cambian lo que se dibuja; el diagrama guardado, las rutas y las exportaciones siguen completos.
  const shown = useMemo(() => filterView(view, filter), [view, filter]);
  const filtering = filterActive(filter);
  // Con la lectura de tráfico por consola, el estado de interfaz de "show interfaces" (dúplex, errores, estado) se suma al guardado.
  const checks = useMemo(() => linkChecks(topoData, traffic.live), [topoData, traffic.live]);
  // Puertos activos sin vecino: un nodo virtual por equipo, del lado opuesto a sus vecinos.
  const l2 = useMemo(() => (ui.l2 ? unknownL2(topoData) : null), [ui.l2, topoData]);
  const l2Cache = useRef(new Map<string, L2Geo>());
  const l2Nodes = useMemo(() => {
    if (!l2?.size) return [];
    // Con muchos equipos se dibuja solo el del seleccionado: cientos de nodos virtuales tapan el mapa
    // y duplican lo que el navegador tiene que pintar.
    const only = l2.size > MAX_L2_NODES ? selected : null;
    if (l2.size > MAX_L2_NODES && !only) return [];
    const pos = new Map(shown.nodes.map((n) => [n.id, n]));
    const pull = new Map<string, [number, number]>();
    const add = (id: string, o: TopoNode | undefined) => {
      const n = pos.get(id);
      if (!n || !o) return;
      const [x, y] = pull.get(id) ?? [0, 0];
      pull.set(id, [x + o.x - n.x, y + o.y - n.y]);
    };
    for (const l of shown.links) {
      if (l2.has(l.a)) add(l.a, pos.get(l.b));
      if (l2.has(l.b)) add(l.b, pos.get(l.a));
    }
    const out: L2Geo[] = [];
    const next = new Map<string, L2Geo>();
    for (const [id, info] of l2) {
      if (only && id !== only) continue;
      const n = pos.get(id);
      if (!n) continue;
      const [dx, dy] = pull.get(id) ?? [0, 0];
      const len = Math.hypot(dx, dy);
      const [ux, uy] = len ? [-dx / len, -dy / len] : [0, 1];
      const x = n.x + ux * 130;
      const y = n.y + uy * 95;
      // Mismo objeto si no se movió: su L2View no se redibuja.
      const prev = l2Cache.current.get(id);
      const v = prev && prev.x === x && prev.y === y && prev.from.x === n.x && prev.from.y === n.y && prev.info === info ? prev : { id, x, y, from: n, info };
      next.set(id, v);
      out.push(v);
    }
    l2Cache.current = next;
    return out;
  }, [l2, shown, selected]);
  const hits: SearchHit[] = useMemo(() => (searchOpen ? searchTopo(topoData, query) : []), [topoData, query, searchOpen]);
  const added = useMemo(() => new Set(diff?.addedLinks.map(linkKey)), [diff]);
  const removed = useMemo(() => new Set(diff?.removedLinks.map(linkKey)), [diff]);
  const ghostIds = useMemo(() => new Set(diff?.removedNodes.map((n) => n.id)), [diff]);
  const newIds = useMemo(() => new Set(diff?.addedNodes), [diff]);

  const route = useMemo(
    () => (path.from && path.to ? shortestPath(topo, path.from, path.to) : null),
    [path, topo],
  );
  const routeKeys = useMemo(() => new Set(route?.links.map(linkKey)), [route]);
  const routeNodes = useMemo(() => new Set(route?.nodes), [route]);

  // Geometría estable: un enlace cuyo trazo no cambió conserva su objeto y su LinkView no se redibuja.
  const geoCache = useRef(new Map<TopoLink, Geo>());
  const geometry = useMemo(() => {
    const prev = geoCache.current;
    const next = new Map<TopoLink, Geo>();
    const out = linkGeometry(shown, shown.links, PARALLEL_GAP).map((g0) => {
      const p = prev.get(g0.l);
      // La clave se conserva mientras el enlace sea el mismo con los mismos extremos: al arrastrar
      // un equipo la geometría se rehace en cada cuadro y no hay que normalizar los puertos de nuevo.
      const k = p && p.l.a === g0.l.a && p.l.b === g0.l.b && p.l.aPort === g0.l.aPort && p.l.bPort === g0.l.bPort ? p.k : linkKey(g0.l);
      const g: Geo = Object.assign(g0, { k });
      const keep = p && p.d === g.d && p.pair.length === g.pair.length ? p : g;
      next.set(g.l, keep);
      return keep;
    });
    geoCache.current = next;
    return out;
  }, [shown]);
  const shownById = useMemo(() => new Map(shown.nodes.map((n) => [n.id, n])), [shown.nodes]);
  const onIssue = useCallback((id: string) => {
    setSelected(id);
    setUi((u) => ({ ...u, panel: true, sec: { ...u.sec, atencion: true } }));
  }, []);
  /** Copia al portapapeles y lo confirma en el mensaje de la herramienta. */
  const copyText = (text: string, what: string) =>
    writeText(text)
      .then(() => setMsg(`${what} copiada: ${text.length > 80 ? `${text.slice(0, 79)}…` : text}`))
      .catch((e) => setMsg(`No se pudo copiar: ${String(e)}`));
  const [nodeMenu, setNodeMenu] = useState<Menu | null>(null);
  // Menú del equipo (clic derecho): la función cambia con el diagrama; NodeView recibe una estable.
  const nodeMenuRef = useRef<(e: React.MouseEvent<SVGGElement>, n: TopoNode) => void>(() => {});
  nodeMenuRef.current = (e, n) => {
    setSelected(n.id);
    const addrs = knownAddrs(n);
    setNodeMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...openMenuItems(n),
        [n.ip ? `Copiar IP (${n.ip})` : "Copiar IP (sin IP de gestión)", <Copy size={13} />, () => n.ip && copyText(n.ip, "IP"), !n.ip, undefined, true],
        ["Copiar nombre", <Copy size={13} />, () => copyText(n.name, "Nombre")],
        ["Copiar nombre e IP", <Copy size={13} />, () => copyText(n.ip ? `${n.name} ${n.ip}` : n.name, "Nombre e IP"), !n.ip],
        ...(addrs.length > 1 ? [[`Copiar sus ${addrs.length} direcciones`, <Copy size={13} />, () => copyText(addrs.join("\n"), "Direcciones")] as MenuItem] : []),
        ["Ver su vecindario", <ListFilter size={13} />, () => setFilter((f) => ({ ...f, hops: f.hops || 2, focus: n.id }))],
      ],
    });
  };
  const onNodeMenu = useCallback((e: React.MouseEvent<SVGGElement>, n: TopoNode) => nodeMenuRef.current(e, n), []);
  // Doble clic en un equipo = "Abrir terminal" (la acción principal del panel).
  const nodeOpenRef = useRef<(n: TopoNode) => void>(() => {});
  nodeOpenRef.current = (n) => openTerminal(n);
  const onNodeOpen = useCallback((n: TopoNode) => nodeOpenRef.current(n), []);
  const onNodeDown = useCallback((e: React.PointerEvent<SVGGElement>, n: TopoNode) => {
    const svg = e.currentTarget.ownerSVGElement as SVGSVGElement;
    svg.setPointerCapture(e.pointerId);
    // El tamaño en px del SVG se toma una vez: medirlo en cada movimiento forzaba un layout extra
    // del mapa por cuadro (el tamaño no cambia durante el arrastre; el viewBox sí puede).
    const r = svg.getBoundingClientRect();
    drag.current = { id: n.id, sx: e.clientX, sy: e.clientY, x: n.x, y: n.y, w: r.width, h: r.height };
    setSelected(n.id);
  }, []);

  // Última tasa por enlace (se recalcula una vez por lectura, no por cuadro).
  const linkRates = useMemo(() => {
    const m = new Map<string, LinkTraffic>();
    if (!trafficOn) return m;
    for (const l of topo.links) {
      const lt = linkTraffic(l, traffic.rates);
      if (lt) m.set(linkKey(l), lt);
    }
    return m;
  }, [trafficOn, traffic.rates, topo.links]);
  // Vista detallada (estilo previo): color continuo, flechas por sentido y animación en los carriles.
  // La vista por defecto es por excepción y no anima ni dibuja flechas.
  const detail = ui.detail;
  const arrowsOn = detail && ui.arrows;
  const animate = detail && ui.anim && ui.arrows && !reducedMotion && visible;
  /**
   * Píldoras del mapa. Por excepción: solo los enlaces altos (70 a 89 %), saturados (90 % o más) o
   * caídos llevan una sobre el centro de la línea, con el % de uso o "caído". En la vista detallada
   * llevan una todos los enlaces con tráfico (si "Rótulo" está activo). Los paralelos entre el mismo
   * par comparten una, con el agregado y el peor estado; el detalle por sentido va en la ficha.
   */
  const trafficPills = useMemo(() => {
    const pairKey = (l: TopoLink) => [l.a, l.b].sort().join("~");
    const pairs = new Map<string, { mids: Pt[]; keys: string[]; items: { g: Geo; lt?: LinkTraffic; level: LinkLevel }[] }>();
    for (const g of geometry) {
      const k = g.k;
      if (removed.has(k)) continue;
      const lt = linkRates.get(k);
      const level = linkLevelOf(checks.get(k), lt);
      const pk = pairKey(g.l);
      let e = pairs.get(pk);
      if (!e) pairs.set(pk, (e = { mids: [], keys: [], items: [] }));
      e.mids.push(g.mid);
      e.keys.push(k);
      if (level === "down" || (detail ? !!lt && ui.rates : level !== "normal")) e.items.push({ g, lt, level });
    }
    const out: Pill[] = [];
    for (const [pk, { mids, keys, items }] of pairs) {
      if (!items.length) continue;
      const worst = items.reduce((a, b) => (LEVEL_RANK[b.level] > LEVEL_RANK[a.level] || (LEVEL_RANK[b.level] === LEVEL_RANK[a.level] && (b.lt?.util ?? -1) > (a.lt?.util ?? -1)) ? b : a));
      const multi = items[0].g.pair.length > 1;
      const grp = multi ? linkGroup(shown, items[0].g.l, shownById) : undefined;
      const short = worst.level === "down" ? "caído" : worst.lt ? trafficShort(worst.lt) : "";
      const tone: Pill["tone"] = worst.level === "down" ? "down" : detail ? undefined : worst.level === "high" || worst.level === "saturated" ? worst.level : undefined;
      out.push({
        key: pk,
        x: mids.reduce((a, m) => a + m.x, 0) / mids.length,
        y: mids.reduce((a, m) => a + m.y, 0) / mids.length,
        text: multi ? `${grp ? `${grp} ×${items[0].g.pair.length}` : "máx"} · ${short}` : short,
        color: detail && ui.color && worst.lt ? UTIL_VAR[utilLevel(worst.lt.util)] : "var(--text)",
        tone,
        dim: !!route && !keys.some((k) => routeKeys.has(k)),
        keys,
      });
    }
    return out;
  }, [geometry, linkRates, checks, removed, route, routeKeys, detail, ui.color, ui.rates, shown, shownById]);
  /** Pares con píldora (todos sus enlaces): su rótulo de agregado ("Po1 ×2") ya va dentro de ella. */
  const pillPairs = useMemo(() => new Set(trafficPills.flatMap((p) => p.keys)), [trafficPills]);

  /**
   * Enlaces con tráfico, del más cargado al menos, solo para la animación de la vista detallada.
   * Sin posiciones: al arrastrar un equipo la geometría cambia en cada cuadro, pero las filas no, y
   * se devuelve el mismo arreglo para que la animación no se recalcule.
   */
  const rowsRef = useRef<TrafficRow[]>([]);
  const trafficRows = useMemo(() => {
    const rows: TrafficRow[] = [];
    if (!animate) return rows;
    for (const g of geometry) {
      const lt = linkRates.get(g.k);
      if (lt && !removed.has(g.k)) rows.push({ key: g.k, lt });
    }
    const peak = (lt: LinkTraffic) => Math.max(lt.ab ?? 0, lt.ba ?? 0);
    rows.sort((x, y) => (y.lt.util ?? -1) - (x.lt.util ?? -1) || peak(y.lt) - peak(x.lt));
    const prev = rowsRef.current;
    const same = prev.length === rows.length && prev.every((r, i) => r.key === rows[i].key && r.lt === rows[i].lt);
    if (!same) rowsRef.current = rows;
    return rowsRef.current;
  }, [animate, geometry, linkRates, removed]);
  /** Geometría a la vista, para ubicar el enlace que se elige en "Requieren atención" (sin un índice por cuadro). */
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  /**
   * Enlaces animados: solo los FLOW_MAX más cargados. Cada paso de la animación repinta el mapa, y
   * con cientos de enlaces animados una topología grande baja de 60 a pocos cuadros por segundo;
   * el resto conserva las flechas fijas.
   */
  const animKeys = useMemo(() => new Set(animate ? trafficRows.slice(0, FLOW_MAX).map((r) => r.key) : []), [animate, trafficRows]);

  /** Requieren atención: alto, saturado, caído o con problemas de interfaz, por severidad y luego uso. */
  const attention = useMemo(() => attentionRows(topoData, checks, linkRates, removed), [topoData, checks, linkRates, removed]);
  const attentionCount = useMemo(() => {
    let down = 0;
    let load = 0;
    let issues = 0;
    for (const r of attention) r.level === "down" ? down++ : r.level === "issues" ? issues++ : load++;
    return { down, load, issues };
  }, [attention]);
  const coverage = useMemo(() => checkCoverage(topoData, traffic.live), [topoData, traffic.live]);

  // Ficha del enlace: se arma solo para el enlace bajo el puntero (o enfocado). Las funciones leen
  // datos vigentes sin cambiar de identidad en cada arrastre: la ficha no depende de posiciones.
  const tips = useMemo(() => new TipStore(), []);
  tips.blocked = () => !!drag.current || !!endPan.current;
  useEffect(() => {
    if (!visible) tips.hide();
  }, [visible, tips]);
  const mapBox = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const detailsFor = useCallback(
    (keys: string[]): LinkDetail[] => {
      const v = viewRef.current;
      const byId = new Map(v.nodes.map((n) => [n.id, n]));
      const out: LinkDetail[] = [];
      const want = new Set(keys);
      for (const l of v.links) {
        const k = linkKey(l);
        if (!want.has(k)) continue;
        const st = removed.has(k) ? "removed" : added.has(k) ? "added" : null;
        out.push(linkDetail(v, l, { byId, lt: st ? undefined : linkRates.get(k), issues: st === "removed" ? undefined : checks.get(k), live: traffic.live, state: st }));
      }
      // Los peores primero (caído y saturado), como en la lista de atención.
      return out.sort((x, y) => LEVEL_RANK[y.level] - LEVEL_RANK[x.level]);
    },
    [checks, linkRates, removed, added, traffic.live],
  );
  /** Clic en "Requieren atención": resalta el enlace y lo centra (otro clic en el mismo lo suelta). */
  const focusLinkRef = useRef(focusLink);
  focusLinkRef.current = focusLink;
  const pickLink = useCallback((key: string) => {
    if (focusLinkRef.current === key) return setFocusLink(null);
    setFocusLink(key);
    const mid = geometryRef.current.find((g) => g.k === key)?.mid;
    if (!mid) return;
    setZoom((z) => Math.max(z, 1.4));
    setFocusReq(mid);
  }, []);
  // El enlace elegido dejó de estar a la vista: se suelta el resaltado.
  useEffect(() => {
    if (focusLink && !geometry.some((g) => g.k === focusLink)) setFocusLink(null);
  }, [focusLink, geometry]);

  // Sugerencias: se calculan del diagrama ya leído, sin comandos, y solo con su fuente activa.
  const suggestions = useMemo(() => collectSuggestions(topoData, sources, dismissed), [topoData, sources, dismissed]);
  const suggestionSources = TOPO_SOURCES.filter((s) => SUGGESTERS[s.id] && sourceOn(sources, s.id));
  const emptyHints = [
    sourceOn(sources, "descriptions") &&
      (topo.nodes.some((n) => n.ports && Object.keys(n.ports).length)
        ? "Ninguna descripción menciona un equipo sin enlace."
        : 'Descubre con "Estado de puertos" para leer las descripciones.'),
    macOn &&
      (topo.nodes.some((n) => n.macs && Object.keys(n.macs).length)
        ? "Ningún puerto sin enlace tiene HSRP/VRRP, MAC de equipo de red o varias MAC."
        : 'Pulsa "Descubrir vecinos" para leer las tablas MAC y ARP.'),
  ].filter((x): x is string => !!x);

  const box = useMemo(() => {
    if (!shown.nodes.length) return { x: 0, y: 0, w: 800, h: 400 };
    // En mapas grandes el nodo L2 es solo el del seleccionado: no cuenta para el encuadre, que si
    // no cambiaría (y se redibujaría todo el mapa) con cada selección.
    const l2Box = l2 && l2.size > MAX_L2_NODES ? [] : l2Nodes;
    const xs = [...shown.nodes.map((n) => n.x), ...l2Box.map((n) => n.x)];
    const ys = [...shown.nodes.map((n) => n.y), ...l2Box.map((n) => n.y)];
    const pad = 30;
    const x = Math.min(...xs) - W / 2 - pad;
    const y = Math.min(...ys) - H / 2 - pad;
    return { x, y, w: Math.max(...xs) - x + W / 2 + pad, h: Math.max(...ys) - y + H / 2 + pad };
  }, [shown.nodes, l2Nodes, l2]);

  /** Suelta el equipo: la posición final se guarda en el diagrama una sola vez. */
  const endDrag = () => {
    drag.current = null;
    if (!dragPos) return;
    const { id, x, y } = dragPos;
    onTopo((t) => ({ ...t, nodes: t.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }));
    setDragPos(null);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    // El SVG se ajusta al contenedor manteniendo proporción: manda el eje más ajustado.
    const scale = Math.max(box.w / d.w, box.h / d.h);
    const x = d.x + (e.clientX - d.sx) * scale;
    const y = d.y + (e.clientY - d.sy) * scale;
    setDragPos({ id: d.id, x, y });
  };

  const exportFile = async (ext: "svg" | "csv" | "drawio", content: string) => {
    const name = ext === "drawio" ? "draw.io" : ext.toUpperCase();
    const dest = await save({ defaultPath: `topologia.${ext}`, filters: [{ name, extensions: [ext] }] });
    if (!dest) return;
    await invoke("save_text", { dest, content }).then(() => setMsg(`Guardado: ${dest}`)).catch((e) => setMsg(String(e)));
  };

  /**
   * draw.io con los íconos de red de su biblioteca Cisco, zonas por carpeta de la sesión guardada
   * y, con el ciclo de vida activo, la etapa EoL bajo cada equipo.
   */
  const exportDrawioIcons = async () => {
    const [{ toDrawioIcons }, life] = await Promise.all([
      import("../../lib/topoDrawio"),
      lifecycle ? import("../../lib/lifecycle").then(async (L) => ({ L, db: await L.loadLifecycle() })) : null,
    ]);
    const zones = new Map<string, string>();
    const notes = new Map<string, string>();
    const today = new Date().toISOString().slice(0, 10);
    for (const n of topo.nodes) {
      const folder = savedFor(n)?.folder?.trim();
      if (folder) zones.set(n.id, folder);
      const model = life && modelFromPlatform(n.platform);
      if (life && model) {
        const level = life.L.lifeLevel(life.L.findLifecycle(life.db, model), today);
        if (level !== "none") notes.set(n.id, life.L.LIFE_LABEL[level]);
      }
    }
    await exportFile("drawio", toDrawioIcons(topo, { zones, notes, l2: ui.l2 }));
  };

  /** Sesión guardada que corresponde al equipo (misma IP o mismo nombre). */
  const savedFor = (n: TopoNode) =>
    sessions.find((s) => (s.type === "ssh" || s.type === "telnet") && ((n.ip && s.host === n.ip) || nodeId(s.name) === n.id));

  const follow = (n: TopoNode) => {
    const saved = savedFor(n);
    const known = terminals.map((t) => t.connId);
    if (saved) {
      setPendingFollow({ sessionId: saved.id, host: saved.host, known });
      onOpenSession(saved);
      setMsg(`Abriendo la sesión guardada "${saved.name}": autentícate en su pestaña. Al conectar queda elegida aquí; vuelve y pulsa "Descubrir vecinos".`);
      return;
    }
    if (!term || !n.ip) return;
    // La IP viene de un vecino (dato del equipo): solo una IPv4/IPv6 literal, nunca un nombre ni "-o…".
    if (!isIpv4(n.ip) && !isIpv6(n.ip)) {
      setMsg(`IP de gestión no válida: ${n.ip.slice(0, 64)}`);
      return;
    }
    const base = term.session;
    // Solo lo necesario para llegar al vecino: usuario, llave, jump host y compatibilidad. No se copian
    // comandos al conectar, túneles ni argumentos extra hacia una IP que informó otro equipo.
    const ssh = proto === "ssh";
    setPendingFollow({ host: n.ip, known });
    onOpenSession({
      id: "",
      name: n.name,
      type: proto,
      host: n.ip,
      port: ssh ? (base.type === "ssh" ? base.port : 22) : base.type === "telnet" ? base.port : 23,
      username: ssh ? base.username : undefined,
      identity_file: ssh ? base.identity_file : undefined,
      jump_host: ssh ? base.jump_host : undefined,
      legacy_ssh: ssh ? base.legacy_ssh : undefined,
      highlight: base.highlight,
      created_at: new Date().toISOString(),
    });
    setMsg(`Abriendo ${proto.toUpperCase()} a ${n.name}: autentícate en su pestaña. Al conectar queda elegida aquí; vuelve y pulsa "Descubrir vecinos".`);
  };

  const termRoute = term?.tabId ? routes[term.tabId] : undefined;

  const liveRef = useRef({ terminals, tabs, onConfirm, onFocusTab });
  liveRef.current = { terminals, tabs, onConfirm, onFocusTab };
  const syncRuns = () => setHopRunning([...hopRuns.current.keys()]);

  /** Pestaña abierta (o caída) de la sesión con la IP del equipo: sirve de pivote candidato por IP. */
  const addrsOf = (id: string) => {
    const n = topoRef.current.nodes.find((x) => x.id === id);
    return n ? knownAddrs(n) : [];
  };

  /** Credencial a escribir en el "Password:" de un paso: la guardada del vecino o, si se pidió, la del pivote. */
  const credFor = (st: { ip: string; user?: string }, pivotOk: boolean): "saved" | "pivot" | undefined => {
    if (!skipSavedCred && st.user && savedHops.has(hopCredKey(st.ip, st.user))) return "saved";
    if (usePivotCred && pivotOk) return "pivot";
    return undefined;
  };

  /**
   * Salto encadenado. Sin `tab`, abre una pestaña NUEVA en segundo plano que reproduce la ruta completa
   * (conecta la sesión del pivote, salta a h1, a h2, …, hasta el destino): las pestañas que ya estaban en
   * cada equipo de la ruta quedan intactas. Con `tab`, sigue en esa pestaña desde donde está.
   * Topología sigue a la vista: el avance se ve en el panel y el usuario va a la pestaña cuando quiera.
   */
  const runHop = (full: TabRoute, tab?: TerminalRef) => {
    if (!full.steps.length) return;
    const target = full.steps[full.steps.length - 1];
    if ([...hopRuns.current.values()].some((r) => r.route.steps.length && r.route.steps[r.route.steps.length - 1].ip === target.ip && r.job.phase !== "done")) {
      setMsg(`Ya hay un salto a ${target.name} en curso.`);
      return;
    }
    const pivotOk = full.session.save_password === true && !!full.session.id;
    const base = tab ? Math.max(0, full.steps.length - 1) : 0;
    const steps = full.steps.slice(base).map((st) => ({ cmd: st.cmd, to: st.prompt ?? st.name, ip: st.ip, user: st.user, cred: credFor(st, pivotOk) }));
    let tabId = tab?.tabId;
    let pivot: string | undefined;
    if (tab) {
      const seen = classifyHopScreen(tab.screen?.(8) ?? "");
      pivot = seen.kind === "prompt" ? seen.name : undefined;
      if (!tabId) return;
      setRoutes((m) => ({ ...m, [tabId!]: m[tabId!] ?? truncateRoute(full, base) }));
    } else {
      pivot = full.origin;
      // Nombre de la pestaña "N vía M"; el tooltip trae la ruta completa (nombre de la sesión).
      const id = onOpenSession(hopTabSession(full.session, routeTooltip(full).slice(0, 120)), { background: true, title: routeTitle(full) });
      if (!id) {
        setMsg("No se pudo abrir la pestaña del salto.");
        return;
      }
      tabId = id;
      setRoutes((m) => ({ ...m, [id]: truncateRoute(full, 0) }));
    }
    const job = newHopChain({ steps, pivot, now: Date.now() });
    hopRuns.current.set(tabId, { tabId, job, route: full, base, pivotCred: pivotOk, openedAt: Date.now(), inplace: !!tab });
    syncRuns();
    // Las casillas de credencial valen para este salto: no se recuerdan.
    setUsePivotCred(false);
    setSkipSavedCred(false);
    const used = steps.filter((s) => s.cred).length;
    setMsg(
      tab
        ? `Esperando el prompt de ${pivot ?? "la pestaña"} para saltar a ${target.name}.`
        : `Abriendo ${full.steps.length > 1 ? "la ruta" : "el salto"} ${routeTooltip(full)} en una pestaña nueva, en segundo plano.${used ? ` Se escribirá la contraseña de ${used === 1 ? "1 equipo" : `${used} equipos`} (un intento cada uno).` : ""}`,
    );
  };

  // Avance de los saltos: lee la pantalla de cada pestaña y envía, pregunta, escribe credenciales o avisa.
  useEffect(() => {
    if (!hopRunning.length) return;
    const setView = (r: HopRun, patch: Partial<HopView>) =>
      setHopViews((vs) => {
        const cur = vs.find((v) => v.tabId === r.tabId);
        const next: HopView = {
          tabId: r.tabId,
          target: r.route.steps[r.route.steps.length - 1]?.name ?? "",
          route: routeNames(r.route),
          step: r.job.index + 1,
          total: r.job.steps.length,
          waiting: "prompt",
          status: "running",
          text: "",
          ...cur,
          ...patch,
        };
        // Lo que se esperaba ya cambió: el aviso anterior (p. ej. "escribe la contraseña") deja de valer.
        if (cur && patch.waiting && patch.waiting !== cur.waiting && patch.text === undefined) next.text = "";
        return cur && JSON.stringify(cur) === JSON.stringify(next) ? vs : [...vs.filter((v) => v.tabId !== r.tabId), next];
      });
    const finish = (r: HopRun, view: Partial<HopView>) => {
      hopRuns.current.delete(r.tabId);
      syncRuns();
      setView(r, { ...view, until: Date.now() + (view.status === "failed" ? 60_000 : 20_000) });
    };
    const reached = (r: HopRun, a: { step: number; at: string }) =>
      setRoutes((m) => {
        const upto = truncateRoute(r.route, r.base + a.step + 1);
        // Mismo equipo (dominio, mayúsculas): se registra con lo que mostró su prompt. Si el prompt no coincide con el
        // diagrama (guion bajo, otro hostname), el nombre del diagrama se mantiene y el prompt queda como alias.
        const steps = upto.steps.map((st, i) =>
          i !== upto.steps.length - 1 ? st : nodeId(a.at) === nodeId(st.name) ? { ...st, name: a.at, prompt: undefined } : { ...st, prompt: a.at },
        );
        return { ...m, [r.tabId]: { ...upto, steps } };
      });
    const apply = (r: HopRun, t: TerminalRef, a: HopAction) => {
      const id = t.connId;
      const st = r.job.steps[(a as { step?: number }).step ?? r.job.index];
      if (a.kind === "send") {
        invoke("write", { id, data: a.data }).catch((e) => setMsg(String(e)));
        setMsg(`Enviado "${r.job.cmd}" en la pestaña "${t.name}"${r.job.steps.length > 1 ? ` (paso ${a.step + 1} de ${r.job.steps.length})` : ""}: ${st?.cred ? "se escribe la contraseña sola" : `autentícate en ${r.job.neighbor} si lo pide`}.`);
        // El pivote se registra con el nombre que mostró su prompt.
        if (a.step === 0 && !r.inplace && a.from && nodeId(a.from) !== nodeId(r.route.origin))
          setRoutes((m) => (m[r.tabId] ? { ...m, [r.tabId]: { ...m[r.tabId], origin: a.from } } : m));
      } else if (a.kind === "notify") {
        setMsg(a.text);
        setView(r, { text: a.text });
      } else if (a.kind === "ask")
        liveRef.current.onConfirm({
          title: `¿Aceptar la llave de ${r.job.neighbor}?`,
          message: `${a.line}\n\n${r.job.pivot ?? "El equipo de partida"} no conocía a ${r.job.neighbor} (${st?.ip ?? ""}). Compara la huella en la pestaña antes de aceptar. Si ya contestaste ahí, cancela.`,
          label: "Aceptar y continuar",
          defaultCancel: true,
          action: () => {
            // La pantalla pudo cambiar mientras se decidía: solo se contesta si la pregunta sigue ahí.
            const cur = liveRef.current.terminals.find((x) => x.connId === id);
            const s = classifyHopScreen(afterEcho(cur?.screen?.(30) ?? "", r.job.cmd));
            if (s.kind === "hostkey") invoke("write", { id, data: `${s.answer}\r` }).catch((e) => setMsg(String(e)));
          },
        });
      else if (a.kind === "fill") {
        // La contraseña la escribe el backend directo en la conexión (nunca pasa por aquí) y solo con el pedido a la vista.
        if (!st?.ip) {
          r.job = hopCredResult(r.job, false);
          return;
        }
        invoke("hop_type_password", {
          conn: id,
          source: a.source,
          pivotId: r.route.session.id || null,
          ip: st.ip,
          user: st.user ?? "",
          cmd: r.job.cmd,
          token: `${a.token}|${r.tabId}`,
        })
          .then(() => {
            r.job = hopCredResult(r.job, true);
            refreshCreds();
          })
          .catch((e) => {
            r.job = hopCredResult(r.job, false);
            setMsg(`No se escribió la contraseña de ${r.job.neighbor}: ${String(e)} Escríbela en la pestaña.`);
          });
      } else if (a.kind === "cred-rejected") {
        setMsg(a.text);
        setView(r, { text: a.text });
        if (st?.ip) setCredAlerts((l) => [...l.filter((x) => !(x.tabId === r.tabId && x.ip === st.ip)), { tabId: r.tabId, to: r.job.neighbor, ip: st.ip!, user: st.user ?? "", source: a.source }]);
      } else if (a.kind === "step") {
        reached(r, a);
        setView(r, { step: a.step + 2, text: `${a.at} alcanzado.` });
      } else if (a.kind === "done") {
        reached(r, { step: r.job.steps.length - 1, at: a.at });
        const last = r.route.steps[r.route.steps.length - 1];
        // Ya se llegó a este equipo saltando: la próxima vez "Abrir terminal" va por la ruta.
        if (last) setUi((u) => ({ ...u, pivot: { ...u.pivot, [nodeId(last.name)]: true, [nodeId(a.at)]: true } }));
        setConnId(id);
        const note = a.mismatch ? ` ${a.mismatch}` : "";
        setMsg(`${a.at} conectado en la pestaña "${t.name}" y elegido en "Equipo": pulsa "Descubrir vecinos" para seguir la ruta.${note}`);
        if (a.manual.length)
          setSaveOffers((l) => [...l.filter((o) => !a.manual.some((m) => m.ip === o.ip && m.user === o.user)), ...a.manual.map((m) => ({ ...m, update: savedHops.has(hopCredKey(m.ip, m.user)) }))]);
        finish(r, { status: "done", waiting: "done", text: `${a.at} conectado${note}` });
      } else if (a.kind === "fail") {
        // El salto no llegó: la pestaña queda en el último equipo alcanzado (los pasos anteriores ya están en su ruta).
        t.notice?.(a.reason);
        setMsg(a.reason);
        finish(r, { status: "failed", waiting: "failed", text: a.reason });
      }
    };
    const timer = window.setInterval(() => {
      const now = Date.now();
      for (const r of [...hopRuns.current.values()]) {
        const { terminals: terms, tabs: briefs } = liveRef.current;
        const t = terms.find((x) => x.tabId === r.tabId);
        if (!t) {
          const brief = briefs.find((b) => b.tabId === r.tabId);
          const to = r.route.steps[r.route.steps.length - 1]?.name ?? "";
          if (!brief) {
            setMsg(`La pestaña del salto a ${to} se cerró antes de terminar.`);
            finish(r, { status: "failed", waiting: "failed", text: "La pestaña se cerró antes de terminar el salto." });
          } else if (brief.status === "closed" || now - r.openedAt > 60_000) {
            const why = `La pestaña hacia ${r.route.origin} no llegó a conectar: no se envió el salto a ${to}.`;
            setMsg(why);
            finish(r, { status: "failed", waiting: "failed", text: why });
          } else setView(r, { waiting: "opening" as HopWaiting, text: `Conectando con ${r.route.origin}…` });
          continue;
        }
        // Sin acceso a la pantalla no se puede seguir el salto: se corta pasado el mismo plazo del prompt.
        if (!t.screen) {
          if (now - r.job.startedAt > PROMPT_WAIT_MS) {
            setMsg(`No se pudo leer la pestaña de ${r.route.steps[r.route.steps.length - 1]?.name}: se canceló el salto.`);
            finish(r, { status: "failed", waiting: "failed", text: "No se pudo leer la pestaña." });
          }
          continue;
        }
        const screen = t.screen(30);
        const step = stepHop(r.job, screen, now);
        r.job = step.job;
        for (const a of step.actions) apply(r, t, a);
        if (hopRuns.current.has(r.tabId)) setView(r, { waiting: hopWaiting(r.job, screen), step: r.job.index + 1, total: r.job.steps.length });
      }
      // Los terminados se quitan solos pasado su tiempo.
      setHopViews((vs) => (vs.some((v) => v.until && v.until < now) ? vs.filter((v) => !v.until || v.until >= now) : vs));
    }, 400);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hopRunning.length]);

  // Las pestañas cerradas dejan de tener ruta; las demás se ajustan a lo que dice su prompt (un "exit" a mano).
  useEffect(() => {
    const ids = new Set(tabs.map((b) => b.tabId));
    setRoutes((m) => (Object.keys(m).some((k) => !ids.has(k)) ? Object.fromEntries(Object.entries(m).filter(([k]) => ids.has(k))) : m));
  }, [tabs]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const cur = routesRef.current;
      let changed: Record<string, TabRoute> | null = null;
      for (const t of liveRef.current.terminals) {
        const r = t.tabId ? cur[t.tabId] : undefined;
        if (!r || !t.screen || hopRuns.current.has(t.tabId!)) continue;
        const fixed = reconcileRoute(r, t.screen(8));
        if (fixed !== r) (changed ??= { ...cur })[t.tabId!] = fixed;
      }
      if (changed) setRoutes(changed);
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  // Los avisos de saltos terminados se quitan solos (los que fallaron duran más).
  useEffect(() => {
    const next = Math.min(...hopViews.filter((v) => v.until).map((v) => v.until!));
    if (!Number.isFinite(next)) return;
    const t = window.setTimeout(() => setHopViews((vs) => vs.filter((v) => !v.until || v.until > Date.now())), Math.max(500, next - Date.now()));
    return () => window.clearTimeout(t);
  }, [hopViews]);

  /** Vuelve al equipo anterior de la ruta (exit en la misma pestaña). */
  const hopBack = () => {
    if (!term?.tabId || !termRoute?.steps.length) return;
    invoke("write", { id: term.connId, data: "exit\r" }).catch((e) => setMsg(String(e)));
    const tabId = term.tabId;
    setRoutes((m) => ({ ...m, [tabId]: truncateRoute(termRoute, termRoute.steps.length - 1) }));
    const names = routeNames(termRoute);
    setMsg(`Enviado "exit": esa pestaña vuelve a ${names[names.length - 2]}.`);
  };

  // ---------- Abrir terminal: un botón que hace lo correcto ----------

  /** Equipo desde el que se arma cada comando de salto: su fabricante (por plataforma) y, si no se sabe, el elegido arriba. */
  const cmdFor = (from: { platform?: string } | undefined, to: { ip?: string }, session: Session) => {
    if (!to.ip) return null;
    const v = vendorOfPlatform(from?.platform) ?? vendor;
    const user = (hopUser || session.username || "").trim();
    const cmd = hopCommand(v, isNxos(from?.platform) ? "nxos" : session.platform, proto, user, to.ip);
    return cmd ? { cmd, user: proto === "ssh" && v !== "huawei" ? user : "" } : null;
  };

  /** Plan de "Abrir terminal" para un equipo con el estado de este momento (pestañas, rutas, sesiones guardadas). */
  const computePlan = (n: TopoNode) => {
    const { terminals: terms, tabs: briefs } = liveRef.current;
    const rts = routesRef.current;
    const planTabs: PlanTab[] = [];
    for (const t of terms) {
      if (!t.tabId) continue;
      const route = rts[t.tabId];
      const device = tabDevice(t, route);
      if (!device) continue;
      const prompt = classifyHopScreen(t.screen?.(8) ?? "").kind === "prompt";
      planTabs.push({ tabId: t.tabId, name: t.name, session: t.session, status: "connected", route, device, free: prompt && !hopRuns.current.has(t.tabId) });
    }
    const live = new Set(terms.map((t) => t.tabId));
    for (const b of briefs) {
      if (b.status !== "closed" || live.has(b.tabId)) continue;
      const route = rts[b.tabId];
      const name = route ? routeNames(route)[routeNames(route).length - 1] : b.host && knownAddrs(n).includes(b.host) ? n.name : b.name;
      planTabs.push({ tabId: b.tabId, name: b.name, session: b.session, status: "closed", route, device: { name, verified: false, index: route?.steps.length ?? 0 }, free: false });
    }
    const saved = new Map<string, Session>();
    for (const x of topoRef.current.nodes) {
      const s = savedFor(x);
      if (s) saved.set(x.id, s);
    }
    const directOk = !!saved.get(n.id) || (!!n.ip && isIpLiteral(n.ip) && !!term);
    return planOpen({
      target: planNode(n),
      nodes: topoRef.current.nodes.map(planNode),
      links: topoRef.current.links,
      tabs: planTabs,
      saved,
      cameFrom: cameFromRef.current,
      needsPivot: !!ui.pivot[n.id],
      directOk,
      cmdFor,
    });
  };

  /** Ejecuta una de las formas de abrir el equipo. */
  const runChoice = (c: OpenChoice, n: TopoNode) => {
    if (c.kind === "focus" && c.tabId) return onFocusTab(c.tabId);
    if (c.kind === "direct") {
      setUi((u) => (u.pivot[n.id] ? { ...u, pivot: Object.fromEntries(Object.entries(u.pivot).filter(([k]) => k !== n.id)) } : u));
      return follow(n);
    }
    if ((c.kind === "route" || c.kind === "shortest") && c.route) {
      if (!isReplayable(c.route.session)) return setMsg("La sesión del pivote no es SSH ni Telnet: no se puede reproducir en otra pestaña.");
      return runHop(c.route);
    }
    if (c.kind === "inplace" && c.route && c.tabId) {
      const t = liveRef.current.terminals.find((x) => x.tabId === c.tabId);
      if (!t) return setMsg("Esa pestaña ya no está conectada.");
      return runHop(c.route, t);
    }
    if (c.kind === "reconnect" && c.tabId) {
      const r = routesRef.current[c.tabId];
      // Una pestaña de salto reconectaría al pivote y perdería la ruta: se reproduce la ruta en una nueva.
      if (r?.steps.length) return runHop(r);
      return onReconnectTab(c.tabId);
    }
  };
  /** Doble clic o menú: la acción principal del equipo. */
  const openTerminal = (n: TopoNode) => {
    const p = computePlan(n);
    if (!p.primary) return setMsg(p.reason ?? "No hay forma de abrir una terminal en este equipo.");
    runChoice(p.primary, n);
  };
  /** Las alternativas del equipo como ítems de menú, más la marca "solo por un vecino". */
  const openMenuItems = (n: TopoNode): MenuItem[] => {
    const p = computePlan(n);
    const items: MenuItem[] = [];
    if (p.primary) items.push(["Abrir terminal", <SquareTerminal size={13} />, () => runChoice(p.primary!, n), false, undefined, false]);
    for (const a of p.alternatives) items.push([a.label, <Route size={13} />, () => runChoice(a, n), false, undefined, false]);
    if (!p.primary && !p.alternatives.length) items.push([p.reason ?? "Sin forma de abrirlo", <SquareTerminal size={13} />, () => {}, true]);
    const marked = !!ui.pivot[n.id];
    items.push([
      marked ? "Quitar la marca «solo por un vecino»" : "Marcar: no llego directo desde mi PC",
      <Route size={13} />,
      () => setUi((u) => ({ ...u, pivot: marked ? Object.fromEntries(Object.entries(u.pivot).filter(([k]) => k !== n.id)) : { ...u.pivot, [n.id]: true } })),
      false,
      undefined,
      true,
    ]);
    return items;
  };
  /** Estado de cada equipo de una ruta en el panel: con pestaña conectada (se enfoca), caída o sin pestaña. */
  const crumbState = (name: string): { state: "connected" | "down" | "none"; tabId?: string } => {
    const id = nodeId(name);
    const { terminals: terms, tabs: briefs } = liveRef.current;
    const hit = tabAtDevice(id, addrsOf(id), terms, routesRef.current);
    if (hit?.tab.tabId) return { state: "connected", tabId: hit.tab.tabId };
    const down = briefs.find((b) => b.status === "closed" && routesRef.current[b.tabId] && nodeId(routeNames(routesRef.current[b.tabId]).slice(-1)[0]) === id);
    return down ? { state: "down", tabId: down.tabId } : { state: "none" };
  };

  const saveSnapshot = () => {
    const name = snapName?.trim() || `Topología ${new Date().toLocaleString()}`;
    const snap: TopoSnapshot = { id: `s${Date.now()}`, name, ts: Date.now(), topo };
    const save = () => {
      onSnapshots([snap, ...snapshots].slice(0, MAX_SNAPSHOTS));
      setSnapName(null);
      setMsg(`Snapshot guardado: ${name}`);
    };
    // Sobre el tope se descarta el más antiguo: se avisa cuál antes de guardar.
    const dropped = snapshots.slice(MAX_SNAPSHOTS - 1);
    if (dropped.length)
      onConfirm({
        title: "¿Guardar y eliminar el snapshot más antiguo?",
        message: `Se guardan hasta ${MAX_SNAPSHOTS} snapshots. Al guardar "${name}" se elimina ${dropped.length === 1 ? "el más antiguo" : `los ${dropped.length} más antiguos`}: ${dropped.map((d) => `"${d.name}"`).join(", ")}.`,
        label: "Guardar",
        danger: true,
        defaultCancel: true,
        action: save,
      });
    else save();
  };

  /** Aplica una edición manual: si falla, muestra el error en el formulario o en el mensaje. */
  const apply = (r: TopoResult, ok: string, onDone?: () => void) => {
    if (!r.topo) {
      if (form) setFormErr(r.error);
      else setMsg(r.error);
      return false;
    }
    onTopo(r.topo);
    setMsg(ok);
    setFormErr("");
    onDone?.();
    return true;
  };

  const submitForm = () => {
    if (!form) return;
    if (form.kind === "node") {
      const input = { name: form.name, ip: form.ip, platform: form.platform };
      const r = form.editId ? updateManualNode(topo, form.editId, input) : addManualNode(topo, input);
      apply(r, form.editId ? "Equipo actualizado" : `Equipo "${form.name.trim()}" agregado`, () => {
        setForm(null);
        setSelected(nodeId(form.name));
      });
    } else {
      const input = { a: form.a, aPort: form.aPort, b: form.b, bPort: form.bPort };
      const r = form.edit ? updateManualLink(topo, form.edit, input) : addManualLink(topo, input);
      apply(r, form.edit ? "Enlace actualizado" : "Enlace manual agregado", () => setForm(null));
    }
  };

  const accept = (s: LinkSuggestion) => apply(acceptSuggestion(topo, s), `Enlace confirmado: ${node(s.a)?.name ?? s.a} ${s.aPort} ↔ ${s.target}`);

  const pathText = route ? pathToText(topo, route) : "";
  const nodesByName = useMemo(() => [...topo.nodes].sort((a, b) => a.name.localeCompare(b.name)), [topo.nodes]);

  // Detalle a demanda: al seleccionar un equipo se abre su sección.
  useEffect(() => {
    if (selected) setOpen("detalle", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const formKey = form ? (form.kind === "node" ? `n:${form.editId ?? ""}` : `l:${form.edit ? linkKey(form.edit) : ""}`) : "";
  // Un formulario manual (nuevo o editar desde Detalle) abre su sección y la deja a la vista.
  useEffect(() => {
    if (!form) return;
    setOpen("manual", true);
    requestAnimationFrame(() => manualRef.current?.scrollIntoView({ block: "nearest" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey]);

  // La primera vez que aparecen sugerencias (de 0 a más de 0) la sección se despliega sola.
  const autoOpened = useRef(false);
  const prevCount = useRef(0);
  useEffect(() => {
    if (!autoOpened.current && prevCount.current === 0 && suggestions.length > 0) {
      autoOpened.current = true;
      setOpen("sugerencias", true);
    }
    prevCount.current = suggestions.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions.length]);

  const showSuggestions = () => {
    setUi((u) => ({ ...u, panel: true, sec: { ...u.sec, sugerencias: true } }));
    requestAnimationFrame(() => suggestionsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  const fit = () => {
    setZoom(1);
    scroller.current?.scrollTo({ left: 0, top: 0 });
  };

  /** Selecciona un equipo, acerca y lo centra en la vista (si un filtro lo oculta, se quitan los filtros). */
  const focusOn = (id: string) => {
    if (!shown.nodes.some((n) => n.id === id)) setFilter(NO_FILTER);
    setSelected(id);
    setZoom((z) => Math.max(z, 1.6));
    setFocusReq(id);
  };
  // Se centra después del render con el zoom nuevo (el SVG ya tiene su tamaño final).
  useEffect(() => {
    if (!focusReq) return;
    setFocusReq(null);
    const el = scroller.current;
    const n = typeof focusReq === "string" ? shown.nodes.find((x) => x.id === focusReq) : focusReq;
    if (!el || !n) return;
    const w = el.clientWidth * zoom;
    const h = el.clientHeight * zoom;
    const k = Math.min(w / box.w, h / box.h);
    const left = (w - box.w * k) / 2 + (n.x - box.x) * k - el.clientWidth / 2;
    const top = (h - box.h * k) / 2 + (n.y - box.y) * k - el.clientHeight / 2;
    el.scrollTo({ left, top, behavior: reducedMotion ? "auto" : "smooth" });
  }, [focusReq, shown, zoom, box, reducedMotion]);

  // Zoom con pellizco (touchpad) o Ctrl/⌘ + rueda, hacia el punto bajo el puntero.
  // Un pellizco o la rueda entregan varios eventos por cuadro: se junta todo en un redibujo por
  // cuadro (cada uno relayouta el mapa completo al cambiar el tamaño del SVG).
  const zoomFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(zoomFrame.current), []);
  const zoomRef = useRef(zoom);
  // Con un redibujo pendiente, el valor que manda es el del último evento, no el del estado.
  if (!zoomFrame.current) zoomRef.current = zoom;
  const zoomAnchor = useRef<{ cx: number; cy: number; sx: number; sy: number; from: number } | null>(null);
  const zoomAt = useCallback((next: number, cx: number, cy: number) => {
    const el = scroller.current;
    const from = zoomRef.current;
    const to = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    if (!el || Math.abs(to - from) < 0.001) return;
    // Varios eventos antes de redibujar (lo normal en un touchpad): el ancla parte del último zoom dibujado.
    const pending = zoomAnchor.current;
    zoomAnchor.current = pending ? { ...pending, cx, cy } : { cx, cy, sx: el.scrollLeft, sy: el.scrollTop, from };
    zoomRef.current = to;
    if (!zoomFrame.current) {
      zoomFrame.current = requestAnimationFrame(() => {
        zoomFrame.current = 0;
        setZoom(zoomRef.current);
      });
    }
  }, []);
  // El dibujo crece en proporción al zoom: se corre el scroll para que el punto bajo el puntero no se mueva.
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    const el = scroller.current;
    if (!a || !el) return;
    zoomAnchor.current = null;
    const f = zoom / a.from;
    el.scrollLeft = (a.sx + a.cx) * f - a.cx;
    el.scrollTop = (a.sy + a.cy) * f - a.cy;
  }, [zoom]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const local = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      return [x - r.left, y - r.top] as const;
    };
    // Rueda vertical: zoom anclado al puntero, como un mapa, sin distinguir mouse de touchpad (no
    // hay forma fiable: Magic Mouse y los mouse con desplazamiento suave dan deltas continuos).
    // Pellizco en Chromium, WebView2 y WebKit: rueda con ctrlKey. Se desplaza con Shift + rueda, con
    // movimiento horizontal del touchpad, o arrastrando el fondo.
    let gesturing = false;
    // Último puntero sobre el mapa: los gestos de WebKit no siempre traen clientX/clientY.
    let pointer: [number, number] | null = null;
    const onMove = (e: PointerEvent) => (pointer = [e.clientX, e.clientY]);
    const onWheel = (e: WheelEvent) => {
      const intent = wheelIntent(e);
      if (intent === "pan") return;
      e.preventDefault();
      if (gesturing) return;
      const [cx, cy] = local(e.clientX, e.clientY);
      zoomAt(zoomRef.current * wheelFactor(e, intent === "pinch"), cx, cy);
    };
    // macOS (WebKit): el pellizco llega como gesto con su escala.
    let base = 1;
    type Gesture = Event & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gesturing = true;
      base = zoomRef.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Gesture;
      const at = Number.isFinite(g.clientX) && Number.isFinite(g.clientY) ? ([g.clientX, g.clientY] as const) : (pointer ?? ([0, 0] as const));
      const [cx, cy] = local(at[0], at[1]);
      if (Number.isFinite(g.scale)) zoomAt(base * g.scale, cx, cy);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gesturing = false;
    };
    // Pantallas táctiles: dos dedos hacen zoom (distancia entre ellos) anclado al punto medio. Un dedo
    // sigue siendo arrastrar el mapa (startPan). Los punteros "touch" se siguen aquí, en fase de captura.
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { dist: number; base: number } | null = null;
    const pair = () => {
      const [a, b] = [...touches.values()];
      return pinchMetrics(a, b);
    };
    const onTouchDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        pinch = { dist: pair().dist, base: zoomRef.current };
        // El segundo dedo cancela el arrastre del primero y no inicia otro (startPan no lo recibe).
        endPan.current?.();
      }
      if (touches.size >= 2) e.stopPropagation();
    };
    const onTouchMove = (e: PointerEvent) => {
      const t = touches.get(e.pointerId);
      if (!t) return;
      t.x = e.clientX;
      t.y = e.clientY;
      if (touches.size !== 2 || !pinch) return;
      e.preventDefault();
      const { dist, mid } = pair();
      const [cx, cy] = local(mid.x, mid.y);
      zoomAt(pinchZoom(pinch.base, pinch.dist, dist, ZOOM_MIN, ZOOM_MAX), cx, cy);
    };
    const onTouchUp = (e: PointerEvent) => {
      if (!touches.delete(e.pointerId)) return;
      pinch = null;
      if (touches.size === 2) pinch = { dist: pair().dist, base: zoomRef.current };
    };
    el.addEventListener("pointerdown", onTouchDown, { capture: true });
    el.addEventListener("pointermove", onTouchMove, { passive: false });
    el.addEventListener("pointerup", onTouchUp);
    el.addEventListener("pointercancel", onTouchUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointermove", onMove);
    el.addEventListener("gesturestart", onGestureStart, { passive: false });
    el.addEventListener("gesturechange", onGestureChange, { passive: false });
    el.addEventListener("gestureend", onGestureEnd, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onTouchDown, { capture: true });
      el.removeEventListener("pointermove", onTouchMove);
      el.removeEventListener("pointerup", onTouchUp);
      el.removeEventListener("pointercancel", onTouchUp);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
    };
  }, [zoomAt]);

  // Arrastrar el fondo (o con el botón del medio, en cualquier parte) mueve el mapa: con la rueda
  // dedicada al zoom, es la forma de desplazarse con mouse.
  const [panning, setPanning] = useState(false);
  const endPan = useRef<(() => void) | null>(null);
  // Si la herramienta se cierra a mitad de un arrastre, no quedan escuchas en la ventana.
  useEffect(() => () => endPan.current?.(), []);
  const startPan = (e: React.PointerEvent<SVGSVGElement>) => {
    const el = scroller.current;
    const onBackground = e.button === 0 && e.target === e.currentTarget;
    if (!el || !(onBackground || e.button === 1)) return;
    e.preventDefault();
    endPan.current?.();
    const start = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    setPanning(true);
    const move = (ev: PointerEvent) => {
      el.scrollLeft = start.sl - (ev.clientX - start.x);
      el.scrollTop = start.st - (ev.clientY - start.y);
    };
    // pointercancel: en pantallas táctiles el navegador puede quedarse con el gesto sin pointerup.
    const up = () => {
      endPan.current = null;
      setPanning(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    endPan.current = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // Ctrl/⌘+C con un equipo seleccionado en el mapa copia su IP, salvo que haya texto
  // seleccionado o el foco esté en un campo (ahí manda la copia normal).
  const selIp = selected ? topoById.get(selected)?.ip : undefined;
  useEffect(() => {
    if (!visible || !selIp) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "c") return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
      if (window.getSelection()?.toString()) return;
      e.preventDefault();
      void copyText(selIp, "IP");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, selIp]);

  const pickHit = (h: SearchHit) => {
    focusOn(h.id);
    setSearchOpen(false);
    setMsg(`${node(h.id)?.name ?? h.id}: ${h.what}${h.detail ? ` ${h.detail}` : ""}`);
  };

  /** Chips de un criterio de filtro: solo los valores presentes en el diagrama, con su cantidad. */
  const chipGroup = <K extends string>(label: string, field: "roles" | "vendors" | "protos" | "states", counts: Map<K, number>, names: (k: K) => string) =>
    counts.size > 0 && (
      <div>
        <p className="mb-1 text-[11.5px] font-medium text-muted">{label}</p>
        <div className="flex flex-wrap gap-1">
          {[...counts].map(([k, c]) => {
            const list = filter[field] as string[];
            const on = list.includes(k);
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter((f) => ({ ...f, [field]: on ? list.filter((x) => x !== k) : [...list, k] }))}
                className={`h-7 px-2 rounded-md border text-[11.5px] ${on ? "border-[var(--accent)] text-accent bg-[var(--selected)]" : "border-line hover:bg-hover"}`}
              >
                {names(k)} <span className="text-muted">{c}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  const countBy = <K extends string>(items: K[]) => {
    const m = new Map<K, number>();
    for (const k of items) m.set(k, (m.get(k) ?? 0) + 1);
    return new Map([...m].sort((a, b) => b[1] - a[1]));
  };
  const roleCounts = useMemo(() => countBy<NodeRole>(dataNodes.map((n) => nodeRole(n))), [dataNodes]);
  const vendorCounts = useMemo(() => countBy<NodeVendor>(dataNodes.map((n) => nodeVendor(n))), [dataNodes]);
  const stateCounts = useMemo(() => countBy<NodeState>(dataNodes.map(nodeState)), [dataNodes]);
  const protoCounts = useMemo(() => countBy<string>(topo.links.map((l) => String(l.proto))), [topo.links]);
  const scopeErr = parseCidrs(ui.scope.cidrs).error;
  const setScope = (p: Partial<TopoScope>) => setUi((u) => ({ ...u, scope: { ...u.scope, ...p } }));
  const scopeSummary =
    [ui.scope.skipEndpoints && "sin teléfonos ni AP", ui.scope.cidrs.trim() && !scopeErr && ui.scope.cidrs.trim(), ui.scope.maxDepth && `hasta ${ui.scope.maxDepth} saltos`]
      .filter(Boolean)
      .join(" · ") || "Sin restricciones";
  const showAttention = () => {
    setUi((u) => ({ ...u, panel: true, sec: { ...u.sec, atencion: true } }));
  };

  // Leyenda solo con lo que hay en la vista y solo si hay algo más que CDP/LLDP.
  const legendKinds = LINK_LEGEND.filter(([, s]) => linkDash(s) && shown.links.some((l) => linkDash(l) === linkDash(s)));
  const hasPhysical = shown.links.some((l) => !linkDash(l));
  const hasTentative = shown.nodes.some((n) => n.manual || n.addrOnly);
  const hasTraffic = linkRates.size > 0;
  // Leyenda de estados: con lecturas de tráfico, o cuando hay algo que resaltar (caído, problemas de interfaz).
  const showStatusLegend = hasTraffic || attention.length > 0;
  const showLegend = legendKinds.length > 0 || hasTentative || showStatusLegend;

  const activeSources = TOPO_SOURCES.filter((s) => sourceOn(sources, s.id)).length;
  const trafficSummary = !trafficOn
    ? "Apagado"
    : !visible
      ? "En pausa (herramienta oculta)"
      : `Cada ${ui.interval} s · ${plural(linkRates.size, "enlace", "enlaces")} con datos${trafficCli ? " · también por consola" : ""}`;
  const diffCount = diff ? diff.addedLinks.length + diff.removedLinks.length + diff.addedNodes.length + diff.removedNodes.length : 0;
  const hint = "Descubre los vecinos del equipo conectado y sigue la ruta salto a salto: clic en un vecino y 'Abrir terminal' (o doble clic). Solo usa comandos de consulta.";

  return (
    <div className="@container h-full min-h-[480px] flex flex-col gap-3">
      <section className="rounded-xl border border-line bg-panel px-3 sm:px-4 pt-3 pb-3">
        {/* En anchos chicos se oculta: el menú lateral ya dice Topología y el texto queda en el botón. */}
        <header className="flex items-baseline gap-2 min-w-0 mb-2 @max-[860px]:hidden">
          <h2 className="text-[13px] font-semibold shrink-0">Topología</h2>
          <p className="text-[11.5px] text-muted truncate" title={hint}>
            {hint}
          </p>
        </header>
        <div className="flex flex-wrap items-end gap-2">
          <Label text="Descubrir con" className="w-full sm:w-36">
            <select className="field w-full" value={mode} onChange={(e) => setUi((u) => ({ ...u, mode: e.target.value as DiscoveryMode }))}>
              <option value="cli">Consola (CLI)</option>
              <option value="snmp">SNMP (perfil)</option>
            </select>
          </Label>
          {mode === "cli" ? (
            <>
              <Label text="Equipo (sesión conectada)" className="w-full sm:flex-1 sm:min-w-40">
                <select className="field w-full" value={connId} onChange={(e) => setConnId(e.target.value)}>
                  {!terminals.length && <option value="">Sin sesiones conectadas</option>}
                  {terminals.map((t) => (
                    <option key={t.connId} value={t.connId}>
                      {t.name}
                      {t.host ? ` · ${t.host}` : ""}
                    </option>
                  ))}
                </select>
              </Label>
              <Label text="Fabricante" className="w-full sm:w-40">
                <select className="field w-full" value={vendor} onChange={(e) => setVendor(e.target.value as TopoVendor)}>
                  {VENDORS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </Label>
            </>
          ) : (
            <Label text="Perfil SNMP del equipo (v2c o v3)" className="w-full sm:flex-1 sm:min-w-48">
              <select className="field w-full" value={profile?.id ?? ""} onChange={(e) => setUi((u) => ({ ...u, snmpProfile: e.target.value }))}>
                {!profiles.length && <option value="">Sin perfiles: créalos en Herramientas › SNMP</option>}
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.host} · {p.host} · {p.version === "3" ? `v3 ${p.level}` : "v2c"}
                    {p.saved ? "" : " (sin secretos guardados)"}
                  </option>
                ))}
              </select>
            </Label>
          )}
          <label
            className="flex items-center gap-1.5 h-8 text-[12px]"
            title={mode === "cli" ? "Lee estado, velocidad, descripción y Port-channel de las interfaces (comandos de consulta)" : "Lee ifOperStatus, ifHighSpeed e ifAlias (IF-MIB)"}
          >
            <input type="checkbox" className="accent-[var(--accent)]" checked={readPorts} onChange={(e) => setReadPorts(e.target.checked)} />
            Estado de puertos
          </label>
          {mode === "cli" ? (
            <Btn kind="primary" disabled={!term || busy} onClick={() => void discover()} title={hint}>
              <Radar size={14} className={busy ? "animate-pulse" : ""} /> {busy ? "Leyendo…" : "Descubrir vecinos"}
            </Btn>
          ) : (
            <Btn kind="primary" disabled={!profile || busy} onClick={discoverSnmp} title="Lee LLDP-MIB y CISCO-CDP-MIB (y las fuentes activas) con GETBULK, solo lectura">
              <Radar size={14} className={busy ? "animate-pulse" : ""} /> {busy ? "Leyendo…" : "Descubrir por SNMP"}
            </Btn>
          )}
        </div>
        {mode === "cli" && term && termRoute && termRoute.steps.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px]">
            <span className="text-muted">Pestaña de salto "{term.name}":</span>
            <span className="font-medium">{routeTooltip(termRoute)}</span>
            <Btn className="!h-6 !px-2 !text-[11.5px]" disabled={busy} onClick={hopBack} title='Envía "exit" en esa pestaña: vuelve al equipo anterior de la ruta'>
              Volver a {routeNames(termRoute).slice(-2)[0]}
            </Btn>
          </div>
        )}
        {mode === "snmp" && (
          <p className="mt-1.5 text-[11.5px] text-muted">
            Solo lectura con el perfil y sus secretos de la bóveda; tope de 10.000 filas y 20 s por tabla. Si LLDP y CDP vuelven vacíos por SNMP, el protocolo está apagado en el equipo.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1 mt-2.5 @max-[860px]:[&_button]:px-2" role="toolbar" aria-label="Diagrama">
          <Btn kind="ghost" title="Acercar (o rueda del mouse o pellizco del touchpad sobre el mapa; arrastra el fondo para moverlo)" onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + 0.2))}>
            <ZoomIn size={14} />
          </Btn>
          <Btn kind="ghost" title="Alejar (o rueda del mouse o pellizco del touchpad sobre el mapa; arrastra el fondo para moverlo)" onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - 0.2))}>
            <ZoomOut size={14} />
          </Btn>
          <Btn kind="ghost" title="Ajustar a la vista" aria-label="Ajustar a la vista" onClick={fit}>
            <Maximize2 size={14} />
          </Btn>
          <Btn kind="ghost" title="Reordenar automáticamente" onClick={() => onTopo((t) => layout({ ...t, nodes: t.nodes.map((n) => ({ ...n, x: 0, y: 0 })) }))}>
            <Network size={14} />
          </Btn>
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
            <input
              type="search"
              className="field !h-8 !pl-7 w-40 sm:!w-64 @max-[860px]:!w-44 !text-[12px]"
              placeholder="Buscar (nombre, IP, MAC, puerto)"
              title="Busca por nombre, IP, MAC, interfaz o descripción; Enter va al primero"
              aria-label="Buscar en el diagrama"
              disabled={!topo.nodes.length}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hits[0]) pickHit(hits[0]);
                if (e.key === "Escape") setSearchOpen(false);
              }}
            />
            {searchOpen && query.trim().length >= 2 && (
              <ul className="absolute z-20 left-0 top-full mt-1 w-72 max-w-[calc(100vw-2.5rem)] max-h-72 overflow-y-auto rounded-lg border border-line bg-panel shadow-pop py-1 text-[12px]" role="listbox">
                {hits.length ? (
                  hits.map((h, i) => (
                    <li key={`${h.id}${i}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={i === 0}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickHit(h)}
                        className="w-full text-left px-3 py-1.5 hover:bg-hover"
                      >
                        <span className="font-medium">{node(h.id)?.name ?? h.id}</span>
                        <span className="block text-[11px] text-muted truncate">
                          {h.what}
                          {h.detail ? `: ${h.detail}` : ""}
                        </span>
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="px-3 py-1.5 text-muted">Sin resultados</li>
                )}
              </ul>
            )}
          </div>
          <span className="w-px h-5 bg-[var(--border)] mx-1 @max-[860px]:hidden" aria-hidden />
          <Btn
            kind="ghost"
            title="Exportar el diagrama: SVG, draw.io, CSV o Mermaid"
            aria-haspopup="menu"
            aria-expanded={!!exportMenu}
            disabled={!topo.nodes.length}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setExportMenu({
                x: r.left,
                y: r.bottom + 4,
                items: [
                  ["Imagen SVG", <Download size={13} />, () => exportFile("svg", toSvg(topo, W, H, linkRates))],
                  ["draw.io con íconos de red", <Download size={13} />, () => void exportDrawioIcons()],
                  ["draw.io simple (cajas)", <Download size={13} />, () => exportFile("drawio", toDrawio(topo, W, H))],
                  ["CSV de enlaces y puertos", <Download size={13} />, () => exportFile("csv", toCsv(topo, linkRates)), !topo.links.length],
                  [
                    "Copiar como Mermaid",
                    <FileCode2 size={13} />,
                    () => writeText(toMermaid(topo)).then(() => setMsg("Diagrama Mermaid copiado al portapapeles")),
                  ],
                ],
              });
            }}
          >
            <Download size={14} /> <span className="@max-[860px]:sr-only">Exportar</span> <ChevronDown size={12} aria-hidden />
          </Btn>
          {exportMenu && <ContextMenu menu={exportMenu} onClose={() => setExportMenu(null)} />}
          {nodeMenu && <ContextMenu menu={nodeMenu} onClose={() => setNodeMenu(null)} />}
          <div className="flex flex-wrap items-center gap-1 ml-auto">
            <Btn
              kind={trafficOn ? "default" : "ghost"}
              aria-pressed={trafficOn}
              title={trafficOn ? "Dejar de leer el tráfico de los enlaces" : "Mostrar el tráfico de los enlaces (opciones en el panel)"}
              onClick={() => setTrafficOn(!trafficOn)}
              className={trafficOn ? "!text-accent" : ""}
            >
              <Activity size={14} aria-hidden /> <span className="@max-[860px]:sr-only">Tráfico</span>
            </Btn>
            {filtering && (
              <Btn title="Hay filtros activos: el diagrama muestra una parte" onClick={() => setUi((u) => ({ ...u, panel: true, sec: { ...u.sec, filtros: true } }))}>
                <ListFilter size={14} className="text-accent" aria-hidden /> <span className="@max-[860px]:sr-only">{shown.nodes.length} de {view.nodes.length}</span>
              </Btn>
            )}
            {attention.length > 0 && (
              <Btn title="Ver los enlaces que requieren atención en el panel" aria-label={`Ver ${attention.length} enlaces que requieren atención`} onClick={showAttention}>
                <TriangleAlert size={14} className={attentionCount.down + attentionCount.load ? "text-danger" : "text-warn"} aria-hidden />{" "}
                <span className="@max-[860px]:sr-only">Atención</span> <CountBadge n={attention.length} />
              </Btn>
            )}
            {suggestions.length > 0 && (
              <Btn
                title="Ver sugerencias en el panel"
                aria-label={`Ver ${suggestions.length} sugerencias`}
                onClick={showSuggestions}
              >
                <Lightbulb size={14} className="text-warn" aria-hidden /> <span className="@max-[860px]:sr-only">Sugerencias</span> <CountBadge n={suggestions.length} />
              </Btn>
            )}
      <Btn
        kind="ghost"
        className="hover:!text-danger"
        title="Borrar diagrama"
        disabled={!topo.nodes.length}
        onClick={() => {
          const manual = topo.nodes.filter((n) => n.manual).length + topo.links.filter((l) => isUserProto(l.proto)).length;
          onConfirm({
            title: "¿Borrar el diagrama?",
            message: `Se borran ${topo.nodes.length} ${topo.nodes.length === 1 ? "equipo" : "equipos"} y ${topo.links.length} ${topo.links.length === 1 ? "enlace" : "enlaces"}${manual ? `, incluidos ${manual} ${manual === 1 ? "elemento agregado" : "elementos agregados"} a mano o desde sugerencias` : ""}. Los snapshots no se tocan: guarda uno antes si quieres recuperarlo.`,
            label: "Borrar diagrama",
            danger: true,
            defaultCancel: true,
            action: () => {
              onTopo({ nodes: [], links: [] });
              setSelected(null);
              setPath({});
            },
          });
        }}
      >
        <Trash2 size={14} />
      </Btn>
            <Btn
              aria-expanded={ui.panel}
              aria-controls={panelId}
              title={ui.panel ? "Ocultar panel lateral" : "Mostrar panel lateral"}
              onClick={() => setPanel(!ui.panel)}
            >
              {ui.panel ? <PanelRightClose size={14} aria-hidden /> : <PanelRight size={14} aria-hidden />} <span className="@max-[860px]:sr-only">Panel</span>
            </Btn>
          </div>
        </div>
        {msg && <p className="mt-2 text-[12px] text-accent">{msg}</p>}
        <HopCards
          views={hopViews}
          alerts={credAlerts}
          offers={saveOffers}
          onView={(tabId) => onFocusTab(tabId)}
          onDiscover={discoverFromTab}
          onDismiss={(tabId) => setHopViews((vs) => vs.filter((v) => v.tabId !== tabId))}
          onUpdate={(a) => setPwDialog({ to: a.to, ip: a.ip, user: a.user, update: true })}
          onAlertDone={(a) => setCredAlerts((l) => l.filter((x) => x !== a))}
          onOffer={(o) => setPwDialog(o)}
          onOfferDone={(o) => setSaveOffers((l) => l.filter((x) => x !== o))}
        />
        {pwDialog && (
          <HopPasswordDialog
            title={pwDialog.update ? `Actualizar la contraseña de ${pwDialog.to}` : `Guardar la contraseña de ${pwDialog.to}`}
            ip={pwDialog.ip}
            user={pwDialog.user}
            note={`${pwDialog.user}@${pwDialog.ip}. Escríbela aquí (no se lee de la terminal): se cifra en la bóveda y se usará sola, una vez por salto, cuando ${pwDialog.to} la pida.`}
            onClose={() => setPwDialog(null)}
            onSaved={() => {
              const d = pwDialog;
              setSaveOffers((l) => l.filter((o) => !(o.ip === d.ip && o.user === d.user)));
              setCredAlerts((l) => l.filter((x) => !(x.ip === d.ip && x.user === d.user)));
              setPwDialog(null);
              setMsg(`Contraseña de ${d.user}@${d.ip} guardada en la bóveda.`);
              refreshCreds();
            }}
          />
        )}
      </section>

      <div className="relative flex-1 min-h-[240px] flex gap-3">
        <div ref={mapBox} className="relative flex-1 min-w-0 rounded-xl border border-line bg-panel overflow-hidden">
          <div ref={scroller} className="absolute inset-0 overflow-auto" style={{ touchAction: "none" }}>
      {!view.nodes.length ? (
        <div className="h-full grid place-items-center text-[12.5px] text-muted p-6 text-center">
          Conecta una sesión con un equipo y pulsa "Descubrir vecinos", o agrega equipos y enlaces a mano.
        </div>
      ) : !shown.nodes.length ? (
        <div className="h-full grid place-items-center text-[12.5px] text-muted p-6 text-center">
          <div className="space-y-2">
            <p>Ningún equipo coincide con los filtros.</p>
            <Btn onClick={() => setFilter(NO_FILTER)}>Quitar filtros</Btn>
          </div>
        </div>
      ) : (
        <svg
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%`, cursor: panning ? "grabbing" : "grab" }}
          onPointerDown={startPan}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          <TopoLayers
            geometry={geometry}
            nodes={shown.nodes}
            l2Nodes={l2Nodes}
            pills={trafficPills}
            byId={topoById}
            shownById={shownById}
            snapshot={snapshot}
            hasRoute={!!route}
            routeKeys={routeKeys}
            routeNodes={routeNodes}
            removed={removed}
            added={added}
            ghostIds={ghostIds}
            newIds={newIds}
            selected={selected}
            focusLink={focusLink}
            linkRates={linkRates}
            detail={detail}
            color={ui.color}
            arrows={arrowsOn}
            animate={animate}
            animKeys={animKeys}
            pillPairs={pillPairs}
            checks={checks}
            tips={tips}
            onIssue={onIssue}
            onNodeDown={onNodeDown}
            onNodeMenu={onNodeMenu}
            onNodeOpen={onNodeOpen}
            onPick={setSelected}
          />
        </svg>
      )}
          </div>
          {!ui.panel && sel && (
            <div className="absolute top-2 left-2 flex items-center gap-2 max-w-[calc(100%-1rem)] rounded-lg border border-line bg-panel shadow-pop pl-3 pr-1 py-1 text-[12px]">
              <span className="font-medium truncate">{sel.name}</span>
              {sel.ip && (
                <Btn kind="ghost" className="!h-6 !px-2 !text-[11.5px]" title={`Copiar IP (${sel.ip})`} aria-label={`Copiar IP ${sel.ip}`} onClick={() => copyText(sel.ip!, "IP")}>
                  <Copy size={12} /> <span className="font-mono">{sel.ip}</span>
                </Btn>
              )}
              <Btn kind="ghost" className="!h-6 !px-2 !text-[11.5px] !text-accent" onClick={() => setUi((u) => ({ ...u, panel: true, sec: { ...u.sec, detalle: true } }))}>
                Ver detalle
              </Btn>
            </div>
          )}
          <MapSummary
            trafficOn={trafficOn}
            visible={visible}
            last={traffic.status.last}
            snmp={traffic.status.snmp.length > 0}
            cli={traffic.status.cli.length > 0}
            count={attention.length}
            hasData={linkRates.size > 0}
            onOpen={showAttention}
          />
          <LinkTip store={tips} box={mapBox} detailsFor={detailsFor} />
          {showLegend && (
            <div className="absolute bottom-2 left-2 flex flex-col items-start gap-1.5 max-w-[calc(100%-1rem)]">
              {isOpen("leyenda") && (
                <div
                  id={legendId}
                  className="flex flex-col gap-1 rounded-lg border border-line bg-panel shadow-pop px-3 py-2 text-[11.5px] text-muted"
                  aria-label="Leyenda de enlaces"
                  role="group"
                >
                  {hasPhysical && (
                    <span className="inline-flex items-center gap-1.5">
                      <LegendLine />
                      CDP / LLDP
                    </span>
                  )}
                  {legendKinds.map(([text, s]) => (
                    <span key={text} className="inline-flex items-center gap-1.5">
                      <LegendLine dash={linkDash(s)} />
                      {text}
                    </span>
                  ))}
                  {hasTentative && (
                    <span className="inline-flex items-center gap-1.5">
                      <svg width="34" height="12" aria-hidden className="shrink-0">
                        <rect x="7" y="1" width="20" height="10" rx="3" fill="var(--chrome)" stroke="var(--field-border)" strokeDasharray="4 3" />
                      </svg>
                      Equipo manual o visto solo por ruteo
                    </span>
                  )}
                  {showStatusLegend && (
                    <>
                      <span className="mt-1 font-medium text-fg">Estado del enlace (sentido más cargado)</span>
                      {(
                        [
                          ["Normal (menos de 70 %)", "var(--muted)", 1.5],
                          [`Alto (${Math.round(UTIL_HIGH * 100)} a ${Math.round(UTIL_SATURATED * 100) - 1} %)`, "var(--warn)", 4],
                          [`Saturado (${Math.round(UTIL_SATURATED * 100)} % o más)`, "var(--danger)", 5],
                        ] as [string, string, number][]
                      ).map(([text, c, w]) => (
                        <span key={text} className="inline-flex items-center gap-1.5">
                          <svg width="34" height="8" aria-hidden className="shrink-0">
                            <line x1="2" y1="4" x2="32" y2="4" stroke={c} strokeWidth={w} strokeLinecap="round" />
                          </svg>
                          {text}
                        </span>
                      ))}
                      <span className="inline-flex items-center gap-1.5">
                        <svg width="34" height="14" aria-hidden className="shrink-0">
                          <line x1="2" y1="7" x2="22" y2="7" stroke="var(--text)" strokeOpacity={0.65} strokeWidth={2} strokeDasharray="5 5" strokeLinecap="round" />
                          <circle cx="28" cy="7" r="5.5" fill="var(--warn)" stroke="var(--panel)" strokeWidth={1.5} />
                          <text x="28" y="10.5" fontSize="9" fontWeight={800} textAnchor="middle" fill="var(--panel)">
                            !
                          </text>
                        </svg>
                        Caído (punteado) · ! problema de interfaz
                      </span>
                    </>
                  )}
                  {detail && hasTraffic && (
                    <>
                      {ui.color && <span className="mt-1 font-medium text-fg">Vista detallada: color y grosor por utilización</span>}
                      {ui.color && UTIL_LEGEND.map(([text, lv]) => (
                        <span key={lv} className="inline-flex items-center gap-1.5">
                          <svg width="34" height="8" aria-hidden className="shrink-0">
                            <line x1="2" y1="4" x2="32" y2="4" stroke={UTIL_VAR[lv]} strokeWidth={lv === "crit" ? 4.5 : lv === "warn" ? 3.5 : 2.5} strokeLinecap="round" />
                          </svg>
                          {text}
                        </span>
                      ))}
                      <span className="inline-flex items-center gap-1.5">
                        <svg width="34" height="8" aria-hidden className="shrink-0">
                          <line x1="2" y1="4" x2="32" y2="4" stroke={UTIL_VAR.none} strokeWidth={2.5} strokeLinecap="round" />
                        </svg>
                        Velocidad desconocida
                      </span>
                      {ui.arrows && <span className="inline-flex items-center gap-1.5">
                        <svg width="34" height="12" aria-hidden className="shrink-0">
                          <line x1="2" y1="6" x2="32" y2="6" stroke="var(--muted)" strokeWidth={1.5} />
                          <polygon points="13,1.5 19,4.5 13,7.5" fill="var(--ok)" />
                          <polygon points="21,4.5 15,7.5 21,10.5" fill="var(--warn)" />
                        </svg>
                        Una flecha por sentido · rótulo con el % de uso del sentido más cargado (≈: aproximada)
                      </span>}
                    </>
                  )}
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-expanded={isOpen("leyenda")}
                  aria-controls={legendId}
                  onClick={() => setUi((u) => ({ ...u, sec: { ...u.sec, leyenda: !u.sec.leyenda } }))}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-line bg-panel text-[11.5px] text-muted hover:text-fg hover:bg-hover"
                >
                  <ChevronUp size={13} aria-hidden className={`transition-transform ${isOpen("leyenda") ? "" : "rotate-180"}`} />
                  Leyenda
                </button>
              </div>
            </div>
          )}
        </div>

        {ui.panel && (
          <aside
            id={panelId}
            aria-label="Panel de topología"
            className="w-[320px] shrink-0 min-h-0 overflow-y-auto space-y-3 @max-[860px]:absolute @max-[860px]:top-0 @max-[860px]:right-0 @max-[860px]:bottom-0 @max-[860px]:z-10 @max-[860px]:max-w-[calc(100%-2rem)] @max-[860px]:rounded-xl @max-[860px]:bg-bg @max-[860px]:shadow-pop @max-[860px]:p-2"
          >
            <Collapsible
              title="Fuentes de descubrimiento"
              summary={`${activeSources} de ${TOPO_SOURCES.length} activas · CDP/LLDP y lo manual, siempre`}
              open={isOpen("fuentes")}
              onToggle={(v) => setOpen("fuentes", v)}
            >
        <div className="space-y-2.5">
          {TOPO_SOURCES.map((s) => (
            <div key={s.id}>
              <Toggle checked={sourceOn(sources, s.id)} onChange={(v) => onSources({ ...sources, [s.id]: v })} label={s.label} />
              <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">{s.hint}</p>
            </div>
          ))}
        </div>
            </Collapsible>

            <Collapsible title="Alcance del descubrimiento" summary={scopeSummary} open={isOpen("alcance")} onToggle={(v) => setOpen("alcance", v)}>
              <div className="space-y-2.5 text-[12px]">
                <p className="text-[11px] text-muted leading-snug">
                  Qué vecinos nuevos se agregan al descubrir. Los que ya están en el diagrama conservan su enlace. No cambia los comandos que se envían.
                </p>
                <div>
                  <Toggle checked={ui.scope.skipEndpoints} onChange={(skipEndpoints) => setScope({ skipEndpoints })} label="Sin teléfonos IP ni access points" />
                  <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">Según la plataforma y las capacidades que anuncian por CDP/LLDP.</p>
                </div>
                <Label text="Solo estas redes (CIDR, separadas por coma)">
                  <input
                    className="field font-mono !text-[12px]"
                    placeholder="10.0.0.0/8, 192.168.10.0/24"
                    maxLength={500}
                    aria-invalid={!!scopeErr}
                    value={ui.scope.cidrs}
                    onChange={(e) => setScope({ cidrs: e.target.value })}
                  />
                </Label>
                {scopeErr ? (
                  <p className="text-[11.5px] text-danger">{scopeErr}. Mientras tanto no se filtra por red.</p>
                ) : (
                  <p className="text-[11px] text-muted leading-snug">Un vecino sin IP de gestión informada se agrega igual.</p>
                )}
                <label className="flex items-center gap-2">
                  <span className="text-muted">Profundidad máxima</span>
                  <select className="field !h-7 !w-36 !text-[12px]" value={ui.scope.maxDepth} onChange={(e) => setScope({ maxDepth: Number(e.target.value) })}>
                    <option value={0}>Sin límite</option>
                    {[1, 2, 3, 4, 5, 6, 8, 10].map((d) => (
                      <option key={d} value={d}>
                        {plural(d, "salto", "saltos")}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </Collapsible>

            <Collapsible
              title="Filtros"
              summary={filtering ? `Mostrando ${shown.nodes.length} de ${view.nodes.length} equipos` : "Todo a la vista"}
              open={isOpen("filtros")}
              onToggle={(v) => setOpen("filtros", v)}
              right={
                filtering && (
                  <Btn kind="ghost" className="!px-1.5 !text-[11.5px]" title="Quitar todos los filtros" onClick={() => setFilter(NO_FILTER)}>
                    <X size={13} /> Quitar
                  </Btn>
                )
              }
            >
              <div className="space-y-2.5 text-[12px]">
                {chipGroup("Rol (estimado por plataforma y capacidades)", "roles", roleCounts, (k) => ROLE_LABEL[k])}
                {chipGroup("Fabricante", "vendors", vendorCounts, (k) => VENDOR_LABEL[k])}
                {chipGroup("Origen del enlace", "protos", protoCounts, (k) => (k === "manual" ? "Manual" : k))}
                {chipGroup("Estado", "states", stateCounts, (k) => STATE_LABEL[k])}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted">Solo a</span>
                  <select
                    className="field !h-7 !w-28 !text-[12px]"
                    aria-label="Saltos desde el equipo foco"
                    value={filter.hops}
                    onChange={(e) => {
                      const hops = Number(e.target.value);
                      setFilter((f) => ({ ...f, hops, focus: hops ? (f.focus ?? selected ?? nodesByName[0]?.id) : f.focus }));
                    }}
                  >
                    <option value={0}>sin límite</option>
                    {[1, 2, 3, 4, 5].map((d) => (
                      <option key={d} value={d}>
                        {plural(d, "salto", "saltos")}
                      </option>
                    ))}
                  </select>
                  <span className="text-muted">de</span>
                  <select
                    className="field !h-7 flex-1 min-w-0 !text-[12px]"
                    aria-label="Equipo foco"
                    disabled={!filter.hops}
                    value={filter.focus ?? ""}
                    onChange={(e) => setFilter((f) => ({ ...f, focus: e.target.value || undefined }))}
                  >
                    {nodesByName.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Toggle checked={ui.l2} onChange={(l2v) => setUi((u) => ({ ...u, l2: l2v }))} label="Puertos activos sin vecino" />
                  <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">
                    Dibuja un nodo "L2 desconocido" junto a cada equipo con interfaces activas sin vecino CDP/LLDP (requiere "Estado de puertos"). Con más de {MAX_L2_NODES} equipos así, solo el del equipo seleccionado.
                  </p>
                </div>
              </div>
            </Collapsible>

            <Collapsible
              title="Requieren atención"
              badge={attention.length || undefined}
              summary={
                attention.length
                  ? [attentionCount.down && `${attentionCount.down} caído${attentionCount.down === 1 ? "" : "s"}`, attentionCount.load && `${attentionCount.load} por carga`, attentionCount.issues && plural(attentionCount.issues, "problema", "problemas")]
                      .filter(Boolean)
                      .join(" · ")
                  : "Todo normal"
              }
              open={isOpen("atencion")}
              onToggle={(v) => setOpen("atencion", v)}
            >
              <div className="space-y-2 text-[12px]">
                {attention.length > 0 ? (
                  <ul className="space-y-0.5 max-h-72 overflow-y-auto">
                    {attention.map((r) => {
                      const pct = r.util === undefined ? undefined : Math.round(r.util * 100);
                      const c = r.level === "down" ? "var(--muted)" : r.level === "saturated" ? "var(--danger)" : "var(--warn)";
                      return (
                        <li key={r.key}>
                          <button
                            type="button"
                            onClick={() => pickLink(r.key)}
                            aria-pressed={focusLink === r.key}
                            className={`w-full text-left rounded-md px-1.5 py-1 hover:bg-hover ${focusLink === r.key ? "bg-selected" : ""}`}
                            title="Ubicar y resaltar en el diagrama"
                          >
                            <span className="flex items-center gap-2">
                              <span className="flex-1 min-w-0 truncate font-medium">
                                {shortName(r.aName, 18)} <span className="text-muted">↔</span> {shortName(r.bName, 18)}
                              </span>
                              <span className="shrink-0 tabular-nums font-semibold" style={{ color: `color-mix(in srgb, ${c} 45%, var(--text))` }}>
                                {r.level === "down" ? "caído" : pct === undefined ? "!" : `${pct} %`}
                              </span>
                            </span>
                            {pct !== undefined && r.level !== "down" && (
                              <span className="mt-0.5 block h-1 rounded-full bg-line overflow-hidden" aria-hidden>
                                <span className="block h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: r.level === "issues" ? "var(--muted)" : c }} />
                              </span>
                            )}
                            <span className="block text-[11.5px] text-muted [overflow-wrap:anywhere]">{r.phrase}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-muted">Todo normal{trafficOn ? "" : ": activa el tráfico para ver también la carga de los enlaces"}.</p>
                )}
                <p className="text-[11px] text-muted leading-snug">
                  Alto desde {Math.round(UTIL_HIGH * 100)} %, saturado desde {Math.round(UTIL_SATURATED * 100)} % (sentido más cargado); caído es un puerto down o err-disabled en algún extremo. Los problemas de interfaz son dúplex o
                  velocidad distintos, VLAN nativa, trunk contra access, miembros fuera del agregado, errores CRC y enlaces que solo ve un lado; los errores son acumulados desde el último clear counters.
                </p>
                <p className="text-[11px] text-muted leading-snug">
                  {coverage.links
                    ? `Revisados con datos de puertos: ${coverage.withData} de ${plural(coverage.links, "enlace físico", "enlaces físicos")} (${coverage.both} con ambos extremos).`
                    : "Sin enlaces físicos que revisar."}
                  {coverage.withData < coverage.links ? ' Activa "Estado de puertos" y explora también el otro extremo para completar la comparación.' : ""} Por SNMP solo se leen estado y velocidad; el dúplex, la VLAN nativa y los errores
                  vienen de la consola y de lo que anuncia CDP.
                </p>
              </div>
            </Collapsible>

            <Collapsible
              title="Tráfico en enlaces"
              summary={trafficSummary}
              open={isOpen("trafico")}
              onToggle={(v) => setOpen("trafico", v)}
            >
              <div className="space-y-2.5 text-[12px]">
                <div>
                  <Toggle checked={trafficOn} onChange={setTrafficOn} label="Tráfico en enlaces" />
                  <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">
                    Lee los contadores de las interfaces con enlace de cada equipo explorado, solo mientras Topología está a la vista. Por SNMP usa el perfil del equipo (misma IP o
                    nombre, con secretos guardados): un GET de ifHCInOctets, ifHCOutOctets e ifHighSpeed (IF-MIB), o los de 32 bits si el agente no los tiene.
                  </p>
                </div>
                <label className="flex items-center gap-2 pl-10">
                  <span className="text-muted">Cada</span>
                  <select
                    className="field !h-7 !w-24 !text-[12px]"
                    value={ui.interval}
                    onChange={(e) => setUi((u) => ({ ...u, interval: Number(e.target.value) as TrafficInterval }))}
                  >
                    {TRAFFIC_INTERVALS.map((i) => (
                      <option key={i} value={i}>
                        {i} s
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <Toggle checked={trafficCli} onChange={setTrafficCli} label="También por consola" />
                  <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">
                    Para equipos sin perfil SNMP: envía <span className="font-mono">show interfaces</span>, <span className="font-mono">display interface</span> o{" "}
                    <span className="font-mono">show interfaces extensive</span> a su sesión conectada en cada lectura. Solo consulta, pero ocupa la sesión unos segundos. En Cisco la misma lectura trae el estado,
                    el dúplex y los errores CRC de cada interfaz, que alimentan los problemas de interfaz.
                  </p>
                </div>
                <div>
                  <Toggle checked={ui.detail} onChange={(d) => setUi((u) => ({ ...u, detail: d }))} label="Vista detallada" />
                  <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">
                    Para expertos. Por defecto el mapa es por excepción: lo normal (menos de {Math.round(UTIL_HIGH * 100)} %) queda en gris fino y solo se resaltan los enlaces altos, saturados o caídos. La vista detallada
                    colorea todos los enlaces por utilización y agrega rótulos, flechas y animación.
                  </p>
                </div>
                {ui.detail && (
                  <div className="space-y-2.5 pl-4 border-l border-line">
                    <div>
                      <Toggle checked={ui.color} onChange={(color) => setUi((u) => ({ ...u, color }))} label="Color por utilización" />
                      <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">Verde, amarillo desde 70 % y rojo desde 90 %, con grosor según la carga.</p>
                    </div>
                    <div>
                      <Toggle checked={ui.arrows} onChange={(arrows) => setUi((u) => ({ ...u, arrows }))} label="Flechas de dirección" />
                      <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">Una punta por sentido sobre cada enlace.</p>
                    </div>
                    <div>
                      <Toggle checked={ui.rates} onChange={(rates) => setUi((u) => ({ ...u, rates }))} label="Rótulo en el enlace" />
                      <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">Una etiqueta corta sobre cada enlace con el % de uso (o la tasa, si no se conoce la velocidad).</p>
                    </div>
                    <div>
                      <Toggle checked={ui.anim && ui.arrows} onChange={(anim) => setUi((u) => ({ ...u, anim, arrows: anim || u.arrows }))} label="Animación" />
                      <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">
                        Puntos que viajan por cada sentido del enlace, más rápido cuanto más carga (se pausa con la herramienta oculta). Con más de {FLOW_MAX} enlaces con
                        tráfico se animan los {FLOW_MAX} más cargados y el resto mantiene sus flechas.
                        {reducedMotion ? " El sistema pide reducir movimiento: queda desactivada." : ""}
                      </p>
                    </div>
                  </div>
                )}
                {trafficOn && (
                  <div className="rounded-md border border-line px-2 py-1.5 space-y-0.5 text-[11.5px]">
                    {!traffic.status.last && <p className="text-muted">Leyendo…</p>}
                    {traffic.status.snmp.length > 0 && <p>SNMP: {traffic.status.snmp.join(", ")}</p>}
                    {traffic.status.cli.length > 0 && <p>Consola: {traffic.status.cli.join(", ")}</p>}
                    {traffic.status.none.length > 0 && (
                      <div className="space-y-1">
                        {/* Sin SNMP ni consola no hay tráfico: el motivo y la acción, a la vista. */}
                        <p className="text-warn">
                          Sin datos de tráfico de {traffic.status.none.join(", ")}: {trafficCli ? "conecta su sesión o crea su perfil SNMP." : "no tiene perfil SNMP."}
                        </p>
                        {!trafficCli && terminals.length > 0 && (
                          <button
                            onClick={() => setTrafficCli(true)}
                            className="h-7 px-2.5 rounded-md border border-line text-[12px] hover:bg-hover"
                            title="Envía show interfaces, display interface o show interfaces extensive a su sesión conectada en cada lectura (solo consulta)"
                          >
                            Leer por consola
                          </button>
                        )}
                      </div>
                    )}
                    {traffic.status.busy.length > 0 && (
                      <p className="text-muted">
                        Pestaña ocupada ({traffic.status.busy.join(", ")}): sin prompt a la vista (paginador, contraseña o un comando en curso); no se le envía nada y se reintenta en la próxima lectura.
                      </p>
                    )}
                    {traffic.status.errors.map((e) => (
                      <p key={e} className="text-danger">
                        {e}
                      </p>
                    ))}
                    {traffic.status.last && !linkRates.size && !traffic.status.errors.length && (
                      <p className="text-muted">La tasa aparece desde la segunda lectura ({ui.interval} s).</p>
                    )}
                    {traffic.status.last && <p className="text-muted">Última lectura: {new Date(traffic.status.last).toLocaleTimeString()}</p>}
                  </div>
                )}
              </div>
            </Collapsible>

            {suggestionSources.length > 0 && (
              <div ref={suggestionsRef} className="scroll-mt-2">
                <Collapsible
                  title="Sugerencias"
                  badge={suggestions.length}
                  summary={suggestions.length ? "Confirma cada una antes de dibujarla" : "Sin sugerencias por ahora"}
                  open={isOpen("sugerencias")}
                  onToggle={(v) => setOpen("sugerencias", v)}
                >
              {suggestions.length ? (
                <ul className="space-y-2 max-h-56 overflow-y-auto">
                  {suggestions.map((s) => (
                    <li key={s.id} className="rounded-md border border-line px-2 py-1.5 text-[11.5px]">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono flex-1 min-w-0 [overflow-wrap:anywhere]" title={`${node(s.a)?.name ?? s.a} ${s.aPort} → ${s.target} ${s.bPort}`}>
                          <span className="whitespace-nowrap">
                            {node(s.a)?.name ?? s.a} {s.aPort}
                          </span>{" "}
                          <span className="whitespace-nowrap">
                            → {s.target} {s.bPort}
                          </span>
                        </span>
                        <span className="text-[11px] font-medium shrink-0" style={{ color: CONFIDENCE_COLOR[s.confidence] }} title={`Confianza ${s.confidence}`}>
                          {s.confidence}
                        </span>
                      </div>
                      <p className="text-muted truncate" title={s.reason}>
                        {TOPO_SOURCES.find((x) => x.id === s.source)?.short ?? s.source}: {s.source === "descriptions" ? `"${s.reason}"` : s.reason}
                      </p>
                      {s.detail && (
                        <p className="text-muted truncate" title={s.detail.vendors.join(", ")}>
                          {s.detail.vendors.join(", ")} · {s.detail.macs} MAC{s.detail.ip && <span className="font-mono"> · {s.detail.ip}</span>}
                        </p>
                      )}
                      <div className="flex gap-1 mt-1">
                        <Btn kind="primary" className="!h-6 !px-2 !text-[11px]" onClick={() => accept(s)}>
                          <Check size={12} /> Confirmar
                        </Btn>
                        <Btn kind="ghost" className="!h-6 !px-2 !text-[11px]" onClick={() => dismiss(s.id)}>
                          Descartar
                        </Btn>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="space-y-1 text-[12px] text-muted">
                  {emptyHints.map((h) => (
                    <p key={h}>{h}</p>
                  ))}
                </div>
              )}
                </Collapsible>
              </div>
            )}

            <Collapsible
              title={sel ? sel.name : "Detalle"}
            summary={sel ? (sel.manual ? "Agregado a mano" : sel.addrOnly ? "Visto por ruteo, aún sin nombre" : sel.explored ? "Vecinos ya leídos" : "Aún no explorado") : "Selecciona un equipo"}
            right={
              sel?.manual && (
                <div className="flex gap-1">
                  <Btn
                    kind="ghost"
                    className="!px-1.5"
                    title="Editar equipo"
                    onClick={() => (setFormErr(""), setForm({ kind: "node", editId: sel.id, name: sel.name, ip: sel.ip ?? "", platform: sel.platform ?? "" }))}
                  >
                    <Pencil size={13} />
                  </Btn>
                  <Btn
                    kind="ghost"
                    className="!px-1.5 hover:!text-danger"
                    title="Eliminar equipo y sus enlaces"
                    onClick={() => apply(deleteManualNode(topo, sel.id), `Equipo "${sel.name}" eliminado`, () => setSelected(null))}
                  >
                    <Trash2 size={13} />
                  </Btn>
                </div>
              )
            }
              open={isOpen("detalle")}
              onToggle={(v) => setOpen("detalle", v)}
            >
            {sel && (
              <div className="space-y-2 text-[12px]">
                {sel.ip && (
                  <p>
                    <span className="text-muted">{sel.addrOnly ? "Dirección:" : "Gestión:"}</span> <span className="font-mono">{sel.ip}</span>
                  </p>
                )}
                {sel.addrOnly && knownAddrs(sel).length > 1 && (
                  <p className="text-muted">
                    Conocido por: <span className="font-mono">{knownAddrs(sel).slice(0, 6).join(", ")}</span>
                  </p>
                )}
                {sel.platform && (
                  <p className="text-muted leading-snug" title={sel.platform}>
                    {sel.platform.length > 120 ? `${sel.platform.slice(0, 119)}…` : sel.platform}
                  </p>
                )}
                {lifecycle && modelFromPlatform(sel.platform) && (
                  <p className="text-[11.5px]">
                    <LifecycleChip model={modelFromPlatform(sel.platform)!} name={sel.name} />
                  </p>
                )}
                <div className="space-y-1 max-h-56 overflow-y-auto">
                  {topo.links
                    .filter((l) => l.a === sel.id || l.b === sel.id)
                    .map((l, i) => {
                      const mine = l.a === sel.id;
                      const other = node(mine ? l.b : l.a);
                      const myPort = mine ? l.aPort : l.bPort;
                      const info = portLine(sel, myPort);
                      const editable = isUserProto(l.proto);
                      const linkIssues = checks.get(linkKey(l));
                      return (
                        <div key={i} className="flex items-start rounded-md hover:bg-hover">
                          <button onClick={() => setSelected(other?.id ?? null)} className="flex-1 min-w-0 text-left px-2 py-1">
                            <span className="font-mono text-[11.5px]">
                              {myPort || "?"} → {other?.name} {(mine ? l.bPort : l.aPort) || ""}
                            </span>
                            {!isPhysicalProto(l.proto) && <span className="ml-1.5 text-[11px] text-muted">{protoLabel(l)}</span>}
                            {linkIssues && (
                              <TriangleAlert
                                size={12}
                                className={`inline ml-1.5 -mt-0.5 ${worstSev(linkIssues) === "crit" ? "text-danger" : "text-warn"}`}
                                aria-label={linkIssues.map((i) => i.text).join(". ")}
                              >
                                <title>{linkIssues.map((i) => i.text).join("\n")}</title>
                              </TriangleAlert>
                            )}
                            {info && <span className="block text-[11px] text-muted truncate">{info}</span>}
                          </button>
                          {editable && (
                            <>
                              <Btn
                                kind="ghost"
                                className="!h-6 !px-1"
                                title="Editar enlace"
                                onClick={() => (setFormErr(""), setForm({ kind: "link", edit: l, a: l.a, aPort: l.aPort, b: l.b, bPort: l.bPort }))}
                              >
                                <Pencil size={12} />
                              </Btn>
                              <Btn kind="ghost" className="!h-6 !px-1 hover:!text-danger" title="Eliminar enlace" onClick={() => apply(deleteManualLink(topo, l), "Enlace eliminado")}>
                                <X size={12} />
                              </Btn>
                            </>
                          )}
                        </div>
                      );
                    })}
                </div>
                {sel.macs && Object.keys(sel.macs).length > 0 && (
                  <details className="rounded-md border border-line px-2 py-1">
                    <summary className="cursor-pointer text-[11.5px] text-muted">MAC por puerto ({Object.keys(sel.macs).length})</summary>
                    <ul className="mt-1 space-y-1 max-h-48 overflow-y-auto">
                      {Object.entries(sel.macs)
                        .sort(([, x], [, y]) => x.port.localeCompare(y.port, undefined, { numeric: true }))
                        .map(([k, mp]) => {
                          const ips = mp.macs.map((e) => e.ip).filter(Boolean);
                          return (
                            <li key={k} className="text-[11px] leading-snug">
                              <span className="font-mono">{mp.port}</span>
                              <span className="text-muted">
                                {" "}
                                · {mp.total} MAC · {macVendors(mp).join(", ")}
                                {ips.length > 0 && ` · ${ips.slice(0, 2).join(", ")}${ips.length > 2 ? "…" : ""}`}
                                {macPortLinked(topo, sel, k) && " · con enlace"}
                              </span>
                            </li>
                          );
                        })}
                    </ul>
                  </details>
                )}
                <div className="grid grid-cols-2 gap-1.5">
                  <Btn className="!text-[11.5px]" onClick={() => setPath({ from: sel.id, to: path.to !== sel.id ? path.to : undefined })}>
                    <Route size={13} /> Desde aquí
                  </Btn>
                  <Btn className="!text-[11.5px]" disabled={!path.from || path.from === sel.id} onClick={() => setPath({ ...path, to: sel.id })}>
                    Hasta aquí
                  </Btn>
                </div>
                <Btn
                  className="w-full !text-[11.5px]"
                  title="Muestra solo los equipos a 2 saltos de este (se ajusta en Filtros)"
                  onClick={() => {
                    setFilter((f) => ({ ...f, hops: f.hops || 2, focus: sel.id }));
                    setOpen("filtros", true);
                  }}
                >
                  <ListFilter size={13} /> Ver su vecindario
                </Btn>
                <ConnectPanel
                  n={sel}
                  getPlan={computePlan}
                  crumb={crumbState}
                  onRun={runChoice}
                  onFocus={onFocusTab}
                  onDiscover={discoverFromTab}
                  canDiscover={mode === "cli" && !busy}
                  onMenu={(e, n) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setNodeMenu({ x: r.left, y: r.bottom + 4, items: openMenuItems(n) });
                  }}
                  hopping={[...hopRuns.current.values()].some((r) => r.route.steps.length > 0 && nodeId(r.route.steps[r.route.steps.length - 1].name) === sel.id)}
                  proto={proto}
                  onProto={setProto}
                  hopUser={hopUser}
                  onHopUser={setHopUser}
                  userHint={term?.session.username ?? ""}
                  askUser={vendor !== "huawei"}
                  savedHops={savedHops}
                  vault={vault}
                  onUnlocked={refreshCreds}
                  usePivotCred={usePivotCred}
                  onUsePivotCred={setUsePivotCred}
                  skipSaved={skipSavedCred}
                  onSkipSaved={setSkipSavedCred}
                />
                {sel.ip && (
                  <Btn className="w-full" title={`Copia ${sel.ip} (también ${isMac ? "⌘" : "Ctrl"}+C con el equipo seleccionado en el mapa, o clic derecho sobre él)`} onClick={() => copyText(sel.ip!, "IP")}>
                    <Copy size={13} /> Copiar IP
                  </Btn>
                )}
              </div>
            )}
            </Collapsible>

            {(path.from || path.to) && (
              <Collapsible
                title="Ruta"
                summary={`${path.from ? (node(path.from)?.name ?? path.from) : "?"} → ${path.to ? (node(path.to)?.name ?? path.to) : "elige destino"}`}
              right={
                <div className="flex gap-1">
                  {route && (
                    <Btn kind="ghost" className="!px-1.5" title="Copiar ruta" onClick={() => writeText(pathText).then(() => setMsg("Ruta copiada"))}>
                      <Copy size={13} />
                    </Btn>
                  )}
                  <Btn kind="ghost" className="!px-1.5" title="Quitar ruta" onClick={() => setPath({})}>
                    <X size={13} />
                  </Btn>
                </div>
              }
                open={isOpen("ruta")}
                onToggle={(v) => setOpen("ruta", v)}
              >
              {path.from && path.to ? (
                route ? (
                  <pre className="text-[11.5px] font-mono whitespace-pre-wrap leading-relaxed">
                    {pathText}
                    {"\n"}
                    <span className="text-muted">{route.links.length} saltos</span>
                  </pre>
                ) : (
                  <p className="text-[12px] text-danger">No hay camino conocido entre ambos equipos.</p>
                )
              ) : (
                <p className="text-[12px] text-muted">Selecciona otro equipo y pulsa "Hasta aquí".</p>
              )}
              </Collapsible>
            )}

            <div ref={manualRef} className="scroll-mt-2">
              <Collapsible
                title="Manual"
                summary={form ? (form.kind === "node" ? "Equipo" : "Enlace") : "Equipos y enlaces agregados a mano"}
                open={isOpen("manual")}
                onToggle={(v) => setOpen("manual", v)}
            right={
              !form && (
                <div className="flex gap-1">
                  <Btn kind="ghost" className="!px-1.5 !text-[11.5px]" title="Agregar equipo" onClick={() => (setFormErr(""), setForm({ kind: "node", name: "", ip: "", platform: "" }))}>
                    <Plus size={13} /> Equipo
                  </Btn>
                  <Btn
                    kind="ghost"
                    className="!px-1.5 !text-[11.5px]"
                    title="Agregar enlace"
                    disabled={topo.nodes.length < 2}
                    onClick={() => (setFormErr(""), setForm({ kind: "link", a: selected ?? "", aPort: "", b: "", bPort: "" }))}
                  >
                    <Plus size={13} /> Enlace
                  </Btn>
                </div>
              )
            }
              >
            {form?.kind === "node" && (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitForm();
                }}
              >
                <Label text="Nombre">
                  <input autoFocus className="field" maxLength={LIMITS.name} value={form.name} placeholder="ej: sw-bodega-01" onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </Label>
                <Label text="IP de gestión (opcional)">
                  <input className="field font-mono" maxLength={45} value={form.ip} placeholder="192.0.2.10" onChange={(e) => setForm({ ...form, ip: e.target.value })} />
                </Label>
                <Label text="Plataforma (opcional)">
                  <input className="field" maxLength={LIMITS.platform} value={form.platform} placeholder="ej: C9200L-24P" onChange={(e) => setForm({ ...form, platform: e.target.value })} />
                </Label>
                {formErr && <p className="text-[11.5px] text-danger">{formErr}</p>}
                <div className="flex gap-1.5">
                  <Btn kind="primary" type="submit" className="flex-1">
                    {form.editId ? "Guardar" : "Agregar equipo"}
                  </Btn>
                  <Btn type="button" onClick={() => setForm(null)}>
                    Cancelar
                  </Btn>
                </div>
              </form>
            )}
            {form?.kind === "link" && (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitForm();
                }}
              >
                {(["a", "b"] as const).map((side) => (
                  <div key={side} className="grid grid-cols-[1fr_92px] gap-1.5">
                    <Label text={`Equipo ${side.toUpperCase()}`}>
                      <select className="field" value={form[side]} onChange={(e) => setForm({ ...form, [side]: e.target.value })}>
                        <option value="">Elegir…</option>
                        {nodesByName.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.name}
                          </option>
                        ))}
                      </select>
                    </Label>
                    <Label text="Interfaz">
                      <input
                        className="field font-mono"
                        maxLength={LIMITS.port}
                        value={side === "a" ? form.aPort : form.bPort}
                        placeholder="Gi1/0/1"
                        onChange={(e) => setForm({ ...form, [side === "a" ? "aPort" : "bPort"]: e.target.value })}
                      />
                    </Label>
                  </div>
                ))}
                {formErr && <p className="text-[11.5px] text-danger">{formErr}</p>}
                <div className="flex gap-1.5">
                  <Btn kind="primary" type="submit" className="flex-1">
                    {form.edit ? "Guardar" : "Agregar enlace"}
                  </Btn>
                  <Btn type="button" onClick={() => setForm(null)}>
                    Cancelar
                  </Btn>
                </div>
              </form>
            )}
            {!form && <p className="text-[12px] text-muted">Se guardan con el diagrama, entran en snapshots, rutas y exportaciones.</p>}
              </Collapsible>
            </div>

            <Collapsible
              title="Snapshots y cambios"
              badge={diffCount || undefined}
              summary={snapshot ? `Comparando con "${snapshot.name}"` : snapshots.length ? `${snapshots.length} guardados` : "Guarda una copia para comparar después"}
              open={isOpen("snapshots")}
              onToggle={(v) => setOpen("snapshots", v)}
            >
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-1">
          {snapName === null ? (
            <Btn kind="ghost" title="Guardar una copia para comparar más adelante" disabled={!topo.nodes.length} onClick={() => setSnapName("")}>
              <Camera size={14} /> Snapshot
            </Btn>
          ) : (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                saveSnapshot();
              }}
            >
              <input
                autoFocus
                className="field !h-7 w-48 !text-[12px]"
                placeholder="Nombre (ej: antes del cambio)"
                value={snapName}
                onChange={(e) => setSnapName(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setSnapName(null)}
              />
              <Btn kind="primary" type="submit" className="!h-7">
                Guardar
              </Btn>
            </form>
          )}
                </div>
                <div className="flex items-center gap-1">
          <label className="flex flex-1 min-w-0 items-center gap-1 text-[12px]" title="Compara el diagrama actual con un snapshot">
            <GitCompare size={14} className="text-muted" />
            <select className="field !h-7 !w-full flex-1 min-w-0 !text-[12px]" value={compareId} onChange={(e) => setCompareId(e.target.value)} disabled={!snapshots.length}>
              <option value="">{snapshots.length ? "Comparar con…" : "Sin snapshots"}</option>
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {snapshot && (
            <>
              <Btn
                kind="ghost"
                title="Reemplazar el diagrama actual por este snapshot"
                onClick={() => {
                  const open = () => {
                    onTopo(snapshot.topo);
                    setCompareId("");
                    setMsg(`Snapshot "${snapshot.name}" abierto`);
                  };
                  if (!topo.nodes.length) return open();
                  onConfirm({
                    title: `¿Reemplazar el diagrama por "${snapshot.name}"?`,
                    message: "El diagrama actual (equipos, enlaces manuales y posiciones) se pierde. Guarda un snapshot antes si lo necesitas.",
                    label: "Reemplazar",
                    danger: true,
                    defaultCancel: true,
                    action: open,
                  });
                }}
              >
                Abrir
              </Btn>
              <Btn
                kind="ghost"
                className="hover:!text-danger"
                title="Eliminar snapshot"
                onClick={() =>
                  onConfirm({
                    title: `¿Eliminar el snapshot "${snapshot.name}"?`,
                    message: "No se puede deshacer. El diagrama actual no cambia.",
                    label: "Eliminar",
                    danger: true,
                    defaultCancel: true,
                    action: () => {
                      onSnapshots(snapshots.filter((s) => s.id !== snapshot.id));
                      setCompareId("");
                    },
                  })
                }
              >
                <X size={14} />
              </Btn>
            </>
          )}
                </div>
                {diff && snapshot && (
                  <div>
                    <p className="mb-1 text-[11.5px] font-medium text-muted">Cambios respecto de "{snapshot.name}"</p>
              {!diff.addedLinks.length && !diff.removedLinks.length && !diff.addedNodes.length && !diff.removedNodes.length ? (
                <p className="text-[12px] text-muted">Sin diferencias.</p>
              ) : (
                <ul className="space-y-1 text-[11.5px] font-mono">
                  {diff.removedNodes.map((n) => (
                    <li key={`rn${n.id}`} className="text-danger">
                      − {n.name}
                    </li>
                  ))}
                  {diff.addedNodes.map((id) => (
                    <li key={`an${id}`} className="text-ok">
                      + {node(id)?.name ?? id}
                    </li>
                  ))}
                  {diff.removedLinks.map((l, i) => (
                    <li key={`rl${i}`} className="text-danger">
                      − {anyName(l.a)} {l.aPort} ↔ {l.bPort} {anyName(l.b)}
                    </li>
                  ))}
                  {diff.addedLinks.map((l, i) => (
                    <li key={`al${i}`} className="text-ok">
                      + {anyName(l.a)} {l.aPort} ↔ {l.bPort} {anyName(l.b)}
                    </li>
                  ))}
                </ul>
              )}
                  </div>
                )}
              </div>
            </Collapsible>
          </aside>
        )}
      </div>
    </div>
  );
}
