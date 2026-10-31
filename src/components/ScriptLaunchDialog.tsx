import { useEffect, useMemo, useState } from "react";
import { FileCode2, TriangleAlert } from "lucide-react";
import { resolveTargets, useBroadcastTarget, useWorkspace } from "../lib/broadcast";
import { useDragResize } from "../lib/useDragResize";
import type { Tab } from "../types";
import { TargetOptions } from "./BroadcastTarget";

export interface ScriptLaunch {
  /** Sesiones destino; la primera es la principal (`nt.run`, `nt.session`). */
  targets: Tab[];
  allowChanges: boolean;
  parallel: number;
  maxMinutes: number;
  /** Permite `type_saved_password`: la app escribe la contraseña guardada (el script no la ve). */
  vaultType: boolean;
}

interface Props {
  script: string;
  onRun: (launch: ScriptLaunch) => void;
  onCancel: () => void;
}

const MINUTES = [5, 15, 30, 60, 120];

/**
 * Lanzar un script: destinos (el mismo selector de la difusión), modo de solo lectura o
 * "permitir cambios", sesiones en paralelo y tiempo máximo.
 */
export function ScriptLaunchDialog({ script, onRun, onCancel }: Props) {
  const win = useDragResize<HTMLFormElement>("scriptLaunchWindow", false);
  const target = useBroadcastTarget();
  const ws = useWorkspace();
  const [allowChanges, setAllowChanges] = useState(false);
  const [parallel, setParallel] = useState(1);
  const [maxMinutes, setMaxMinutes] = useState(30);
  // Por ejecución: siempre empieza sin marcar.
  const [vaultType, setVaultType] = useState(false);

  const resolved = useMemo(() => {
    const tabs = ws.tabs.map((t) => ({ id: t.id, session: t.session, title: t.title }) as Tab);
    const r = resolveTargets(target, tabs, (id) => ws.tabs.find((t) => t.id === id)?.status, ws.activeId, ws.panes);
    // La pestaña activa, si está entre los destinos, es la sesión principal.
    r.targets.sort((a, b) => Number(b.id === ws.activeId) - Number(a.id === ws.activeId));
    return r;
  }, [target, ws]);
  const title = (t: Tab) => ws.tabs.find((x) => x.id === t.id)?.title ?? t.session.name;
  const n = resolved.targets.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4" onMouseDown={onCancel}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="sl-title"
        {...win.box}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (n) onRun({ targets: resolved.targets, allowChanges, parallel: Math.min(parallel, n), maxMinutes, vaultType });
        }}
        className="w-[460px] max-w-full bg-panel border border-line rounded-xl shadow-pop"
      >
        <header {...win.handle} className="flex items-center gap-2.5 px-5 pt-4 select-none">
          <span className="w-8 h-8 grid place-items-center rounded-lg bg-selected text-accent">
            <FileCode2 size={17} />
          </span>
          <h2 id="sl-title" className="text-[14px] font-semibold truncate">
            Ejecutar {script}
          </h2>
        </header>

        <div className="px-5 mt-3 text-[12px]">
          <p className="text-muted mb-1">Destino (el script solo puede usar estas sesiones)</p>
          <div className="border border-line rounded-lg p-1.5">
            <TargetOptions />
          </div>
          <p className="mt-2 leading-snug" aria-live="polite">
            {n === 0 ? (
              <span className="text-danger">Ninguna sesión remota conectada en este destino.</span>
            ) : (
              <>
                {n === 1 ? "1 sesión: " : `${n} sesiones: `}
                {resolved.targets.map((t, i) => (
                  <span key={t.id} className={i === 0 ? "font-medium" : ""}>
                    {title(t)}
                    {i < n - 1 ? ", " : ""}
                  </span>
                ))}
                {n > 1 && <span className="text-muted"> (la primera es la principal de nt.run)</span>}
              </>
            )}
          </p>
          {resolved.skipped.length > 0 && (
            <p className="mt-1 text-muted leading-snug">
              Se omiten: {resolved.skipped.map((s) => `${title(s.tab)} (${s.reason.toLowerCase()})`).join(", ")}
            </p>
          )}

          <label className="mt-3 flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--danger)]"
              checked={allowChanges}
              onChange={(e) => setAllowChanges(e.target.checked)}
            />
            <span>
              Permitir cambios
              <span className="block text-muted">Sin marcar (recomendado), cada comando que cambia configuración pide confirmación.</span>
            </span>
          </label>
          {allowChanges && (
            <p className="mt-2 p-2 rounded-md border border-danger text-danger leading-snug flex gap-2">
              <TriangleAlert size={14} className="shrink-0 mt-0.5" />
              <span>
                Los comandos que cambian configuración se enviarán sin preguntar {n > 1 ? `en las ${n} sesiones` : "en la sesión"}. Lo
                que puede cortar servicio se confirma igual. Úsalo solo con scripts que revisaste.
              </span>
            </p>
          )}

          <label className="mt-3 flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--accent)]"
              checked={vaultType}
              disabled={n === 0}
              onChange={(e) => setVaultType(e.target.checked)}
            />
            <span>
              Permitir que el script escriba contraseñas guardadas en: {n ? resolved.targets.map(title).join(", ") : "ninguna sesión"}
              <span className="block text-muted">
                Solo con nt.type_saved_password(): la app la escribe en el pedido de login del equipo y el script nunca la ve. Vale para esta
                ejecución.
              </span>
            </span>
          </label>

          <div className="mt-3 flex gap-4">
            <label className="flex items-center gap-2">
              <span className="text-muted">En paralelo</span>
              <select
                className="field !h-7 !w-16 !text-[12px]"
                value={parallel}
                disabled={n < 2}
                onChange={(e) => setParallel(Number(e.target.value))}
              >
                {[1, 2, 3, 4].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-muted">Tiempo máximo</span>
              <select className="field !h-7 !w-24 !text-[12px]" value={maxMinutes} onChange={(e) => setMaxMinutes(Number(e.target.value))}>
                {MINUTES.map((v) => (
                  <option key={v} value={v}>
                    {v} min
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-3 text-[11.5px] text-muted leading-snug">
            Mientras corre, lo que escribas en estas pestañas no se envía al equipo. Para cortarlo usa Detener script en la barra de
            botones.
          </p>
        </div>

        <footer className="flex justify-end gap-2 px-5 py-3 mt-3 border-t border-line">
          <button type="button" onClick={onCancel} className="px-3.5 h-8 rounded-md border border-line hover:bg-hover">
            Cancelar
          </button>
          <button
            type="submit"
            autoFocus
            disabled={n === 0}
            className={`px-3.5 h-8 rounded-md font-medium hover:opacity-90 disabled:opacity-40 ${
              allowChanges ? "bg-danger text-danger-fg" : "bg-accent text-accent-fg"
            }`}
          >
            Ejecutar
          </button>
        </footer>
      </form>
    </div>
  );
}
