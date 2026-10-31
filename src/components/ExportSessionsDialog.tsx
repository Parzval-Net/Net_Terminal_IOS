import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { FileDown, Folder, X } from "lucide-react";
import { Session, sessionTarget } from "../types";
import { SessionIcon } from "./SessionIcon";
import { isWithin, normPath } from "../lib/folders";
import { sessionsToXml } from "../lib/sessionXml";
import { plural } from "../lib/plural";

interface Props {
  sessions: Session[];
  /** Carpeta preseleccionada (menú de una carpeta del panel); sin valor, todas. */
  folder?: string;
  onClose: () => void;
}

/** Elige qué sesiones exportar: XML compatible con SecureCRT o JSON al portapapeles. */
export function ExportSessionsDialog({ sessions, folder, onClose }: Props) {
  const list = useMemo(
    () =>
      sessions
        .filter((s) => s.type !== "local")
        .map((s) => ({ s, path: normPath(s.folder) }))
        .sort((a, b) => a.path.localeCompare(b.path) || a.s.name.localeCompare(b.s.name)),
    [sessions],
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(list.filter((x) => folder === undefined || isWithin(x.path, normPath(folder))).map((x) => x.s.id)),
  );
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter((x) => `${x.s.name} ${sessionTarget(x.s)} ${x.path}`.toLowerCase().includes(t));
  }, [list, q]);

  const groups = useMemo(() => {
    const out: { path: string; items: Session[] }[] = [];
    for (const x of shown) {
      const last = out[out.length - 1];
      if (last?.path === x.path) last.items.push(x.s);
      else out.push({ path: x.path, items: [x.s] });
    }
    return out;
  }, [shown]);

  const setMany = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) on ? next.add(id) : next.delete(id);
      return next;
    });
  const shownIds = shown.map((x) => x.s.id);
  const allShown = shownIds.length > 0 && shownIds.every((id) => selected.has(id));
  const picked = () => list.filter((x) => selected.has(x.s.id)).map((x) => x.s);

  const saveXml = async () => {
    const items = picked();
    const dest = await save({ defaultPath: "sesiones.xml", filters: [{ name: "XML", extensions: ["xml"] }] }).catch(() => null);
    if (!dest) return;
    await invoke("save_text", { dest, content: sessionsToXml(items) })
      .then(() => setMsg(`${plural(items.length, "sesión exportada", "sesiones exportadas")}: ${dest}`))
      .catch((e) => setMsg(String(e)));
  };

  const copyJson = async () => {
    const items = picked().map(({ id: _id, created_at: _c, save_password: _pw, ...rest }) => rest);
    await writeText(JSON.stringify(items, null, 2))
      .then(() => setMsg(`${plural(items.length, "sesión copiada", "sesiones copiadas")} al portapapeles`))
      .catch((e) => setMsg(String(e)));
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/25 p-2 sm:p-4" onMouseDown={onClose}>
      <div
        className="w-full sm:w-[560px] max-w-[calc(100vw-1rem)] sm:max-w-[96vw] max-h-[96vh] sm:max-h-[90vh] flex flex-col bg-panel border border-line rounded-xl shadow-pop overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 flex items-center justify-between px-3 sm:px-5 h-12 border-b border-line">
          <h2 className="text-[14px] font-semibold">Exportar sesiones</h2>
          <button onClick={onClose} aria-label="Cerrar" className="w-7 h-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover">
            <X size={16} />
          </button>
        </header>

        <div className="shrink-0 px-3 sm:px-5 pt-3 pb-2 space-y-2">
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            <input className="field flex-1 min-w-[140px]" placeholder="Filtrar por nombre, host o carpeta" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            <label className="flex items-center gap-2 text-[12.5px] shrink-0">
              <input type="checkbox" className="accent-[var(--accent)]" checked={allShown} onChange={(e) => setMany(shownIds, e.target.checked)} />
              {q ? "Todas las filtradas" : "Todas"}
            </label>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-5 pb-3">
          {!groups.length && <p className="py-6 text-center text-[12px] text-muted">Sin sesiones que coincidan.</p>}
          {groups.map((g) => {
            const ids = g.items.map((s) => s.id);
            const on = ids.every((id) => selected.has(id));
            return (
              <div key={g.path} className="py-1">
                <label className="flex items-center gap-2 h-7 text-[12px] font-medium text-muted">
                  <input type="checkbox" className="accent-[var(--accent)]" checked={on} onChange={(e) => setMany(ids, e.target.checked)} />
                  <Folder size={13} />
                  <span className="truncate">{g.path || "Sin carpeta"}</span>
                  <span className="ml-auto text-[11px] font-normal">{ids.filter((id) => selected.has(id)).length}/{ids.length}</span>
                </label>
                {g.items.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 h-7 pl-6 text-[12.5px] rounded-md hover:bg-hover">
                    <input type="checkbox" className="accent-[var(--accent)]" checked={selected.has(s.id)} onChange={(e) => setMany([s.id], e.target.checked)} />
                    <SessionIcon type={s.type} size={13} />
                    <span className="truncate">{s.name}</span>
                    <span className="ml-auto pr-1 text-[11px] text-muted truncate">{sessionTarget(s)}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>

        <footer className="shrink-0 border-t border-line px-3 sm:px-5 py-3 space-y-2">
          <p className="text-[11.5px] text-muted">
            El XML usa el formato de SecureCRT: se abre ahí y se reimporta aquí con Importar › Desde archivo. Solo datos de
            conexión, nunca contraseñas ni comandos al conectar.
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {msg && <span className="mr-auto text-[11.5px] text-accent truncate" title={msg}>{msg}</span>}
            <span className="text-[11.5px] text-muted">{plural(selected.size, "sesión", "sesiones")}</span>
            <button onClick={copyJson} disabled={!selected.size} className="px-3.5 h-10 sm:h-8 rounded-xl sm:rounded-md border border-line hover:bg-hover disabled:opacity-40 text-[13px] font-medium sm:font-normal touch-manipulation">
              Copiar JSON
            </button>
            <button
              onClick={saveXml}
              disabled={!selected.size}
              className="flex items-center gap-1.5 px-3.5 h-10 sm:h-8 rounded-xl sm:rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-40 text-[13px] touch-manipulation"
            >
              <FileDown size={14} /> Guardar XML…
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
