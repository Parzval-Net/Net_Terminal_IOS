import { useEffect, useMemo, useState } from "react";
import { Radio, Square, X } from "lucide-react";
import { Risk, computeRisk, riskLabel } from "../lib/packs";
import { Resolved, clearBroadcast, stopBroadcast, useBroadcastRun } from "../lib/broadcast";
import { tabTitle } from "../types";

const RANK: Record<Risk, number> = { read: 0, change: 1, disruptive: 2 };
const riskColor: Record<Risk, string> = { read: "text-muted", change: "text-warn", disruptive: "text-danger" };

interface Props {
  text: string;
  resolved: Resolved;
  /** Riesgo declarado (catálogo): se usa si es mayor que el calculado. */
  declared?: Risk;
  delayMs: number;
  /** CLI Lab: sin pausa entre equipos (se ejecutan en paralelo) y con otro verbo. */
  verb?: string;
  onCancel: () => void;
  onConfirm: (deviceDelayMs: number) => void;
}

/**
 * Confirmación de difusión: equipos destino, omitidos y el texto completo con el riesgo
 * de cada línea. Si algo cambia configuración o puede cortar servicio, hay que escribir
 * la cantidad de equipos para habilitar el envío.
 */
export function BroadcastDialog({ text, resolved, declared, delayMs, verb, onCancel, onConfirm }: Props) {
  const lines = useMemo(() => text.replace(/\s+$/, "").split("\n"), [text]);
  // Comentarios, "!" y salidas de modo no se marcan: solo ensuciarían la vista.
  const risks = useMemo(
    () => lines.map((l): Risk => (!l.trim() || /^\s*(!|#|end$|exit$|quit$|return$)/i.test(l) ? "read" : computeRisk(l))),
    [lines],
  );
  const risk = useMemo<Risk>(() => {
    let r: Risk = computeRisk(text.trim());
    for (const x of [...risks, declared ?? "read"]) if (RANK[x] > RANK[r]) r = x;
    return r;
  }, [risks, text, declared]);
  const n = resolved.targets.length;
  const [typed, setTyped] = useState("");
  const [delay, setDelay] = useState(delayMs);
  const needsCount = risk !== "read";
  const ok = n > 0 && (!needsCount || typed.trim() === String(n));

  useEffect(() => {
    // En captura: Esc/Enter no llegan a la terminal. Enter solo confirma lo que no exige escribir.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      } else if (e.key === "Enter" && !needsCount && ok && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        e.stopPropagation();
        onConfirm(delay);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel, onConfirm, needsCount, ok, delay]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-2 sm:p-4" onMouseDown={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bc-title"
        className="w-full sm:w-[620px] max-w-[calc(100vw-1rem)] sm:max-w-[96vw] max-h-[96vh] sm:max-h-[90vh] flex flex-col bg-panel border border-line rounded-xl shadow-pop"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="px-3 sm:px-5 pt-4 pb-2">
          <h2 id="bc-title" className="text-[14px] font-semibold flex items-center gap-2">
            <Radio size={15} className={risk === "read" ? "text-accent" : riskColor[risk]} />
            {verb ? `${verb} en` : "Enviar a"} {n} {n === 1 ? "equipo" : "equipos"}
          </h2>
          <p className={`text-[12px] mt-0.5 ${risk === "read" ? "text-muted" : riskColor[risk] + " font-medium"}`}>
            {riskLabel[risk]}
            {risk === "disruptive" ? " en todos los equipos de la lista." : ""}
          </p>
        </header>
        <div className="px-3 sm:px-5 overflow-y-auto space-y-3 min-h-0">
          <div>
            <h3 className="text-[11.5px] font-medium text-muted mb-1">Destinos, en este orden</h3>
            <ol className="rounded-md border border-line divide-y divide-[var(--border)] max-h-40 overflow-y-auto text-[12px]">
              {resolved.targets.map((t, i) => (
                <li key={t.id} className="flex items-center gap-2 px-2 h-7">
                  <span className="w-5 text-right text-muted tabular-nums">{i + 1}</span>
                  <span className="truncate flex-1">{tabTitle(t)}</span>
                  <span className="text-muted truncate">{t.session.host ?? ""}</span>
                </li>
              ))}
              {n === 0 && <li className="px-2 h-7 flex items-center text-muted">Ninguna sesión conectada en el destino elegido.</li>}
            </ol>
            {resolved.skipped.length > 0 && (
              <p className="text-[11.5px] text-muted mt-1">
                Se omiten: {resolved.skipped.map((s) => `${tabTitle(s.tab)} (${s.reason.toLowerCase()})`).join(", ")}
              </p>
            )}
          </div>
          <div>
            <h3 className="text-[11.5px] font-medium text-muted mb-1">Texto completo ({lines.length} {lines.length === 1 ? "línea" : "líneas"})</h3>
            <div className="rounded-md bg-hover max-h-56 overflow-auto font-mono text-[11.5px] py-1">
              {lines.map((l, i) => (
                <div key={i} className="flex gap-2 px-2 leading-[1.55]">
                  <span className={`w-20 shrink-0 font-sans text-[11px] ${riskColor[risks[i]]}`}>
                    {risks[i] === "read" ? "" : risks[i] === "change" ? "cambio" : "disruptivo"}
                  </span>
                  <span className="whitespace-pre">{l || " "}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3 pb-1">
            {!verb && <label className="text-[12px]">
              <span className="block text-[11.5px] font-medium text-muted mb-1">Pausa entre equipos</span>
              <span className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={100}
                  className="field !h-7 !w-24"
                  value={delay}
                  onChange={(e) => setDelay(Math.max(0, Math.min(10000, Number(e.target.value) || 0)))}
                />
                ms
              </span>
            </label>}
            {needsCount && n > 0 && (
              <label className="text-[12px] flex-1 min-w-0 sm:min-w-[220px]">
                <span className={`block text-[11.5px] font-medium mb-1 ${riskColor[risk]}`}>
                  Para confirmar, escribe la cantidad de equipos ({n})
                </span>
                <input autoFocus className="field !h-7" inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value)} />
              </label>
            )}
          </div>
        </div>
        <footer className="flex flex-wrap justify-end gap-2 px-3 sm:px-5 py-3 sm:py-4 border-t border-line">
          <button onClick={onCancel} className="px-4 sm:px-3.5 h-10 sm:h-8 rounded-xl sm:rounded-md border border-line hover:bg-hover text-[13px] font-medium sm:font-normal touch-manipulation">
            Cancelar
          </button>
          <button
            autoFocus={!needsCount}
            disabled={!ok}
            onClick={() => onConfirm(delay)}
            className={`px-4 sm:px-3.5 h-10 sm:h-8 rounded-xl sm:rounded-md font-medium hover:opacity-90 disabled:opacity-40 text-[13px] touch-manipulation ${
              risk === "disruptive" ? "bg-danger text-danger-fg" : risk === "change" ? "bg-warn text-accent-fg" : "bg-accent text-accent-fg"
            }`}
          >
            {verb ? `${verb} en` : "Enviar a"} {n} {n === 1 ? "equipo" : "equipos"}
          </button>
        </footer>
      </div>
    </div>
  );
}

const statusText = { pending: "En cola", sending: "Enviando", ok: "Enviado", error: "Error", skipped: "Omitido", stopped: "Detenido" } as const;
const statusColor = { pending: "text-muted", sending: "text-accent", ok: "text-ok", error: "text-danger", skipped: "text-muted", stopped: "text-warn" } as const;

/** Indicador persistente de la difusión en curso (y resumen al terminar). */
export function BroadcastBar() {
  const run = useBroadcastRun();
  const [detail, setDetail] = useState(false);
  if (!run) return null;
  const sendable = run.items.filter((i) => i.status !== "skipped" || i.reason === "Se desconectó");
  const done = sendable.filter((i) => i.status !== "pending" && i.status !== "sending").length;
  const ok = run.items.filter((i) => i.status === "ok").length;
  const current = run.items.find((i) => i.status === "sending");
  const pct = sendable.length ? Math.round((done / sendable.length) * 100) : 100;
  return (
    <div className="shrink-0 border-b border-line bg-selected" role="status" aria-live="polite">
      <div className="flex items-center gap-3 px-3 h-9 text-[12.5px]">
        <Radio size={14} className={run.running ? "text-warn animate-pulse" : "text-accent"} />
        <span className="font-medium">{run.running ? "Difusión en curso" : "Difusión terminada"}</span>
        <span className="tabular-nums text-muted">
          {done}/{sendable.length} {sendable.length === 1 ? "equipo" : "equipos"} · {ok} {ok === 1 ? "enviado" : "enviados"}
          {current ? ` · ${current.name}` : ""}
        </span>
        <div className="w-32 h-1.5 rounded-full bg-hover overflow-hidden">
          <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="flex-1" />
        <button className="text-accent hover:underline" onClick={() => setDetail((d) => !d)}>
          {detail ? "Ocultar detalle" : "Ver detalle"}
        </button>
        {run.running ? (
          <button
            onClick={stopBroadcast}
            className="flex items-center gap-1.5 px-2.5 h-6 rounded-md bg-danger text-danger-fg font-medium hover:opacity-90"
          >
            <Square size={10} fill="currentColor" /> Detener
          </button>
        ) : (
          <button className="text-muted hover:text-fg" title="Cerrar" onClick={clearBroadcast}>
            <X size={14} />
          </button>
        )}
      </div>
      {detail && (
        <ul className="px-10 pb-2 max-h-48 overflow-y-auto text-[12px] space-y-0.5">
          {run.items.map((i) => (
            <li key={i.tabId} className="flex gap-3">
              <span className={`w-20 ${statusColor[i.status]}`}>{statusText[i.status]}</span>
              <span className="w-48 truncate">{i.name}</span>
              <span className="text-muted truncate">{i.reason ?? i.host ?? ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
