import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, KeyRound, Plus, Trash2, X } from "lucide-react";
import { SerialPortInfo, Session, SessionType, Tunnel, TunnelKind } from "../types";
import { SerialPortField } from "./SerialPortField";
import { SessionIcon, typeLabel } from "./SessionIcon";
import { vendorSchemes } from "../lib/highlight";
import { backspaceOptions } from "../lib/backspace";
import { normPath } from "../lib/folders";
import { useDragResize } from "../lib/useDragResize";
import { CredStatus, MASK, credStatus, needsUnlock, storageLabel } from "../lib/credentials";
import { VaultUnlock } from "./VaultUnlock";

/** Qué hacer con la contraseña guardada al guardar la sesión. */
export type CredChange = { action: "keep" } | { action: "set"; password: string } | { action: "delete" };

interface Props {
  initial?: Session;
  /** Título del diálogo (por defecto "Editar sesión" o "Nueva sesión"). */
  title?: string;
  defaultFolder?: string;
  folders: string[];
  onClose: () => void;
  onSave: (s: Session, connect: boolean, cred: CredChange) => void;
}

const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
const DEFAULT_PORT: Partial<Record<SessionType, number>> = { ssh: 22, telnet: 23, raw: 2001 };
const ENCODINGS: [string, string][] = [
  ["utf-8", "UTF-8 (por defecto)"],
  ["iso-8859-1", "ISO-8859-1 (Latin-1, equipos antiguos)"],
  ["windows-1252", "Windows-1252"],
];

export function SessionModal({ initial, title, defaultFolder, folders, onClose, onSave }: Props) {
  const [s, setS] = useState<Session>(
    initial ?? {
      id: "",
      name: "",
      type: "ssh",
      port: 22,
      baud_rate: 9600,
      data_bits: 8,
      stop_bits: 1,
      parity: "none",
      flow_control: "none",
      folder: defaultFolder,
      created_at: "",
    },
  );
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const set = <K extends keyof Session>(k: K, v: Session[K]) => setS((p) => ({ ...p, [k]: v }));

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

  const changeType = (type: SessionType) =>
    setS((p) => ({
      ...p,
      type,
      port: p.port === DEFAULT_PORT[p.type] || !p.port ? DEFAULT_PORT[type] : p.port,
    }));

  const [error, setError] = useState("");
  /** Contraseña nueva escrita en el modal (solo se envía al backend al guardar). */
  const [newPw, setNewPw] = useState("");
  /** Hay una guardada y no se está cambiando: se muestra la máscara fija. */
  const hadPw = !!initial?.save_password;
  const [changing, setChanging] = useState(!hadPw);
  /** Se pidió borrar la guardada: vaciar el campo no la recupera. */
  const [deleted, setDeleted] = useState(false);
  const [cred, setCred] = useState<CredStatus | null>(null);
  const refreshCred = () => credStatus().then(setCred).catch(() => {});
  useEffect(() => {
    if (s.save_password || hadPw) refreshCred();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.save_password]);

  const credChange = (): CredChange => {
    if (!s.save_password || s.type === "local") return hadPw ? { action: "delete" } : { action: "keep" };
    if (newPw) return { action: "set", password: newPw };
    return { action: "keep" };
  };

  const submit = (connect: boolean) => {
    const tunnelError = s.type === "ssh" ? validateTunnels(s.tunnels ?? []) : null;
    if (tunnelError) return setError(tunnelError);
    const name =
      s.name.trim() ||
      (s.type === "serial" ? s.serial_port : s.type === "local" ? "Terminal local" : s.host) ||
      typeLabel[s.type];
    const tunnels = s.type === "ssh" && s.tunnels?.length ? s.tunnels : undefined;
    const pw = credChange();
    if (s.save_password && s.type !== "local" && !hadPw && pw.action !== "set")
      return setError("Escribe la contraseña a guardar");
    if (pw.action === "set" && /[\r\n\0]/.test(pw.password)) return setError("La contraseña no puede contener saltos de línea");
    if (pw.action === "set" && new TextEncoder().encode(pw.password).length > 1024) return setError("La contraseña es demasiado larga");
    const save_password = s.type !== "local" && s.save_password ? true : undefined;
    onSave({ ...s, name, folder: normPath(s.folder) || undefined, tunnels, save_password }, connect, pw);
  };

  const remote = s.type === "ssh" || s.type === "telnet" || s.type === "raw";
  const win = useDragResize<HTMLFormElement>("sessionWindow");
  const pwBlock = (
    <PasswordBlock
      session={s}
      hadPw={hadPw}
      changing={changing}
      newPw={newPw}
      cred={cred}
      onChangeClick={() => setChanging(true)}
      onDelete={() => {
        setNewPw("");
        setDeleted(true);
        // Queda el campo para escribir otra; sin escribir nada, la guardada se borra al guardar.
        setChanging(true);
        set("save_password", undefined);
      }}
      onNewPw={(v) => {
        setError("");
        setNewPw(v);
        // Escribir una clave implica guardarla; vaciarla la descarta, salvo al cambiar una guardada
        // (vacío = mantenerla).
        if (v) set("save_password", true);
        else if (!hadPw || deleted) set("save_password", undefined);
      }}
      onUnlocked={refreshCred}
      onUser={(v) => set("username", v || undefined)}
    />
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-2 sm:p-4" onMouseDown={onClose}>
      <form
        {...win.box}
        className="w-full sm:w-[460px] bg-panel border border-line rounded-xl shadow-pop sm:resize overflow-hidden flex flex-col min-w-0 sm:min-w-[360px] min-h-0 sm:min-h-[260px] max-w-[calc(100vw-1rem)] sm:max-w-[96vw] max-h-[96vh] sm:max-h-[94vh]"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit(true);
        }}
      >
        <header {...win.handle} className="shrink-0 flex items-center justify-between px-3 sm:px-5 h-12 border-b border-line select-none">
          <h2 className="text-[14px] font-semibold">{title ?? (initial ? "Editar sesión" : "Nueva sesión")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="w-7 h-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 space-y-4">
          <div className="grid grid-cols-5 gap-1 p-1 rounded-xl sm:rounded-lg bg-hover">
            {(["ssh", "telnet", "serial", "raw", "local"] as SessionType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => changeType(t)}
                className={`flex items-center justify-center gap-1 sm:gap-1.5 h-9 sm:h-8 rounded-lg sm:rounded-md text-[11.5px] sm:text-[12.5px] font-medium px-1 truncate touch-manipulation ${
                  s.type === t ? "bg-panel shadow-sm text-fg" : "text-muted hover:text-fg"
                }`}
              >
                <span className="hidden min-[380px]:inline-flex shrink-0">
                  <SessionIcon type={t} size={14} />
                </span>
                <span className="truncate">{typeLabel[t]}</span>
              </button>
            ))}
          </div>

          <Row>
            <Field label="Nombre">
              <input
                className="field"
                value={s.name}
                placeholder={s.type === "serial" ? "Consola switch" : "Router core"}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field label="Carpeta">
              <input
                className="field"
                list="folders"
                value={s.folder ?? ""}
                placeholder="Raíz · usa / para subcarpetas"
                onChange={(e) => set("folder", e.target.value)}
              />
              <datalist id="folders">
                {folders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </Field>
          </Row>

          {remote && (
            <Row cols="3fr 1fr">
              <Field label="Host">
                <input
                  className="field"
                  required
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
                  <input
                    className="field"
                    value={s.username ?? ""}
                    placeholder="Según ~/.ssh/config"
                    onChange={(e) => set("username", e.target.value)}
                  />
                </Field>
                <Field label="Llave privada (opcional)">
                  <input
                    className="field"
                    value={s.identity_file ?? ""}
                    placeholder="~/.ssh/id_ed25519"
                    onChange={(e) => set("identity_file", e.target.value)}
                  />
                </Field>
              </Row>
              {pwBlock}
              <Field label="Jump host / bastión (opcional)">
                <input
                  className="field"
                  value={s.jump_host ?? ""}
                  placeholder="usuario@bastion:22"
                  onChange={(e) => set("jump_host", e.target.value)}
                />
              </Field>
              <Field label="Argumentos extra de ssh (avanzado)">
                <input
                  className="field font-mono !text-[12px]"
                  value={s.ssh_args ?? ""}
                  placeholder="-L 8443:192.0.2.10:443 -A -o StrictHostKeyChecking=accept-new"
                  onChange={(e) => set("ssh_args", e.target.value)}
                />
              </Field>
              <TunnelsEditor
                tunnels={s.tunnels ?? []}
                onChange={(t) => {
                  setError("");
                  set("tunnels", t.length ? t : undefined);
                }}
              />
              <label className="flex items-start gap-2.5 text-[12.5px]">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--accent)]"
                  checked={!!s.legacy_ssh}
                  onChange={(e) => set("legacy_ssh", e.target.checked)}
                />
                <span>
                  Permitir algoritmos legacy
                  <span className="block text-muted">
                    Equipos antiguos: DH group1/14/GEX-sha1, ssh-rsa, cifrados CBC/3DES y MAC hmac-sha1/md5.
                    Solo se activan los que soporte el OpenSSH instalado.
                  </span>
                </span>
              </label>
              <p className="text-[11.5px] text-muted">
                Usa OpenSSH del sistema, por lo que respeta tu ~/.ssh/config, agente y known_hosts. Las llaves y el
                agente siguen siendo la opción más segura.
              </p>
            </>
          )}

          {s.type === "serial" && (
            <>
              <Row cols="3fr 2fr">
                <Field label="Puerto">
                  <SerialPortField value={s.serial_port ?? ""} ports={ports} onChange={(v) => set("serial_port", v)} onRefresh={loadPorts} />
                </Field>
                <Field label="Velocidad">
                  <select
                    className="field"
                    value={s.baud_rate ?? 9600}
                    onChange={(e) => set("baud_rate", Number(e.target.value))}
                  >
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
                  <select
                    className="field"
                    value={s.data_bits ?? 8}
                    onChange={(e) => set("data_bits", Number(e.target.value))}
                  >
                    {[8, 7, 6, 5].map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Paridad">
                  <select
                    className="field"
                    value={s.parity ?? "none"}
                    onChange={(e) => set("parity", e.target.value as Session["parity"])}
                  >
                    <option value="none">None</option>
                    <option value="even">Even</option>
                    <option value="odd">Odd</option>
                  </select>
                </Field>
                <Field label="Stop">
                  <select
                    className="field"
                    value={s.stop_bits ?? 1}
                    onChange={(e) => set("stop_bits", Number(e.target.value))}
                  >
                    <option>1</option>
                    <option>2</option>
                  </select>
                </Field>
                <Field label="Flujo">
                  <select
                    className="field"
                    value={s.flow_control ?? "none"}
                    onChange={(e) => set("flow_control", e.target.value as Session["flow_control"])}
                  >
                    <option value="none">None</option>
                    <option value="software">XON/XOFF</option>
                    <option value="hardware">RTS/CTS</option>
                  </select>
                </Field>
              </Row>
              {ports.length === 0 && (
                <p className="text-[11.5px] text-muted">
                  No se detectaron adaptadores. Conecta el cable USB-serial y presiona actualizar.
                </p>
              )}
            </>
          )}

          {s.type === "raw" && (
            <p className="text-[11.5px] text-muted">
              TCP crudo: conexión directa sin negociación Telnet. Útil para servidores de consola (puertos 2001+, 7001+) y
              equipos que no hablan Telnet.
            </p>
          )}

          {s.type !== "local" && s.type !== "ssh" && pwBlock}

          {s.type !== "local" && (
            <details className="rounded-lg border border-line" open={!!(s.on_connect || s.local_echo || s.auto_reconnect || s.backspace)}>
              <summary className="px-3 h-9 flex items-center text-[12.5px] cursor-default">Opciones de terminal</summary>
              <div className="px-3 pb-3 space-y-3">
                <Field label="Comandos al conectar (uno por línea)">
                  <textarea
                    className="field !h-20 py-2 font-mono !text-[12px] resize-y"
                    spellCheck={false}
                    value={s.on_connect ?? ""}
                    placeholder={"terminal length 0\nshow clock"}
                    onChange={(e) => set("on_connect", e.target.value || undefined)}
                  />
                </Field>
                <Row>
                  <Field label="Enter envía">
                    <select
                      className="field"
                      value={s.newline ?? "cr"}
                      onChange={(e) => set("newline", e.target.value === "cr" ? undefined : (e.target.value as Session["newline"]))}
                    >
                      <option value="cr">CR (estándar)</option>
                      <option value="lf">LF</option>
                      <option value="crlf">CR+LF</option>
                    </select>
                  </Field>
                  <Field label="Codificación">
                    <select
                      className="field"
                      value={s.encoding ?? "utf-8"}
                      onChange={(e) => set("encoding", e.target.value === "utf-8" ? undefined : e.target.value)}
                    >
                      {ENCODINGS.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                </Row>
                <Row>
                  <Field label="Retroceso envía">
                    <select
                      className="field"
                      value={s.backspace ?? ""}
                      onChange={(e) => set("backspace", (e.target.value || undefined) as Session["backspace"])}
                    >
                      {backspaceOptions(s.platform).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <p className="self-end pb-1.5 text-[11px] text-muted">Si Retroceso no borra (equipos Huawei VRP), usa BS. Shift+Retroceso envía el otro.</p>
                </Row>
                <label className="flex items-center gap-2.5 text-[12.5px]">
                  <input
                    type="checkbox"
                    className="accent-[var(--accent)]"
                    checked={!!s.auto_reconnect}
                    onChange={(e) => set("auto_reconnect", e.target.checked || undefined)}
                  />
                  Reconectar automáticamente si se corta (reinicios, cable USB)
                </label>
                {(s.type === "serial" || s.type === "raw") && (
                  <label className="flex items-center gap-2.5 text-[12.5px]">
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)]"
                      checked={!!s.local_echo}
                      onChange={(e) => set("local_echo", e.target.checked || undefined)}
                    />
                    Eco local (mostrar lo que escribes si el equipo no lo devuelve)
                  </label>
                )}
              </div>
            </details>
          )}

          {s.type !== "local" && (
            <div>
              <label className="flex flex-wrap items-center justify-between gap-2 sm:gap-4">
                <span className="min-w-[160px] flex-1">
                  Resaltado de sintaxis
                  <span className="block text-[11.5px] text-muted">Colorea interfaces, IPs, estados y configuración</span>
                </span>
                <select
                  className="field !w-full sm:!w-48"
                  value={s.highlight ?? "default"}
                  onChange={(e) => set("highlight", e.target.value === "default" ? undefined : e.target.value)}
                >
                  <option value="default">Según ajustes</option>
                  {vendorSchemes.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                  <option value="off">Sin resaltado</option>
                </select>
              </label>
            </div>
          )}
        </div>

        <footer className="shrink-0 flex flex-wrap items-center justify-end gap-2 px-3 sm:px-5 py-3 border-t border-line">
          {error && <span className="mr-auto text-[11.5px] text-danger truncate max-w-full">{error}</span>}
          <button
            type="button"
            onClick={() => submit(false)}
            className="px-4 sm:px-3.5 h-10 sm:h-8 rounded-xl sm:rounded-md border border-line hover:bg-hover text-[13px] font-medium sm:font-normal touch-manipulation"
          >
            Guardar
          </button>
          <button type="submit" className="px-4 sm:px-3.5 h-10 sm:h-8 rounded-xl sm:rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 text-[13px] touch-manipulation">
            Guardar y conectar
          </button>
        </footer>
      </form>
    </div>
  );
}

/** Contraseña guardada: solo escritura, nunca se muestra ni se lee desde el backend. */
function PasswordBlock(p: {
  session: Session;
  hadPw: boolean;
  changing: boolean;
  newPw: string;
  cred: CredStatus | null;
  onChangeClick: () => void;
  onDelete: () => void;
  onNewPw: (v: string) => void;
  onUnlocked: () => void;
  onUser: (v: string) => void;
}) {
  const { session: s, cred } = p;
  const on = !!s.save_password;
  const noVault = cred?.backend === "vault" && !cred.exists;
  const locked = needsUnlock(cred);
  const userHint = on && s.type !== "ssh" && !s.username;
  return (
    <div
      className="rounded-lg border px-3 py-2.5 space-y-2.5"
      style={{
        borderColor: "color-mix(in srgb, var(--accent) 55%, transparent)",
        background: "color-mix(in srgb, var(--accent) 7%, transparent)",
      }}
    >
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
        <KeyRound size={14} className="text-accent" /> Contraseña
        <span className="ml-auto text-[11px] font-normal text-muted">Opcional · se completa sola al conectar</span>
      </div>
      {s.type !== "ssh" && (
        <Field label="Usuario (opcional)">
          <input
            className="field"
            value={s.username ?? ""}
            placeholder="Se envía en el prompt Username: o login:"
            onChange={(e) => p.onUser(e.target.value)}
          />
        </Field>
      )}
      {p.hadPw && on && !p.changing ? (
        <div className="flex items-center gap-2">
          <input className="field flex-1 font-mono tracking-widest" type="password" value={MASK} readOnly tabIndex={-1} aria-label="Contraseña guardada" />
          <span className="flex items-center gap-1 text-[11.5px] text-accent shrink-0">
            <KeyRound size={12} /> Guardada
          </span>
          <button type="button" onClick={p.onChangeClick} className="px-2.5 h-8 rounded-md border border-line hover:bg-hover shrink-0">
            Cambiar
          </button>
          <button
            type="button"
            onClick={p.onDelete}
            className="px-2.5 h-8 rounded-md border border-line text-danger hover:bg-hover shrink-0"
          >
            Borrar
          </button>
        </div>
      ) : (
        <input
          className="field !border-accent"
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          maxLength={1024}
          value={p.newPw}
          aria-label={p.hadPw ? "Nueva contraseña" : "Contraseña"}
          placeholder={p.hadPw && on ? "Vacío: mantener la guardada" : "Escribe la contraseña para guardarla"}
          onChange={(e) => p.onNewPw(e.target.value)}
        />
      )}
      {userHint && <p className="text-[11.5px] text-muted">Sin usuario definido solo se completa la contraseña.</p>}
      {on && noVault && (
        <p className="text-[11.5px] text-warn">
          Primero crea la bóveda con una contraseña maestra en Ajustes › Credenciales.
        </p>
      )}
      {on && locked && (
        <div className="space-y-1">
          <p className="text-[11.5px] text-warn">La bóveda está bloqueada: desbloquéala para guardar.</p>
          <VaultUnlock onUnlocked={p.onUnlocked} />
        </div>
      )}
      <p className="text-[11.5px] text-muted">
        Se completa en el primer pedido de contraseña (una vez, dentro de 60 s).
        {s.type !== "ssh" && " En Telnet, TCP y Serial también envía el usuario si está definido."} Se guarda en la{" "}
        {storageLabel(cred)}, nunca en el archivo de sesiones, logs ni exportaciones, y no se puede volver a ver.
      </p>
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

const isPort = (p?: number) => !!p && Number.isInteger(p) && p >= 1 && p <= 65535;
const ADDR = /^\[?[A-Za-z0-9.:_%*-]+\]?$/;

/** Mensaje de error del primer túnel inválido, o null. */
function validateTunnels(list: Tunnel[]): string | null {
  for (const [i, t] of list.entries()) {
    const n = `Túnel ${i + 1}`;
    if (!isPort(t.listen_port)) return `${n}: puerto de escucha inválido (1-65535)`;
    if (t.bind && (!ADDR.test(t.bind.trim()) || t.bind.trim().startsWith("-"))) return `${n}: dirección de escucha inválida`;
    if (t.kind !== "dynamic") {
      const h = t.dest_host?.trim() ?? "";
      if (!h || !ADDR.test(h) || h.startsWith("-") || h.includes("*")) return `${n}: destino inválido`;
      if (!isPort(t.dest_port)) return `${n}: puerto de destino inválido (1-65535)`;
    }
  }
  return list.length > 32 ? "Máximo 32 túneles por sesión" : null;
}

const exposed = (t: Tunnel) => ["0.0.0.0", "*", "::", "[::]"].includes(t.bind?.trim() ?? "");

/** Reglas de túnel estructuradas: Local (-L), Remoto (-R) y Dinámico (-D, SOCKS). */
function TunnelsEditor({ tunnels, onChange }: { tunnels: Tunnel[]; onChange: (t: Tunnel[]) => void }) {
  const upd = (i: number, p: Partial<Tunnel>) => onChange(tunnels.map((t, k) => (k === i ? { ...t, ...p } : t)));
  const num = (v: string) => (v.trim() ? Number(v.replace(/\D/g, "")) || 0 : undefined) as number;
  const warnExposed = tunnels.some(exposed);
  const warnRemote = tunnels.some((t) => t.kind === "remote");
  return (
    <details className="rounded-lg border border-line" open={tunnels.length > 0}>
      <summary className="px-3 h-9 flex items-center text-[12.5px] cursor-default">
        Túneles SSH{tunnels.length ? ` (${tunnels.length})` : ""}
      </summary>
      <div className="px-3 pb-3 space-y-1.5">
        {tunnels.map((t, i) => (
          <div key={i} className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 sm:gap-1 text-[12px] p-2 sm:p-0 rounded-md border sm:border-0 border-line/60">
            <select
              className="field !h-7 !w-[54px] !px-1 !text-[12px]"
              title="Local (-L): puerto del PC hacia un destino visto desde el servidor. Remoto (-R): puerto del servidor hacia tu PC. Dinámico (-D): proxy SOCKS."
              value={t.kind}
              onChange={(e) => upd(i, { kind: e.target.value as TunnelKind })}
            >
              <option value="local">-L</option>
              <option value="remote">-R</option>
              <option value="dynamic">-D</option>
            </select>
            <input
              className="field !h-7 !px-1.5 !w-[80px] !text-[12px] font-mono"
              placeholder="127.0.0.1"
              title="Dirección de escucha"
              value={t.bind ?? ""}
              onChange={(e) => upd(i, { bind: e.target.value || undefined })}
            />
            <input
              className="field !h-7 !px-1.5 !w-[50px] !text-[12px] font-mono"
              inputMode="numeric"
              placeholder="1080"
              title="Puerto de escucha"
              value={t.listen_port || ""}
              onChange={(e) => upd(i, { listen_port: num(e.target.value) })}
            />
            {t.kind !== "dynamic" ? (
              <>
                <span className="text-muted">→</span>
                <input
                  className="field !h-7 !px-1.5 flex-1 min-w-0 !text-[12px] font-mono"
                  placeholder="192.0.2.10"
                  title="Host de destino"
                  value={t.dest_host ?? ""}
                  onChange={(e) => upd(i, { dest_host: e.target.value || undefined })}
                />
                <input
                  className="field !h-7 !px-1.5 !w-[50px] !text-[12px] font-mono"
                  inputMode="numeric"
                  placeholder="443"
                  title="Puerto de destino"
                  value={t.dest_port ?? ""}
                  onChange={(e) => upd(i, { dest_port: num(e.target.value) })}
                />
              </>
            ) : (
              <span className="flex-1 text-muted text-[11.5px] truncate">Proxy SOCKS</span>
            )}
            <button
              type="button"
              title="Quitar túnel"
              onClick={() => onChange(tunnels.filter((_, k) => k !== i))}
              className="w-7 h-7 shrink-0 grid place-items-center rounded-md text-muted hover:text-danger hover:bg-hover ml-auto sm:ml-0"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={tunnels.length >= 32}
          onClick={() => onChange([...tunnels, { kind: "local", listen_port: 0 } as Tunnel])}
          className="flex items-center gap-1.5 px-2 h-7 rounded-md text-[12px] text-muted hover:text-fg hover:bg-hover disabled:opacity-40"
        >
          <Plus size={13} /> Agregar túnel
        </button>
        {(warnExposed || warnRemote) && (
          <div className="flex gap-2 p-2 rounded-md border border-warn/40 text-[11.5px]">
            <AlertTriangle size={13} className="text-warn shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              {warnExposed && <p>Escuchar en 0.0.0.0 o * expone el puerto a toda la red, no solo a este PC.</p>}
              {warnRemote && <p>Un túnel remoto (-R) abre un puerto en el servidor que llega hasta tu PC o tu red.</p>}
            </div>
          </div>
        )}
        <p className="text-[11.5px] text-muted">
          Se validan antes de conectar. Escucha por defecto en 127.0.0.1. Los argumentos extra se mantienen aparte.
        </p>
      </div>
    </details>
  );
}
