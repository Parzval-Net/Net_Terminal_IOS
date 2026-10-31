import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { KeyRound } from "lucide-react";
import { CredStatus, credStatus, needsUnlock, storageLabel } from "../../lib/credentials";
import { isIpLiteral, validHopUser } from "../../lib/hopCred";
import { VaultUnlock } from "../VaultUnlock";

/**
 * Guarda (o reemplaza) la contraseña de un vecino en la bóveda cifrada, por IP y usuario. La
 * contraseña se escribe aquí, en un campo oculto propio: la app no ve lo que se teclea en la terminal.
 * Va directo a Rust y el campo se vacía; nunca se muestra, se registra ni se vuelve a leer.
 */
export function HopPasswordDialog({
  title,
  ip: ipIn,
  user: userIn,
  editable,
  note,
  onClose,
  onSaved,
}: {
  title: string;
  ip?: string;
  user?: string;
  /** Se piden también la IP y el usuario (agregar a mano). */
  editable?: boolean;
  note?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [ip, setIp] = useState(ipIn ?? "");
  const [user, setUser] = useState(userIn ?? "");
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [st, setSt] = useState<CredStatus | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const refresh = () => credStatus().then(setSt).catch(() => setSt(null));
  useEffect(() => {
    refresh();
    first.current?.focus();
  }, []);
  const locked = needsUnlock(st);
  const valid = isIpLiteral(ip.trim()) && validHopUser(user.trim()) && pw.length > 0 && !/[\r\n\0]/.test(pw);

  const save = async () => {
    if (!valid || busy || locked) return;
    setBusy(true);
    setError("");
    try {
      await invoke("hop_cred_set", { ip: ip.trim(), user: user.trim(), password: pw });
      setPw("");
      onSaved();
    } catch (e) {
      setError(String(e));
      refresh();
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setPw("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-2 sm:p-4" onMouseDown={close}>
      <form
        role="dialog"
        aria-label={title}
        className="w-full sm:w-[400px] max-w-full bg-panel border border-line rounded-xl shadow-pop p-4 sm:p-5 space-y-3"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {note && <p className="text-[12px] text-muted">{note}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block min-w-0">
            <span className="block mb-1 text-[11.5px] font-medium text-muted">IP del vecino</span>
            <input ref={editable ? first : undefined} className="field font-mono" value={ip} readOnly={!editable} maxLength={45} placeholder="192.0.2.12" onChange={(e) => setIp(e.target.value)} />
          </label>
          <label className="block min-w-0">
            <span className="block mb-1 text-[11.5px] font-medium text-muted">Usuario</span>
            <input className="field" value={user} readOnly={!editable} maxLength={64} placeholder="noc" onChange={(e) => setUser(e.target.value)} />
          </label>
        </div>
        {locked ? (
          <div className="space-y-1">
            <p className="text-[12px] text-warn">La bóveda está bloqueada: desbloquéala para guardar.</p>
            <VaultUnlock autoFocus onUnlocked={refresh} />
          </div>
        ) : (
          <label className="block">
            <span className="block mb-1 text-[11.5px] font-medium text-muted">Contraseña</span>
            <input
              ref={editable ? undefined : first}
              type="password"
              className="field"
              autoComplete="new-password"
              spellCheck={false}
              value={pw}
              maxLength={1024}
              onChange={(e) => setPw(e.target.value)}
            />
          </label>
        )}
        <p className="text-[11.5px] text-muted">
          Se guarda en la {storageLabel(st)}, solo para este vecino y este usuario. No se muestra, no va en logs ni en exportaciones y solo se escribe cuando el equipo pide la contraseña.
        </p>
        {ip.trim() && !isIpLiteral(ip.trim()) && <p className="text-[11.5px] text-danger">La IP debe ser una dirección IPv4 o IPv6.</p>}
        {user.trim() && !validHopUser(user.trim()) && <p className="text-[11.5px] text-danger">Usuario no válido (sin espacios ni símbolos raros).</p>}
        {error && <p className="text-[11.5px] text-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={close} className="px-3.5 h-8 rounded-md border border-line hover:bg-hover">
            Cancelar
          </button>
          <button type="submit" disabled={!valid || busy || locked} className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-50">
            <KeyRound size={13} /> {busy ? "Guardando…" : "Guardar en la bóveda"}
          </button>
        </div>
      </form>
    </div>
  );
}
