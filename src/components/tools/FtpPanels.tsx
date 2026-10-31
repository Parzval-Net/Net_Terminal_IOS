import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Folder, FileText, Lock, RefreshCw, Square, TerminalSquare } from "lucide-react";
import type { Settings } from "../../lib/settings";
import { Btn, CopyText, Label, Section, StatusPill, Toggle, fmtBytes } from "./ui";
import type { ScpRequest, TerminalRef } from "./FileManager";
import { SCP_EXIT_EVENT, type ScpExit, scpOutcome } from "../../lib/scpVerify";

interface FtpInfo {
  user: string;
  pass: string;
  port: number;
  write: boolean;
}

/** Servidor FTP de la carpeta compartida: para equipos que solo copian por FTP. */
export function FtpServerSection({
  settings: s,
  running,
  onChange,
  refreshRunning,
  ip,
  file,
}: {
  settings: Settings;
  running: string[];
  onChange: (p: Partial<Settings>) => void;
  refreshRunning: () => void;
  ip: string;
  file: string;
}) {
  const on = running.includes("ftp");
  const [info, setInfo] = useState<FtpInfo | null>(null);
  // Subidas: solo por esta sesión de la app, nunca quedan habilitadas al reiniciar.
  const [write, setWrite] = useState(false);
  // Elección del usuario: sin servidor, el interruptor vuelve a esto y no a lo que dejó el gestor.
  const userWrite = useRef(false);
  const [error, setError] = useState("");

  const syncInfo = () => {
    invoke<FtpInfo | null>("ftp_server_info")
      .then((i) => {
        setInfo(i);
        setWrite(i ? i.write : userWrite.current);
      })
      .catch(() => {});
  };
  useEffect(() => {
    syncInfo();
    // El gestor de archivos puede habilitar subidas durante una extracción.
    window.addEventListener("nt-server-write", syncInfo);
    return () => window.removeEventListener("nt-server-write", syncInfo);
  }, [on]);

  // Con el servidor activo, el cambio se aplica en caliente: mismas credenciales, sin cortar transferencias.
  const changeWrite = async (v: boolean) => {
    setError("");
    userWrite.current = v;
    setWrite(v);
    if (!on) return;
    try {
      await invoke("server_set_write", { kind: "ftp", allow: v });
    } catch (e) {
      setError(String(e));
    }
    syncInfo();
  };

  const toggle = async () => {
    setError("");
    try {
      if (on) {
        await invoke("server_stop", { kind: "ftp" });
        setInfo(null);
      } else setInfo(await invoke<FtpInfo>("ftp_server_start", { port: s.ftpPort, allowWrite: write }));
    } catch (e) {
      setError(String(e));
    }
    refreshRunning();
  };

  const cred = info ? `${info.user}:${info.pass}` : "USUARIO:CLAVE";
  return (
    <Section
      title="Servidor FTP"
      hint="Usuario nt y contraseña nueva en cada inicio. Solo lectura salvo que habilites subidas."
      right={<StatusPill state={on ? "running" : "stopped"} label={on ? `Activo · TCP ${s.ftpPort}${info?.write ? " · con subidas" : ""}` : "Detenido"} />}
    >
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <Label text="Puerto" className="w-20 sm:w-24">
          <input className="field" type="number" disabled={on} value={s.ftpPort} onChange={(e) => onChange({ ftpPort: Number(e.target.value) || 21 })} />
        </Label>
        <div className="pb-1.5">
          <Toggle checked={write} onChange={changeWrite} label="Permitir subidas" />
        </div>
        <Btn kind={on ? "default" : "primary"} className="ml-auto" onClick={toggle}>
          {on ? "Detener" : "Iniciar"}
        </Btn>
      </div>
      <p className="flex items-start gap-1.5 text-[11.5px] text-warn mb-2">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" /> FTP no cifra: usuario, contraseña y archivos viajan en claro. Prefiere SCP/SFTP o HTTP si el equipo lo soporta.
      </p>
      {error && <p className="mb-2 text-[12px] text-danger">{error}</p>}
      {on && info && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-muted">Usuario</span> <CopyText text={info.user} />
          <span className="text-muted">Contraseña</span> <CopyText text={info.pass} />
        </div>
      )}
      <p className="text-[11.5px] text-muted mb-1">Desde el equipo:</p>
      <div className="flex flex-col items-start gap-1">
        <CopyText text={`copy ftp://${cred}@${ip}/${file} flash:`} />
        <CopyText text={`file copy ftp://${cred}@${ip}/${file} /var/tmp/`} />
        {info?.write && <CopyText text={`copy running-config ftp://${cred}@${ip}/respaldo.cfg`} />}
      </div>
      {s.ftpPort < 1024 && <p className="mt-2 text-[11.5px] text-muted">En Linux y macOS el puerto 21 puede requerir privilegios; si no inicia, usa 2121 (los equipos que no permiten indicar puerto necesitan el 21).</p>}
    </Section>
  );
}

interface Entry {
  name: string;
  size: number;
  dir: boolean;
  date: string;
}

/** Cliente FTP/FTPS: trae o deja archivos de la carpeta compartida en un servidor FTP. */
export function FtpClientSection({ files, onLocalChange }: { files: [string, number][]; onLocalChange: () => void }) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState(21);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [tls, setTls] = useState(true);
  const [path, setPath] = useState("");
  const [listing, setListing] = useState<{ cwd: string; entries: Entry[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [upload, setUpload] = useState("");
  const [jobs, setJobs] = useState<string[]>([]);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  useEffect(() => {
    const un = listen<{ job: string; kind: string; text: string }>("tool-job", ({ payload: e }) => {
      if (!jobsRef.current.includes(e.job)) return;
      if (e.kind === "error") setError(e.text);
      if (e.kind === "done") {
        onLocalChange();
        setJobs((j) => j.filter((x) => x !== e.job));
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, [onLocalChange]);

  const params = (p = path) => ({ host, port, user, pass, tls, path: p });

  const list = async (p = path) => {
    setError("");
    setBusy(true);
    try {
      const l = await invoke<{ cwd: string; entries: Entry[] }>("ftp_list", { params: params(p) });
      setListing(l);
      setPath(l.cwd || p);
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  const enter = (name: string) => list(name === ".." ? `${path.replace(/\/[^/]*\/?$/, "") || "/"}` : `${path.replace(/\/$/, "")}/${name}`);

  const start = async (cmd: "ftp_get" | "ftp_put", name: string) => {
    setError("");
    try {
      const job = await invoke<string>(cmd, { params: params(), name });
      jobsRef.current = [...jobsRef.current, job];
      setJobs(jobsRef.current);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Section title="Cliente FTP / FTPS" hint="Trae firmware o configuraciones de un servidor FTP a la carpeta compartida, o sube archivos desde ella.">
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:[grid-template-columns:2fr_0.7fr_1.2fr_1.2fr_1.6fr]">
        <Label text="Servidor">
          <input className="field font-mono" value={host} placeholder="ftp.ejemplo.cl" onChange={(e) => setHost(e.target.value)} />
        </Label>
        <Label text="Puerto">
          <input className="field" type="number" value={port} onChange={(e) => setPort(Number(e.target.value) || 21)} />
        </Label>
        <Label text="Usuario">
          <input className="field" value={user} autoComplete="off" onChange={(e) => setUser(e.target.value)} />
        </Label>
        <Label text="Contraseña (no se guarda)">
          <input className="field" type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} />
        </Label>
        <Label text="Carpeta remota" className="sm:col-span-2 lg:col-span-1">
          <input className="field font-mono" value={path} placeholder="/" onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && list()} />
        </Label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Toggle checked={tls} onChange={setTls} label="FTPS explícito (AUTH TLS, certificado verificado)" />
        {!tls && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-warn">
            <AlertTriangle size={13} /> Sin TLS la contraseña y los archivos viajan en claro
          </span>
        )}
        {tls && (
          <span className="inline-flex items-center gap-1 text-[12px] text-muted">
            <Lock size={12} /> Certificados del sistema, sin excepciones. Solo modo explícito (puerto 21 o el que indiques); FTPS implícito en el 990 no está soportado
          </span>
        )}
        {jobs.length > 0 && (
          <Btn kind="ghost" onClick={() => jobs.forEach((job) => invoke("tool_stop", { job }))}>
            <Square size={12} /> Cancelar ({jobs.length})
          </Btn>
        )}
        <Btn kind="primary" className="ml-auto" disabled={!host.trim() || busy} onClick={() => list()}>
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} /> Listar
        </Btn>
      </div>
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
      {listing && (
        <div className="mt-3 grid gap-3 grid-cols-1 md:[grid-template-columns:2fr_1fr]">
          <div className="max-h-[320px] overflow-auto rounded-lg border border-line">
            <table className="w-full text-[12px]">
              <tbody>
                {listing.cwd !== "/" && (
                  <tr className="border-t border-line first:border-0 hover:bg-hover cursor-default" onDoubleClick={() => enter("..")}>
                    <td className="px-2 py-1.5" colSpan={4}>
                      <Folder size={13} className="inline mr-1.5 text-muted" />
                      ..
                    </td>
                  </tr>
                )}
                {listing.entries.map((e) => (
                  <tr key={e.name} className="border-t border-line first:border-0 hover:bg-hover" onDoubleClick={() => e.dir && enter(e.name)}>
                    <td className="px-2 py-1.5 font-mono truncate max-w-[140px] sm:max-w-none">
                      {e.dir ? <Folder size={13} className="inline mr-1.5 text-muted" /> : <FileText size={13} className="inline mr-1.5 text-muted" />}
                      {e.name}
                    </td>
                    <td className="px-2 text-right text-muted tabular-nums whitespace-nowrap">{e.dir ? "" : fmtBytes(e.size)}</td>
                    <td className="px-2 text-muted whitespace-nowrap hidden sm:table-cell">{e.date}</td>
                    <td className="px-2 text-right">
                      {!e.dir && (
                        <Btn kind="ghost" className="!h-6 !px-1.5" title="Traer a la carpeta compartida" onClick={() => start("ftp_get", e.name)}>
                          <ArrowDownToLine size={13} />
                        </Btn>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {listing.entries.length === 0 && <p className="p-3 text-[12px] text-muted">Carpeta vacía.</p>}
          </div>
          <div>
            <Label text="Subir desde la carpeta compartida">
              <select className="field w-full" value={upload} onChange={(e) => setUpload(e.target.value)}>
                <option value="">Elegir archivo…</option>
                {files.map(([n, size]) => (
                  <option key={n} value={n}>
                    {n} · {fmtBytes(size)}
                  </option>
                ))}
              </select>
            </Label>
            <Btn className="mt-2 w-full sm:w-auto" disabled={!upload} onClick={() => start("ftp_put", upload)}>
              <ArrowUpFromLine size={13} /> Subir a {listing.cwd || "/"}
            </Btn>
            <p className="mt-2 text-[11.5px] text-muted">El progreso aparece en Transferencias. Doble clic en una carpeta para entrar.</p>
          </div>
        </div>
      )}
    </Section>
  );
}

/** SFTP interactivo con el OpenSSH del sistema, en la carpeta compartida. */
export function SftpSection({ terminals, onScp }: { terminals: TerminalRef[]; onScp: (req: ScpRequest) => void }) {
  const ssh = terminals.filter((t) => t.host);
  const [conn, setConn] = useState("");
  const term = ssh.find((t) => t.connId === conn) ?? ssh[0];
  // SFTP interactivo: no hay un fin de transferencia claro (el usuario escribe put/get). Al
  // cerrarse la pestaña se recuerda cómo verificar el MD5 en el gestor de archivos.
  const open = useRef(new Set<string>());
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const on = (ev: Event) => {
      const e = (ev as CustomEvent<ScpExit>).detail;
      if (!open.current.delete(e.transfer)) return;
      setNotice(scpOutcome({ upload: true, mode: "shell", files: [], verify: true, canVerify: true }, e).text);
    };
    window.addEventListener(SCP_EXIT_EVENT, on);
    return () => window.removeEventListener(SCP_EXIT_EVENT, on);
  }, []);
  const openSftp = () => {
    if (!term) return;
    const transferId = `sftp-${Date.now()}`;
    open.current.add(transferId);
    setNotice("");
    onScp({ upload: false, files: [], remoteDir: "", session: term.session, mode: "shell", transferId });
  };
  return (
    <Section
      title="SFTP interactivo"
      hint="Abre sftp en una pestaña con el usuario, puerto, llave y jump host de la sesión. get y put trabajan en la carpeta compartida."
    >
      <div className="flex flex-wrap sm:flex-nowrap items-end gap-3">
        <Label text="Equipo (sesión conectada)" className="flex-1 w-full sm:w-auto">
          <select className="field w-full" value={term?.connId ?? ""} onChange={(e) => setConn(e.target.value)}>
            {ssh.length === 0 && <option value="">Sin sesiones de red conectadas</option>}
            {ssh.map((t) => (
              <option key={t.connId} value={t.connId}>
                {t.name} · {t.host}
              </option>
            ))}
          </select>
        </Label>
        <Btn kind="primary" disabled={!term} onClick={openSftp} className="w-full sm:w-auto">
          <TerminalSquare size={14} /> Abrir SFTP
        </Btn>
      </div>
      <p className="mt-2 text-[11.5px] text-muted">
        La llave del equipo se verifica contra known_hosts como en SSH y la contraseña se escribe en la pestaña. Comandos: <code>ls</code>, <code>cd</code>, <code>get archivo</code>,{" "}
        <code>put archivo</code>, <code>bye</code>. Lo que subas aquí no se verifica solo: selecciónalo en el gestor de archivos y pulsa MD5.
      </p>
      {notice && (
        <p className="mt-1.5 text-[11.5px] text-warn" role="status">
          {notice}
        </p>
      )}
    </Section>
  );
}
