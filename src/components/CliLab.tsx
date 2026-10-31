import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ITheme } from "@xterm/xterm";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Check, CircleAlert, CircleCheck, Copy, Play, Plus, Save, Square, Terminal, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { CodeEditor, renderHighlighted } from "./CodeEditor";
import { cssColor } from "../lib/highlight";
import { TargetOptions } from "./BroadcastTarget";
import { BroadcastDialog } from "./BroadcastDialog";
import { fillTemplate, templateVars } from "./TemplateDialog";
import { Compiled } from "../lib/highlight";
import { Resolved, isBroadcastRunning, targetLabel, useBroadcastTarget, useWorkspace } from "../lib/broadcast";
import { LabItem, LabStep, SAVE_COMMAND, clearLab, isLabRunning, labReport, runLab, scriptLines, splitStep, stopLab, useLabRun } from "../lib/cliLab";
import { runOnDeviceResult } from "../lib/deviceRun";
import { isSecretVar } from "../lib/templateSecrets";
import { useDragResize } from "../lib/useDragResize";
import { fontStack } from "../lib/theme";
import { isMac } from "../lib/platform";
import { persist, stored } from "../lib/prefs";
import { tabTitle } from "../types";
import { plural } from "../lib/plural";

type NoteInfo = { name: string; protected: boolean };

/** Prefijo de las notas creadas desde el CLI Lab: se listan primero en su selector. */
const SCRIPT_PREFIX = "Script ";
/** El mismo filtro que aplica el backend al nombre de una nota (notes.rs). */
const cleanNoteName = (v: string) =>
  v
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .trim();

interface Props {
  /** Fabricante de la pestaña activa (catálogo): comando de guardado sugerido. */
  vendor: string;
  compiled: Compiled[];
  theme: ITheme;
  font: string;
  fontSize: number;
  /** Destinos según el selector de destino de la barra de estado. */
  resolve: () => Resolved;
  /** Conexión de una pestaña, si sigue conectada. */
  connOf: (tabId: string) => string | undefined;
  onClose: () => void;
}

/**
 * Jerarquía de botones con las mismas medidas que el resto de la app (una sola acción principal
 * por vista: Ejecutar, h-8). Todas las áreas de clic miden 28 px o más (WCAG 2.2, 2.5.8 pide 24 px).
 */
const BTN_SECONDARY =
  "flex items-center gap-1.5 px-3 h-7 rounded-md border border-line text-[12px] hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent";
const BTN_GHOST =
  "flex items-center gap-1.5 px-2 h-7 rounded-md text-[12px] text-muted hover:text-fg hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted";
const BTN_ICON = "w-7 h-7 shrink-0 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover";
/** Título de sección: el mismo en el editor (Variables) y el panel derecho (Destino, Opciones). */
const SECTION = "mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted";

const DRAFT = "cliLabDraft";
const LAB_DEFAULTS = { stopOnError: true, answer: false, parallel: 4, timeout: 30 };
const OPTS = "cliLabOptions";
const statusText = { pending: "En cola", running: "Ejecutando", ok: "OK", error: "Error", stopped: "Detenido", skipped: "Omitido" } as const;
const statusColor = { pending: "text-muted", running: "text-accent", ok: "text-ok", error: "text-danger", stopped: "text-warn", skipped: "text-muted" } as const;

/**
 * CLI Lab: script de varias líneas que se ejecuta en las sesiones del destino elegido, línea a
 * línea y leyendo cada respuesta. Se detiene al primer error de CLI y nunca confirma preguntas
 * del equipo salvo que se pida (o sea un comando de guardado).
 */
export function CliLab(p: Props) {
  const [text, setText] = useState(() => stored(DRAFT, { text: "" }).text ?? "");
  /** Nota abierta en el Lab y su texto guardado (para saber si hay cambios). */
  const [note, setNote] = useState<{ name: string; saved: string } | null>(null);
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  const loadNotes = () => invoke<NoteInfo[]>("list_notes").then(setNotes, () => {});
  useEffect(() => {
    loadNotes();
  }, []);
  const [opts, setOpts] = useState(() => ({ ...LAB_DEFAULTS, ...stored(OPTS, LAB_DEFAULTS) }));
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ text: string; shown: string; resolved: Resolved } | null>(null);
  const [view, setView] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  /** Nombre en edición al guardar un script nuevo (sin window.prompt: no existe en todas las webviews). */
  const [naming, setNaming] = useState<string | null>(null);
  const run = useLabRun();
  const target = useBroadcastTarget();
  const ws = useWorkspace();
  const win = useDragResize<HTMLDivElement>("cliLabWindow");

  // El borrador se guarda al dejar de escribir (300 ms), no en cada tecla, y siempre al cerrar.
  const draft = useRef(text);
  draft.current = text;
  useEffect(() => {
    const t = window.setTimeout(() => persist(DRAFT, { text }), 300);
    return () => window.clearTimeout(t);
  }, [text]);
  useEffect(() => () => persist(DRAFT, { text: draft.current }), []);
  useEffect(() => persist(OPTS, opts), [opts]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !confirm && naming === null && p.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.onClose, confirm, naming]);

  const vars = useMemo(() => templateVars(text), [text]);
  const lines = useMemo(() => scriptLines(text), [text]);
  const dirty = note ? note.saved !== text : !!text.trim();
  const openable = useMemo(() => {
    const list = notes.filter((x) => !x.protected);
    return {
      scripts: list.filter((x) => x.name.startsWith(SCRIPT_PREFIX)),
      others: list.filter((x) => !x.name.startsWith(SCRIPT_PREFIX)),
    };
  }, [notes]);
  const saveCmd = SAVE_COMMAND[p.vendor];
  const missing = vars.filter((v) => !values[v]?.trim());
  const running = !!run?.running;

  const execute = () => {
    if (!lines.length) return setMsg("El script no tiene comandos (las líneas con !, # o // son comentarios)");
    if (missing.length) return setMsg(`Completa: ${missing.join(", ")}`);
    if (isLabRunning()) return setMsg("Ya hay un script en ejecución");
    if (isBroadcastRunning()) return setMsg("Hay un envío a varias sesiones en curso: espera a que termine");
    const filled = scriptLines(fillTemplate(text, values)).join("\n");
    const masked = Object.fromEntries(vars.map((v) => [v, isSecretVar(v) ? "••••••" : values[v]]));
    setMsg("");
    setConfirm({ text: filled, shown: scriptLines(fillTemplate(text, masked)).join("\n"), resolved: p.resolve() });
  };

  const start = () => {
    if (!confirm) return;
    if (isBroadcastRunning()) {
      setConfirm(null);
      return setMsg("Hay un envío a varias sesiones en curso: espera a que termine");
    }
    const { text: body, shown, resolved } = confirm;
    setConfirm(null);
    setView(null);
    const timeout = Math.max(5, Math.min(600, opts.timeout));
    runLab(
      resolved.targets.map((t) => ({ tabId: t.id, name: tabTitle(t), host: t.session.host })),
      body.split("\n"),
      {
        stopOnError: opts.stopOnError,
        parallel: opts.parallel,
        answer: opts.answer,
        labels: shown.split("\n"),
        secrets: vars.filter(isSecretVar).map((v) => values[v] ?? ""),
        conn: p.connOf,
        exec: (conn, cmd, answer) => runOnDeviceResult(conn, cmd, timeout, answer),
      },
    ).catch((e) => setMsg(String(e)));
  };

  const writeNote = async (name: string) => {
    try {
      await invoke("save_note", { name, content: text });
    } catch (e) {
      setMsg(`No se pudo guardar: ${e}`);
      return false;
    }
    setNote({ name, saved: text });
    setMsg(`Guardado en Notas: ${name}`);
    loadNotes();
    // Notas recarga la nota si la tiene abierta y sin cambios pendientes.
    window.dispatchEvent(new CustomEvent("nt-note-saved", { detail: { name } }));
    return true;
  };
  const saveScript = (asNew: boolean) => {
    if (note && !asNew) return void writeNote(note.name);
    const base = note ? `${note.name} (copia)` : `${SCRIPT_PREFIX}${cleanNoteName(lines[0]?.trim() ?? "").slice(0, 40) || "nuevo"}`;
    setNaming(base);
  };
  const commitName = () => {
    const name = cleanNoteName(naming ?? "");
    if (!name) return setNaming(null);
    if (notes.some((x) => x.name.toLowerCase() === name.toLowerCase()) && name !== note?.name) {
      return setMsg(`Ya existe una nota "${name}": elige otro nombre`);
    }
    setNaming(null);
    void writeNote(name);
  };
  const openNote = async (name: string) => {
    if (!name) return;
    try {
      const content = await invoke<string>("read_note", { name });
      setText(content);
      setNote({ name, saved: content });
      setValues({});
      setMsg("");
    } catch (e) {
      setMsg(`No se pudo abrir ${name}: ${e}`);
    }
  };

  const n = p.resolve().targets.length;

  // Sin equipo elegido se muestra el primero con error; la vista salta al comando que falló.
  const shown = run?.items.find((i) => i.tabId === view) ?? (run?.running ? null : (run?.items.find((i) => i.status === "error") ?? null));
  const failRef = useRef<HTMLDivElement>(null);
  const failKey = shown && !run?.running ? `${shown.tabId}:${shown.steps.length}` : "";
  useEffect(() => {
    if (failKey) failRef.current?.scrollIntoView({ block: "nearest" });
  }, [failKey]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-2 sm:p-4" onMouseDown={p.onClose}>
      <div
        {...win.box}
        className="@container w-full sm:w-[960px] h-full sm:h-[640px] bg-panel border border-line rounded-xl shadow-pop sm:resize overflow-hidden flex flex-col min-w-0 sm:min-w-[min(620px,calc(100vw-2rem))] min-h-0 sm:min-h-[min(420px,calc(100vh-2rem))] max-w-[calc(100vw-1rem)] sm:max-w-[98vw] max-h-[96vh]"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="CLI Lab"
      >
        <header {...win.handle} className="shrink-0 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 h-12 border-b border-line select-none overflow-x-auto [scrollbar-width:none]">
          <Terminal size={16} className="text-accent" />
          <h2 className="text-[14px] font-semibold mr-1 sm:mr-2">CLI Lab</h2>
          <select
            className="field !h-7 !w-36 sm:!w-56 !text-[12px]"
            value={note?.name ?? ""}
            aria-label="Abrir una nota"
            title="Los scripts se guardan en Notas"
            onFocus={loadNotes}
            onChange={(e) => (e.target.value ? openNote(e.target.value) : setNote(null))}
          >
            <option value="">{note ? "Desvincular (guardar como nueva)" : dirty ? "Sin guardar" : "Abrir desde Notas…"}</option>
            {openable.scripts.length > 0 && (
              <optgroup label="Scripts">
                {openable.scripts.map((x) => (
                  <option key={x.name} value={x.name}>
                    {x.name.slice(SCRIPT_PREFIX.length)}
                  </option>
                ))}
              </optgroup>
            )}
            {openable.others.length > 0 && (
              <optgroup label="Otras notas">
                {openable.others.map((x) => (
                  <option key={x.name} value={x.name}>
                    {x.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {naming !== null ? (
            <input
              autoFocus
              className="field !h-7 !w-48 !text-[12px]"
              aria-label="Nombre del script"
              placeholder="Nombre del script"
              title="Enter guarda · Esc cancela"
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") setNaming(null);
              }}
              onBlur={() => setNaming(null)}
            />
          ) : (
          <button
            onClick={() => saveScript(false)}
            disabled={!text.trim() || (!!note && !dirty)}
            title={note ? `Guardar cambios en la nota "${note.name}"${dirty ? " (hay cambios sin guardar)" : ""}` : "Guardar como nota nueva"}
            className={BTN_SECONDARY}
          >
            <Save size={13} /> Guardar
            {/* Punto de cambios sin guardar: el estado se ve sin ocupar texto en el encabezado. */}
            {note && dirty && <span aria-label="Cambios sin guardar" className="w-1.5 h-1.5 rounded-full bg-warn" />}
          </button>
          )}
          {note && (
            <button onClick={() => saveScript(true)} className={BTN_GHOST}>
              Guardar como…
            </button>
          )}
          <span className="flex-1" />
          <button onClick={p.onClose} aria-label="Cerrar" title="Cerrar (Esc)" className={BTN_ICON}>
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 min-h-0 flex flex-col @[44rem]:flex-row">
          <section className="flex-1 min-w-0 flex flex-col">
            {/* Barra del editor: acciones sobre el texto del script (la ejecución va en el panel derecho). */}
            <div className="shrink-0 flex items-center gap-1 pl-3 pr-2 h-9 border-b border-line text-[12px]">
              <span className="font-medium">Script CLI</span>
              <span className="text-muted">· {plural(lines.length, "comando", "comandos")}</span>
              <span className="flex-1" />
              <button
                disabled={!saveCmd}
                title={
                  saveCmd
                    ? `Agrega "${saveCmd}" al final para guardar la configuración`
                    : p.vendor === "fortinet"
                      ? "FortiOS guarda la configuración al cerrar el bloque con end"
                      : "Sin comando de guardado conocido para este fabricante"
                }
                onClick={() => saveCmd && setText((t) => `${t.replace(/\s+$/, "")}${t.trim() ? "\n" : ""}${saveCmd}\n`)}
                className={BTN_GHOST}
              >
                <Plus size={13} /> Guardar config
              </button>
              <button onClick={() => writeText(text).then(() => setMsg("Script copiado"))} disabled={!text.trim()} title="Copiar el script" className={BTN_GHOST}>
                <Copy size={13} /> Copiar
              </button>
            </div>
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden border-b border-line">
              <CodeEditor
                gutter
                value={text}
                onChange={setText}
                compiled={p.compiled}
                theme={p.theme}
                font={fontStack(p.font)}
                fontSize={p.fontSize}
                placeholder={"Un comando por línea; se ejecutan en orden y se lee cada respuesta.\n! comentario  # comentario  // comentario\n\nconfig system interface\n    edit {{puerto}}\n        set alias {{alias}}\n    next\nend"}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    execute();
                  }
                }}
              />
            </div>
            {vars.length > 0 && (
              <div className="shrink-0 px-3 pt-2 pb-3 border-b border-line">
              <h3 className={SECTION}>Variables</h3>
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
                {vars.map((v) => (
                  <label key={v} className="block text-[11.5px]">
                    <span className="block mb-1 font-mono text-muted">{`{{${v}}}`}</span>
                    <input
                      className="field !h-7 !text-[12px]"
                      type={isSecretVar(v) ? "password" : "text"}
                      autoComplete="off"
                      value={values[v] ?? ""}
                      onChange={(e) => setValues((x) => ({ ...x, [v]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
              </div>
            )}
            {run && (
              <section className="shrink-0 h-[48%] min-h-[150px] border-t border-line flex flex-col sm:flex-row min-w-0">
                <div className="w-full sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r border-line flex flex-col max-h-[140px] sm:max-h-none">
                  <div className="flex items-center gap-1 pl-3 pr-1 h-9 text-[12px] border-b border-line">
                    <span className="font-medium">{running ? "Ejecutando…" : "Resultado"}</span>
                    <span className="text-muted tabular-nums">
                      · {run.items.filter((i) => i.status === "ok").length}/{run.items.length} OK
                    </span>
                    <span className="flex-1" />
                    <button aria-label="Copiar informe" title="Copiar informe" className={BTN_ICON} onClick={() => writeText(labReport(run)).then(() => setMsg("Informe copiado"))}>
                      <Copy size={14} />
                    </button>
                    {!running && (
                      <button aria-label="Cerrar resultado" title="Cerrar resultado" className={BTN_ICON} onClick={clearLab}>
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <ul className="flex-1 overflow-y-auto text-[12px]">
                    {run.items.map((i) => (
                      <li key={i.tabId}>
                        <button onClick={() => setView(i.tabId)} className={`w-full flex items-center gap-2 px-3 h-8 text-left hover:bg-hover ${shown?.tabId === i.tabId ? "bg-selected" : ""}`}>
                          <StatusIcon item={i} />
                          <span className="truncate flex-1">{i.name}</span>
                          <span className={`text-[11px] tabular-nums ${statusColor[i.status]}`}>
                            {i.status === "running" ? `${i.steps.length}/${run.lines}` : statusText[i.status]}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <LabOutput item={shown} compiled={p.compiled} theme={p.theme} font={p.font} fontSize={p.fontSize} failRef={failRef} />
              </section>
            )}
          </section>

          <aside className="w-full @[44rem]:w-64 @[52rem]:w-72 shrink-0 border-t @[44rem]:border-t-0 @[44rem]:border-l border-line flex flex-col min-h-0">
            {/* Opciones con scroll propio: el botón Ejecutar/Detener queda siempre visible abajo. */}
            <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-2">
              <h3 className={`${SECTION} px-2 flex items-center gap-2`} title={targetLabel(target, ws)}>
                Destino
                <span className="ml-auto normal-case tracking-normal font-normal">{plural(n, "conectada", "conectadas")}</span>
              </h3>
              <TargetOptions />
            </div>
            <div className="px-4 py-3 space-y-2.5 border-t border-line text-[12px]">
              <h3 className={SECTION}>Opciones</h3>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-[var(--accent)]" checked={opts.stopOnError} onChange={(e) => setOpts((o) => ({ ...o, stopOnError: e.target.checked }))} />
                Detener el equipo al primer error
              </label>
              <label className="flex items-start gap-2" title="y/n, [confirm], Continue? [Y/N]. Los comandos de guardado siempre se confirman.">
                <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={opts.answer} onChange={(e) => setOpts((o) => ({ ...o, answer: e.target.checked }))} />
                <span>
                  Responder "sí" a las preguntas del equipo
                  <span className="block text-[11px] text-muted">Apagado: se responde que no y se marca error.</span>
                </span>
              </label>
              <label className="flex items-center justify-between gap-2">
                Equipos a la vez
                <input type="number" min={1} max={10} className="field !h-7 !w-16 text-right tabular-nums" value={opts.parallel} onChange={(e) => setOpts((o) => ({ ...o, parallel: Math.max(1, Math.min(10, Number(e.target.value) || 1)) }))} />
              </label>
              <label className="flex items-center justify-between gap-2" title="Si el equipo no vuelve al prompt en este plazo, la línea queda en error">
                Espera máx. por comando (s)
                <input type="number" min={5} max={600} className="field !h-7 !w-16 text-right tabular-nums" value={opts.timeout} onChange={(e) => setOpts((o) => ({ ...o, timeout: Number(e.target.value) || 30 }))} />
              </label>
            </div>
            </div>
            <div className="shrink-0 p-3 border-t border-line space-y-2">
              <p role="status" aria-live="polite" className={`text-[11.5px] text-warn ${msg ? "" : "hidden"}`}>
                {msg}
              </p>
              {running ? (
                <button onClick={stopLab} className="w-full flex items-center justify-center gap-1.5 h-8 rounded-md bg-danger text-danger-fg font-medium hover:opacity-90">
                  <Square size={11} fill="currentColor" /> Detener
                </button>
              ) : (
                <button
                  onClick={execute}
                  disabled={!lines.length || n === 0}
                  title={!lines.length ? "Escribe al menos un comando" : n === 0 ? "Ninguna sesión conectada en el destino elegido" : undefined}
                  className="w-full flex items-center justify-center gap-1.5 h-8 rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-40"
                >
                  <Play size={13} /> Ejecutar en {plural(n, "equipo", "equipos")}
                  {/* Atajo como en la paleta de comandos: texto, sin recuadro. */}
                  <kbd className="ml-1 font-sans text-[11px] font-normal opacity-75">{isMac ? "⌘↵" : "Ctrl+↵"}</kbd>
                </button>
              )}
            </div>
          </aside>
        </div>

      </div>
      {confirm && (
        <BroadcastDialog
          text={confirm.shown}
          resolved={confirm.resolved}
          delayMs={0}
          verb="Ejecutar"
          onCancel={() => setConfirm(null)}
          onConfirm={start}
        />
      )}
    </div>
  );
}

function StatusIcon({ item }: { item: LabItem }) {
  if (item.status === "ok") return <CircleCheck size={13} className="text-ok shrink-0" />;
  if (item.status === "error") return <CircleAlert size={13} className="text-danger shrink-0" />;
  return <span className={`w-[13px] h-[13px] shrink-0 rounded-full border ${item.status === "running" ? "border-accent animate-pulse" : "border-line"}`} />;
}

/** Líneas que se dibujan por comando antes de "Mostrar más" (un show tech puede traer miles). */
const STEP_LINES = 200;

interface OutputProps {
  item: LabItem | null;
  compiled: Compiled[];
  theme: ITheme;
  font: string;
  fontSize: number;
  failRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Salida como la consola del equipo: prompt y comando, ✓ o ✗, y lo que respondió. Memorizada: al
 * escribir en el editor no se vuelve a dibujar (con miles de líneas cada tecla costaba cientos de ms).
 */
const LabOutput = memo(function LabOutput({ item, compiled, theme, font, fontSize, failRef }: OutputProps) {
  const firstFail = item ? item.steps.findIndex((x) => !x.ok) : -1;
  return (
    <div
      className="flex-1 min-w-0 overflow-auto py-1.5"
      style={{ background: theme.background, color: theme.foreground, fontFamily: fontStack(font), fontSize: Math.max(11, fontSize - 1) }}
    >
      {!item && <p className="font-sans text-[12px] text-muted p-3">Elige un equipo para ver la respuesta de cada comando.</p>}
      {item?.reason && <p className="font-sans text-[12px] text-danger px-3 pb-1.5">{item.reason}</p>}
      {item?.steps.map((s, k) => (
        <StepRow key={k} step={s} compiled={compiled} theme={theme} rowRef={k === firstFail ? failRef : undefined} />
      ))}
      {item?.status === "running" && (
        <div className="px-3 py-1 font-sans text-[12px] text-muted animate-pulse">Ejecutando línea {item.steps.length + 1}…</div>
      )}
    </div>
  );
});

/** Un comando: los pasos ya terminados no cambian, así que cada fila se dibuja una sola vez. */
const StepRow = memo(function StepRow({
  step: s,
  compiled,
  theme,
  rowRef,
}: {
  step: LabStep;
  compiled: Compiled[];
  theme: ITheme;
  rowRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const [all, setAll] = useState(false);
  const { prompt, body } = useMemo(() => splitStep(s.output, s.cmd), [s.output, s.cmd]);
  const visible = all ? body : body.slice(0, STEP_LINES);
  const showNote = !!s.note && body.every((l) => !s.note!.includes(l.trim()) || !l.trim());
  return (
    <div ref={rowRef} className={`px-3 py-1 leading-[1.55] ${s.ok ? "hover:bg-hover" : "bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]"}`}>
      <div className="flex items-start gap-2 whitespace-pre">
        {s.ok ? <Check size={13} className="shrink-0 mt-[3px] text-ok" /> : <X size={13} className="shrink-0 mt-[3px] text-danger" />}
        <span className="min-w-0">
          {prompt && <span style={{ color: cssColor("gray", theme) }}>{prompt} </span>}
          {renderHighlighted(s.cmd.trim(), compiled, theme)}
        </span>
      </div>
      {(body.length > 0 || showNote) && (
        <div className="pl-[21px] pt-0.5 whitespace-pre">
          {visible.map((l, i) => (
            <div key={i}>{renderHighlighted(l, compiled, theme)}</div>
          ))}
          {body.length > visible.length && (
            <button onClick={() => setAll(true)} className="my-0.5 px-2 h-6 rounded-md font-sans text-[11.5px] text-accent hover:bg-hover">
              Mostrar {body.length - visible.length} líneas más
            </button>
          )}
          {showNote && <div className="font-sans text-[12px] text-danger">{s.note}</div>}
        </div>
      )}
    </div>
  );
});
