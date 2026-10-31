import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FileCode2, KeyRound } from "lucide-react";
import { riskLabel, type Risk } from "../lib/packs";
import { type GatePrompt, type ScriptPrompt, type SecretPrompt, autoDecision, scriptLineRisk } from "../lib/scriptGate";
import { useDragResize } from "../lib/useDragResize";

interface Props {
  toast: (text: string, kind?: "info" | "error") => void;
}

/** El secreto viaja solo en esta llamada: nunca se registra ni se guarda en estado global. */
const reply = (p: ScriptPrompt, approve: boolean, value?: string) =>
  invoke("script_prompt_reply", { run: p.run, id: p.id, approve, value: value ?? null }).catch(() => {});

/**
 * Diálogos que piden los scripts: confirmar una línea que cambia o puede cortar servicio,
 * e ingresar un secreto. Las consultas se aprueban solas, sin diálogo.
 */
export function ScriptPrompts({ toast }: Props) {
  const [queue, setQueue] = useState<ScriptPrompt[]>([]);
  const lastBlocked = useRef(0);

  useEffect(() => {
    const subs = [
      listen<ScriptPrompt>("script-prompt", ({ payload: p }) => {
        if (p.kind === "gate" && autoDecision(p)) reply(p, true);
        else setQueue((q) => [...q, p]);
      }),
      listen<{ run: string; id: string }>("script-prompt-closed", ({ payload }) =>
        setQueue((q) => q.filter((x) => !(x.run === payload.run && x.id === payload.id))),
      ),
      listen<string>("script-input-blocked", () => {
        const now = Date.now();
        if (now - lastBlocked.current < 4000) return;
        lastBlocked.current = now;
        toast("Un script está usando esta sesión: lo que escribes no se envía. Usa Detener script para liberarla.", "error");
      }),
    ];
    return () => subs.forEach((u) => u.then((f) => f()));
  }, [toast]);

  const current = queue[0];
  if (!current) return null;
  const done = (approve: boolean, value?: string) => {
    reply(current, approve, value);
    setQueue((q) => q.slice(1));
  };
  return current.kind === "gate" ? (
    <GateDialog key={current.id} prompt={current} pending={queue.length} onDecide={(ok) => done(ok)} />
  ) : (
    <SecretDialog key={current.id} prompt={current} onDone={(v) => done(v !== null, v ?? undefined)} />
  );
}

function GateDialog({ prompt: p, pending, onDecide }: { prompt: GatePrompt; pending: number; onDecide: (ok: boolean) => void }) {
  const win = useDragResize("scriptGateWindow", false);
  const risk: Risk = scriptLineRisk(p.line, p.opaque);
  useEffect(() => {
    // Esc rechaza; Enter no aprueba a propósito (hay que hacer clic en Permitir).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") onDecide(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDecide]);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/35 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="sg-title" {...win.box} className="w-[500px] max-w-full bg-panel border border-line rounded-xl shadow-pop">
        <header {...win.handle} className="flex items-center gap-2.5 px-5 pt-4 select-none">
          <span className={`w-8 h-8 grid place-items-center rounded-lg bg-selected ${risk === "disruptive" ? "text-danger" : "text-warn"}`}>
            <FileCode2 size={17} />
          </span>
          <div className="min-w-0">
            <h2 id="sg-title" className="text-[14px] font-semibold truncate">
              {p.script} quiere ejecutar en {p.session}
            </h2>
            <p className={`text-[12px] ${risk === "disruptive" ? "text-danger" : "text-warn"}`}>
              {riskLabel[risk]}
              {p.allowChanges && risk === "disruptive" ? " (se confirma aunque el script permita cambios)" : ""}
            </p>
          </div>
        </header>
        <pre className="mx-5 mt-4 p-3 rounded-lg bg-hover font-mono text-[12px] whitespace-pre-wrap break-all max-h-48 overflow-y-auto select-text">
          {p.line}
        </pre>
        {p.opaque && (
          <p className="px-5 mt-2 text-[11.5px] text-danger">
            La línea tiene teclas que el equipo interpreta (Tab, ?, Esc o Ctrl-D): lo que se ejecute puede ser distinto de lo que se ve.
          </p>
        )}
        <div className="px-5 mt-3 text-[11.5px] text-muted leading-snug">
          <p>
            Destinos de esta ejecución ({p.targets.length}):{" "}
            {p.targets.map((t, i) => (
              <span key={t} className={t === p.session ? "text-fg font-medium" : ""}>
                {t}
                {i < p.targets.length - 1 ? ", " : ""}
              </span>
            ))}
          </p>
          <p className="mt-1">
            Si la permites, esta línea no se vuelve a preguntar en esta ejecución, en ninguno de estos destinos. Rechazar detiene el
            script y la línea no llega al equipo. Se rechaza sola en 2 minutos.
            {pending > 1 ? ` Hay ${pending - 1} pedidos más en espera.` : ""}
          </p>
        </div>
        <footer className="flex justify-end gap-2 px-5 py-3 mt-3 border-t border-line">
          <button autoFocus onClick={() => onDecide(false)} className="px-3.5 h-8 rounded-md border border-line hover:bg-hover">
            Rechazar y detener
          </button>
          <button
            onClick={() => onDecide(true)}
            className={`px-3.5 h-8 rounded-md font-medium hover:opacity-90 ${risk === "disruptive" ? "bg-danger text-danger-fg" : "bg-accent text-accent-fg"}`}
          >
            Permitir
          </button>
        </footer>
      </div>
    </div>
  );
}

function SecretDialog({ prompt: p, onDone }: { prompt: SecretPrompt; onDone: (value: string | null) => void }) {
  const win = useDragResize<HTMLFormElement>("scriptSecretWindow", false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onDone(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDone]);

  // El valor se lee del campo al enviar: no pasa por el estado de React.
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = input.current?.value ?? "";
    if (input.current) input.current.value = "";
    onDone(value);
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/35 p-4">
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ss-title"
        {...win.box}
        className="w-[420px] max-w-full bg-panel border border-line rounded-xl shadow-pop"
        autoComplete="off"
      >
        <header {...win.handle} className="flex items-center gap-2.5 px-5 pt-4 select-none">
          <span className="w-8 h-8 grid place-items-center rounded-lg bg-selected text-accent">
            <KeyRound size={17} />
          </span>
          <div className="min-w-0">
            <h2 id="ss-title" className="text-[14px] font-semibold truncate">
              {p.script} pide un secreto
            </h2>
            <p className="text-[12px] text-muted truncate">{p.label}</p>
          </div>
        </header>
        <div className="px-5 mt-4">
          <input
            ref={input}
            type="password"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            aria-label={p.label}
            className="field w-full"
          />
          <p className="mt-2 text-[11.5px] text-muted leading-snug">
            Se entrega solo a este script. La app lo enmascara en los mensajes del script y en las confirmaciones, y no lo guarda en
            logs ni historial. Ingrésalo solo si confías en el script.
          </p>
        </div>
        <footer className="flex justify-end gap-2 px-5 py-3 mt-3 border-t border-line">
          <button type="button" onClick={() => onDone(null)} className="px-3.5 h-8 rounded-md border border-line hover:bg-hover">
            Cancelar
          </button>
          <button type="submit" className="px-3.5 h-8 rounded-md bg-accent text-accent-fg font-medium hover:opacity-90">
            Entregar
          </button>
        </footer>
      </form>
    </div>
  );
}
