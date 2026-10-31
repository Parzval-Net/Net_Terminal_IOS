import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderSearch, Gauge, Play, RefreshCw, Square, Trash2 } from "lucide-react";
import { SpeedResult } from "../../lib/settings";
import { LineChart, StatTile } from "./LineChart";
import { Btn, Console, CopyText, Label, Section, Toggle } from "./ui";
import { useJob } from "./useJob";

interface IperfResult {
  protocol: string;
  sent_mbps: number | null;
  received_mbps: number | null;
  retransmits: number | null;
  jitter_ms: number | null;
  lost_percent: number | null;
  cpu_local: number | null;
  cpu_remote: number | null;
  remote: string | null;
  intervals: number[];
}

const mbps = (v: number | null | undefined) =>
  v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(2)} Gbps` : `${v.toFixed(v >= 100 ? 0 : 1)} Mbps`;

interface SpeedProps {
  history: SpeedResult[];
  onResult: (r: SpeedResult) => void;
  onHistory: (h: SpeedResult[]) => void;
}

export function PerfTool(p: SpeedProps) {
  return (
    <div className="space-y-4">
      <SpeedTest {...p} />
      <Iperf />
    </div>
  );
}

function SpeedTest({ history, onResult, onHistory }: SpeedProps) {
  // Borrado en dos clics (sin diálogo): el primero arma, el segundo confirma.
  const [armed, setArmed] = useState<string | null>(null);
  const job = useJob<SpeedResult, { phase: string; value: number; progress: number }>();
  const [live, setLive] = useState<{ download: number[]; upload: number[] }>({ download: [], upload: [] });

  useEffect(() => {
    const p = job.progress;
    if (p && (p.phase === "download" || p.phase === "upload"))
      setLive((l) => ({ ...l, [p.phase]: [...l[p.phase as "download" | "upload"], p.value] }));
  }, [job.progress]);

  useEffect(() => {
    if (job.result) onResult(job.result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.result]);

  // Si la última medición se borró del historial, deja de mostrarse en los indicadores.
  const r = job.result && history.some((h) => h.ts === job.result!.ts) ? job.result : history[0];
  const phaseLabel = { latency: "Midiendo latencia", download: "Midiendo bajada", upload: "Midiendo subida" }[job.progress?.phase ?? ""] ?? "Preparando";

  return (
    <Section
      title="Speedtest"
      hint="Contra speed.cloudflare.com (red anycast más cercana). Consume ~95 MB de datos por prueba."
      right={
        <Btn
          kind={job.running ? "default" : "primary"}
          onClick={() => {
            if (job.running) return job.stop();
            setLive({ download: [], upload: [] });
            job.start("tool_speedtest");
          }}
        >
          {job.running ? <Square size={13} /> : <Gauge size={14} />} {job.running ? "Cancelar" : "Iniciar prueba"}
        </Btn>
      }
    >
      {job.running && (
        <div className="mb-3">
          <div className="flex justify-between text-[11.5px] text-muted mb-1">
            <span>{phaseLabel}</span>
            <span>{job.progress ? `${Math.round(job.progress.progress * 100)} %` : ""}</span>
          </div>
          <div className="h-1.5 rounded-full bg-hover overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${(job.progress?.progress ?? 0) * 100}%` }} />
          </div>
        </div>
      )}
      {job.error && <p className="mb-2 text-[12px] text-danger">{job.error}</p>}
      <div className="grid grid-cols-2 @[32rem]:grid-cols-4 gap-2">
        <StatTile label="Bajada" value={mbps(r?.download_mbps)} />
        <StatTile label="Subida" value={mbps(r?.upload_mbps)} />
        <StatTile label="Latencia" value={r ? `${r.latency_ms.toFixed(1)} ms` : "—"} />
        <StatTile label="Jitter" value={r ? `${r.jitter_ms.toFixed(1)} ms` : "—"} />
      </div>
      {r?.server?.colo && (
        <p className="mt-2 text-[11.5px] text-muted">
          Servidor: {r.server.colo}
          {r.server.city ? ` (${r.server.city})` : ""} · {new Date(r.ts).toLocaleString("es-CL")}
        </p>
      )}
      {job.running && live.download.length > 0 && (
        <div className="mt-3">
          <LineChart title="Mediciones de bajada" unit="Mbps" height={110} points={live.download.map((y, i) => ({ x: i, y }))} />
        </div>
      )}
      {history.length > 0 && (
        <details className="mt-3">
          <summary className="text-[12px] text-muted cursor-default">Historial ({history.length})</summary>
          <div className="overflow-x-auto">
            <table className="w-full mt-2 text-[12px] min-w-[500px]">
              <thead className="text-muted text-left">
                <tr>
                  <th className="font-medium py-1">Fecha</th>
                  <th className="font-medium">Bajada</th>
                  <th className="font-medium">Subida</th>
                  <th className="font-medium">Latencia</th>
                  <th className="font-medium">Jitter</th>
                  <th className="font-medium">Servidor</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {history.map((h) => (
                  <tr key={h.ts} className="border-t border-line">
                    <td className="py-1">{new Date(h.ts).toLocaleString("es-CL")}</td>
                    <td>{mbps(h.download_mbps)}</td>
                    <td>{mbps(h.upload_mbps)}</td>
                    <td>{h.latency_ms.toFixed(1)} ms</td>
                    <td>{h.jitter_ms != null ? `${h.jitter_ms.toFixed(1)} ms` : "—"}</td>
                    <td>{h.server?.colo ?? ""}</td>
                    <td className="text-right">
                      <button
                        title={armed === h.ts ? "Clic para confirmar" : "Eliminar esta medición"}
                        aria-label="Eliminar esta medición"
                        onMouseLeave={() => setArmed(null)}
                        onClick={() => {
                          if (armed !== h.ts) return setArmed(h.ts);
                          onHistory(history.filter((x) => x.ts !== h.ts));
                          setArmed(null);
                        }}
                        className={`w-6 h-6 inline-grid place-items-center rounded-md hover:bg-hover ${
                          armed === h.ts ? "text-danger" : "text-muted hover:text-danger"
                        }`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end mt-1">
            <button
              onMouseLeave={() => setArmed(null)}
              onClick={() => {
                if (armed !== "all") return setArmed("all");
                onHistory([]);
                setArmed(null);
              }}
              className={`text-[11.5px] px-2 h-6 rounded-md hover:bg-hover ${armed === "all" ? "text-danger" : "text-muted hover:text-danger"}`}
            >
              {armed === "all" ? "Clic para borrar todo el historial" : "Borrar historial"}
            </button>
          </div>
        </details>
      )}
    </Section>
  );
}

/** Ruta de iperf3 elegida a mano (comodidad de este equipo: cada PC lo tiene en otra carpeta). */
const IPERF_PATH_KEY = "iperfPath";
const storedIperfPath = () => {
  try {
    return localStorage.getItem(IPERF_PATH_KEY) ?? "";
  } catch {
    return "";
  }
};
/** `suggested`: hallado en una carpeta de usuario (Descargas, C:\…) y aún no ejecutado. */
type IperfFound = { path: string; version: string; suggested?: boolean };
const isWindows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

function Iperf() {
  const [found, setFound] = useState<IperfFound | null | undefined>(undefined);
  const [searching, setSearching] = useState(false);
  const [pickError, setPickError] = useState("");
  const version = found === undefined ? undefined : found && !found.suggested ? found.version : null;
  const [host, setHost] = useState("");
  const [port, setPort] = useState(5201);
  const [seconds, setSeconds] = useState(10);
  const [parallel, setParallel] = useState(1);
  const [reverse, setReverse] = useState(false);
  const [udp, setUdp] = useState(false);
  const [bandwidth, setBandwidth] = useState("100M");
  const client = useJob<IperfResult>();
  const server = useJob();
  const [ips, setIps] = useState<{ name: string; ip: string }[]>([]);

  /** Busca iperf3 (también fuera del PATH: carpetas de descarga, winget, Homebrew, snap…). */
  const detect = async (custom = storedIperfPath()) => {
    setSearching(true);
    try {
      const f = await invoke<IperfFound | null>("tool_iperf_version", { custom: custom || null });
      setFound(f);
      return f;
    } finally {
      setSearching(false);
    }
  };
  /** El usuario elige el ejecutable (o confirma el sugerido): se guarda solo si responde como iperf3. */
  const pick = async (chosen?: string) => {
    setPickError("");
    const file =
      chosen ??
      (await open({
        multiple: false,
        directory: false,
        title: "Elegir el ejecutable de iperf3",
        filters: isWindows ? [{ name: "iperf3", extensions: ["exe"] }] : undefined,
      }));
    if (typeof file !== "string") return;
    const f = await detect(file);
    if (f && f.path === file) {
      try {
        localStorage.setItem(IPERF_PATH_KEY, file);
      } catch {
        /* solo comodidad */
      }
    } else setPickError(`"${file.split(/[\\/]/).pop()}" no respondió como iperf3 (el archivo debe llamarse iperf3${isWindows ? ".exe" : ""}).`);
  };

  useEffect(() => {
    void detect();
    invoke<{ name: string; ip: string }[]>("local_ips").then(setIps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (version === null)
    return (
      <Section title="iperf3" hint="Throughput, retransmisiones, jitter y pérdida entre dos puntos.">
        <p className="text-[12.5px]">
          No se encontró iperf3 en el PATH ni en las carpetas habituales (Descargas, Archivos de programa, winget, Chocolatey, Scoop, Homebrew, MacPorts, snap). Si ya lo
          instalaste o descomprimiste en otra carpeta, elige el ejecutable:
        </p>
        {found?.suggested && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="min-w-0 break-all">
              Se encontró uno en <span className="font-mono">{found.path}</span>. Por seguridad no se ejecuta hasta que lo confirmes.
            </span>
            <Btn onClick={() => void pick(found.path)}>Usar este</Btn>
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Btn kind={found?.suggested ? undefined : "primary"} onClick={() => void pick()}>
            <FolderSearch size={14} /> Elegir iperf3{isWindows ? ".exe" : ""}…
          </Btn>
          <Btn onClick={() => void detect()} disabled={searching}>
            <RefreshCw size={14} className={searching ? "animate-spin" : ""} /> {searching ? "Buscando…" : "Buscar de nuevo"}
          </Btn>
        </div>
        {pickError && <p className="mt-1.5 text-[12px] text-danger">{pickError}</p>}
        <p className="mt-3 text-[12px] text-muted">Para instalarlo:</p>
        <ul className="mt-2 space-y-1 text-[12px] text-muted">
          <li>
            macOS: <CopyText text="brew install iperf3" />
          </li>
          <li>
            Linux: <CopyText text="sudo apt install iperf3" /> o <CopyText text="sudo dnf install iperf3" />
          </li>
          <li>
            Windows: búscalo con <CopyText text="winget search iperf3" /> o usa una compilación de terceros enlazada desde iperf.fr (ESnet no publica binarios). Si es un zip,
            descomprímelo completo (iperf3.exe necesita cygwin1.dll en la misma carpeta) y elige iperf3.exe arriba.
          </li>
        </ul>
      </Section>
    );

  const r = client.result;

  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))]">
      <Section
        title="iperf3 · cliente"
        hint={found ? `${found.version} · ${found.path}` : "Detectando…"}
        right={
          found && (
            <Btn kind="ghost" className="!h-7 !px-2 !text-[11.5px]" title="Usar otro ejecutable de iperf3" onClick={() => void pick()}>
              <FolderSearch size={13} /> Cambiar
            </Btn>
          )
        }
      >
        {pickError && <p className="mb-2 text-[12px] text-danger">{pickError}</p>}
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (client.running) return client.stop();
            client.start("tool_iperf", {
              params: { host: host.trim(), port, seconds, parallel, reverse, udp, bandwidth: udp ? bandwidth : undefined },
            });
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 @[36rem]:grid-cols-[1fr_90px_90px_80px] gap-2">
            <Label text="Servidor iperf3">
              <input className="field" value={host} placeholder="10.0.0.2" onChange={(e) => setHost(e.target.value)} />
            </Label>
            <Label text="Puerto">
              <input className="field" type="number" value={port} onChange={(e) => setPort(Number(e.target.value) || 5201)} />
            </Label>
            <Label text="Duración">
              <select className="field" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
                {[5, 10, 30, 60].map((s) => (
                  <option key={s} value={s}>
                    {s} s
                  </option>
                ))}
              </select>
            </Label>
            <Label text="Flujos">
              <select className="field" value={parallel} onChange={(e) => setParallel(Number(e.target.value))}>
                {[1, 2, 4, 8, 16].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Label>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Toggle checked={reverse} onChange={setReverse} label="Inverso (servidor → cliente)" />
            <Toggle checked={udp} onChange={setUdp} label="UDP" />
            {udp && (
              <input className="field !w-24 !h-7" value={bandwidth} title="Ancho de banda objetivo (ej. 100M, 1G)" onChange={(e) => setBandwidth(e.target.value)} />
            )}
            <Btn type="submit" kind={client.running ? "default" : "primary"} className="ml-auto" disabled={!host.trim()}>
              {client.running ? <Square size={13} /> : <Play size={13} />} {client.running ? `Midiendo ${seconds} s…` : "Medir"}
            </Btn>
          </div>
        </form>
        {client.error && <p className="mt-2 text-[12px] text-danger">{client.error}</p>}
        {r && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 @[32rem]:grid-cols-4 gap-2">
              <StatTile label="Enviado" value={mbps(r.sent_mbps)} />
              <StatTile label="Recibido" value={mbps(r.received_mbps)} />
              {r.protocol === "UDP" ? (
                <>
                  <StatTile label="Jitter" value={r.jitter_ms != null ? `${r.jitter_ms.toFixed(2)} ms` : "—"} />
                  <StatTile label="Pérdida" value={r.lost_percent != null ? `${r.lost_percent.toFixed(2)} %` : "—"} tone={(r.lost_percent ?? 0) > 1 ? "danger" : undefined} />
                </>
              ) : (
                <>
                  <StatTile label="Retransmisiones" value={String(r.retransmits ?? "—")} tone={(r.retransmits ?? 0) > 0 ? "warn" : undefined} />
                  <StatTile label="CPU local / remota" value={r.cpu_local != null ? `${r.cpu_local.toFixed(0)} / ${(r.cpu_remote ?? 0).toFixed(0)} %` : "—"} />
                </>
              )}
            </div>
            {r.intervals.length > 1 && (
              <LineChart title="Throughput por segundo" unit="Mbps" height={130} points={r.intervals.map((y, i) => ({ x: i + 1, y }))} xLabel={(x) => `Segundo ${x}`} />
            )}
          </div>
        )}
        {!r && client.lines.length > 0 && <Console lines={client.lines} height={120} />}
      </Section>

      <Section
        title="iperf3 · servidor"
        hint="Para medir desde otro equipo hacia este PC."
        right={
          <Btn kind={server.running ? "default" : "primary"} onClick={() => (server.running ? server.stop() : server.start("tool_iperf", { params: { server: true, port } }))}>
            {server.running ? "Detener" : "Iniciar"}
          </Btn>
        }
      >
        <p className="text-[12px] text-muted mb-2">Desde el otro extremo ejecuta:</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {ips.map((i) => (
            <CopyText key={i.ip} text={`iperf3 -c ${i.ip} -p ${port}`} />
          ))}
        </div>
        <Console lines={server.lines} empty={server.running ? "Esperando clientes…" : "Detenido"} height={160} />
      </Section>
    </div>
  );
}
