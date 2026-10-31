import { memo, useEffect, useRef, useState } from "react";
import { ArrowUp, FileSearch, RotateCcw, Send, Sparkles, Square, X } from "lucide-react";
import { AiCommand, AiContext, AiEvent, aiAsk, aiCancel, aiReset } from "../lib/ai";
import { Risk, riskLabel } from "../lib/packs";
import { PanelResize, panelClass } from "./PanelResize";

const riskStyle: Record<Risk, string> = { read: "text-ok", change: "text-warn", disruptive: "text-danger" };
const TOOL_LABEL: Record<string, string> = {
  read_output: "Leyendo la salida de la terminal",
  suggest_command: "Buscando en el catálogo",
  explain_output: "Revisando líneas de la salida",
};

interface Msg {
  role: "user" | "assistant" | "notice";
  text: string;
  tools?: string[];
  suggestions?: AiCommand[];
  error?: boolean;
}

interface Props {
  width: number;
  overlay?: boolean;
  onResize: (w: number) => void;
  onClose: () => void;
  /** Contexto de la pestaña activa al momento de preguntar; null sin pestaña de terminal. */
  getContext: () => AiContext | null;
  /** Nombre de la pestaña conectada a la que iría un comando; null si no hay destino. */
  target: string | null;
  /** Envía un comando sugerido: pasa por el motor de riesgo y la confirmación de la app. */
  onRun: (c: AiCommand) => void;
}

/**
 * Panel del asistente on-device (Apple Intelligence). Solo existe en iOS con el modelo
 * disponible; App.tsx no lo monta en otro caso.
 */
export const AssistantPanel = memo(function AssistantPanel(p: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgs]);

  // Al cerrar el panel se corta la respuesta en curso.
  useEffect(() => () => void aiCancel(), []);

  const patchLast = (fn: (m: Msg) => Msg) =>
    setMsgs((list) => (list.length ? [...list.slice(0, -1), fn(list[list.length - 1])] : list));

  const ask = async (prompt: string, mode: "chat" | "explain") => {
    const ctx = p.getContext();
    if (!ctx) {
      setMsgs((l) => [...l, { role: "notice", text: "Abre una pestaña de terminal para usar el asistente." }]);
      return;
    }
    setBusy(true);
    setMsgs((l) => [...l, { role: "user", text: prompt }, { role: "assistant", text: "", tools: [] }]);
    const onEvent = (e: AiEvent) => {
      if (e.type === "suggestions") {
        // Sin duplicados si el modelo busca dos veces lo mismo.
        return patchLast((m) => ({
          ...m,
          suggestions: [...(m.suggestions ?? []), ...e.items.filter((i) => !m.suggestions?.some((s) => s.cmd === i.cmd))],
        }));
      }
      const text = e.text ?? "";
      if (e.type === "delta") patchLast((m) => ({ ...m, text: m.text + text }));
      else if (e.type === "replace") patchLast((m) => ({ ...m, text }));
      else if (e.type === "tool") patchLast((m) => ({ ...m, tools: [...(m.tools ?? []), text] }));
      else if (e.type === "notice")
        setMsgs((l) => [...l.slice(0, -1), { role: "notice", text }, l[l.length - 1]]);
    };
    try {
      const r = await aiAsk(prompt, ctx, mode, onEvent);
      patchLast((m) => ({ ...m, text: r.text || m.text || (r.cancelled ? "(detenido)" : "(sin respuesta)") }));
    } catch (e) {
      const message = typeof e === "string" ? e : (e as { message?: string })?.message ?? String(e);
      patchLast((m) => ({ ...m, text: message, error: true }));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    ask(q, "chat");
  };

  const reset = () => {
    aiReset();
    setMsgs([]);
    setBusy(false);
  };

  return (
    <aside className={panelClass(!!p.overlay)} style={{ width: p.width }} aria-label="Asistente IA">
      <PanelResize width={p.width} onResize={p.onResize} />
      <header className="flex items-center gap-1 px-2 h-9 border-b border-line">
        <Sparkles size={14} className="text-accent shrink-0" />
        <span className="flex-1 text-[12.5px] font-medium truncate">Asistente</span>
        <button className="w-8 h-8 sm:w-7 sm:h-7 shrink-0 grid place-items-center rounded-full sm:rounded-md text-muted hover:text-fg hover:bg-hover" title="Nueva conversación" aria-label="Nueva conversación" onClick={reset}>
          <RotateCcw size={14} />
        </button>
        <button className="w-8 h-8 sm:w-7 sm:h-7 shrink-0 grid place-items-center rounded-full sm:rounded-md text-muted hover:text-fg hover:bg-hover" title="Cerrar" aria-label="Cerrar asistente" onClick={p.onClose}>
          <X size={15} />
        </button>
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto px-2.5 py-2 space-y-2 text-[13px]">
        {!msgs.length && (
          <div className="text-muted text-[12.5px] space-y-2 pt-1">
            <p>Pregunta sobre lo que muestra la terminal. El modelo corre en este equipo con Apple Intelligence: la salida no sale del teléfono.</p>
            <p>El asistente no ejecuta nada. Los comandos sugeridos salen del catálogo y los envías tú, con la confirmación de riesgo de siempre.</p>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "notice" ? (
            <p key={i} className="text-muted text-[11.5px] italic">
              {m.text}
            </p>
          ) : m.role === "user" ? (
            <div key={i} className="ml-8 rounded-lg bg-accent/15 px-2.5 py-1.5 whitespace-pre-wrap break-words">
              {m.text}
            </div>
          ) : (
            <div key={i} className="mr-4 space-y-1.5">
              {!!m.tools?.length && (
                <div className="text-[11px] text-muted space-y-0.5">
                  {[...new Set(m.tools)].map((t) => (
                    <div key={t}>· {TOOL_LABEL[t] ?? t}</div>
                  ))}
                </div>
              )}
              <div className={`whitespace-pre-wrap break-words ${m.error ? "text-danger" : ""}`}>
                {m.text || (busy && i === msgs.length - 1 ? <span className="text-muted animate-pulse">Pensando…</span> : null)}
              </div>
              {m.suggestions?.map((s) => (
                <div key={s.cmd} className="rounded-lg border border-line bg-panel px-2 py-1.5">
                  <div className="flex items-start gap-2">
                    <code className="flex-1 min-w-0 font-mono text-[12px] break-all">{s.cmd}</code>
                    <button
                      className="inline-flex items-center gap-1 px-2.5 sm:px-2 h-7 rounded-full sm:rounded-md border border-line bg-panel text-[11.5px] font-medium sm:font-normal hover:bg-hover active:bg-selected disabled:opacity-40 shrink-0"
                      disabled={!p.target}
                      title={p.target ? `Enviar a ${p.target} (pide confirmación)` : "Sin sesión conectada"}
                      onClick={() => p.onRun(s)}
                    >
                      <Send size={12} /> Enviar
                    </button>
                  </div>
                  <div className="text-[11.5px] text-muted mt-0.5 line-clamp-2">{s.desc}</div>
                  <div className={`text-[11px] mt-0.5 ${riskStyle[s.risk]}`}>{riskLabel[s.risk]}</div>
                </div>
              ))}
            </div>
          ),
        )}
      </div>

      <div className="border-t border-line p-2 space-y-1.5">
        <div className="flex gap-1.5">
          <button
            className="inline-flex items-center gap-1 px-2.5 sm:px-2 h-7 rounded-full sm:rounded-md border border-line bg-panel text-[11.5px] font-medium sm:font-normal hover:bg-hover active:bg-selected disabled:opacity-40"
            disabled={busy}
            onClick={() => ask("Explica la salida reciente de la terminal: qué muestra y si hay algo anormal.", "explain")}
          >
            <FileSearch size={13} /> Explicar salida
          </button>
        </div>
        <div className="flex items-end gap-1.5">
          <textarea
            className="field flex-1 min-h-9 max-h-32 resize-none !py-1.5 text-[13px]"
            rows={1}
            placeholder="¿Qué comando muestra las interfaces caídas?"
            value={input}
            autoCapitalize="sentences"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {busy ? (
            <button className="h-9 w-9 shrink-0 grid place-items-center rounded-full disabled:opacity-40 touch-manipulation border border-line hover:bg-hover" title="Detener" aria-label="Detener" onClick={() => aiCancel()}>
              <Square size={14} />
            </button>
          ) : (
            <button
              className="h-9 w-9 shrink-0 grid place-items-center rounded-full disabled:opacity-40 touch-manipulation bg-accent text-accent-fg hover:opacity-90"
              title="Preguntar"
              aria-label="Preguntar"
              disabled={!input.trim()}
              onClick={submit}
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
});
