import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { homeDir, join } from "@tauri-apps/api/path";
import { AlertTriangle, FileUp, X } from "lucide-react";
import { Session, sessionTarget } from "../types";
import { SessionIcon, typeLabel } from "./SessionIcon";
import { joinPath, normPath } from "../lib/folders";
import { mergeImported, planImport } from "../lib/importMerge";

import { plural } from "../lib/plural";
interface Preview {
  format: string;
  sessions: Session[];
  warnings: string[];
}

interface Props {
  folders: string[];
  /** Sesiones guardadas, para avisar cuáles ya existen y cuáles cambian. */
  sessions: Session[];
  /** Agrega `list` (con la deduplicación existente) y guarda `updates`; devuelve cuántas se agregaron. */
  onImport: (list: Session[], updates: Session[]) => Promise<number>;
  onClose: () => void;
}

const FORMATS: { id: string; label: string; ext: string[] }[] = [
  { id: "auto", label: "Detectar automáticamente", ext: [] },
  { id: "openssh", label: "OpenSSH (~/.ssh/config)", ext: [] },
  { id: "putty", label: "PuTTY (.reg exportado)", ext: ["reg"] },
  { id: "securecrt", label: "SecureCRT (XML exportado)", ext: ["xml"] },
  { id: "mobaxterm", label: "MobaXterm (.mobaconf, .mxtsessions, .ini)", ext: ["mobaconf", "mxtsessions", "ini"] },
  { id: "csv", label: "CSV", ext: ["csv", "txt"] },
];
const NAMES: Record<string, string> = { openssh: "OpenSSH", putty: "PuTTY", securecrt: "SecureCRT", mobaxterm: "MobaXterm", csv: "CSV" };

/** Importación desde otros clientes con vista previa, selección y carpeta de destino. */
export function ImportDialog({ folders, sessions, onImport, onClose }: Props) {
  const [format, setFormat] = useState("auto");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [file, setFile] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dest, setDest] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // Sesiones que ya existen (misma carpeta y nombre) con datos de conexión distintos.
  const [overwrite, setOverwrite] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const load = async (path: string, fmt: string) => {
    setBusy(true);
    setMsg("");
    try {
      const p = await invoke<Preview>("import_sessions_file", { path, format: fmt });
      setPreview(p);
      setFile(path);
      setSelected(new Set(p.sessions.map((_, i) => i)));
      setDest(`Importado/${NAMES[p.format] ?? p.format}`);
      if (!p.sessions.length) setMsg("No se encontraron sesiones importables en el archivo.");
    } catch (e) {
      setPreview(null);
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    const f = FORMATS.find((x) => x.id === format);
    const path = await open({
      multiple: false,
      directory: false,
      title: "Archivo de sesiones para importar",
      filters: f?.ext.length ? [{ name: f.label, extensions: f.ext }] : undefined,
    }).catch(() => null);
    if (typeof path === "string") load(path, format);
  };

  const sshConfig = async () => {
    try {
      load(await join(await homeDir(), ".ssh", "config"), "openssh");
    } catch (e) {
      setMsg(String(e));
    }
  };

  // Sesiones con su carpeta final y su estado frente a lo ya guardado.
  const resolved = useMemo(() => {
    if (!preview) return [];
    const base = normPath(dest);
    return preview.sessions.map((s) => ({ ...s, folder: joinPath(base, s.folder ?? "") || undefined }));
  }, [preview, dest]);
  const plan = useMemo(() => planImport(sessions, resolved), [sessions, resolved]);
  const changing = plan.filter((p, i) => p.status === "update" && selected.has(i)).length;
  // Sesiones que cambian de destino teniendo contraseña guardada, túneles o comandos al conectar.
  const risky = plan.flatMap((p, i) => (p.status === "update" && p.drops && selected.has(i) ? [{ p, s: resolved[i] }] : []));
  // Con cambios de destino sensibles la opción por defecto es conservar.
  useEffect(() => setOverwrite(risky.length === 0), [risky.length]);

  const doImport = async () => {
    if (!preview) return;
    const fresh: Session[] = [];
    const updates: Session[] = [];
    let same = 0;
    let kept = 0;
    resolved.forEach((s, i) => {
      if (!selected.has(i)) return;
      const p = plan[i];
      if (p.status === "new") fresh.push(s);
      else if (p.status === "same") same++;
      else if (overwrite && p.existing) updates.push(mergeImported(p.existing, s));
      else kept++;
    });
    setBusy(true);
    try {
      const added = await onImport(fresh, updates);
      const parts = [plural(added, "sesión nueva", "sesiones nuevas")];
      if (updates.length) parts.push(plural(updates.length, "actualizada", "actualizadas"));
      if (same + fresh.length - added) parts.push(plural(same + fresh.length - added, "ya existía igual", "ya existían iguales"));
      if (kept) parts.push(`${plural(kept, "existente", "existentes")} sin cambios por tu elección`);
      setMsg(`Importación lista: ${parts.join(", ")}.`);
      setPreview(null);
    } catch (e) {
      setMsg(`Importación incompleta: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const all = !!preview && selected.size === preview.sessions.length;
  const toggle = (i: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const count = selected.size;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/25 p-2 sm:p-4" onMouseDown={onClose}>
      <div
        className="w-full sm:w-[680px] max-w-[calc(100vw-1rem)] sm:max-w-[96vw] max-h-[96vh] sm:max-h-[90vh] flex flex-col bg-panel border border-line rounded-xl shadow-pop overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 flex items-center justify-between px-3 sm:px-5 h-12 border-b border-line">
          <h2 className="text-[14px] font-semibold truncate pr-2">Importar sesiones desde otro cliente</h2>
          <button onClick={onClose} aria-label="Cerrar" className="w-7 h-7 shrink-0 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 space-y-3">
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            <select className="field !w-auto flex-1 min-w-[140px]" value={format} onChange={(e) => setFormat(e.target.value)}>
              {FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <button
              onClick={pick}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 h-8 rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-50 shrink-0"
            >
              <FileUp size={14} /> Elegir archivo…
            </button>
            <button onClick={sshConfig} disabled={busy} className="px-3 h-8 rounded-md border border-line hover:bg-hover disabled:opacity-50 shrink-0">
              Leer ~/.ssh/config
            </button>
          </div>

          {!preview && (
            <div className="text-[11.5px] text-muted space-y-1.5">
              <p>
                Solo se importan datos de conexión: nombre, carpeta, protocolo, host, puerto, usuario, serial y jump host.
                Nunca contraseñas, comandos al conectar, argumentos extra, ProxyCommand, proxies ni túneles.
              </p>
              <p>
                PuTTY: en regedit exporta <code>HKEY_CURRENT_USER\Software\SimonTatham\PuTTY\Sessions</code>. SecureCRT: el
                XML de Tools › Export Settings. MobaXterm: un .mxtsessions exportado, la configuración .mobaconf o el
                MobaXterm.ini de la versión portable.
              </p>
              <p>
                CSV: columnas <code>name,folder,type,host,port,username</code> (encabezado opcional, también en español; separador
                coma o punto y coma). <code>type</code>: ssh, telnet, raw o serial. En serial, <code>host</code> es el puerto
                (COM3, /dev/ttyUSB0) y <code>port</code> la velocidad. Subcarpetas con <code>/</code>.
              </p>
            </div>
          )}

          {msg && <p className="text-[12px] text-accent">{msg}</p>}

          {preview && preview.sessions.length > 0 && (
            <>
              <div className="flex items-center gap-2 text-[12px]">
                <span className="text-muted shrink-0">Carpeta de destino</span>
                <input
                  className="field !h-7 flex-1"
                  list="import-folders"
                  value={dest}
                  placeholder="Raíz"
                  onChange={(e) => setDest(e.target.value)}
                />
                <datalist id="import-folders">
                  {folders.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </div>
              {changing > 0 && (
                <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] space-y-1.5">
                  <p className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle size={13} className="text-warn" />
                    {plural(changing, "sesión ya existe", "sesiones ya existen")} en esa carpeta con datos de conexión distintos
                  </p>
                  <label className="flex items-center gap-2">
                    <input type="radio" className="accent-[var(--accent)]" checked={overwrite} onChange={() => setOverwrite(true)} />
                    Sobrescribir con lo importado (host, puerto, usuario, tipo y serial)
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" className="accent-[var(--accent)]" checked={!overwrite} onChange={() => setOverwrite(false)} />
                    Conservar las existentes y omitirlas
                  </label>
                  {risky.length > 0 && (
                    <div className="text-[11.5px] space-y-0.5">
                      <p className="font-medium text-warn">
                        {plural(risky.length, "sesión cambia", "sesiones cambian")} de destino y tiene contraseña guardada, túneles o
                        comandos al conectar. Al sobrescribir se quitan para que no lleguen a otro equipo:
                      </p>
                      <ul className="font-mono text-[11px] text-muted">
                        {risky.slice(0, 5).map(({ p, s }) => (
                          <li key={s.name} className="truncate">
                            {s.name}: {p.existing ? sessionTarget(p.existing) : ""} → {sessionTarget(s)}
                          </li>
                        ))}
                        {risky.length > 5 && <li>… y {risky.length - 5} más</li>}
                      </ul>
                    </div>
                  )}
                  <p className="text-[11px] text-muted">
                    Se conservan el resaltado, SSH legacy y lo que el archivo no trae. Pasa el mouse sobre "Cambia" para ver qué
                    campos se actualizan.
                  </p>
                </div>
              )}
              <div className="rounded-lg border border-line overflow-hidden">
                <div className="flex items-center gap-2 px-3 h-8 bg-chrome border-b border-line text-[11.5px] text-muted">
                  <label className="p-1 -m-1 grid place-items-center">
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)]"
                      checked={all}
                      aria-label="Seleccionar todas"
                      onChange={() => setSelected(all ? new Set() : new Set(preview.sessions.map((_, i) => i)))}
                    />
                  </label>
                  <span className="flex-1 truncate">
                    {NAMES[preview.format] ?? preview.format} · {plural(preview.sessions.length, "sesión", "sesiones")} · {file}
                  </span>
                </div>
                <ul className="max-h-[300px] overflow-y-auto">
                  {preview.sessions.map((s, i) => (
                    <li key={i}>
                      <label className="flex items-center gap-2 px-3 h-8 text-[12px] hover:bg-hover">
                        <input type="checkbox" className="accent-[var(--accent)]" checked={selected.has(i)} onChange={() => toggle(i)} />
                        <SessionIcon type={s.type} size={13} />
                        <span className="w-[30%] truncate">{s.name}</span>
                        <span className="flex-1 truncate text-muted font-mono text-[11.5px]">
                          {sessionTarget(s)}
                          {s.jump_host ? ` vía ${s.jump_host}` : ""}
                        </span>
                        <span className="w-[24%] truncate text-muted text-[11.5px]">{s.folder ?? ""}</span>
                        <StatusBadge status={plan[i]?.status} changes={plan[i]?.changes ?? []} overwrite={overwrite} />
                        <span className="w-12 text-right text-[11px] text-muted uppercase">{typeLabel[s.type]}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {preview && preview.warnings.length > 0 && (
            <details className="rounded-lg border border-line text-[11.5px]">
              <summary className="flex items-center gap-1.5 px-3 h-8 cursor-default">
                <AlertTriangle size={13} className="text-warn" />
                {preview.warnings.length} {preview.warnings.length === 1 ? "aviso" : "avisos"}: lo que no se importa y por qué
              </summary>
              <ul className="px-3 pb-2 max-h-40 overflow-y-auto space-y-0.5 text-muted">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <footer className="shrink-0 flex flex-wrap justify-end gap-2 px-3 sm:px-5 py-3 border-t border-line">
          <button onClick={onClose} className="px-4 sm:px-3.5 h-10 sm:h-8 rounded-xl sm:rounded-md border border-line hover:bg-hover text-[13px] font-medium sm:font-normal touch-manipulation">
            {preview ? "Cancelar" : "Cerrar"}
          </button>
          {preview && preview.sessions.length > 0 && (
            <button
              onClick={doImport}
              disabled={busy || count === 0}
              className="px-4 sm:px-3.5 h-10 sm:h-8 rounded-xl sm:rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-50 text-[13px] touch-manipulation"
            >
              Importar {count}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

const FIELD_LABEL: Record<string, string> = {
  type: "tipo",
  host: "host",
  port: "puerto",
  username: "usuario",
  identity_file: "llave",
  legacy_ssh: "SSH legacy",
  jump_host: "jump host",
  serial_port: "puerto serial",
  baud_rate: "velocidad",
  data_bits: "bits de datos",
  stop_bits: "bits de parada",
  parity: "paridad",
  flow_control: "control de flujo",
};

/** Estado de cada fila: nueva, ya existe igual, o cambia (y si se sobrescribirá). */
function StatusBadge({ status, changes, overwrite }: { status?: string; changes: string[]; overwrite: boolean }) {
  if (status === "same") return <span className="w-16 text-right text-[11px] text-muted">Ya existe</span>;
  if (status === "update")
    return (
      <span
        className={`w-16 text-right text-[11px] ${overwrite ? "text-warn font-medium" : "text-muted line-through"}`}
        title={`Cambia: ${changes.map((c) => FIELD_LABEL[c] ?? c).join(", ")}`}
      >
        Cambia
      </span>
    );
  return <span className="w-16 text-right text-[11px] text-accent">Nueva</span>;
}
