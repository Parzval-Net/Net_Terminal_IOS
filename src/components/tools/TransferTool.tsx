import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { FilePlus, FolderOpen, RefreshCw } from "lucide-react";
import { Settings } from "../../lib/settings";
import { Btn, CopyText, IpSelect, Label, Section, StatusPill, Toggle, fmtBytes } from "./ui";
import { useLocalIp } from "./useLocalIp";
import { FileManager, ScpRequest, TerminalRef } from "./FileManager";
import { FtpClientSection, FtpServerSection, SftpSection } from "./FtpPanels";
import { isMobile } from "../../lib/platform";

interface Transfer {
  id: string;
  proto: string;
  client: string;
  file: string;
  dir: "get" | "put";
  bytes: number;
  total: number | null;
  done: boolean;
  error: string | null;
  ts: number;
}

export function TransferTool({
  settings: s,
  running,
  onChange,
  refreshRunning,
  terminals,
  onConfirm,
  onScp,
}: {
  settings: Settings;
  running: string[];
  onChange: (p: Partial<Settings>) => void;
  refreshRunning: () => void;
  terminals: TerminalRef[];
  onConfirm: (req: { title: string; message: string; label: string; danger?: boolean; action: () => void }) => void;
  onScp: (req: ScpRequest) => void;
}) {
  const { ips, ip: localIp, setIp } = useLocalIp();
  const [files, setFiles] = useState<[string, number][]>([]);
  const [selFile, setSelFile] = useState("");
  // Subidas TFTP: solo por esta sesión de la app, igual que en FTP (nunca quedan habilitadas
  // al reiniciar). Con el servidor activo se aplican en caliente, sin reiniciarlo.
  const [tftpWrite, setTftpWrite] = useState(false);
  // Lo que eligió el usuario: con el servidor detenido el interruptor vuelve a esto, no a lo que
  // dejó el gestor de archivos durante una extracción.
  const userWrite = useRef(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [error, setError] = useState("");

  const loadFiles = useCallback(() => invoke<[string, number][]>("tftp_files").then(setFiles), []);

  // Estado real del servidor (el gestor de archivos puede habilitar subidas durante una extracción).
  const syncWrite = useCallback(() => {
    invoke<boolean | null>("server_write", { kind: "tftp" })
      .then((w) => setTftpWrite(w ?? userWrite.current))
      .catch(() => {});
  }, []);
  useEffect(() => {
    syncWrite();
    window.addEventListener("nt-server-write", syncWrite);
    return () => window.removeEventListener("nt-server-write", syncWrite);
  }, [syncWrite, running]);

  const setWrite = async (v: boolean) => {
    setError("");
    userWrite.current = v;
    setTftpWrite(v);
    if (!running.includes("tftp")) return;
    try {
      await invoke("server_set_write", { kind: "tftp", allow: v });
    } catch (e) {
      setError(String(e));
      syncWrite();
    }
  };

  useEffect(() => {
    loadFiles();
    const un = listen<Omit<Transfer, "ts">>("transfer", ({ payload }) => {
      setTransfers((list) => {
        const i = list.findIndex((t) => t.id === payload.id);
        const item = { ...payload, ts: Date.now() };
        const next = i >= 0 ? list.map((t, k) => (k === i ? item : t)) : [item, ...list].slice(0, 50);
        return next;
      });
      if (payload.done && payload.dir === "put") loadFiles();
    });
    return () => {
      un.then((f) => f());
    };
  }, [loadFiles]);

  const toggle = async (kind: "tftp" | "http") => {
    setError("");
    try {
      if (running.includes(kind)) await invoke("server_stop", { kind });
      else
        await invoke("server_start", {
          kind,
          port: kind === "tftp" ? s.tftpPort : s.httpPort,
          allowWrite: tftpWrite,
        });
    } catch (e) {
      setError(String(e));
    }
    refreshRunning();
  };

  const addFile = async () => {
    const path = await open({ multiple: false, directory: false, title: "Archivo para servir por TFTP/HTTP" });
    if (typeof path !== "string") return;
    try {
      await invoke("tftp_add", { path });
      loadFiles();
    } catch (e) {
      setError(String(e));
    }
  };

  const ip = localIp || "IP_DE_ESTE_PC";
  // Los comandos usan el archivo elegido en "Archivos compartidos" (o el primero).
  const file = files.some(([n]) => n === selFile) ? selFile : (files[0]?.[0] ?? "firmware.bin");
  const tftpOn = running.includes("tftp");
  const httpOn = running.includes("http");

  return (
    <div className="space-y-4">
      <Section
        title="Gestor de archivos"
        hint="Selecciona o arrastra archivos entre este PC y el equipo. La app escribe el comando copy en la sesión, responde las confirmaciones y muestra el progreso."
      >
        <FileManager
          terminals={terminals}
          settings={s}
          refreshRunning={refreshRunning}
          onConfirm={onConfirm}
          onScp={onScp}
        />
      </Section>

      <div className="flex flex-wrap items-end gap-4">
        <IpSelect ips={ips} ip={localIp} onChange={setIp} className="w-full sm:w-72" />
        <p className="flex-1 min-w-[200px] text-[12px] text-muted">
          Servidores: el gestor de archivos usa el que ya esté activo; si no hay uno, lo inicia para la operación y lo detiene al
          terminar. Las subidas que necesita una extracción se habilitan en caliente, sin reiniciar ni cambiar la contraseña FTP,
          y se vuelven a quitar al final. Escuchan en la red solo mientras están activos; si el firewall del sistema pregunta,
          permite el acceso solo en redes privadas.
        </p>
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr))]">
        <Section title="Servidor TFTP" right={<StatusPill state={tftpOn ? "running" : "stopped"} label={tftpOn ? `Activo · UDP ${s.tftpPort}` : "Detenido"} />}>
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <Label text="Puerto" className="w-20 sm:w-24">
              <input className="field" type="number" disabled={tftpOn} value={s.tftpPort} onChange={(e) => onChange({ tftpPort: Number(e.target.value) || 69 })} />
            </Label>
            <div className="pb-1.5">
              <Toggle checked={tftpWrite} onChange={setWrite} label="Permitir subidas" />
            </div>
            <Btn kind={tftpOn ? "default" : "primary"} className="ml-auto" onClick={() => toggle("tftp")}>
              {tftpOn ? "Detener" : "Iniciar"}
            </Btn>
          </div>
          <p className="text-[11.5px] text-muted mb-1">Desde el equipo:</p>
          <div className="flex flex-col items-start gap-1">
            <CopyText text={`copy tftp://${ip}/${file} flash:`} />
            <CopyText text={`tftp ${ip} get ${file}`} />
            {tftpWrite && <CopyText text={`copy running-config tftp://${ip}/respaldo.cfg`} />}
          </div>
          {s.tftpPort < 1024 && (
            <p className="mt-2 text-[11.5px] text-muted">
              En Linux y macOS el puerto 69 puede requerir privilegios; si no inicia, usa 1069 y configura ese puerto en el equipo si lo soporta.
            </p>
          )}
        </Section>

        <Section title="Servidor HTTP" hint="Solo lectura. Más rápido que TFTP para imágenes grandes." right={<StatusPill state={httpOn ? "running" : "stopped"} label={httpOn ? `Activo · TCP ${s.httpPort}` : "Detenido"} />}>
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <Label text="Puerto" className="w-20 sm:w-24">
              <input className="field" type="number" disabled={httpOn} value={s.httpPort} onChange={(e) => onChange({ httpPort: Number(e.target.value) || 8080 })} />
            </Label>
            <Btn kind={httpOn ? "default" : "primary"} className="ml-auto" onClick={() => toggle("http")}>
              {httpOn ? "Detener" : "Iniciar"}
            </Btn>
          </div>
          <p className="text-[11.5px] text-muted mb-1">Desde el equipo:</p>
          <div className="flex flex-col items-start gap-1">
            <CopyText text={`copy http://${ip}:${s.httpPort}/${file} flash:`} />
            <CopyText text={`http://${ip}:${s.httpPort}/`} />
          </div>
        </Section>
      </div>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr))]">
        <FtpServerSection settings={s} running={running} onChange={onChange} refreshRunning={refreshRunning} ip={ip} file={file} />
        <SftpSection terminals={terminals} onScp={onScp} />
      </div>

      <FtpClientSection files={files} onLocalChange={loadFiles} />

      <Section
        title="Archivos compartidos"
        hint="Clic en un archivo para usarlo en los comandos de arriba."
        right={
          <div className="flex gap-1">
            <Btn onClick={addFile}>
              <FilePlus size={14} /> Agregar
            </Btn>
            {!isMobile && (
              <Btn kind="ghost" title="Abrir carpeta" onClick={() => invoke("open_dir", { which: "tftp" })}>
                <FolderOpen size={14} />
              </Btn>
            )}
            <Btn kind="ghost" title="Actualizar" onClick={loadFiles}>
              <RefreshCw size={13} />
            </Btn>
          </div>
        }
      >
        {files.length === 0 ? (
          <p className="text-[12px] text-muted">La carpeta está vacía. Agrega un firmware o abre la carpeta y copia archivos ahí.</p>
        ) : (
          <table className="w-full text-[12px]">
            <tbody>
              {files.map(([name, size]) => (
                <tr
                  key={name}
                  aria-selected={name === file}
                  onClick={() => setSelFile(name)}
                  className={`border-t border-line first:border-0 cursor-default ${name === file ? "bg-selected" : "hover:bg-hover"}`}
                >
                  <td className="py-1.5 px-1 font-mono break-all">{name}</td>
                  <td className="px-1 text-right text-muted tabular-nums whitespace-nowrap">{fmtBytes(size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {transfers.length > 0 && (
        <Section title="Transferencias" right={<Btn kind="ghost" onClick={() => setTransfers([])}>Limpiar</Btn>}>
          <div className="space-y-2">
            {transfers.map((t) => {
              const pct = t.total ? Math.min(100, (t.bytes / t.total) * 100) : t.done && !t.error ? 100 : null;
              return (
                <div key={t.id}>
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="truncate min-w-0">
                      <span className="font-mono">{t.file}</span>
                      <span className="text-muted">
                        {" "}
                        · {t.proto.toUpperCase()} · {t.dir === "get" ? "descarga" : "subida"} · {t.client}
                      </span>
                    </span>
                    <span className={`shrink-0 tabular-nums ${t.error ? "text-danger" : t.done ? "text-ok" : ""}`}>
                      {t.error ? `✕ ${t.error}` : t.done ? `● ${fmtBytes(t.bytes)}` : `${fmtBytes(t.bytes)}${t.total ? ` / ${fmtBytes(t.total)}` : ""}`}
                    </span>
                  </div>
                  <div className="h-1 mt-1 rounded-full bg-hover overflow-hidden">
                    <div
                      className={`h-full ${t.error ? "bg-danger" : "bg-accent"} ${pct == null ? "animate-pulse w-1/3" : ""}`}
                      style={pct != null ? { width: `${pct}%` } : undefined}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
