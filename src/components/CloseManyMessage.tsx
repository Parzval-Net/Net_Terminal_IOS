import type { ReactNode } from "react";
import { CloseScope, CloseSummary, namesPreview, plural } from "../lib/closeAll";

interface Props {
  scope: CloseScope;
  summary: CloseSummary;
  /** Hay un envío a varias sesiones en curso con equipos entre estas pestañas. */
  broadcast: boolean;
  /** Alguna de estas pestañas está a la vista en la vista dividida. */
  split: boolean;
  toolsOpen: boolean;
}

/** Aviso de "Cerrar todas / las demás / las de la derecha": qué se corta y qué se conserva. */
export function CloseManyMessage({ scope, summary: s, broadcast, split, toolsOpen }: Props) {
  const rest = [
    s.local && plural(s.local, "terminal local", "terminales locales"),
    s.disconnected && plural(s.disconnected, "pestaña desconectada", "pestañas desconectadas"),
  ].filter(Boolean) as string[];
  const items: ReactNode[] = [];
  if (s.transfers)
    items.push(
      <>
        Se {s.transfers === 1 ? "cancela 1 transferencia" : `cancelan ${s.transfers} transferencias`} en curso (pestañas SCP/SFTP).
      </>,
    );
  if (s.quick)
    items.push(
      <>
        Se {s.quick === 1 ? "pierde 1 conexión rápida" : `pierden ${s.quick} conexiones rápidas`} sin guardar. Para{" "}
        {s.quick === 1 ? "conservarla" : "conservarlas"}, usa
        "Guardar como sesión…" en su pestaña antes de cerrar.
      </>,
    );
  if (broadcast)
    items.push(
      scope === "all"
        ? "El envío a varias sesiones en curso se detiene."
        : "El envío a varias sesiones en curso omite los equipos de estas pestañas.",
    );
  if (split)
    items.push(scope === "all" ? "Se sale de la vista dividida." : "Los paneles de la vista dividida que muestran estas pestañas quedan vacíos.");
  if (s.logging)
    items.push(
      `${s.logging === 1 ? "1 pestaña graba" : `${s.logging} pestañas graban`} log: el archivo se cierra y lo grabado queda en disco.`,
    );
  if (toolsOpen) items.push("Herramientas sigue abierta: el monitoreo y los servidores no se detienen.");

  return (
    <div className="whitespace-normal space-y-2">
      {s.connected.length > 0 ? (
        <p className="text-fg">
          <b className="text-danger">
            Se {s.connected.length === 1 ? "corta 1 sesión remota conectada" : `cortan ${s.connected.length} sesiones remotas conectadas`}
          </b>
          {" "}(SSH, Telnet, Serial o TCP): {namesPreview(s.connected)}.
        </p>
      ) : (
        <p className="text-fg">No hay sesiones remotas conectadas.</p>
      )}
      {rest.length > 0 && (
        <p>
          También se {s.local + s.disconnected === 1 ? "cierra" : "cierran"} {rest.join(" y ")}.
        </p>
      )}
      {items.length > 0 && (
        <ul className="list-disc pl-4 space-y-1">
          {items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
