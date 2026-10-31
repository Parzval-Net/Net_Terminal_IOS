import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeftRight, BellRing, Blocks, Bot, Check, FolderOpen, Highlighter, Info, KeyRound, Palette, ScrollText, Search, SquareTerminal, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import logo from "../assets/logo.svg";
import type { ModuleId } from "../lib/settings";
import { useDragResize } from "../lib/useDragResize";

const AiSettings = lazy(() => import("./AiSettings").then((m) => ({ default: m.AiSettings })));
import type { ITheme } from "@xterm/xterm";
import { HighlightSettings } from "./HighlightSettings";
import { AlertSettings } from "./AlertSettings";
import { CredentialSettings } from "./CredentialSettings";
import { allFolders } from "../lib/folders";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { Settings, UpdateInfo, defaultSettings } from "../lib/settings";
import { Session } from "../types";
import { TermPreset, fontStack, presets } from "../lib/theme";
import { isMobile, zoomLabel } from "../lib/platform";
import { GHOST_COLORS, GHOST_STYLES, type GhostColor, type GhostStyle, LIST_KEYS, type ListKey, TIP_TIMES, clearUsage } from "../lib/suggest";

import { plural } from "../lib/plural";
import { ConfirmDialog } from "./ConfirmDialog";
import { createPortal } from "react-dom";
interface Props {
  settings: Settings;
  appDark: boolean;
  termTheme: ITheme;
  sessions: Session[];
  onImportSessions: (list: Session[]) => Promise<number>;
  /** Importación desde archivos de otros clientes. */
  onImportFile?: () => void;
  onExportFile: () => void;
  initialSection?: Section;
  mcpStatus: string;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}

export type Section = "appearance" | "highlight" | "terminal" | "alerts" | "modules" | "ai" | "credentials" | "data" | "sessions" | "about";

const MODULES: [ModuleId, string, string][] = [
  ["monitor", "Monitoreo", "Sondas ICMP/TCP con gráfico y alarma sonora"],
  ["diag", "Diagnóstico", "Ping continuo, traceroute y verificación de puertos"],
  ["topology", "Topología", "Diagrama de vecinos CDP/LLDP y de ruteo, enlaces manuales y seguimiento de rutas"],
  ["subnet", "Subredes", "Calculadora IPv4/IPv6 y división de redes"],
  ["perf", "Velocidad", "Speedtest (Cloudflare) e iperf3"],
  ["transfer", "Transferencias", "TFTP, HTTP, FTP y SFTP: servir firmware y recibir respaldos desde equipos"],
  ["syslog", "Syslog", "Recibir logs de equipos en vivo"],
  ["snmp", "SNMP", "Consultas v1/v2c/v3, conjuntos de OIDs y receptor de traps"],
  ["plugins", "Plugins", "Extensiones instalables en Python"],
  ["backup", "Respaldos", "Respaldo de configuración por fabricante y comparación de versiones"],
];

/**
 * Secciones agrupadas por tarea (General, Sesiones y datos, Herramientas, Integraciones):
 * grupos de 2 a 3 ítems con etiquetas que describen qué configura cada uno, en vez de una
 * lista plana de nueve. Los ids se conservan para que los enlaces directos sigan funcionando.
 * `keywords`: lo que busca el cuadro de búsqueda (etiquetas de los ajustes de la sección).
 */
const sections: { id: Section; label: string; Icon: typeof Palette; group: string; keywords: string }[] = [
  { id: "appearance", label: "Apariencia", Icon: Palette, group: "General", keywords: "interfaz claro oscuro sistema barra de sesiones flotante superpuesta pestañas verticales horizontales tema de terminal fuente tamaño interlineado cursor parpadeante colores" },
  { id: "terminal", label: "Terminal", Icon: SquareTerminal, group: "General", keywords: "historial scrollback copiar al seleccionar pegar clic derecho confirmar al cerrar legacy ssh algoritmos antiguos ssh-rsa compatibilidad sugerencias de comandos autocompletar abreviaturas historial de sugerencias tecla de lista confirmar envío varias líneas barra de botones pausa entre líneas notas barra de teclas tactiles táctiles android móvil virtual" },
  { id: "highlight", label: "Resaltado", Icon: Highlighter, group: "General", keywords: "resaltado sintaxis reglas regex esquemas fabricante cisco juniper huawei fortinet colores exportar importar" },
  { id: "data", label: "Logs", Icon: ScrollText, group: "Sesiones y datos", keywords: "logs grabar automáticamente hora en cada línea nombre del archivo patrón anexar rotación diaria ocultar secretos carpeta de logs" },
  { id: "credentials", label: "Credenciales", Icon: KeyRound, group: "Sesiones y datos", keywords: "contraseñas guardadas bóveda llavero contraseña maestra portable credenciales" },
  { id: "sessions", label: "Importar y exportar", Icon: ArrowLeftRight, group: "Sesiones y datos", keywords: "sesiones importar exportar portapapeles json putty securecrt mobaxterm ssh config csv carpeta de datos portable" },
  { id: "modules", label: "Módulos", Icon: Blocks, group: "Herramientas", keywords: "módulos cli lab scripts automatización monitoreo diagnóstico topología subredes velocidad tftp http syslog plugins respaldos herramientas" },
  { id: "alerts", label: "Alertas", Icon: BellRing, group: "Herramientas", keywords: "alertas palabra clave reglas sonido aviso pestaña expresión regular" },
  { id: "ai", label: "Agentes IA", Icon: Bot, group: "Integraciones", keywords: "agentes ia mcp claude gemini codex puerto token aprobación solo lectura servidor" },
  { id: "about", label: "Acerca de", Icon: Info, group: "Acerca de", keywords: "versión actualizaciones buscar ahora github repositorio autor" },
];

const FONTS = [
  "JetBrains Mono",
  "Fira Code",
  "Cascadia Code",
  "Cascadia Mono",
  "Consolas",
  "SF Mono",
  "Menlo",
  "Monaco",
  "Source Code Pro",
  "IBM Plex Mono",
  "Ubuntu Mono",
  "DejaVu Sans Mono",
  "Hack",
];

export function SettingsModal({
  settings: s,
  appDark,
  termTheme,
  sessions,
  onImportSessions,
  onImportFile,
  onExportFile,
  initialSection,
  mcpStatus,
  onChange,
  onClose,
}: Props) {
  const [section, setSection] = useState<Section>(initialSection ?? "appearance");
  const win = useDragResize("settingsWindow");
  const [dataDir, setDataDir] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  // Lo que "Restablecer valores" borra además de las preferencias (las reglas de resaltado propias se conservan).
  const resetLoses = [
    s.macros.length && plural(s.macros.length, "botón de comandos", "botones de comandos"),
    s.monitors.length && plural(s.monitors.length, "monitor", "monitores"),
    s.alertRules.length && plural(s.alertRules.length, "regla de alerta", "reglas de alerta"),
    s.topology.nodes.length && `la topología (${plural(s.topology.nodes.length, "equipo", "equipos")})`,
    s.topoSnapshots.length && plural(s.topoSnapshots.length, "snapshot de topología", "snapshots de topología"),
    s.snmpProfiles.length && plural(s.snmpProfiles.length, "perfil SNMP", "perfiles SNMP"),
    s.favCommands.length && plural(s.favCommands.length, "comando favorito", "comandos favoritos"),
    s.extraFolders.length && plural(s.extraFolders.length, "carpeta vacía", "carpetas vacías"),
    s.speedHistory.length && "el historial de velocidad",
    s.disabledPacks.length && plural(s.disabledPacks.length, "pack desactivado (vuelve a activarse)", "packs desactivados (vuelven a activarse)"),
    !isMobile && s.mcpEnabled && "la configuración del servidor MCP (se apaga y su token se borra)",
  ].filter((x): x is string => !!x);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const baseSections = useMemo(() => (isMobile ? sections.filter((x) => x.id !== "ai") : sections), []);
  const visible = useMemo(
    () => (q ? baseSections.filter((x) => x.label.toLowerCase().includes(q) || x.keywords.includes(q)) : baseSections),
    [q, baseSections],
  );
  // Al buscar se muestra la primera sección que coincide.
  useEffect(() => {
    if (q && visible.length && !visible.some((x) => x.id === section)) setSection(visible[0].id);
  }, [q, visible, section]);
  const groups = useMemo(() => {
    const out: { name: string; items: typeof sections }[] = [];
    for (const x of visible) {
      const g = out.find((o) => o.name === x.group);
      if (g) g.items.push(x);
      else out.push({ name: x.group, items: [x] });
    }
    return out;
  }, [visible]);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(""), 3500);
  };

  const importSessions = async () => {
    let list: Session[];
    try {
      const data = JSON.parse(await readText());
      list = (Array.isArray(data) ? data : [data]).filter(
        (x): x is Session => x && typeof x.name === "string" && ["ssh", "telnet", "raw", "serial", "local"].includes(x.type),
      );
    } catch {
      return flash("El portapapeles no contiene sesiones válidas (JSON)");
    }
    if (!list.length) return flash("El portapapeles no contiene sesiones válidas (JSON)");
    try {
      const added = await onImportSessions(list);
      flash(`${plural(added, "sesión importada", "sesiones importadas")}${added < list.length ? `, ${plural(list.length - added, "ya existía", "ya existían")}` : ""}`);
    } catch (e) {
      flash(`Importación incompleta: ${e}`);
    }
  };

  useEffect(() => {
    invoke<string>("data_dir").then(setDataDir).catch(() => {});
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const autoPreset = presets[appDark ? 0 : 1];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-0 sm:p-4" onMouseDown={onClose}>
      <div
        {...win.box}
        className="@container w-full h-full sm:w-[800px] sm:h-[600px] min-w-0 sm:min-w-[420px] min-h-0 sm:min-h-[340px] max-w-full sm:max-w-[96vw] max-h-full sm:max-h-[94vh] sm:resize flex bg-panel sm:border border-line rounded-none sm:rounded-xl shadow-pop overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <nav
          aria-label="Secciones de ajustes"
          className="hidden @[640px]:block w-44 shrink-0 bg-chrome border-r border-line p-2 space-y-0.5 overflow-y-auto"
        >
          <div {...win.handle} className="px-2 pt-1.5 pb-2 text-[14px] font-semibold select-none">
            Ajustes
          </div>
          <label className="flex items-center gap-1.5 mx-1 mb-2 h-7 px-2 rounded-md border border-field-line bg-field focus-within:border-accent focus-within:ring-3 focus-within:ring-[var(--selected)]">
            <Search size={13} className="text-muted shrink-0" />
            <input
              className="flex-1 min-w-0 bg-transparent outline-none text-[12px] placeholder:text-muted"
              placeholder="Buscar ajuste"
              aria-label="Buscar ajuste"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {groups.map((g) => (
            <div key={g.name} className="pb-1.5">
              {g.name !== "Acerca de" && (
                <div className="px-2 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.name}</div>
              )}
              {g.items.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => setSection(id)}
                  title={label}
                  className={`w-full flex items-center justify-start gap-2 px-2 h-8 rounded-md text-left ${
                    section === id ? "bg-selected text-fg" : "text-muted hover:text-fg hover:bg-hover"
                  }`}
                >
                  <Icon size={15} className="shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          ))}
          {q && !visible.length && <p className="px-2 text-[11.5px] text-muted">Sin resultados</p>}
        </nav>

        <div className="flex-1 min-w-0 flex flex-col">
          <header {...win.handle} className="shrink-0 flex items-center justify-between gap-2 h-12 px-3 sm:px-5 border-b border-line select-none">
            <h2 className="text-[14.5px] sm:text-[14px] font-semibold truncate">{sections.find((x) => x.id === section)?.label}</h2>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setSection("about")}
                title="Acerca de NetTerminal"
                aria-label="Acerca de"
                className={`@[640px]:hidden flex items-center gap-1 px-2.5 h-8 rounded-full border text-[12px] font-medium transition-colors ${
                  section === "about" ? "bg-selected text-accent border-accent/40" : "border-line text-muted hover:text-fg hover:bg-hover"
                }`}
              >
                <Info size={14} />
                <span className="hidden min-[360px]:inline">Acerca de</span>
              </button>
              <button
                onClick={onClose}
                aria-label="Cerrar"
                className="w-8 h-8 sm:w-7 sm:h-7 grid place-items-center rounded-full sm:rounded-md text-muted hover:text-fg hover:bg-hover"
              >
                <X size={17} />
              </button>
            </div>
          </header>

          {/* Barra horizontal deslizable de chips Material 3 en teléfonos y pantallas compactas (< 640px) */}
          <nav
            aria-label="Secciones de ajustes (móvil)"
            className="flex @[640px]:hidden items-center gap-1.5 px-3 py-2 border-b border-line bg-chrome overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden shrink-0"
          >
            {baseSections.map(({ id, label, Icon }) => {
              const isActive = section === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSection(id)}
                  aria-current={isActive ? "page" : undefined}
                  className={`shrink-0 flex items-center gap-1.5 px-3 h-8.5 rounded-full text-[12px] font-medium border transition-colors touch-manipulation ${
                    isActive
                      ? "bg-selected text-fg border-accent/40"
                      : "bg-panel text-muted border-line hover:text-fg hover:bg-hover"
                  }`}
                >
                  <Icon size={14} className={isActive ? "text-accent shrink-0" : "shrink-0"} />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-3 sm:py-4 space-y-4 sm:space-y-5">
            {section === "appearance" && (
              <>
                <Item label="Interfaz">
                  <Segmented
                    value={s.appTheme}
                    onChange={(v) => onChange({ appTheme: v })}
                    options={[
                      ["system", "Sistema"],
                      ["light", "Claro"],
                      ["dark", "Oscuro"],
                    ]}
                  />
                </Item>

                {!isMobile && (
                  <>
                    <Item label="Pestañas" hint="Verticales: en una columna a la izquierda">
                      <Segmented
                        value={s.tabLayout}
                        onChange={(v) => onChange({ tabLayout: v })}
                        options={[
                          ["horizontal", "Horizontales"],
                          ["vertical", "Verticales"],
                        ]}
                      />
                    </Item>

                    <Item
                      label="Barra de sesiones flotante"
                      hint="Con la barra de sesiones cerrada, al pasar el mouse por Sesiones (barra de actividad) se abre sobre la terminal sin empujarla; se cierra al salir, elegir una sesión o con Esc, y «Fijar» la vuelve a acoplar"
                    >
                      <Switch checked={s.floatingSidebar} onChange={(v) => onChange({ floatingSidebar: v })} />
                    </Item>
                  </>
                )}

                <div>
                  <Label>Tema de terminal</Label>
                  <div className="grid grid-cols-1 @[330px]:grid-cols-2 @[520px]:grid-cols-3 gap-2">
                    <ThemeCard
                      preset={{ ...autoPreset, name: "Automático" }}
                      hint="Sigue la interfaz"
                      selected={s.terminalTheme === "auto"}
                      onClick={() => onChange({ terminalTheme: "auto" })}
                      font={s.fontFamily}
                    />
                    {presets.map((p) => (
                      <ThemeCard
                        key={p.id}
                        preset={p}
                        selected={s.terminalTheme === p.id}
                        onClick={() => onChange({ terminalTheme: p.id })}
                        font={s.fontFamily}
                      />
                    ))}
                  </div>
                </div>

                <Item label="Fuente">
                  <input
                    className="field max-w-full w-full sm:!w-52"
                    list="font-list"
                    placeholder="Predeterminada del sistema"
                    value={s.fontFamily}
                    onChange={(e) => onChange({ fontFamily: e.target.value })}
                  />
                  <datalist id="font-list">
                    {FONTS.map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                </Item>

                <Item label="Tamaño" hint={`${zoomLabel}+ / ${zoomLabel}- también lo ajusta`}>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={9}
                      max={28}
                      value={s.fontSize}
                      onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
                      className="w-28 sm:w-36 accent-[var(--accent)]"
                    />
                    <span className="w-10 text-right tabular-nums">{s.fontSize}px</span>
                  </div>
                </Item>

                <Item label="Interlineado">
                  <select
                    className="field max-w-full w-full sm:!w-28"
                    value={s.lineHeight}
                    onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
                  >
                    {[1, 1.1, 1.15, 1.2, 1.3, 1.5].map((v) => (
                      <option key={v} value={v}>
                        {v.toFixed(2)}
                      </option>
                    ))}
                  </select>
                </Item>

                <Item label="Cursor">
                  <Segmented
                    value={s.cursorStyle}
                    onChange={(v) => onChange({ cursorStyle: v })}
                    options={[
                      ["block", "Bloque"],
                      ["bar", "Barra"],
                      ["underline", "Subrayado"],
                    ]}
                  />
                </Item>

                <Item label="Cursor parpadeante">
                  <Switch checked={s.cursorBlink} onChange={(v) => onChange({ cursorBlink: v })} />
                </Item>
              </>
            )}

            {section === "highlight" && (
              <HighlightSettings settings={s} theme={termTheme} onChange={onChange} />
            )}

            {section === "modules" && (
              <>
                <p className="text-[12px] text-muted">
                  Muestra u oculta herramientas y vistas en la interfaz. Desactivar un módulo no borra su configuración ni sus datos.
                </p>
                <Item
                  label="CLI Lab (scripts multilínea)"
                  hint={
                    isMobile
                      ? "Automatización multilínea con variables para varias sesiones. Viene deshabilitada por defecto en móvil para mantener la navegación limpia; ideal si usas tablet con teclado físico."
                      : "Editor y ejecución masiva de scripts multilínea con variables y lectura de respuestas comando a comando."
                  }
                >
                  <Switch
                    checked={s.cliLabEnabled}
                    onChange={(v) => onChange({ cliLabEnabled: v })}
                  />
                </Item>
                {MODULES.filter(([id]) => !isMobile || id !== "plugins").map(([id, label, hint]) => (
                  <Item key={id} label={label} hint={hint}>
                    <Switch
                      checked={s.modules[id] !== false}
                      onChange={(v) => onChange({ modules: { ...s.modules, [id]: v } })}
                    />
                  </Item>
                ))}
              </>
            )}

            {section === "ai" && !isMobile && (
              <Suspense fallback={null}>
                <AiSettings settings={s} status={mcpStatus} onChange={onChange} />
              </Suspense>
            )}

            {section === "terminal" && (
              <>
                <Item label="Historial (scrollback)" hint="Líneas por pestaña. Cada 1.000 líneas llenas ocupan unos 3 MB; el log en disco guarda todo">
                  <select
                    className="field max-w-full w-full sm:!w-32"
                    value={s.scrollback}
                    onChange={(e) => onChange({ scrollback: Number(e.target.value) })}
                  >
                    {[1000, 2000, 5000, 10000, 50000, 100000].map((v) => (
                      <option key={v} value={v}>
                        {v.toLocaleString("es-CL")}
                      </option>
                    ))}
                  </select>
                </Item>
                <Item label="Copiar al seleccionar" hint="El texto seleccionado pasa al portapapeles">
                  <Switch checked={s.copyOnSelect} onChange={(v) => onChange({ copyOnSelect: v })} />
                </Item>
                {!isMobile && (
                  <Item label="Pegar con clic derecho">
                    <Switch checked={s.rightClickPaste} onChange={(v) => onChange({ rightClickPaste: v })} />
                  </Item>
                )}
                <Item
                  label="Barra de teclas táctiles en terminal"
                  hint="Muestra una barra de teclas rápidas (Esc, Tab, Ctrl, flechas, ?, |, pegar, buscar) optimizada para dispositivos Android y pantallas táctiles"
                >
                  <Switch checked={s.showMobileKeyBar} onChange={(v) => onChange({ showMobileKeyBar: v })} />
                </Item>
                <Item label="Confirmar al cerrar" hint="Pide confirmación antes de cortar una sesión remota activa">
                  <Switch checked={s.confirmClose} onChange={(v) => onChange({ confirmClose: v })} />
                </Item>
                <Item
                  label="Ciclo de vida del equipo (EoL)"
                  hint="Muestra en la barra de estado el modelo, la etapa de fin de vida (fin de venta, de software, de soporte) y si conviene actualizar el sistema operativo, leyendo el show version que ejecutes (no envía comandos). Bases oficiales de Cisco, Meraki, Fortinet, Juniper y HPE Aruba; se descargan recién al activarlo"
                >
                  <Switch checked={s.lifecycleInfo} onChange={(v) => onChange({ lifecycleInfo: v })} />
                </Item>
                <Item
                  label="Activar algoritmos legacy automáticamente"
                  hint="Si un equipo SSH exige ssh-rsa, SHA1 o CBC, reconecta una vez en modo compatible y lo deja guardado en la sesión. Usa algoritmos débiles: actívalo solo en redes de gestión confiables"
                >
                  <Switch checked={s.autoLegacySsh} onChange={(v) => onChange({ autoLegacySsh: v })} />
                </Item>
                <Item
                  label="Sugerencias de comandos"
                  hint="En sesiones remotas con plataforma detectada o fijada en el catálogo, muestra en color el resto de un comando de consulta, también si lo escribes abreviado (sh ip int br). Tab o Flecha derecha lo acepta, Ctrl+→ u Option+→ acepta una palabra, Esc la descarta en esa línea y la tecla de lista abre hasta 8 comandos. Sin sugerencia visible, Tab y Esc van al equipo como siempre. Nunca se envía Enter; los comandos con riesgo solo aparecen en la lista y piden confirmación. En modo configuración solo sugiere tras do (Cisco) o run (Junos). No funciona en la terminal local"
                >
                  <Switch checked={s.commandSuggest} onChange={(v) => onChange({ commandSuggest: v, commandSuggestSet: true })} />
                </Item>
                {s.commandSuggest && (
                  <>
                    {!isMobile && (
                      <>
                        <Item label="Tecla para abrir la lista" hint="Ctrl+Espacio choca con el cambio de fuente de entrada de macOS. En Linux con IBus, Ctrl+. puede abrir el selector de emojis: usa Alt+/ (tecla física de la barra en el teclado US, la del guion en el latinoamericano)">
                          <select
                            className="field max-w-full w-full sm:!w-40"
                            value={s.suggestListKey}
                            onChange={(e) => onChange({ suggestListKey: e.target.value as ListKey })}
                          >
                            {(Object.keys(LIST_KEYS) as ListKey[]).map((k) => (
                              <option key={k} value={k}>
                                {LIST_KEYS[k]}
                              </option>
                            ))}
                          </select>
                        </Item>
                        <Item
                          label="Tab acepta la sugerencia"
                          hint="Solo cuando hay una sugerencia visible. Sin sugerencia (en un marcador como {{interfaz}}, un nombre que no está en el catálogo o tras Esc), Tab va al equipo y funciona su autocompletado. Un segundo Tab dentro de 400 ms también va al equipo, para seguir con su autocompletado"
                        >
                          <Switch checked={s.suggestTabAccept} onChange={(v) => onChange({ suggestTabAccept: v })} />
                        </Item>
                      </>
                    )}
                    <Item label="Color de la sugerencia" hint="Automático elige por tema un color con al menos 3:1 de contraste con el fondo, distinto del texto y del cursor. Un tono fijo se ajusta a cada tema para mantener ese contraste">
                      <select className="field max-w-full w-full sm:!w-40" value={s.suggestColor} onChange={(e) => onChange({ suggestColor: e.target.value as GhostColor })}>
                        {(Object.keys(GHOST_COLORS) as GhostColor[]).map((k) => (
                          <option key={k} value={k}>
                            {GHOST_COLORS[k]}
                          </option>
                        ))}
                      </select>
                    </Item>
                    <Item label="Estilo de la sugerencia" hint="Cursiva o subrayado punteado la distinguen aún más de la salida del equipo">
                      <select className="field max-w-full w-full sm:!w-40" value={s.suggestStyle} onChange={(e) => onChange({ suggestStyle: e.target.value as GhostStyle })}>
                        {(Object.keys(GHOST_STYLES) as GhostStyle[]).map((k) => (
                          <option key={k} value={k}>
                            {GHOST_STYLES[k]}
                          </option>
                        ))}
                      </select>
                    </Item>
                    <Item
                      label="Mostrar ayuda junto a la sugerencia"
                      hint={`Indica «Tab o → acepta · Esc descarta» en las primeras ${TIP_TIMES} líneas con sugerencia de cada plataforma y luego se oculta. Borrar el historial de sugerencias la vuelve a mostrar`}
                    >
                      <Switch checked={s.suggestTip} onChange={(v) => onChange({ suggestTip: v })} />
                    </Item>
                    <ClearSuggestHistory />
                  </>
                )}
                <div className="pt-2 text-[12px] font-medium text-muted">Notas</div>
                <Item label="Confirmar envío de varias líneas" hint="Muestra un resumen antes de enviar o pegar un bloque en un equipo remoto">
                  <Switch checked={s.confirmSend} onChange={(v) => onChange({ confirmSend: v })} />
                </Item>
                <Item
                  label="Barra de botones"
                  hint={
                    isMobile
                      ? "Comandos rápidos de un clic sobre la barra de estado. Se oculta sola si no hay botones"
                      : "Comandos rápidos y scripts sobre la barra de estado. Se oculta sola si no hay botones; «Nuevo botón» y los scripts siguen en la paleta (⌘K)"
                  }
                >
                  <Switch checked={s.showButtonBar} onChange={(v) => onChange({ showButtonBar: v })} />
                </Item>
                <Item label="Pausa entre líneas" hint="Útil en consolas serial o equipos que pierden caracteres al pegar">
                  <select
                    className="field max-w-full w-full sm:!w-32"
                    value={s.sendLineDelay}
                    onChange={(e) => onChange({ sendLineDelay: Number(e.target.value) })}
                  >
                    {[0, 25, 50, 100, 250, 500].map((v) => (
                      <option key={v} value={v}>
                        {v === 0 ? "Sin pausa" : `${v} ms`}
                      </option>
                    ))}
                  </select>
                </Item>
              </>
            )}

            {section === "about" && <About settings={s} onChange={onChange} />}

            {section === "credentials" && <CredentialSettings />}

            {section === "alerts" && (
              <AlertSettings settings={s} folders={allFolders(sessions, s.extraFolders)} onChange={onChange} />
            )}

            {section === "data" && (
              <>
                <Item label="Grabar logs automáticamente" hint="Cada sesión remota se registra en texto plano">
                  <Switch checked={s.autoLog} onChange={(v) => onChange({ autoLog: v })} />
                </Item>
                <Item label="Hora en cada línea del log" hint="Formato [AAAA-MM-DD HH:MM:SS], útil como evidencia de cambios">
                  <Switch checked={s.logTimestamps} onChange={(v) => onChange({ logTimestamps: v })} />
                </Item>
                <LogNaming settings={s} onChange={onChange} />
                <Item label="Si el archivo ya existe" hint="Anexar sirve con nombres sin hora, p. ej. un log por equipo y día">
                  <Segmented
                    value={s.logAppend ? "append" : "new"}
                    onChange={(v) => onChange({ logAppend: v === "append" })}
                    options={[
                      ["new", "Archivo nuevo"],
                      ["append", "Anexar"],
                    ]}
                  />
                </Item>
                <Item label="Rotación diaria" hint="Al cambiar el día se continúa en un archivo con la fecha nueva">
                  <Switch checked={s.logRotateDaily} onChange={(v) => onChange({ logRotateDaily: v })} />
                </Item>
                <Item label="Ocultar secretos en los logs" hint="password, secret, community, key-string, pre-shared-key… se guardan como ****">
                  <Switch checked={s.logMask} onChange={(v) => onChange({ logMask: v })} />
                </Item>
                <LogsFolder settings={s} onChange={onChange} />
              </>
            )}

            {section === "sessions" && (
              <>
                <Item label="Sesiones" hint="Comparte tu lista de equipos en XML o JSON, o importa desde otros clientes">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={importSessions}
                      className="px-3 h-8 sm:h-7 rounded-lg sm:rounded-md border border-line hover:bg-hover"
                    >
                      Importar
                    </button>
                    {onImportFile && (
                      <button
                        onClick={onImportFile}
                        title="PuTTY, SecureCRT, MobaXterm, ~/.ssh/config o CSV"
                        className="px-3 h-8 sm:h-7 rounded-lg sm:rounded-md border border-line hover:bg-hover"
                      >
                        Desde archivo…
                      </button>
                    )}
                    <button
                      onClick={onExportFile}
                      title="Elige qué sesiones: XML (compatible con SecureCRT) o JSON"
                      className="px-3 h-8 sm:h-7 rounded-lg sm:rounded-md border border-line hover:bg-hover"
                    >
                      Exportar…
                    </button>
                  </div>
                </Item>
                {notice && <p className="text-[11.5px] text-accent -mt-2">{notice}</p>}
                <Item label="Carpeta de datos" hint={dataDir}>
                  <OpenBtn which="data" />
                </Item>
                {!isMobile && (
                  <p className="text-[11.5px] text-muted">
                    Para modo portable, crea un archivo llamado <code>portable</code> junto al ejecutable: sesiones,
                    ajustes y logs se guardarán en <code>./data</code>.
                  </p>
                )}
              </>
            )}
          </div>

          <footer className="flex flex-wrap justify-between items-center gap-2 px-3 sm:px-5 min-h-12 py-1.5 border-t border-line">
            <button
              onClick={() => setConfirmReset(true)}
              title="Las reglas de resaltado personalizadas se conservan"
              className="px-3 h-8 sm:h-7 rounded-lg sm:rounded-md border border-line text-[12px] text-muted hover:text-danger hover:border-danger"
            >
              Restablecer valores
            </button>
            <span className="text-[11.5px] text-muted">Los cambios se aplican al instante</span>
          </footer>
          {confirmReset &&
            createPortal(
            <ConfirmDialog
              title="¿Restablecer todos los ajustes?"
              message={
                <>
                  Vuelven a sus valores por defecto la apariencia, la terminal, los módulos, los logs y los puertos.
                  {resetLoses.length > 0 && (
                    <>
                      {" "}También se borra:
                      <ul className="mt-1.5 list-disc pl-5">
                        {resetLoses.map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <p className="mt-1.5">Se conservan las sesiones, las notas, los respaldos, las contraseñas guardadas y tus reglas de resaltado. No se puede deshacer.</p>
                </>
              }
              confirmLabel="Restablecer"
              danger
              defaultCancel
              onCancel={() => setConfirmReset(false)}
              onConfirm={() => {
                setConfirmReset(false);
                onChange({ ...defaultSettings, customRules: s.customRules });
              }}
            />,
            document.body,
          )}
        </div>
      </div>
    </div>
  );
}

const LOG_VARS = ["{session}", "{host}", "{folder}", "{date}", "{time}"];

/** Patrón del nombre del log con vista previa (el backend sanea y lo mantiene en la carpeta de logs). */
function LogNaming({ settings: s, onChange }: { settings: Settings; onChange: (p: Partial<Settings>) => void }) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const clean = (v: string) => v.replace(/[^\p{L}\p{N}._\u0000-]/gu, "_");
  const vars: Record<string, string> = {
    "{session}": "core-sw01",
    "{host}": "192.0.2.10",
    "{folder}": "Clientes/Sitio_A/",
    "{date}": `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    "{time}": `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
  };
  const pattern = s.logPattern || defaultSettings.logPattern;
  let preview = pattern
    .replace(/\{folder\}[\/\\]?/g, "\u0000")
    .split(/(\{[a-z]+\})/)
    .map((part) => vars[part] ?? clean(part))
    .join("")
    .replace(/\u0000/g, vars["{folder}"]);
  if (s.logRotateDaily && !pattern.includes("{date}")) preview += `_${vars["{date}"]}`;
  return (
    <div className="space-y-1.5">
      <Item label="Nombre del archivo" hint="Variables: {session} {host} {folder} {date} {time}. {folder} crea subcarpetas">
        <input
          className="field max-w-full w-full sm:!w-56 font-mono !text-[12px]"
          value={s.logPattern}
          maxLength={200}
          placeholder={defaultSettings.logPattern}
          onChange={(e) => onChange({ logPattern: e.target.value })}
        />
      </Item>
      <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
        {LOG_VARS.map((v) => (
          <button
            key={v}
            onClick={() => onChange({ logPattern: (s.logPattern || "") + v })}
            className="px-1.5 h-6 rounded border border-line hover:bg-hover font-mono"
          >
            {v}
          </button>
        ))}
      </div>
      <div className="text-[11px] text-muted truncate font-mono" title={`logs/${preview}.log`}>
        Ejemplo: logs/{preview}.log
      </div>
    </div>
  );
}

interface LogsDirInfo {
  path: string;
  default: string;
  custom: boolean;
  portable: boolean;
}

/** Carpeta de logs: el backend valida (absoluta, existente, con escritura) y la aplica al instante. */
function LogsFolder({ settings: s, onChange }: { settings: Settings; onChange: (p: Partial<Settings>) => void }) {
  const [info, setInfo] = useState<LogsDirInfo | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    invoke<LogsDirInfo>("logs_dir_get").then(setInfo).catch(() => {});
  }, [s.logsDir]);
  const apply = async (path: string) => {
    setError("");
    try {
      setInfo(await invoke<LogsDirInfo>("logs_dir_set", { path: path || null }));
      onChange({ logsDir: path });
    } catch (e) {
      setError(String(e));
    }
  };
  const pick = async () => {
    const dir = await openDialog({ directory: true, multiple: false, title: "Carpeta de logs", defaultPath: info?.path }).catch(() => null);
    if (typeof dir === "string") apply(dir);
  };
  return (
    <div className="space-y-1.5">
      <Item label="Carpeta de logs" hint={info?.path ?? ""}>
        <div className="flex gap-1.5">
          <button onClick={pick} className="px-3 h-7 rounded-md border border-line hover:bg-hover">
            Elegir…
          </button>
          <OpenBtn which="logs" />
        </div>
      </Item>
      {s.logsDir && (
        <div className="flex items-center gap-2 text-[11.5px] text-muted">
          <button onClick={() => apply("")} className="hover:text-fg hover:underline">
            Restablecer a la predeterminada
          </button>
          <span className="truncate" title={info?.default}>({info?.default})</span>
        </div>
      )}
      {s.logsDir && info?.portable && (
        <p className="text-[11.5px] text-warn">Modo portable: los logs fuera de la carpeta data/ no viajan con el pendrive.</p>
      )}
      {error && <p className="text-[11.5px] text-danger">{error}</p>}
    </div>
  );
}

function UpdateSettings({ settings: s, onChange }: { settings: Settings; onChange: (p: Partial<Settings>) => void }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState("");
  const [repo, setRepo] = useState("");
  useEffect(() => {
    invoke<string>("app_version").then(setVersion).catch(() => {});
    invoke<string>("app_repo").then(setRepo).catch(() => {});
  }, []);
  const check = async () => {
    setBusy(true);
    setStatus("");
    try {
      const u = await invoke<UpdateInfo>("update_check");
      if (s.updateDismissed) onChange({ updateDismissed: "" });
      if (u.newer) window.dispatchEvent(new CustomEvent("nt-update-found", { detail: u }));
      setStatus(
        u.newer
          ? u.supported
            ? `Hay una versión nueva: ${u.latest}. Instálala desde el aviso en la parte superior.`
            : `Hay una versión nueva: ${u.latest}. ${u.reason ?? ""}`
          : `Estás al día (${u.current}).`,
      );
    } catch (e) {
      setStatus(String(e));
    }
    setBusy(false);
  };
  return (
    <div className="rounded-xl sm:rounded-lg border border-line p-3.5 sm:p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">Actualizaciones</div>
          <div className="text-[11.5px] text-muted leading-snug">
            Versión instalada {version}. Revisa al abrir la app y cada 6 horas; instala con un clic y verifica la firma del
            proyecto antes de instalar.
          </div>
        </div>
        <button onClick={check} disabled={busy} className="shrink-0 px-3.5 h-8.5 sm:h-7 rounded-full sm:rounded-md border border-line hover:bg-hover disabled:opacity-40 text-[12.5px] sm:text-[12px] font-medium sm:font-normal">
          {busy ? "Buscando…" : "Buscar ahora"}
        </button>
      </div>
      {repo && <p className="text-[11px] text-muted break-all">Fuente: releases de github.com/{repo}</p>}
      {status && <p className="text-[12px] text-accent">{status}</p>}
    </div>
  );
}

/** Acerca de: versión, autor, repositorio y el bloque de actualizaciones (misma información). */
function About({ settings, onChange }: { settings: Settings; onChange: (p: Partial<Settings>) => void }) {
  const [version, setVersion] = useState("");
  const [repo, setRepo] = useState("");
  useEffect(() => {
    invoke<string>("app_version").then(setVersion).catch(() => {});
    invoke<string>("app_repo").then(setRepo).catch(() => {});
  }, []);
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center text-center gap-2 pt-3 pb-2 px-3 rounded-2xl bg-chrome/60 border border-line/60">
        <img src={logo} alt="Logo de NetTerminal" className="w-20 h-20 drop-shadow-sm" draggable={false} />
        <div className="text-[19px] font-semibold tracking-tight">NetTerminal</div>
        <div className="px-2.5 py-0.5 rounded-full bg-selected text-accent text-[11.5px] font-medium">
          Versión {version || "0.9.19"}
        </div>
        <p className="text-[13px] mt-1.5">
          Creado por <span className="font-semibold">Nicolás Rivera</span>
        </p>
        <p className="text-[12px] text-muted">Desarrollado en conjunto con Claude</p>
        <p className="text-[12.5px] text-muted max-w-sm mt-1 leading-relaxed">
          Cliente SSH, Telnet, Serial y terminal local para el trabajo diario con equipos de red. Tauri 2, Rust y xterm.js.
        </p>
        {repo && (
          <button
            onClick={() => openUrl(`https://github.com/${repo}`)}
            className="mt-2 px-4 h-9 sm:h-7 rounded-full sm:rounded-md border border-line bg-panel hover:bg-hover text-[12.5px] sm:text-[12px] font-medium"
          >
            github.com/{repo}
          </button>
        )}
      </div>
      <UpdateSettings settings={settings} onChange={onChange} />
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-[12px] font-medium text-muted">{children}</div>;
}

/** El historial guarda solo plantillas del catálogo, en este equipo (nunca argumentos ni equipos). */
function ClearSuggestHistory() {
  const [done, setDone] = useState(false);
  return (
    <Item label="Historial de sugerencias" hint="Los comandos del catálogo que aceptaste o ejecutaste suben en la lista. Solo se guarda la plantilla del catálogo, en este equipo. Borrarlo también vuelve a mostrar la ayuda junto a la sugerencia">
      <button
        onClick={() => {
          clearUsage();
          setDone(true);
        }}
        disabled={done}
        className="px-3 h-8 sm:h-7 rounded-lg sm:rounded-md border border-line hover:bg-hover disabled:opacity-50 text-[12px]"
      >
        {done ? "Historial borrado" : "Borrar historial de sugerencias"}
      </button>
    </Item>
  );
}

function Item({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 min-h-10 sm:min-h-8 py-1 sm:py-0">
      <div className="min-w-0 sm:min-w-[160px] flex-1">
        <div className="font-medium sm:font-normal">{label}</div>
        {hint && <div className="text-[11.5px] text-muted leading-snug sm:truncate mt-0.5" title={hint}>{hint}</div>}
      </div>
      <div className="shrink-0 max-w-full">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 sm:w-9 sm:h-5 rounded-full transition-colors touch-manipulation before:absolute before:-inset-[4px] before:content-[''] ${checked ? "bg-accent" : "bg-field-line"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 sm:w-4 sm:h-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5 sm:translate-x-4" : ""
        }`}
      />
    </button>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap p-0.5 rounded-xl sm:rounded-lg bg-hover">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-3 h-8 sm:h-7 rounded-lg sm:rounded-md text-[12.5px] font-medium sm:font-normal touch-manipulation ${
            value === v ? "bg-panel shadow-sm text-fg" : "text-muted hover:text-fg"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ThemeCard({
  preset,
  hint,
  selected,
  onClick,
  font,
}: {
  preset: TermPreset;
  hint?: string;
  selected: boolean;
  onClick: () => void;
  font: string;
}) {
  const t = preset.theme;
  const swatches = [t.red, t.green, t.yellow, t.blue, t.magenta, t.cyan];
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg border overflow-hidden ${
        selected ? "border-accent ring-2 ring-[var(--selected)]" : "border-line hover:border-muted"
      }`}
    >
      <div className="px-2.5 py-2 text-[11px] leading-snug" style={{ background: t.background, color: t.foreground, fontFamily: fontStack(font) }}>
        <div>
          <span style={{ color: t.green }}>noc@core</span>
          <span style={{ color: t.blue }}>:~</span>$ show ver
        </div>
        <div className="flex gap-1 mt-1.5">
          {swatches.map((c, i) => (
            <span key={i} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between px-2.5 h-7 text-[12px]">
        <span className="truncate" title={hint ? `${preset.name} · ${hint}` : preset.name}>
          {preset.name}
          {hint && <span className="text-muted"> · {hint}</span>}
        </span>
        {selected && <Check size={13} className="text-accent shrink-0" />}
      </div>
    </button>
  );
}

function OpenBtn({ which }: { which: "logs" | "data" }) {
  if (isMobile) return null;
  return (
    <button
      onClick={() => invoke("open_dir", { which }).catch(console.error)}
      className="flex items-center gap-1.5 px-3 h-7 rounded-md border border-line hover:bg-hover"
    >
      <FolderOpen size={14} />
      Abrir
    </button>
  );
}
