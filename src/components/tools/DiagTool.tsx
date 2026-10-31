import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Play, Square } from "lucide-react";
import { Sample, stats } from "../../lib/monitors";
import { LineChart, StatTile } from "./LineChart";
import { Btn, Console, Label, Section, fmtMs } from "./ui";
import { useJob } from "./useJob";

const QUICK = "quick-ping";

interface PortRow {
  port: number;
  open: boolean;
  rtt: number | null;
  error: string | null;
}

const COMMON: Record<number, string> = {
  21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS", 69: "TFTP", 80: "HTTP", 110: "POP3", 161: "SNMP",
  179: "BGP", 389: "LDAP", 443: "HTTPS", 445: "SMB", 830: "NETCONF", 1812: "RADIUS", 3389: "RDP", 8080: "HTTP alt",
  8443: "HTTPS alt", 49: "TACACS+",
};

/** "22,23,80-85" -> [22,23,80,81,82,83,84,85] */
export function parsePorts(text: string): number[] {
  const out = new Set<number>();
  for (const part of text.split(/[\s,;]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let p = Math.min(a, b); p <= Math.max(a, b) && out.size < 1024; p++) if (p > 0 && p < 65536) out.add(p);
  }
  return [...out];
}

export function DiagTool({ samples }: { samples: Record<string, Sample[]> }) {
  const [pingHost, setPingHost] = useState("");
  const [pinging, setPinging] = useState(false);
  const [pingErr, setPingErr] = useState("");
  const [traceHost, setTraceHost] = useState("");
  const trace = useJob();
  const [portHost, setPortHost] = useState("");
  const [portText, setPortText] = useState("22,23,80,443,830,8080");
  const [ports, setPorts] = useState<PortRow[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [portErr, setPortErr] = useState("");

  useEffect(() => () => void invoke("monitor_stop", { id: QUICK }), []);

  const togglePing = async () => {
    if (pinging) {
      await invoke("monitor_stop", { id: QUICK });
      return setPinging(false);
    }
    setPingErr("");
    try {
      await invoke("monitor_start", {
        cfg: { id: QUICK, kind: "icmp", host: pingHost.trim(), interval_ms: 1000, timeout_ms: 1000 },
      });
      setPinging(true);
    } catch (e) {
      setPingErr(String(e));
    }
  };

  const quick = (samples[QUICK] ?? []).slice(-300);
  const st = stats(quick);

  const scan = async () => {
    setScanning(true);
    setPortErr("");
    setPorts(null);
    try {
      setPorts(await invoke<PortRow[]>("tool_ports", { host: portHost.trim(), ports: parsePorts(portText), timeoutMs: 1500 }));
    } catch (e) {
      setPortErr(String(e));
    }
    setScanning(false);
  };

  return (
    <div className="space-y-4">
      <Section title="Ping continuo" hint="Usa el ping del sistema; no requiere permisos de administrador.">
        <form
          className="flex gap-2 mb-3"
          onSubmit={(e) => {
            e.preventDefault();
            togglePing();
          }}
        >
          <input className="field flex-1" placeholder="8.8.8.8 o router.lab" value={pingHost} disabled={pinging} onChange={(e) => setPingHost(e.target.value)} />
          <Btn type="submit" kind={pinging ? "default" : "primary"} disabled={!pingHost.trim()}>
            {pinging ? <Square size={13} /> : <Play size={13} />} {pinging ? "Detener" : "Iniciar"}
          </Btn>
        </form>
        {pingErr && <p className="mb-2 text-[12px] text-danger">{pingErr}</p>}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 mb-3">
          <StatTile label="Actual" value={st.last?.ok ? fmtMs(st.last.rtt) : st.last ? "Sin resp." : "—"} tone={st.last && !st.last.ok ? "danger" : undefined} />
          <StatTile label="Promedio" value={fmtMs(st.avg)} />
          <StatTile label="Mín / máx" value={st.min == null ? "—" : `${st.min.toFixed(0)} / ${st.max!.toFixed(0)}`} />
          <StatTile label="Jitter" value={fmtMs(st.jitter)} />
          <StatTile label={`Pérdida (${st.lost}/${st.sent})`} value={`${st.loss.toFixed(1)} %`} tone={st.loss >= 5 ? "danger" : st.loss > 0 ? "warn" : undefined} />
        </div>
        <LineChart
          title="Latencia del ping continuo"
          unit="ms"
          height={150}
          points={quick.map((s) => ({ x: s.ts, y: s.ok ? s.rtt : null, note: s.error ?? undefined }))}
          xLabel={(x) => new Date(x).toLocaleTimeString("es-CL")}
        />
      </Section>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))]">
        <Section title="Traceroute" hint="Muestra cada salto hasta el destino (sin resolver nombres).">
          <form
            className="flex gap-2 mb-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (trace.running) trace.stop();
              else trace.start("tool_traceroute", { host: traceHost.trim() });
            }}
          >
            <input className="field flex-1 min-w-0" placeholder="Destino" value={traceHost} onChange={(e) => setTraceHost(e.target.value)} />
            <Btn type="submit" kind={trace.running ? "default" : "primary"} disabled={!traceHost.trim()}>
              {trace.running ? "Detener" : "Trazar"}
            </Btn>
          </form>
          {trace.error && <p className="mb-2 text-[12px] text-danger">{trace.error}</p>}
          <Console lines={trace.lines} empty="La ruta aparecerá aquí" />
        </Section>

        <Section title="Puertos TCP" hint="Verifica si un servicio acepta conexiones. Rangos permitidos: 22,80-90.">
          <form
            className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 mb-3"
            onSubmit={(e) => {
              e.preventDefault();
              scan();
            }}
          >
            <Label text="Host">
              <input className="field" value={portHost} placeholder="192.0.2.10" onChange={(e) => setPortHost(e.target.value)} />
            </Label>
            <Label text="Puertos">
              <input className="field font-mono !text-[12px]" value={portText} onChange={(e) => setPortText(e.target.value)} />
            </Label>
            <div className="self-end">
              <Btn type="submit" kind="primary" className="w-full sm:w-auto" disabled={scanning || !portHost.trim() || !parsePorts(portText).length}>
                {scanning ? "Revisando…" : "Revisar"}
              </Btn>
            </div>
          </form>
          {portErr && <p className="mb-2 text-[12px] text-danger">{portErr}</p>}
          <div className="max-h-[220px] overflow-auto">
            <table className="w-full text-[12px] min-w-[280px]">
              <thead className="text-muted text-left">
                <tr>
                  <th className="font-medium py-1">Puerto</th>
                  <th className="font-medium">Servicio</th>
                  <th className="font-medium">Estado</th>
                  <th className="font-medium text-right">Tiempo</th>
                </tr>
              </thead>
              <tbody>
                {ports?.map((r) => (
                  <tr key={r.port} className="border-t border-line">
                    <td className="py-1 font-mono">{r.port}</td>
                    <td className="text-muted">{COMMON[r.port] ?? ""}</td>
                    <td className={r.open ? "text-ok" : "text-muted"} title={r.error ?? ""}>
                      {r.open ? "● Abierto" : "○ Cerrado / filtrado"}
                    </td>
                    <td className="text-right tabular-nums">{r.open ? fmtMs(r.rtt) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}
