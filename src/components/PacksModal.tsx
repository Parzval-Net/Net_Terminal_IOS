import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, Download, FileJson, Lock, Search, Trash2, Upload, X } from "lucide-react";
import { OS_VENDORS, Pack, Risk, Validation, buildCatalog, riskLabel, validatePack } from "../lib/packs";
import { useDragResize } from "../lib/useDragResize";

interface Props {
  packs: Pack[];
  disabled: string[];
  onToggle: (id: string, enabled: boolean) => void;
  onChanged: () => void;
  onClose: () => void;
}

const riskColor: Record<Risk, string> = { read: "text-ok", change: "text-warn", disruptive: "text-danger" };

export function PacksModal({ packs, disabled, onToggle, onChanged, onClose }: Props) {
  const win = useDragResize("packsWindow");
  const [preview, setPreview] = useState<Validation | null>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Con 13+ packs incluidos: búsqueda y grupos como en el selector del catálogo.
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = packs.filter((p) => !q || `${p.name} ${p.vendorName ?? ""} ${p.vendor}`.toLowerCase().includes(q));
    const groupOf = (p: Pack) =>
      !p.builtin ? "Importados" : OS_VENDORS.includes(p.vendor) ? "Sistemas operativos" : /^forti/.test(p.vendor) ? "Fortinet" : "Equipos de red";
    return (["Equipos de red", "Fortinet", "Sistemas operativos", "Importados"] as const)
      .map((g) => [g, match.filter((p) => groupOf(p) === g)] as const)
      .filter(([, l]) => l.length);
  }, [packs, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = async () => {
    setError("");
    const path = await open({ multiple: false, directory: false, filters: [{ name: "Pack de comandos", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    try {
      setPreview(validatePack(await invoke("cmdpack_read", { path })));
    } catch (e) {
      setError(String(e));
    }
  };

  const install = async () => {
    const pack = preview?.pack;
    if (!pack) return;
    if (packs.some((p) => p.builtin && p.id === pack.id)) return setError("Ese id corresponde a un pack incluido; cambia el id del pack");
    try {
      // Se guarda la versión ya validada y normalizada, nunca el archivo original.
      await invoke("cmdpack_save", { pack: { ...pack, builtin: undefined } });
      setPreview(null);
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const exportPack = async (id: string) => {
    const dest = await save({ defaultPath: `${id}.json`, filters: [{ name: "Pack de comandos", extensions: ["json"] }] });
    if (!dest) return;
    await invoke("cmdpack_export", { id, dest }).catch((e) => setError(String(e)));
  };

  // Memorizado: mover o redimensionar la ventana vuelve a dibujar el modal.
  const stats = useMemo(() => {
    const pack = preview?.pack;
    if (!pack) return null;
    const cat = buildCatalog([pack], [])[0];
    const by: Record<Risk, number> = { read: 0, change: 0, disruptive: 0 };
    cat.commands.forEach((c) => by[c.risk]++);
    return { by, escalated: cat.commands.filter((c) => c.escalated).length, total: cat.commands.length };
  }, [preview]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-2 sm:p-4" onMouseDown={onClose}>
      <div
        {...win.box}
        className="w-full sm:w-[620px] h-full sm:h-[560px] bg-panel border border-line rounded-xl shadow-pop sm:resize overflow-hidden flex flex-col min-w-0 sm:min-w-[420px] min-h-0 sm:min-h-[320px] max-w-[calc(100vw-1rem)] sm:max-w-[96vw] max-h-[96vh] sm:max-h-[94vh]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header {...win.handle} className="shrink-0 flex items-center justify-between px-3 sm:px-5 h-12 border-b border-line select-none">
          <h2 className="text-[14px] font-semibold">Packs de comandos</h2>
          <button onClick={onClose} aria-label="Cerrar" className="w-7 h-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 space-y-4">
          <p className="text-[12px] text-muted">
            Un pack es un archivo JSON con comandos y sus explicaciones. Es solo texto: nunca se ejecuta al importarlo. La app
            recalcula el riesgo de cada comando y no permite que un pack lo declare menor.
          </p>
          {error && <p className="text-[12px] text-danger">{error}</p>}

          {preview && (
            <div className="rounded-lg border border-line p-3 space-y-2">
              {preview.pack ? (
                <>
                  <div className="flex items-center gap-2">
                    <FileJson size={16} className="text-accent" />
                    <span className="font-semibold">{preview.pack.name}</span>
                    <span className="text-[12px] text-muted">
                      {preview.pack.vendorName} · v{preview.pack.version ?? "?"} · {preview.pack.author ?? "autor no declarado"}
                    </span>
                  </div>
                  {preview.pack.description && <p className="text-[12px]">{preview.pack.description}</p>}
                  {stats && (
                    <p className="text-[12px]">
                      {stats.total} comandos ·{" "}
                      {(Object.keys(stats.by) as Risk[]).map((r) => (
                        <span key={r} className={`mr-2 ${riskColor[r]}`}>
                          {riskLabel[r]}: {stats.by[r]}
                        </span>
                      ))}
                      {stats.escalated > 0 && (
                        <span className="block text-warn">
                          ▲ {stats.escalated} comandos declaraban menos riesgo del real; la app los ajustó.
                        </span>
                      )}
                    </p>
                  )}
                  {packs.some((p) => p.id === preview.pack!.id) && (
                    <p className="text-[12px] text-warn">▲ Reemplazará el pack instalado con el mismo id.</p>
                  )}
                </>
              ) : (
                <p className="text-[12px] text-danger">No es un pack válido: {preview.errors.join(" · ")}</p>
              )}
              {preview.warnings.length > 0 && (
                <details className="text-[11.5px] text-muted">
                  <summary>{preview.warnings.length} avisos</summary>
                  <ul className="mt-1 list-disc pl-4 max-h-24 overflow-y-auto">
                    {preview.warnings.slice(0, 50).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => setPreview(null)} className="px-3 h-7 rounded-md border border-line hover:bg-hover">
                  Cancelar
                </button>
                <button
                  disabled={!preview.pack}
                  onClick={install}
                  className="px-3 h-7 rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-40"
                >
                  Importar
                </button>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-field-line bg-field focus-within:border-accent">
            <Search size={13} className="text-muted shrink-0" />
            <input
              className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] placeholder:text-muted"
              placeholder="Buscar pack o fabricante"
              aria-label="Buscar pack o fabricante"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {grouped.map(([label, list]) => (
            <section key={label} className="space-y-1">
              <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</h3>
              <div className="rounded-lg border border-line divide-y divide-[var(--border)]">
                {list.map((p) => {
                  const enabled = !disabled.includes(p.id);
                  return (
                    <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                      <label className="p-1 -m-1 grid place-items-center cursor-pointer">
                        <input
                          type="checkbox"
                          className="accent-[var(--accent)]"
                          checked={enabled}
                          onChange={(e) => onToggle(p.id, e.target.checked)}
                          title={enabled ? "Desactivar" : "Activar"}
                        />
                      </label>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {p.builtin && <Lock size={11} className="text-muted" />}
                          <span className="truncate">{p.name}</span>
                        </div>
                        <div className="text-[11.5px] text-muted truncate">
                          {p.name.startsWith(p.vendorName) ? "" : `${p.vendorName} · `}
                          {p.commands.length} comandos{p.version ? ` · v${p.version}` : ""}
                          {p.author ? ` · ${p.author}` : ""}
                        </div>
                      </div>
                      {!p.builtin && (
                        <>
                          <button title="Exportar para compartir" onClick={() => exportPack(p.id)} className="w-7 h-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover">
                            <Download size={14} />
                          </button>
                          <button
                            title={confirmDelete === p.id ? "Clic para confirmar" : "Eliminar"}
                            onMouseLeave={() => setConfirmDelete(null)}
                            onClick={async () => {
                              if (confirmDelete !== p.id) return setConfirmDelete(p.id);
                              await invoke("cmdpack_delete", { id: p.id }).catch((e) => setError(String(e)));
                              onChanged();
                            }}
                            className={`w-7 h-7 grid place-items-center rounded-md hover:bg-hover ${confirmDelete === p.id ? "text-danger" : "text-muted hover:text-danger"}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {!grouped.length && <p className="text-center text-[12px] text-muted py-2">Sin resultados para "{query}"</p>}

          <p className="text-[11.5px] text-muted flex gap-1.5">
            <AlertTriangle size={13} className="shrink-0 text-warn" />
            Al compartir un pack no incluyas IPs, hostnames, nombres de clientes ni credenciales reales: usa variables como{" "}
            {"{{ip}}"}.
          </p>
        </div>

        <footer className="shrink-0 flex flex-wrap justify-between items-center gap-2 px-3 sm:px-5 py-2.5 sm:py-3 border-t border-line">
          <span className="text-[11.5px] text-muted hidden sm:inline">Formato: netterminal-commands v1 (ver documentación técnica, sección Packs de comandos)</span>
          <button onClick={pick} className="w-full sm:w-auto shrink-0 whitespace-nowrap flex items-center justify-center gap-1.5 px-3.5 h-10 sm:h-8 rounded-xl sm:rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 touch-manipulation text-[13px] sm:text-[12.5px]">
            <Upload size={14} /> Importar pack
          </button>
        </footer>
      </div>
    </div>
  );
}
