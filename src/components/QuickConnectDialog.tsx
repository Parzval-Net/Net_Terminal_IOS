import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Zap } from "lucide-react";
import { SerialPortInfo, Session, SessionType } from "../types";
import { SerialPortField } from "./SerialPortField";
import { SessionIcon, typeLabel } from "./SessionIcon";
import { quickTarget } from "./CommandPalette";
import { useDragResize } from "../lib/useDragResize";
import { backspaceOptions } from "../lib/backspace";

interface Props {
  onClose: () => void;
  /** Abre la pestaña con una sesión sin guardar (id vacío), como la paleta. */
  onOpen: (s: Session) => void;
}

type QuickType = Exclude<SessionType, "local">;

const TYPES: QuickType[] = ["ssh", "telnet", "raw", "serial"];
const DEFAULT_PORT: Record<QuickType, number> = { ssh: 22, telnet: 23, raw: 2001, serial: 0 };
const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
const HOST = /^[\w.\-:%[\]]+$/;

/** Conexión rápida por formulario (SSH, Telnet, TCP crudo o Serial) sin guardar la sesión. */
export function QuickConnectDialog({ onClose, onOpen }: Props) {
  const [s, setS] = useState<Session>({
    id: "",
    name: "",
    type: "ssh",
    port: 22,
    baud_rate: 9600,
    data_bits: 8,
    stop_bits: 1,
    parity: "none",
    flow_control: "none",
    created_at: "",
  });
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [error, setError] = useState("");
  const set = <K extends keyof Session>(k: K, v: Session[K]) => setS((p) => ({ ...p, [k]: v }));
  const win = useDragResize<HTMLFormElement>("quickWindow", false);

  const loadPorts = () =>
    invoke<SerialPortInfo[]>("list_serial_ports")
      .then((list) => {
        setPorts(list);
        // Sin puerto elegido se propone el adaptador USB (consola típica) antes que un COM de la placa.
        const pick = list.find((x) => x.port_type.startsWith("USB")) ?? list[0];
        setS((p) => (p.serial_port || !pick ? p : { ...p, serial_port: pick.port_name }));
      })
      .catch(() => {});

  useEffect(() => {
    if (s.type === "serial") loadPorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.type]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const changeType = (type: QuickType) => {
    setError("");
    setS((p) => ({ ...p, type, port: p.port === DEFAULT_PORT[p.type as QuickType] || !p.port ? DEFAULT_PORT[type] : p.port }));
  };

  const submit = () => {
    const remote = s.type !== "serial";
    const host = (s.host ?? "").trim();
    if (remote) {
      if (!host || !HOST.test(host) || host.includes("..")) return setError("Escribe un host o IP válido");
      if (!s.port || s.port < 1 || s.port > 65535) return setError("Puerto fuera de rango (1 a 65535)");
      if (s.type === "ssh" && s.username && !/^[\w.@-]+$/.test(s.username)) return setError("Usuario con caracteres no permitidos");
    } else if (!s.serial_port?.trim()) return setError("Elige un puerto serial");
    const session: Session = {
      ...s,
      host: remote ? host : undefined,
      username: s.type === "ssh" ? s.username?.trim() || undefined : undefined,
      identity_file: s.type === "ssh" ? s.identity_file?.trim() || undefined : undefined,
      legacy_ssh: s.type === "ssh" && s.legacy_ssh ? true : undefined,
      name: remote ? host : s.serial_port!.split(/[\\/]/).pop() || s.serial_port!,
      created_at: new Date().toISOString(),
    };
    // Mismo historial que la paleta (⌘K); el serial no tiene destino que recordar.
    if (session.type === "ssh" || session.type === "telnet")
      invoke("recent_target_add", { target: quickTarget(session) }).catch(() => {});
    onOpen(session);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-2 sm:p-4" onMouseDown={onClose}>
      <form
        {...win.box}
        className="w-full sm:w-[440px] max-w-[calc(100vw-1rem)] sm:max-w-[96vw] max-h-[96vh] sm:max-h-[94vh] min-w-0 bg-panel border border-line rounded-xl shadow-pop overflow-hidden flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <header {...win.handle} className="flex items-center justify-between h-12 px-3 sm:px-5 border-b border-line select-none">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold">
            <Zap size={15} className="text-warn" />
            Conexión rápida
          </h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="w-7 h-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 space-y-4">
          <div className="grid grid-cols-4 gap-1 p-1 rounded-xl sm:rounded-lg bg-hover">
            {TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => changeType(t)}
                className={`flex items-center justify-center gap-1.5 h-9 sm:h-8 rounded-lg sm:rounded-md text-[12px] sm:text-[12.5px] font-medium px-1 truncate touch-manipulation ${
                  s.type === t ? "bg-panel shadow-sm text-fg" : "text-muted hover:text-fg"
                }`}
              >
                <span className="hidden min-[360px]:inline-flex shrink-0">
                  <SessionIcon type={t} size={14} />
                </span>
                <span className="truncate">{typeLabel[t]}</span>
              </button>
            ))}
          </div>

          {s.type !== "serial" && (
            <Row cols="3fr 1fr">
              <Field label="Host">
                <input
                  className="field"
                  autoFocus
                  value={s.host ?? ""}
                  placeholder="192.0.2.10 o hostname"
                  onChange={(e) => set("host", e.target.value)}
                />
              </Field>
              <Field label="Puerto">
                <input
                  className="field"
                  type="number"
                  min={1}
                  max={65535}
                  value={s.port ?? ""}
                  onChange={(e) => set("port", Number(e.target.value) || undefined)}
                />
              </Field>
            </Row>
          )}

          {s.type === "ssh" && (
            <>
              <Row>
                <Field label="Usuario">
                  <input className="field" value={s.username ?? ""} placeholder="Según ~/.ssh/config" onChange={(e) => set("username", e.target.value)} />
                </Field>
                <Field label="Llave privada (opcional)">
                  <input className="field" value={s.identity_file ?? ""} placeholder="~/.ssh/id_ed25519" onChange={(e) => set("identity_file", e.target.value)} />
                </Field>
              </Row>
              <label className="flex items-start gap-2.5 text-[12.5px]">
                <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={!!s.legacy_ssh} onChange={(e) => set("legacy_ssh", e.target.checked)} />
                <span>
                  Permitir algoritmos legacy
                  <span className="block text-muted">Equipos antiguos: ssh-rsa, DH group1/14, cifrados CBC y MAC sha1/md5.</span>
                </span>
              </label>
            </>
          )}

          {s.type === "raw" && (
            <p className="text-[11.5px] text-muted">TCP crudo: sin negociación Telnet, para servidores de consola (puertos 2001+, 7001+).</p>
          )}

          {s.type === "serial" && (
            <>
              <Row cols="3fr 2fr">
                <Field label="Puerto">
                  <SerialPortField value={s.serial_port ?? ""} ports={ports} onChange={(v) => set("serial_port", v)} onRefresh={loadPorts} autoFocus />
                </Field>
                <Field label="Velocidad">
                  <select className="field" value={s.baud_rate ?? 9600} onChange={(e) => set("baud_rate", Number(e.target.value))}>
                    {BAUDS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </Field>
              </Row>
              <Row cols="1fr 1fr 1fr 1fr">
                <Field label="Datos">
                  <select className="field" value={s.data_bits ?? 8} onChange={(e) => set("data_bits", Number(e.target.value))}>
                    {[8, 7, 6, 5].map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Paridad">
                  <select className="field" value={s.parity ?? "none"} onChange={(e) => set("parity", e.target.value as Session["parity"])}>
                    <option value="none">None</option>
                    <option value="even">Even</option>
                    <option value="odd">Odd</option>
                  </select>
                </Field>
                <Field label="Stop">
                  <select className="field" value={s.stop_bits ?? 1} onChange={(e) => set("stop_bits", Number(e.target.value))}>
                    <option>1</option>
                    <option>2</option>
                  </select>
                </Field>
                <Field label="Flujo">
                  <select className="field" value={s.flow_control ?? "none"} onChange={(e) => set("flow_control", e.target.value as Session["flow_control"])}>
                    <option value="none">None</option>
                    <option value="software">XON/XOFF</option>
                    <option value="hardware">RTS/CTS</option>
                  </select>
                </Field>
              </Row>
              {ports.length === 0 && <p className="text-[11.5px] text-muted">No se detectaron adaptadores. Conecta el cable USB-serial y presiona actualizar.</p>}
            </>
          )}

          <details className="rounded-lg border border-line" open={!!s.backspace}>
            <summary className="px-3 h-8 flex items-center text-[12.5px] cursor-default">Opciones avanzadas</summary>
            <div className="px-3 pb-3">
              <Field label="Retroceso envía">
                <select
                  className="field"
                  value={s.backspace ?? ""}
                  onChange={(e) => set("backspace", (e.target.value || undefined) as Session["backspace"])}
                >
                  {backspaceOptions().map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="mt-1 text-[11px] text-muted">Si Retroceso no borra (equipos Huawei VRP), usa BS (^H).</p>
            </div>
          </details>

          {error && <p className="text-[12px] text-danger">{error}</p>}
          <p className="text-[11.5px] text-muted">
            La sesión no se guarda. Después puedes guardarla desde el menú de la pestaña o la barra de estado ("Guardar como sesión…").
          </p>
        </div>

        <footer className="flex flex-wrap justify-end gap-2 px-3 sm:px-5 py-2.5 sm:h-14 border-t border-line items-center">
          <button type="button" onClick={onClose} className="px-4 sm:px-3 h-10 sm:h-8 rounded-xl sm:rounded-md border border-line hover:bg-hover font-medium sm:font-normal touch-manipulation">
            Cancelar
          </button>
          <button type="submit" className="px-4 sm:px-3 h-10 sm:h-8 rounded-xl sm:rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 touch-manipulation">
            Conectar
          </button>
        </footer>
      </form>
    </div>
  );
}

function Row({ children, cols = "1fr 1fr" }: { children: React.ReactNode; cols?: string }) {
  if (cols === "1fr 1fr 1fr 1fr") {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {children}
      </div>
    );
  }
  return (
    <div className="grid gap-2 sm:gap-3" style={{ gridTemplateColumns: cols }}>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="block mb-1 text-[11.5px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
