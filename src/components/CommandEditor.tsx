import { useEffect, useState } from "react";
import { CATEGORIES, PackCommand, Platform, Risk, computeRisk, riskLabel } from "../lib/packs";
import { useDragResize } from "../lib/useDragResize";

interface Props {
  vendorName: string;
  platforms: Platform[];
  initial?: PackCommand;
  onSave: (c: PackCommand) => void;
  onDelete?: () => void;
  onClose: () => void;
}

/** Alta o edición de un comando en "Mis comandos" del fabricante. */
export function CommandEditor({ vendorName, platforms, initial, onSave, onDelete, onClose }: Props) {
  const win = useDragResize<HTMLFormElement>("commandEditor");
  const [c, setC] = useState<PackCommand>(initial ?? { cmd: "", desc: "", cat: "Diagnóstico", risk: "read" });
  const computed = computeRisk(c.cmd);
  const RANK = { read: 0, change: 1, disruptive: 2 };
  const effective: Risk = RANK[computed] > RANK[c.risk] ? computed : c.risk;
  const badVar = (c.cmd.match(/\{\{[^}]*\}\}/g) ?? []).some((m) => !/^\{\{\s*[\w.-]+\s*\}\}$/.test(m));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const valid = c.cmd.trim() && c.desc.trim() && !badVar;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-2 sm:p-4" onMouseDown={onClose}>
      <form
        {...win.box}
        className="w-full sm:w-[480px] bg-panel border border-line rounded-xl shadow-pop sm:resize overflow-hidden flex flex-col min-w-0 sm:min-w-[360px] min-h-0 sm:min-h-[300px] max-w-[calc(100vw-1rem)] sm:max-w-[96vw] max-h-[96vh] sm:max-h-[94vh]"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave({ ...c, cmd: c.cmd.trim(), desc: c.desc.trim(), platforms: c.platforms?.length ? c.platforms : undefined });
        }}
      >
        <header {...win.handle} className="shrink-0 px-3 sm:px-5 h-12 flex items-center border-b border-line select-none">
          <h2 className="text-[14px] font-semibold">
            {initial ? "Editar comando" : "Nuevo comando"} · {vendorName}
          </h2>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 space-y-3">
          <label className="block">
            <span className="block mb-1 text-[11.5px] font-medium text-muted">Comando (varias líneas permitidas, variables como {"{{interfaz}}"})</span>
            <textarea
              autoFocus
              className={`field !h-24 py-2 font-mono !text-[12px] resize-y ${badVar ? "!border-danger" : ""}`}
              spellCheck={false}
              value={c.cmd}
              onChange={(e) => setC({ ...c, cmd: e.target.value })}
            />
            {badVar && <span className="text-[11px] text-danger">Las variables solo admiten letras, números, _ . y -</span>}
          </label>
          <label className="block">
            <span className="block mb-1 text-[11.5px] font-medium text-muted">Explicación</span>
            <textarea className="field !h-16 py-2 !text-[12.5px] resize-y" value={c.desc} onChange={(e) => setC({ ...c, desc: e.target.value })} />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block mb-1 text-[11.5px] font-medium text-muted">Categoría</span>
              <select className="field" value={c.cat} onChange={(e) => setC({ ...c, cat: e.target.value })}>
                {CATEGORIES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block mb-1 text-[11.5px] font-medium text-muted">Riesgo</span>
              <select className="field" value={c.risk} onChange={(e) => setC({ ...c, risk: e.target.value as Risk })}>
                {(Object.keys(riskLabel) as Risk[]).map((r) => (
                  <option key={r} value={r}>
                    {riskLabel[r]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {effective !== c.risk && (
            <p className="text-[11.5px] text-warn">▲ Por su contenido, la app lo tratará como "{riskLabel[effective]}".</p>
          )}
          {platforms.length > 0 && (
            <div>
              <span className="block mb-1 text-[11.5px] font-medium text-muted">Aplica a (vacío = todas)</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {platforms.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 text-[12px]">
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)]"
                      checked={!!c.platforms?.includes(p.id)}
                      onChange={(e) =>
                        setC({
                          ...c,
                          platforms: e.target.checked ? [...(c.platforms ?? []), p.id] : (c.platforms ?? []).filter((x) => x !== p.id),
                        })
                      }
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
          )}
          <label className="block">
            <span className="block mb-1 text-[11.5px] font-medium text-muted">Nota (opcional)</span>
            <input className="field" value={c.note ?? ""} onChange={(e) => setC({ ...c, note: e.target.value || undefined })} />
          </label>
        </div>
        <footer className="shrink-0 flex flex-wrap justify-between items-center gap-2 px-3 sm:px-5 py-3 border-t border-line">
          <div>
            {onDelete && (
              <button type="button" onClick={onDelete} className="px-3.5 h-10 sm:h-8 rounded-xl sm:rounded-md text-danger hover:bg-hover text-[13px] font-medium touch-manipulation">
                Eliminar
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onClose} className="px-3.5 h-10 sm:h-8 rounded-xl sm:rounded-md border border-line hover:bg-hover text-[13px] font-medium sm:font-normal touch-manipulation">
              Cancelar
            </button>
            <button type="submit" disabled={!valid} className="px-3.5 h-10 sm:h-8 rounded-xl sm:rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-40 text-[13px] touch-manipulation">
              Guardar en Mis comandos
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
