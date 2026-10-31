import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Send, Trash2 } from "lucide-react";

interface Entry {
  cmd: string;
  ts: number;
}

interface Props {
  /** Clave del equipo (ver historyKey). */
  historyKey: string;
  connected: boolean;
  /** Reenvía por el mismo camino con control de riesgo que Notas y el catálogo. */
  onResend: (cmd: string) => void;
  onClose: () => void;
}

/**
 * Historial de comandos enviados desde Notas, catálogo y botones para el equipo activo.
 * Se abre desde la barra de estado, el menú de la pestaña, la paleta o el atajo; se lee solo al montarse (sin costo cerrado).
 */
export function HistoryMenu({ historyKey, connected, onResend, onClose }: Props) {
  const [items, setItems] = useState<Entry[] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<Entry[]>("cmd_history", { key: historyKey })
      .then(setItems)
      .catch(() => setItems([]));
    // El botón del historial en la barra de estado alterna el panel: no lo cierra aquí para que el clic no lo reabra.
    const onDown = (e: MouseEvent | TouchEvent) =>
      !box.current?.contains(e.target as Node) && !(e.target as Element).closest?.("[data-history-btn]") && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("touchstart", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("touchstart", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [historyKey, onClose]);

  const clear = () => {
    if (!confirmClear) return setConfirmClear(true);
    invoke("cmd_history_clear", { key: historyKey }).catch(() => {});
    setItems([]);
    setConfirmClear(false);
  };

  return (
    <div
      ref={box}
      role="dialog"
      aria-label="Historial de comandos enviados"
      className="fixed bottom-16 sm:bottom-9 right-2 sm:right-3 z-40 w-[420px] max-w-[calc(100vw-1rem)] bg-panel border border-line rounded-lg shadow-pop text-[12px] text-fg overflow-hidden"
    >
      <div className="flex items-center justify-between px-3 h-8 border-b border-line text-muted">
        <span className="truncate pr-2 min-w-0" title="Últimos comandos enviados (Notas, catálogo y botones)">
          Últimos comandos enviados
        </span>
        {!!items?.length && (
          <button
            onClick={clear}
            onMouseLeave={() => setConfirmClear(false)}
            className={`shrink-0 flex items-center gap-1 hover:text-danger active:text-danger ${confirmClear ? "text-danger" : ""}`}
            title="Borrar el historial de este equipo"
          >
            <Trash2 size={12} />
            {confirmClear ? "Confirmar" : "Borrar"}
          </button>
        )}
      </div>
      <ul className="max-h-[320px] overflow-y-auto p-1">
        {items === null && <li className="px-2 py-3 text-muted">Cargando…</li>}
        {items?.length === 0 && (
          <li className="px-2 py-3 text-muted">
            Sin comandos registrados. Se guardan los enviados desde Notas, el catálogo y los botones, nunca lo que
            escribes en la terminal.
          </li>
        )}
        {items?.map((e) => {
          const lines = e.cmd.split("\n");
          return (
            <li key={e.ts + e.cmd}>
              <button
                disabled={!connected}
                title={connected ? `Reenviar:\n${e.cmd}` : "Conecta la sesión para reenviar"}
                onClick={() => {
                  onClose();
                  onResend(e.cmd);
                }}
                className="group w-full flex items-center gap-2 px-2 h-8 sm:h-7 rounded-md text-left hover:bg-hover active:bg-hover select-none touch-manipulation disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <span className="flex-1 min-w-0 truncate font-mono">
                  {lines[0]}
                  {lines.length > 1 && <span className="text-muted"> (+{lines.length - 1} líneas)</span>}
                </span>
                <span className="text-[11px] text-muted shrink-0">
                  {new Date(e.ts).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                </span>
                {connected && <Send size={12} className="text-accent shrink-0 opacity-0 group-hover:opacity-100" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
