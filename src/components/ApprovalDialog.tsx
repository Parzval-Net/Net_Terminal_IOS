import { useEffect, useMemo, useState } from "react";
import { Bot } from "lucide-react";
import { useDragResize } from "../lib/useDragResize";
import { Risk, riskLabel, textRisk } from "../lib/packs";

const BADGE: Record<Risk, string> = {
  read: "border border-line text-muted",
  change: "border border-[var(--warn)] text-warn",
  disruptive: "bg-danger text-danger-fg",
};

export interface ApprovalRequest {
  id: string;
  tool: string;
  target: string;
  detail: string;
}

interface Props {
  request: ApprovalRequest;
  pending: number;
  onDecide: (approved: boolean) => void;
}

/**
 * Aprobación de una acción pedida por un agente de IA. Enter no aprueba a propósito:
 * hay que hacer clic en "Permitir" para evitar aprobaciones por inercia.
 */
export function ApprovalDialog({ request, pending, onDecide }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDecide(false);
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDecide]);

  const win = useDragResize("approvalWindow", false);
  const lines = request.detail.split("\n");
  const action = request.tool === "open_session" ? "abrir la sesión" : "ejecutar en";
  const risk = useMemo(() => (request.tool === "open_session" ? null : textRisk(request.detail)), [request]);
  // Lo que puede cortar servicio exige una confirmación extra antes de habilitar "Permitir".
  const [ack, setAck] = useState(false);
  const blocked = risk === "disruptive" && !ack;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/35 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="approval-title" aria-describedby="approval-detail" {...win.box} className="w-[480px] max-w-full bg-panel border border-line rounded-xl shadow-pop">
        <header {...win.handle} className="flex items-center gap-2.5 px-5 pt-4 select-none">
          <span className="w-8 h-8 grid place-items-center rounded-lg bg-selected text-accent">
            <Bot size={17} />
          </span>
          <div>
            <h2 id="approval-title" className="text-[14px] font-semibold">Un agente de IA quiere {action}</h2>
            <p className="text-[12px] text-muted">{request.target}</p>
          </div>
          {risk && (
            <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${BADGE[risk]}`} title="Riesgo calculado por la app, no declarado por el agente">
              {riskLabel[risk]}
            </span>
          )}
        </header>
        {request.tool !== "open_session" && (
          <pre id="approval-detail" className="mx-5 mt-4 p-3 rounded-lg bg-hover font-mono text-[12px] whitespace-pre-wrap break-all max-h-56 overflow-y-auto select-text">
            {request.detail}
          </pre>
        )}
        <p className="px-5 mt-3 text-[11.5px] text-muted">
          {lines.length > 1 ? `${lines.length} líneas. ` : ""}
          Revisa el contenido antes de permitir. Se rechaza solo en 2 minutos.
          {pending > 1 ? ` Hay ${pending - 1} ${pending - 1 === 1 ? "solicitud más" : "solicitudes más"} en espera.` : ""}
        </p>
        {risk === "disruptive" && (
          <label className="mx-5 mt-2 flex items-start gap-2 text-[12px] text-danger">
            <input type="checkbox" className="mt-0.5 accent-[var(--danger)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            Entiendo que este comando puede cortar servicio en {request.target}.
          </label>
        )}
        <footer className="flex justify-end gap-2 px-5 py-3 mt-3 border-t border-line">
          {/* El foco parte en Rechazar: un Enter accidental no debe aprobar. */}
          <button autoFocus onClick={() => onDecide(false)} className="px-3.5 h-8 rounded-md border border-line hover:bg-hover">
            Rechazar
          </button>
          <button
            onClick={() => !blocked && onDecide(true)}
            disabled={blocked}
            title={blocked ? "Marca la confirmación para permitir un comando que puede cortar servicio" : undefined}
            className={`px-3.5 h-8 rounded-md font-medium hover:opacity-90 disabled:opacity-50 ${risk === "disruptive" ? "bg-danger text-danger-fg" : "bg-accent text-accent-fg"}`}
          >
            Permitir
          </button>
        </footer>
      </div>
    </div>
  );
}
