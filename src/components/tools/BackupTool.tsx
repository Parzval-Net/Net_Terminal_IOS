import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ClipboardCopy, Download, FileText, FolderOpen, GitCompare, Play, RefreshCw, Square } from "lucide-react";
import type { TerminalRef } from "./FileManager";
import { Btn, Section, StatusPill, Toggle, fmtBytes } from "./ui";
import { DiffView } from "./DiffView";
import { runOnDevice } from "../../lib/deviceRun";
import { BACKUP_PROFILES, backupLabel, cleanConfig, configProblem, guessBackupProfile, pool, profileById } from "../../lib/backup";
import { diffLines, diffStats, markSecretChanges, splitLines, unifiedDiff, DiffRow, SecretMarks } from "../../lib/diff";
import { isWithin, normPath } from "../../lib/folders";
import { isMobile } from "../../lib/platform";
import { plural } from "../../lib/plural";
interface BackupFile {
  name: string;
  size: number;
  modified: number;
}
interface DeviceBackups {
  device: string;
  files: BackupFile[];
}

type JobState = { state: "pending" | "running" | "ok" | "error"; text?: string };

/** Máximo de equipos respaldándose a la vez: no satura AAA ni la CPU de los equipos. */
const CONCURRENCY = 3;

export default function BackupTool({ terminals }: { terminals: TerminalRef[] }) {
  // Una sesión puede estar abierta en varias pestañas: se respalda una vez.
  const devices = useMemo(() => {
    const seen = new Set<string>();
    return terminals.filter((t) => (seen.has(t.session.id) ? false : (seen.add(t.session.id), true)));
  }, [terminals]);
  const folders = useMemo(
    () => [...new Set(devices.map((d) => normPath(d.session.folder)).filter(Boolean))].sort(),
    [devices],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [mask, setMask] = useState(true);
  const [jobs, setJobs] = useState<Record<string, JobState>>({});
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  const [list, setList] = useState<DeviceBackups[]>([]);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(() => {
    invoke<DeviceBackups[]>("backup_list").then((l) => setList(l ?? [])).catch((e) => setMsg(String(e)));
  }, []);
  useEffect(refresh, [refresh]);

  const profileOf = (t: TerminalRef) => profiles[t.connId] ?? guessBackupProfile(t.session);
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const pickFolder = (folder: string) =>
    setSelected(new Set(devices.filter((d) => isWithin(normPath(d.session.folder), folder)).map((d) => d.connId)));

  const run = async () => {
    const targets = devices.filter((d) => selected.has(d.connId));
    if (!targets.length) return;
    stopRef.current = false;
    setRunning(true);
    setMsg("");
    setJobs(Object.fromEntries(targets.map((t) => [t.connId, { state: "pending" } as JobState])));
    const set = (id: string, j: JobState) => setJobs((s) => ({ ...s, [id]: j }));
    await pool(
      targets,
      CONCURRENCY,
      async (t) => {
        const cmd = profileById(profileOf(t)).cmd;
        set(t.connId, { state: "running" });
        try {
          const raw = await runOnDevice(t.connId, cmd, 300);
          const clean = cleanConfig(raw, cmd);
          const problem = configProblem(clean);
          if (problem) return set(t.connId, { state: "error", text: problem });
          const file = await invoke<string>("backup_save", { device: t.session.name, content: clean, mask });
          set(t.connId, { state: "ok", text: `${plural(splitLines(clean).length, "línea", "líneas")} · ${file}` });
        } catch (e) {
          set(t.connId, { state: "error", text: String(e instanceof Error ? e.message : e) });
        }
      },
      () => stopRef.current,
    );
    setRunning(false);
    if (stopRef.current) setMsg("Detenido: los equipos pendientes no se respaldaron.");
    refresh();
  };

  // ---------- Comparación ----------
  const [selA, setSelA] = useState<{ device: string; file: string } | null>(null);
  const [selB, setSelB] = useState<{ device: string; file: string } | null>(null);
  const [diff, setDiff] = useState<{ a: string[]; b: string[]; rows: DiffRow[]; nameA: string; nameB: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Por defecto: las dos versiones más recientes del primer equipo con dos o más.
  useEffect(() => {
    if (selA || selB) return;
    const d = list.find((x) => x.files.length >= 2);
    if (d) {
      setSelA({ device: d.device, file: d.files[1].name });
      setSelB({ device: d.device, file: d.files[0].name });
    }
  }, [list, selA, selB]);

  const compare = async () => {
    if (!selA || !selB) return;
    setBusy(true);
    try {
      const marks = (sel: { device: string; file: string }) => invoke<SecretMarks>("backup_secrets", sel).catch(() => null);
      const [ta, tb, ha, hb] = await Promise.all([invoke<string>("backup_read", selA), invoke<string>("backup_read", selB), marks(selA), marks(selB)]);
      const a = splitLines(ta);
      const b = splitLines(tb);
      // Se cede el hilo antes de calcular para que se vea el estado "Comparando".
      await new Promise((r) => setTimeout(r, 0));
      setDiff({
        a,
        b,
        // Las huellas usan una llave por equipo: solo se comparan entre respaldos del mismo equipo.
        rows: selA.device === selB.device ? markSecretChanges(diffLines(a, b), ha, hb) : diffLines(a, b),
        nameA: `${selA.device}/${selA.file}`,
        nameB: `${selB.device}/${selB.file}`,
      });
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  const unified = () => (diff ? unifiedDiff(diff.a, diff.b, diff.rows, diff.nameA, diff.nameB) : "");
  const exportDiff = async () => {
    if (!diff) return;
    const dest = await save({ defaultPath: "diff-configuracion.txt", filters: [{ name: "Texto", extensions: ["txt"] }] });
    if (!dest) return;
    await invoke("save_text", { dest, content: unified() })
      .then(() => setMsg(`Guardado: ${dest}`))
      .catch((e) => setMsg(String(e)));
  };
  const toNotes = async (device: string, file: string) => {
    try {
      const content = await invoke<string>("backup_read", { device, file });
      const name = `Respaldo ${device} ${file.replace(/\.txt$/, "")}`;
      await invoke("save_note", { name, content });
      setMsg(`Copiado a Notas como "${name}"`);
    } catch (e) {
      setMsg(String(e));
    }
  };

  const stats = diff ? diffStats(diff.rows) : null;
  const okCount = Object.values(jobs).filter((j) => j.state === "ok").length;
  const doneCount = Object.values(jobs).filter((j) => j.state === "ok" || j.state === "error").length;

  return (
    <div className="space-y-4">
      <Section
        title="Respaldar configuración"
        hint={`Ejecuta solo comandos de consulta, hasta ${CONCURRENCY} equipos a la vez`}
        right={
          !isMobile ? (
            <Btn kind="ghost" onClick={() => invoke("open_dir", { which: "backups" })} title="Abrir carpeta de respaldos">
              <FolderOpen size={14} /> Carpeta
            </Btn>
          ) : undefined
        }
      >
        {devices.length === 0 ? (
          <p className="text-[12.5px] text-muted">Conecta una o más sesiones remotas para respaldarlas.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Btn onClick={() => setSelected(new Set(devices.map((d) => d.connId)))} disabled={running}>
                Todas
              </Btn>
              <Btn onClick={() => setSelected(new Set())} disabled={running}>
                Ninguna
              </Btn>
              {folders.length > 0 && (
                <select
                  className="field !h-8 w-full sm:!w-56"
                  value=""
                  disabled={running}
                  onChange={(e) => e.target.value && pickFolder(e.target.value)}
                  aria-label="Seleccionar las sesiones de una carpeta"
                >
                  <option value="">Seleccionar carpeta…</option>
                  {folders.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              )}
              <span className="flex-1" />
              <Toggle checked={mask} onChange={setMask} label="Enmascarar secretos" />
            </div>
            <div className="rounded-lg border border-line divide-y divide-[var(--border)] overflow-x-auto">
              {devices.map((t) => {
                const j = jobs[t.connId];
                return (
                  <div key={t.connId} className="flex items-center gap-3 px-3 h-10 text-[12.5px] min-w-[540px]">
                    <label className="p-1 -m-1 grid place-items-center">
                      <input
                        type="checkbox"
                        className="accent-[var(--accent)]"
                        checked={selected.has(t.connId)}
                        disabled={running}
                        onChange={(e) => toggle(t.connId, e.target.checked)}
                        aria-label={`Respaldar ${t.name}`}
                      />
                    </label>
                    <span className="w-44 truncate font-medium" title={t.name}>
                      {t.session.name}
                    </span>
                    <span className="w-32 truncate text-muted">{t.host ?? ""}</span>
                    <select
                      className="field !h-7 !w-52 !text-[12px]"
                      value={profileOf(t)}
                      disabled={running}
                      onChange={(e) => setProfiles((p) => ({ ...p, [t.connId]: e.target.value }))}
                      title={profileById(profileOf(t)).cmd}
                    >
                      {BACKUP_PROFILES.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <code className="hidden xl:block w-60 truncate text-[11.5px] text-muted">{profileById(profileOf(t)).cmd}</code>
                    <span className="flex-1 min-w-0 flex items-center gap-2 justify-end">
                      {j && (
                        <>
                          <span className="truncate text-[11.5px] text-muted" title={j.text}>
                            {j.text}
                          </span>
                          <StatusPill
                            state={j.state === "ok" ? "up" : j.state === "error" ? "down" : j.state === "running" ? "running" : "unknown"}
                            label={{ pending: "En cola", running: "Respaldando", ok: "Guardado", error: "Error" }[j.state]}
                          />
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2 mt-3">
              {running ? (
                <Btn kind="danger" onClick={() => (stopRef.current = true)}>
                  <Square size={12} fill="currentColor" /> Detener ({doneCount}/{Object.keys(jobs).length})
                </Btn>
              ) : (
                <Btn kind="primary" onClick={run} disabled={!selected.size}>
                  <Play size={13} /> Respaldar {selected.size || ""}
                </Btn>
              )}
              <span className="text-[12px] text-muted">
                {msg ||
                  (doneCount && !running ? `${okCount} de ${Object.keys(jobs).length} guardados.` : "") ||
                  (mask ? "Contraseñas, llaves y comunidades SNMP se guardan como ****; la comparación entre fechas del mismo equipo marca \"secreto cambiado\" por una huella, sin guardar el secreto. Revisa antes de compartir." : "Se guardará la configuración con sus secretos.")}
              </span>
            </div>
          </>
        )}
      </Section>

      <Section
        title="Respaldos guardados"
        hint="Elige A y B para comparar: el mismo equipo en el tiempo o dos equipos distintos"
        right={
          <Btn kind="ghost" onClick={refresh} title="Actualizar lista">
            <RefreshCw size={14} />
          </Btn>
        }
      >
        {list.length === 0 ? (
          <p className="text-[12.5px] text-muted">Aún no hay respaldos.</p>
        ) : (
          <div className="rounded-lg border border-line divide-y divide-[var(--border)] max-h-72 overflow-auto">
            {list.map((d) =>
              d.files.map((f, i) => {
                const isA = selA?.device === d.device && selA.file === f.name;
                const isB = selB?.device === d.device && selB.file === f.name;
                return (
                  <div key={`${d.device}/${f.name}`} className="flex items-center gap-3 px-3 h-9 text-[12.5px] min-w-[460px]">
                    <span className={`w-44 truncate ${i === 0 ? "font-medium" : "text-muted"}`}>{i === 0 ? d.device : ""}</span>
                    <span className="w-40 tabular-nums">{backupLabel(f.name)}</span>
                    <span className="w-20 text-muted tabular-nums">{fmtBytes(f.size)}</span>
                    <span className="flex-1" />
                    <PickBtn on={isA} onClick={() => setSelA({ device: d.device, file: f.name })} label="A" />
                    <PickBtn on={isB} onClick={() => setSelB({ device: d.device, file: f.name })} label="B" />
                    <Btn kind="ghost" className="!h-7 !px-2" onClick={() => toNotes(d.device, f.name)} title="Copiar a Notas">
                      <FileText size={13} />
                    </Btn>
                  </div>
                );
              }),
            )}
          </div>
        )}
      </Section>

      <Section
        title="Comparar"
        hint={selA && selB ? `A: ${selA.device} ${backupLabel(selA.file)}  ·  B: ${selB.device} ${backupLabel(selB.file)}` : "Elige A y B en la lista"}
        right={
          <div className="flex items-center gap-1">
            {diff && (
              <>
                <Btn kind="ghost" onClick={() => writeText(unified()).then(() => setMsg("Diff copiado al portapapeles"))} title="Copiar diff">
                  <ClipboardCopy size={14} />
                </Btn>
                <Btn kind="ghost" onClick={exportDiff} title="Exportar diff como texto">
                  <Download size={14} /> Exportar
                </Btn>
              </>
            )}
            <Btn kind="primary" onClick={compare} disabled={!selA || !selB || busy} title="Comparar A y B">
              <GitCompare size={14} /> {busy ? "Comparando…" : "Comparar"}
            </Btn>
          </div>
        }
      >
        {diff && stats ? (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2 text-[12px]">
              <span className="text-ok font-medium">+{stats.added.toLocaleString("es-CL")} agregadas</span>
              <span className="text-danger font-medium">−{stats.removed.toLocaleString("es-CL")} quitadas</span>
              <span className="text-muted">{stats.same.toLocaleString("es-CL")} iguales</span>
              <span className="text-muted truncate w-full sm:w-auto">
                A: {diff.nameA} · B: {diff.nameB}
              </span>
            </div>
            <DiffView key={`${diff.nameA}|${diff.nameB}`} a={diff.a} b={diff.b} rows={diff.rows} />
          </>
        ) : (
          <p className="text-[12.5px] text-muted">El resultado aparece aquí. Las secciones sin cambios se pliegan.</p>
        )}
      </Section>
    </div>
  );
}

function PickBtn({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      title={`Usar como ${label}`}
      className={`w-8 h-8 rounded-md text-[12px] font-semibold border touch-manipulation ${
        on ? "bg-accent text-accent-fg border-transparent" : "border-line text-muted hover:text-fg hover:bg-hover"
      }`}
    >
      {label}
    </button>
  );
}
