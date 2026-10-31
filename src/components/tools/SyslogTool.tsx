import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FolderOpen, Pause, Play } from "lucide-react";
import { Settings } from "../../lib/settings";
import { Btn, CopyText, IpSelect, Label, Section, StatusPill, Toggle } from "./ui";
import { useLocalIp } from "./useLocalIp";
import { loghostCommands } from "../../lib/devicefs";
import { isMobile } from "../../lib/platform";

interface Msg {
  ts: number;
  src: string;
  severity: number;
  facility: number;
  msg: string;
}

const SEV = ["Emergencia", "Alerta", "Crítico", "Error", "Warning", "Notice", "Info", "Debug"];
const sevColor = (s: number) => (s <= 3 ? "text-danger" : s === 4 ? "text-warn" : "text-muted");
const MAX = 5000;

export function SyslogTool({
  settings: s,
  running,
  onChange,
  refreshRunning,
}: {
  settings: Settings;
  running: string[];
  onChange: (p: Partial<Settings>) => void;
  refreshRunning: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [filter, setFilter] = useState("");
  const [minSev, setMinSev] = useState(7);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const { ips, ip: localIp, setIp } = useLocalIp();
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const on = running.includes("syslog");

  useEffect(() => {
    const un = listen<Msg[]>("syslog", ({ payload }) => {
      if (pausedRef.current) return;
      setMsgs((m) => [...payload.reverse(), ...m].slice(0, MAX));
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  const toggle = async () => {
    setError("");
    try {
      if (on) await invoke("server_stop", { kind: "syslog" });
      else await invoke("server_start", { kind: "syslog", port: s.syslogPort, save: s.syslogSave });
    } catch (e) {
      setError(String(e));
    }
    refreshRunning();
  };

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return msgs.filter((m) => m.severity <= minSev && (!q || m.msg.toLowerCase().includes(q) || m.src.includes(q)));
  }, [msgs, filter, minSev]);

  const ip = localIp || "IP_DE_ESTE_PC";
  const cmds = loghostCommands(ip, s.syslogPort);

  return (
    <div className="space-y-4">
      <Section
        title="Servidor Syslog"
        hint="Recibe los logs que envían los equipos (UDP). Útil durante ventanas de cambio para ver eventos en vivo."
        right={<StatusPill state={on ? "running" : "stopped"} label={on ? `Activo · UDP ${s.syslogPort}` : "Detenido"} />}
      >
        <div className="flex flex-wrap items-end gap-3">
          <Label text="Puerto" className="w-24">
            <input className="field" type="number" disabled={on} value={s.syslogPort} onChange={(e) => onChange({ syslogPort: Number(e.target.value) || 514 })} />
          </Label>
          <div className="pb-1.5">
            <Toggle checked={s.syslogSave} onChange={(v) => onChange({ syslogSave: v })} label="Guardar en archivo diario" />
          </div>
          {!isMobile && (
            <Btn kind="ghost" title="Abrir carpeta de syslog" onClick={() => invoke("open_dir", { which: "syslog" })}>
              <FolderOpen size={14} />
            </Btn>
          )}
          <Btn kind={on ? "default" : "primary"} className="ml-auto" onClick={toggle}>
            {on ? "Detener" : "Iniciar"}
          </Btn>
        </div>
        {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <IpSelect ips={ips} ip={localIp} onChange={setIp} className="w-full sm:w-72" />
          <div className="flex flex-wrap items-center gap-1.5 pb-1 text-[11.5px] text-muted">
            Configura el equipo: Cisco <CopyText text={cmds.cisco} /> Huawei <CopyText text={cmds.huawei} />
          </div>
        </div>
        {cmds.huaweiPortNote && (
          <p className="mt-1.5 text-[11.5px] text-muted">
            Huawei: "port" está documentado en CloudEngine V300, NE y S5700/S6700 V200R024; en AR y versiones antiguas, verificar en tu
            versión (sin "port" solo sirve el 514).
          </p>
        )}
        {s.syslogPort < 1024 && (
          <p className="mt-1.5 text-[11.5px] text-muted">En Linux y macOS el puerto 514 puede requerir privilegios; si no inicia, usa 1514.</p>
        )}
      </Section>

      <Section
        title={`Mensajes (${shown.length}${shown.length !== msgs.length ? ` de ${msgs.length}` : ""})`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <input className="field !h-7 w-full sm:!w-44" placeholder="Filtrar texto o IP" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <select className="field !h-7 flex-1 sm:flex-initial sm:!w-32" value={minSev} onChange={(e) => setMinSev(Number(e.target.value))}>
              {SEV.map((l, i) => (
                <option key={l} value={i}>
                  Hasta {l}
                </option>
              ))}
            </select>
            <Btn kind="ghost" title={paused ? "Reanudar" : "Pausar vista"} onClick={() => setPaused(!paused)}>
              {paused ? <Play size={13} /> : <Pause size={13} />}
            </Btn>
            <Btn kind="ghost" onClick={() => setMsgs([])}>
              Limpiar
            </Btn>
          </div>
        }
      >
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-[12px] min-w-[480px]">
            <tbody className="font-mono">
              {shown.slice(0, 1000).map((m, i) => (
                <tr key={`${m.ts}-${i}`} className="border-t border-line align-top">
                  <td className="py-1 pr-3 text-muted whitespace-nowrap">{new Date(m.ts).toLocaleTimeString("es-CL")}</td>
                  <td className="pr-3 whitespace-nowrap">{m.src}</td>
                  <td className={`pr-3 whitespace-nowrap font-sans ${sevColor(m.severity)}`}>
                    {m.severity <= 3 ? "✕ " : m.severity === 4 ? "▲ " : ""}
                    {SEV[m.severity]}
                  </td>
                  <td className="break-all select-text">{m.msg}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {msgs.length === 0 && <p className="text-[12px] text-muted">{on ? "Esperando mensajes…" : "Inicia el servidor para recibir logs."}</p>}
        </div>
      </Section>
    </div>
  );
}
