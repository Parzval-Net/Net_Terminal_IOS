import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  FilePlus,
  Folder,
  FileText,
  FolderOpen,
  HardDrive,
  Monitor,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { Settings } from "../../lib/settings";
import { RemoteFile, guessProfile, parseListing, parseMd5, profiles } from "../../lib/devicefs";
import type { Session } from "../../types";
import { Btn, Console, Label, fmtBytes } from "./ui";

import { plural } from "../../lib/plural";
import { isMobile } from "../../lib/platform";
import { SCP_EXIT_EVENT, type ScpExit, type ScpJob, busyRetry, isBusyError, scpOutcome } from "../../lib/scpVerify";
export interface TerminalRef {
  connId: string;
  /** Id de la pestaña (estable al reconectar, a diferencia de connId). */
  tabId?: string;
  name: string;
  host?: string;
  highlight?: string;
  session: Session;
  /** Últimas líneas de la pantalla de la pestaña (sin enviar nada al equipo). */
  screen?: (lines: number) => string;
  /** Escribe un aviso local en la pestaña (no llega al equipo). */
  notice?: (text: string) => void;
}

/** Una pestaña abierta con su estado (conectada o no), para la ruta de Topología. */
export interface TabBrief {
  tabId: string;
  name: string;
  host?: string;
  status: "connecting" | "connected" | "closed";
  session: Session;
}

export interface ScpRequest {
  upload: boolean;
  files: string[];
  remoteDir: string;
  session: Session;
  /** "scp" (clásico), "sftp" (scp sobre SFTP) o "shell" (sftp interactivo). */
  mode?: "scp" | "sftp" | "shell";
  /** Id de la transferencia: la pestaña lo usa como id de sesión y lo informa al terminar (SCP_EXIT_EVENT). */
  transferId?: string;
}

type Proto = "tftp" | "http" | "ftp" | "scp" | "sftp";
/** Marca en el comando que se reemplaza por usuario:contraseña del servidor FTP al ejecutar. */
const FTP_CRED = "{{ftp}}";

interface Op {
  id: string;
  kind: "send" | "pull" | "backup" | "verify";
  /** MD5 esperado (operación de verificación). */
  expect?: string;
  file: string;
  conn: string;
  command: string;
  status: "pending" | "running" | "ok" | "error";
  lines: string[];
  error?: string;
  bytes?: number;
  total?: number | null;
  /** SCP/SFTP en otra pestaña: no ocupa la cola y termina con SCP_EXIT_EVENT. */
  transfer?: string;
  scp?: ScpJob;
  /** Comando MD5 armado al enviar (perfil, sistema de archivos e IP de ese momento). */
  md5For?: (file: string) => string;
  /** Reintentos con el equipo ocupado por un script y cuándo se puede volver a intentar. */
  retries?: number;
  notBefore?: number;
}

interface Props {
  terminals: TerminalRef[];
  settings: Settings;
  refreshRunning: () => void;
  onConfirm: (req: { title: string; message: string; label: string; danger?: boolean; action: () => void }) => void;
  /** Abre una pestaña con scp (la contraseña se escribe ahí). */
  onScp: (req: ScpRequest) => void;
}

const DND_LOCAL = "application/x-nt-local";
const DND_REMOTE = "application/x-nt-remote";
const TIMEOUT = 3600; // firmware grandes por TFTP pueden tardar decenas de minutos

export function FileManager({ terminals, settings: s, refreshRunning, onConfirm, onScp }: Props) {
  const [connId, setConnId] = useState<string>("");
  const term = terminals.find((t) => t.connId === connId);
  const [profileId, setProfileId] = useState("cisco");
  const profile = profiles.find((p) => p.id === profileId)!;
  const [fs, setFs] = useState(profile.fs);
  const [extra, setExtra] = useState("");
  const [proto, setProto] = useState<Proto>("tftp");
  const ssh = proto === "scp" || proto === "sftp";
  const canPull = ssh || (proto === "ftp" ? !!profile.ftp?.download : !!profile.download);
  const canBackup = proto === "ftp" ? !!profile.ftp?.backup : !!profile.backup;
  useEffect(() => {
    if (proto === "ftp" && !profile.ftp) setProto("tftp");
  }, [proto, profile]);
  const [verify, setVerify] = useState(true);
  const [ips, setIps] = useState<{ name: string; ip: string }[]>([]);
  const [ip, setIp] = useState("");
  const [local, setLocal] = useState<[string, number][]>([]);
  const [remote, setRemote] = useState<{ files: RemoteFile[]; free: number | null; total: number | null } | null>(null);
  const [listing, setListing] = useState(false);
  const [selLocal, setSelLocal] = useState<Set<string>>(new Set());
  const [selRemote, setSelRemote] = useState<Set<string>>(new Set());
  const [ops, setOps] = useState<Op[]>([]);
  const [error, setError] = useState("");
  const [drop, setDrop] = useState<"local" | "remote" | null>(null);
  const [showLog, setShowLog] = useState<string | null>(null);
  const jobToOp = useRef(new Map<string, string>());
  const listJob = useRef<string | null>(null);

  // Primera sesión conectada por defecto; perfil según el fabricante de la sesión.
  useEffect(() => {
    if (!term && terminals[0]) setConnId(terminals[0].connId);
  }, [terminals, term]);
  useEffect(() => {
    if (!term) return;
    const p = guessProfile(term.session);
    setProfileId(p);
    setFs(profiles.find((x) => x.id === p)!.fs);
    setRemote(null);
    if (term.host)
      invoke<string | null>("source_ip", { host: term.host })
        .then((v) => v && setIp(v))
        .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, term?.session.platform]);

  const loadLocal = useCallback(() => invoke<[string, number][]>("tftp_files").then(setLocal), []);
  useEffect(() => {
    loadLocal();
    invoke<{ name: string; ip: string }[]>("local_ips").then((l) => {
      setIps(l);
      setIp((cur) => cur || l[0]?.ip || "");
    });
  }, [loadLocal]);

  // Eventos: salida de comandos en el equipo y progreso de transferencias.
  useEffect(() => {
    const subs = [
      listen<{ job: string; kind: string; text: string; data?: { ok: boolean; output: string } }>("tool-job", ({ payload: e }) => {
        if (e.job === listJob.current) {
          if (e.kind === "result" && e.data) setRemote(parseListing(e.data.output));
          if (e.kind === "error") setError(e.text);
          if (e.kind === "done") {
            listJob.current = null;
            setListing(false);
          }
          return;
        }
        const opId = jobToOp.current.get(e.job);
        if (!opId) return;
        // Firmware enviado sin errores: verifica su MD5 contra la copia del PC.
        if (e.kind === "result" && e.data?.ok) {
          const op = opsRef.current.find((o) => o.id === opId);
          if (op?.kind === "send" && op.status === "running") afterSendRef.current(op);
        }
        setOps((list) =>
          list.map((o) => {
            if (o.id !== opId) return o;
            if (e.kind === "line") return { ...o, lines: [...o.lines.slice(-300), e.text] };
            if (e.kind === "error") return { ...o, status: "error", error: e.text };
            if (e.kind === "result" && e.data && o.kind === "verify") {
              const got = parseMd5(e.data.output);
              const match = !!got && got === o.expect;
              return { ...o, status: match ? "ok" : "error", error: match ? undefined : got ? `MD5 no coincide (${got})` : "El equipo no devolvió un MD5" };
            }
            if (e.kind === "result" && e.data) {
              if (o.status === "error") return o;
              if (!e.data.ok) return { ...o, status: "error", error: "El equipo informó un error (ver salida)" };
              return { ...o, status: "ok", error: undefined };
            }
            return o;
          }),
        );
      }),
      listen<{ file: string; bytes: number; total: number | null; done: boolean }>("transfer", ({ payload: t }) => {
        setOps((list) =>
          list.map((o) => (o.status === "running" && (t.file === o.file || t.file.split(/[\\/]/).pop() === o.file) ? { ...o, bytes: t.bytes, total: t.total } : o)),
        );
        if (t.done) loadLocal();
      }),
    ];
    return () => subs.forEach((u) => u.then((f) => f()));
  }, [loadLocal]);

  const refreshRemote = useCallback(async () => {
    if (!connId) return;
    setError("");
    setListing(true);
    try {
      listJob.current = await invoke<string>("device_run", { conn: connId, command: profile.list(fs), timeoutSecs: 60 });
    } catch (e) {
      setError(String(e));
      setListing(false);
    }
  }, [connId, profile, fs]);

  // Servidores: se reutiliza el que ya esté activo. Si falta, se inicia; si hace falta escribir
  // (el equipo envía al PC), las subidas se habilitan en caliente, sin reiniciar: no cambia la
  // contraseña FTP que el usuario ya copió ni se cortan otras transferencias. Al terminar la
  // tanda se deja cada servidor como estaba (detenido o sin subidas). La escritura no queda
  // abierta: el servidor escucha en toda la red y TFTP no tiene autenticación.
  type Prev = { ran: boolean; write?: boolean };
  const restore = useRef<Partial<Record<"tftp" | "http" | "ftp", Prev>>>({});
  const remember = (k: "tftp" | "http" | "ftp", prev: Prev) => {
    if (!(k in restore.current)) restore.current[k] = prev;
  };
  const notifyWrite = () => window.dispatchEvent(new Event("nt-server-write"));

  const ensureServer = async (kind: "tftp" | "http", write: boolean) => {
    const on = (await invoke<string[]>("server_running")).includes(kind);
    if (kind === "http") {
      if (!on) {
        remember("http", { ran: false });
        await invoke("server_start", { kind: "http", port: s.httpPort });
      }
    } else if (!on) {
      remember("tftp", { ran: false });
      await invoke("server_start", { kind: "tftp", port: s.tftpPort, allowWrite: write });
    } else if (write) {
      const before = await invoke<boolean>("server_set_write", { kind: "tftp", allow: true });
      remember("tftp", { ran: true, write: before });
    }
    refreshRunning();
    notifyWrite();
  };

  // FTP: credenciales del servidor de la app (usuario nt y contraseña de este inicio).
  const ensureFtp = async (write: boolean) => {
    let info = await invoke<{ user: string; pass: string; write: boolean } | null>("ftp_server_info");
    if (!info) {
      remember("ftp", { ran: false });
      info = await invoke<{ user: string; pass: string; write: boolean }>("ftp_server_start", { port: s.ftpPort, allowWrite: write });
      refreshRunning();
    } else if (write && !info.write) {
      const before = await invoke<boolean>("server_set_write", { kind: "ftp", allow: true });
      remember("ftp", { ran: true, write: before });
      info = { ...info, write: true };
    }
    notifyWrite();
    return info;
  };

  useEffect(() => {
    const prev = restore.current;
    if (!Object.keys(prev).length || ops.some((o) => o.status === "running" || o.status === "pending")) return;
    restore.current = {};
    (async () => {
      for (const [kind, p] of Object.entries(prev) as [string, Prev][]) {
        if (!p.ran) await invoke("server_stop", { kind }).catch(() => {});
        else if (p.write === false) await invoke("server_set_write", { kind, allow: false }).catch(() => {});
      }
      refreshRunning();
      notifyWrite();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops]);

  // Cola: una operación a la vez sobre el equipo. SCP/SFTP corre en su pestaña y no la ocupa.
  const runningOp = ops.find((o) => o.status === "running" && !o.transfer);
  // Reintentos diferidos (equipo ocupado por un script): un tic vuelve a revisar la cola.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (runningOp) return;
    const now = Date.now();
    const next = ops.find((o) => o.status === "pending" && !(o.notBefore && o.notBefore > now));
    if (!next) {
      const wait = ops.filter((o) => o.status === "pending" && o.notBefore).map((o) => o.notBefore! - now);
      if (!wait.length) return;
      const t = window.setTimeout(() => setTick((x) => x + 1), Math.max(50, Math.min(...wait)));
      return () => window.clearTimeout(t);
    }
    setOps((l) => l.map((o) => (o.id === next.id ? { ...o, status: "running" } : o)));
    (async () => {
      try {
        // La verificación MD5 no transfiere nada: no necesita servidor.
        let command = next.command;
        if (command.includes(FTP_CRED)) {
          const info = await ensureFtp(next.kind !== "send");
          command = command.split(FTP_CRED).join(`${info.user}:${info.pass}`);
        } else if (next.kind !== "verify") await ensureServer(next.kind === "send" && proto === "http" ? "http" : "tftp", next.kind !== "send");
        const job = await invoke<string>("device_run", { conn: next.conn, command, timeoutSecs: TIMEOUT });
        jobToOp.current.set(job, next.id);
      } catch (e) {
        // Verificación con la sesión tomada por un script: se espera sin interferir y se reintenta.
        const wait = next.kind === "verify" && isBusyError(e) ? busyRetry(next.retries ?? 0) : null;
        setOps((l) =>
          l.map((o) =>
            o.id !== next.id
              ? o
              : wait !== null
                ? { ...o, status: "pending", retries: (o.retries ?? 0) + 1, notBefore: Date.now() + wait, error: "Equipo ocupado por un script: se reintenta en 5 s" }
                : { ...o, status: "error", error: isBusyError(e) && next.kind === "verify" ? "El equipo siguió ocupado por un script: pulsa MD5 cuando termine" : String(e) },
          ),
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops, runningOp, tick]);

  // Al terminar todas las operaciones, refresca ambos paneles.
  const pending = ops.some((o) => o.status === "pending" || o.status === "running");
  const prevPending = useRef(false);
  useEffect(() => {
    if (prevPending.current && !pending) {
      loadLocal();
      refreshRemote();
    }
    prevPending.current = pending;
  }, [pending, loadLocal, refreshRemote]);

  /** Encola verificaciones MD5: calcula el hash local y compara con el del equipo. */
  const queueVerify = async (files: string[], conn: string, md5For?: (file: string) => string) => {
    const md5 = profile.md5;
    const build = md5For ?? (md5 ? (file: string) => md5({ ip, port: s.httpPort, file, fs, extra }) : null);
    if (!build) return;
    for (const file of files) {
      const expect = await invoke<string>("tftp_md5", { name: file }).catch(() => null);
      if (!expect) continue;
      setOps((o) => [
        ...o,
        {
          id: `${Date.now()}-v-${file}`,
          kind: "verify",
          file,
          conn,
          expect,
          command: build(file),
          status: "pending",
          lines: [],
        },
      ]);
    }
  };

  const opsRef = useRef(ops);
  opsRef.current = ops;
  const afterSendRef = useRef((_op: Op) => {});
  afterSendRef.current = (op: Op) => {
    if (verify && profile.md5) queueVerify([op.file], op.conn);
  };

  // Fin de una pestaña SCP/SFTP abierta por el gestor: con código 0 en una subida se verifica
  // el MD5 en la sesión del equipo (la misma cola que TFTP/HTTP/FTP); si falló, se avisa.
  const onScpExitRef = useRef((_e: ScpExit) => {});
  onScpExitRef.current = (e: ScpExit) => {
    const op = opsRef.current.find((o) => o.transfer === e.transfer && o.status === "running");
    if (!op?.scp) return;
    const next = scpOutcome(op.scp, e);
    setOps((l) =>
      l.map((o) =>
        o.id !== op.id ? o : { ...o, status: next.action === "failed" ? "error" : "ok", error: next.action === "failed" ? next.text : undefined, lines: [...o.lines, next.text] },
      ),
    );
    if (next.action === "verify") queueVerify(next.files, op.conn, op.md5For);
  };
  useEffect(() => {
    const on = (ev: Event) => onScpExitRef.current((ev as CustomEvent<ScpExit>).detail);
    window.addEventListener(SCP_EXIT_EVENT, on);
    return () => window.removeEventListener(SCP_EXIT_EVENT, on);
  }, []);

  const enqueue = (kind: Op["kind"], files: string[]) => {
    if (!term) return setError("Conecta una sesión con el equipo primero");
    if (ssh && (kind === "send" || kind === "pull")) {
      if (!term.host) return setError(`${proto.toUpperCase()} requiere una sesión de red con host (no serial)`);
      const mode: "scp" | "sftp" = proto === "sftp" ? "sftp" : "scp";
      const md5 = profile.md5;
      const md5Vars = { ip, port: s.httpPort, fs, extra };
      const go = () => {
        const transfer = `scp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        onScp({ upload: kind === "send", files, remoteDir: fs, session: term.session, mode, transferId: transfer });
        // Seguimiento en la lista: termina cuando la pestaña avisa el fin del proceso.
        setOps((o) =>
          [
            {
              id: transfer,
              kind: kind === "send" ? ("send" as const) : ("pull" as const),
              file: files.join(", "),
              conn: term.connId,
              command: `${mode.toUpperCase()} en otra pestaña`,
              status: "running" as const,
              lines: [],
              transfer,
              scp: { upload: kind === "send", mode, files, verify, canVerify: !!md5 },
              md5For: md5 ? (file: string) => md5({ ...md5Vars, file }) : undefined,
            },
            ...o.filter((x) => x.status !== "ok"),
          ].slice(0, 30),
        );
      };
      const overwrite = kind === "send" ? files.filter((f) => remote?.files.some((r) => r.name === f)) : [];
      if (overwrite.length)
        onConfirm({ title: "¿Sobrescribir en el equipo?", message: overwrite.join(", "), label: "Sobrescribir", danger: true, action: go });
      else go();
      setSelLocal(new Set());
      setSelRemote(new Set());
      return;
    }
    if (!ip) return setError("Selecciona la IP de este PC que el equipo puede alcanzar");
    const vars = (file: string) => ({ ip, port: s.httpPort, file, fs, extra });
    const items: Op[] = files.map((file) => ({
      id: `${Date.now()}-${file}`,
      kind,
      file,
      conn: term.connId,
      command:
        proto === "ftp" && profile.ftp
          ? kind === "send"
            ? profile.ftp.upload(vars(file), FTP_CRED)
            : kind === "pull"
              ? profile.ftp.download!(vars(file), FTP_CRED)
              : profile.ftp.backup!(vars(file), FTP_CRED)
          : kind === "send"
            ? profile.upload(vars(file), proto === "http" ? "http" : "tftp")
            : kind === "pull"
              ? profile.download!(vars(file))
              : profile.backup!(vars(file)),
      status: "pending",
      lines: [],
    }));
    const overwrite = kind === "send" ? files.filter((f) => remote?.files.some((r) => r.name === f)) : files.filter((f) => local.some(([n]) => n === f));
    const go = () => setOps((o) => [...items, ...o.filter((x) => x.status !== "ok")].slice(0, 30));
    // Espacio libre en el equipo (si el listado lo informó).
    const needed = kind === "send" ? files.reduce((n, f) => n + (local.find(([l]) => l === f)?.[1] ?? 0), 0) : 0;
    if (kind === "send" && remote?.free != null && needed > remote.free)
      return onConfirm({
        title: "No hay espacio suficiente en el equipo",
        message: `Necesitas ${fmtBytes(needed)} y quedan ${fmtBytes(remote.free)} libres en ${fs}. Libera espacio antes de enviar.`,
        label: "Enviar igual",
        danger: true,
        action: go,
      });
    if (overwrite.length)
      onConfirm({
        title: "¿Sobrescribir archivos?",
        message: `Ya existe${overwrite.length > 1 ? "n" : ""} en el destino: ${overwrite.join(", ")}`,
        label: "Sobrescribir",
        danger: true,
        action: go,
      });
    else go();
    setSelLocal(new Set());
    setSelRemote(new Set());
  };

  const addFiles = async () => {
    const paths = await open({ multiple: true, directory: false, title: "Archivos para enviar a equipos" });
    const list = typeof paths === "string" ? [paths] : (paths ?? []);
    for (const path of list) await invoke("tftp_add", { path }).catch((e) => setError(String(e)));
    loadLocal();
  };

  const backupName = useMemo(
    () => `${(term?.name ?? "equipo").replace(/[^\w.-]+/g, "_")}_${new Date().toISOString().slice(0, 10)}.cfg`,
    [term],
  );

  const remoteFiles = remote?.files.filter((f) => !f.dir) ?? [];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 @[48rem]:[grid-template-columns:2fr_1.6fr_1fr_1.3fr_0.9fr]">
        <Label text="Equipo (sesión conectada)">
          <select className="field w-full" value={connId} onChange={(e) => setConnId(e.target.value)}>
            {terminals.length === 0 && <option value="">Sin sesiones conectadas</option>}
            {terminals.map((t) => (
              <option key={t.connId} value={t.connId}>
                {t.name}
                {t.host ? ` · ${t.host}` : ""}
              </option>
            ))}
          </select>
        </Label>
        <Label text="Tipo de equipo">
          <select
            className="field w-full"
            value={profileId}
            onChange={(e) => {
              setProfileId(e.target.value);
              setFs(profiles.find((p) => p.id === e.target.value)!.fs);
              setRemote(null);
            }}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Label>
        <Label text="Almacenamiento">
          <input className="field font-mono !text-[12px] w-full" value={fs} onChange={(e) => setFs(e.target.value.trim())} />
        </Label>
        <Label text="IP de este PC">
          <select className="field w-full" value={ip} onChange={(e) => setIp(e.target.value)}>
            {ip && !ips.some((i) => i.ip === ip) && <option value={ip}>{ip} (ruta al equipo)</option>}
            {ips.map((i) => (
              <option key={i.ip} value={i.ip}>
                {i.ip} · {i.name}
              </option>
            ))}
          </select>
        </Label>
        <Label text="Protocolo">
          <select className="field w-full" value={proto} onChange={(e) => setProto(e.target.value as Proto)}>
            <option value="tftp">TFTP</option>
            <option value="http" disabled={profileId === "huawei"}>
              HTTP (solo envío, rápido)
            </option>
            <option value="ftp" disabled={!profile.ftp}>
              FTP (sin cifrar)
            </option>
            <option value="scp">SCP (cifrado)</option>
            <option value="sftp">SFTP (cifrado)</option>
          </select>
        </Label>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-[11.5px] text-muted">
        {profile.md5 && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-[var(--accent)]" checked={verify} onChange={(e) => setVerify(e.target.checked)} />
            Verificar MD5 después de enviar
          </label>
        )}
        {profile.md5 && ssh && verify && (
          <span>
            Con {proto.toUpperCase()} se verifica cuando la pestaña de la copia termina sin error (código 0); si falla o la cierras antes, no
            se verifica.
          </span>
        )}
        {proto === "sftp" && (
          <span>
            SFTP abre una pestaña donde escribes la contraseña. Requiere servidor SFTP en el equipo (NX-OS: <code>feature sftp-server</code>; Junos y Linux lo traen con SSH).
          </span>
        )}
        {proto === "ftp" && (
          <span className="text-warn">
            FTP no cifra: el usuario nt y la contraseña de este inicio del servidor de la app viajan en claro y quedan en el historial del equipo. Úsalo solo en redes de gestión.
          </span>
        )}
        {proto === "scp" && (
          <span>
            SCP abre una pestaña donde escribes la contraseña. Requiere servidor SCP en el equipo (Cisco: <code>ip scp server enable</code>).
          </span>
        )}
      </div>
      {(profile.note || profileId === "nxos") && (
        <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-muted">
          {profile.note && <span>{profile.note}</span>}
          {profileId === "nxos" && (
            <input className="field !h-6 !w-40 !text-[11.5px]" placeholder="VRF (management)" value={extra} onChange={(e) => setExtra(e.target.value)} />
          )}
        </div>
      )}
      {error && <p className="text-[12px] text-danger">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
        {/* Panel PC */}
        <Pane
          icon={<Monitor size={14} />}
          title={isMobile ? "Este dispositivo · carpeta compartida" : "Este PC · carpeta compartida"}
          highlight={drop === "local"}
          actions={
            <>
              <Btn kind="ghost" className="!px-1.5 !h-7" title="Agregar archivos" onClick={addFiles}>
                <FilePlus size={14} />
              </Btn>
              {!isMobile && (
                <Btn kind="ghost" className="!px-1.5 !h-7" title="Abrir carpeta" onClick={() => invoke("open_dir", { which: "tftp" })}>
                  <FolderOpen size={14} />
                </Btn>
              )}
              <Btn kind="ghost" className="!px-1.5 !h-7" title="Actualizar" onClick={loadLocal}>
                <RefreshCw size={13} />
              </Btn>
            </>
          }
          dropProps={{
            onDragOver: (e) => {
              if (!e.dataTransfer.types.includes(DND_REMOTE)) return;
              e.preventDefault();
              setDrop("local");
            },
            onDragLeave: () => setDrop(null),
            onDrop: (e) => {
              setDrop(null);
              const names = e.dataTransfer.getData(DND_REMOTE).split("\n").filter(Boolean);
              if (names.length && canPull) enqueue("pull", names);
            },
          }}
          footer={plural(local.length, "archivo", "archivos")}
        >
          {local.length === 0 && <Empty text="Agrega firmware o configuraciones con el botón +" />}
          {local.map(([name, size]) => (
            <Row
              key={name}
              name={name}
              detail={fmtBytes(size)}
              selected={selLocal.has(name)}
              onToggle={() => setSelLocal(toggle(selLocal, name))}
              onDragStart={(e) => {
                const names = selLocal.has(name) ? [...selLocal] : [name];
                e.dataTransfer.setData(DND_LOCAL, names.join("\n"));
              }}
              onDelete={() =>
                onConfirm({
                  title: `¿Eliminar ${name} de la carpeta compartida?`,
                  message: "Solo se borra la copia en este PC.",
                  label: "Eliminar",
                  danger: true,
                  action: () => invoke("tftp_delete", { name }).then(loadLocal),
                })
              }
            />
          ))}
        </Pane>

        {/* Acciones */}
        <div className="flex flex-row flex-wrap sm:flex-col justify-center items-center sm:items-stretch gap-2 py-1 sm:py-0">
          <Btn kind="primary" disabled={!selLocal.size || !term} onClick={() => enqueue("send", [...selLocal])} title="El equipo descarga los archivos seleccionados" className="flex-1 sm:flex-initial">
            <span>Enviar</span>
            <ArrowRight size={14} className="hidden sm:inline" />
            <ArrowDown size={14} className="sm:hidden" />
          </Btn>
          <Btn
            disabled={!selRemote.size || !term || !canPull}
            onClick={() => enqueue("pull", [...selRemote])}
            title={canPull ? "Trae los archivos seleccionados a este PC" : `No soportado por ${proto.toUpperCase()} en este equipo: usa SCP o SFTP`}
            className="flex-1 sm:flex-initial"
          >
            <ArrowLeft size={14} className="hidden sm:inline" />
            <ArrowUp size={14} className="sm:hidden" />
            <span>Traer</span>
          </Btn>
          <Btn
            kind="ghost"
            disabled={!term || !profile.md5 || ![...selRemote].some((f) => local.some(([n]) => n === f))}
            onClick={() => queueVerify([...selRemote].filter((f) => local.some(([n]) => n === f)), term!.connId)}
            title="Compara el MD5 del archivo en el equipo con la copia de este PC"
          >
            MD5
          </Btn>
          <Btn
            kind="ghost"
            disabled={!term || !canBackup}
            onClick={() => enqueue("backup", [backupName])}
            title="copy running-config a la carpeta compartida de este PC, sin enmascarar secretos. Para un historial con secretos enmascarados y comparación entre fechas usa Herramientas › Respaldos."
          >
            <Save size={14} /> Respaldar config
          </Btn>
        </div>

        {/* Panel equipo */}
        <Pane
          icon={<HardDrive size={14} />}
          title={term ? `${term.name} · ${fs}` : "Equipo"}
          highlight={drop === "remote"}
          actions={
            <Btn kind="ghost" className="!h-7" disabled={!term || listing} onClick={refreshRemote}>
              <RefreshCw size={13} className={listing ? "animate-spin" : ""} /> {remote ? "Actualizar" : "Leer archivos"}
            </Btn>
          }
          dropProps={{
            onDragOver: (e) => {
              if (!e.dataTransfer.types.includes(DND_LOCAL)) return;
              e.preventDefault();
              setDrop("remote");
            },
            onDragLeave: () => setDrop(null),
            onDrop: (e) => {
              setDrop(null);
              const names = e.dataTransfer.getData(DND_LOCAL).split("\n").filter(Boolean);
              if (names.length) enqueue("send", names);
            },
          }}
          footer={
            remote?.free != null
              ? `${plural(remoteFiles.length, "archivo", "archivos")} · libre ${fmtBytes(remote.free)}${remote.total ? ` de ${fmtBytes(remote.total)}` : ""}`
              : remote
                ? plural(remoteFiles.length, "archivo", "archivos")
                : ""
          }
        >
          {!term && <Empty text="Conecta una sesión SSH, Telnet o Serial con el equipo" />}
          {term && !remote && !listing && <Empty text={`Pulsa "Leer archivos" para listar ${fs}`} />}
          {remote?.files.map((f) => (
            <Row
              key={f.name}
              name={f.name}
              dir={f.dir}
              detail={f.dir ? "carpeta" : fmtBytes(f.size)}
              sub={f.date}
              selected={selRemote.has(f.name)}
              onToggle={() => !f.dir && setSelRemote(toggle(selRemote, f.name))}
              onDragStart={(e) => {
                const names = selRemote.has(f.name) ? [...selRemote] : [f.name];
                e.dataTransfer.setData(DND_REMOTE, names.join("\n"));
              }}
            />
          ))}
          {remote && remote.files.length === 0 && <Empty text="No se reconocieron archivos en la salida del equipo" />}
        </Pane>
      </div>

      {ops.length > 0 && (
        <div className="rounded-xl border border-line bg-panel p-3 space-y-2">
          <div className="flex justify-between items-center">
            <h4 className="text-[12.5px] font-semibold">Operaciones</h4>
            <Btn kind="ghost" className="!h-6" disabled={pending} onClick={() => setOps([])}>
              Limpiar
            </Btn>
          </div>
          {ops.map((o) => {
            const pct = o.total ? Math.min(100, ((o.bytes ?? 0) / o.total) * 100) : o.status === "ok" ? 100 : null;
            return (
              <div key={o.id}>
                <div className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="truncate">
                    <span className="text-muted">
                      {o.kind === "send" ? "→ Enviar" : o.kind === "pull" ? "← Traer" : o.kind === "verify" ? "✓ MD5" : "← Respaldo"}
                    </span>{" "}
                    <span className="font-mono">{o.file}</span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span
                      className={
                        o.status === "ok" ? "text-ok" : o.status === "error" ? "text-danger" : o.status === "running" ? "text-accent" : "text-muted"
                      }
                    >
                      {o.status === "ok"
                        ? "● Completado"
                        : o.status === "error"
                          ? `✕ ${o.error ?? "Error"}`
                          : o.status === "running"
                            ? o.transfer
                              ? "En curso en su pestaña"
                              : `En curso${o.bytes ? ` · ${fmtBytes(o.bytes)}` : ""}`
                            : (o.error ?? "En cola")}
                    </span>
                    <button className="text-muted hover:text-fg" title="Ver salida del equipo" onClick={() => setShowLog(showLog === o.id ? null : o.id)}>
                      <ChevronDown size={14} className={showLog === o.id ? "rotate-180" : ""} />
                    </button>
                  </span>
                </div>
                <div className="h-1 mt-1 rounded-full bg-hover overflow-hidden">
                  <div
                    className={`h-full ${o.status === "error" ? "bg-danger" : "bg-accent"} ${o.status === "running" && pct == null ? "animate-pulse w-1/3" : ""}`}
                    style={pct != null ? { width: `${pct}%` } : undefined}
                  />
                </div>
                {o.kind === "backup" && o.status === "ok" && (
                  <p className="mt-1 text-[11.5px] text-warn">
                    Guardado en la carpeta compartida (panel izquierdo) tal como lo envió el equipo, con contraseñas y communities sin
                    enmascarar. No aparece en Respaldos: para historial enmascarado y comparable usa Herramientas › Respaldos.
                  </p>
                )}
                {showLog === o.id && (
                  <div className="mt-2">
                    <p className="text-[11px] text-muted mb-1 font-mono">{o.command}</p>
                    <Console lines={o.lines} height={140} empty="Sin salida todavía" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function toggle(set: Set<string>, v: string) {
  const n = new Set(set);
  if (n.has(v)) n.delete(v);
  else n.add(v);
  return n;
}

function Pane({
  icon,
  title,
  actions,
  footer,
  highlight,
  dropProps,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  actions: React.ReactNode;
  footer: string;
  highlight: boolean;
  dropProps: React.HTMLAttributes<HTMLDivElement>;
  children: React.ReactNode;
}) {
  return (
    <div
      {...dropProps}
      className={`min-w-0 flex flex-col rounded-xl border bg-panel ${highlight ? "border-accent ring-2 ring-[var(--selected)]" : "border-line"}`}
    >
      <div className="flex items-center gap-2 px-3 h-10 border-b border-line">
        <span className="text-muted">{icon}</span>
        <span className="text-[12.5px] font-semibold truncate flex-1">{title}</span>
        {actions}
      </div>
      <div className="h-[260px] sm:h-[300px] overflow-y-auto p-1">{children}</div>
      <div className="px-3 h-7 flex items-center border-t border-line text-[11px] text-muted">{footer}</div>
    </div>
  );
}

function Row({
  name,
  detail,
  sub,
  dir,
  selected,
  onToggle,
  onDragStart,
  onDelete,
}: {
  name: string;
  detail: string;
  sub?: string;
  dir?: boolean;
  selected: boolean;
  onToggle: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDelete?: () => void;
}) {
  return (
    <div
      draggable={!dir}
      onDragStart={onDragStart}
      onClick={onToggle}
      title={sub}
      className={`group flex items-center gap-2 px-2 h-8 rounded-md text-[12.5px] ${selected ? "bg-selected" : "hover:bg-hover"}`}
    >
      {dir ? <Folder size={14} className="text-muted shrink-0" /> : <FileText size={14} className="text-muted shrink-0" />}
      <span className="truncate flex-1 font-mono text-[12px]">{name}</span>
      <span className="text-[11px] text-muted tabular-nums shrink-0">{detail}</span>
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className={`${selected ? "block" : "hidden sm:group-hover:block"} p-1 text-muted hover:text-danger shrink-0`}
          title="Eliminar de la carpeta compartida"
          aria-label={`Eliminar ${name}`}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="p-4 text-center text-[12px] text-muted">{text}</p>;
}
