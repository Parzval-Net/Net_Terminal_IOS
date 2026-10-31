import { useState } from "react";
import { Lock, LockOpen } from "lucide-react";

/** Minutos de inactividad antes de bloquear una nota protegida. */
export const AUTO_LOCK_OPTIONS = [1, 5, 15, 30, 60];
export const MIN_NOTE_PASSWORD = 8;

/** Pantalla de una nota protegida y bloqueada: pide la contraseña (nunca se guarda en el frontend). */
export function NoteUnlock({ name, onUnlock }: { name: string; onUnlock: (password: string) => Promise<string | null> }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    const err = await onUnlock(password);
    setBusy(false);
    setPassword("");
    setError(err ?? "");
  };

  return (
    <form onSubmit={submit} className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
      <Lock size={28} className="text-muted" />
      <div>
        <p className="text-[13px] font-medium truncate max-w-[260px]">{name}</p>
        <p className="text-[12px] text-muted">Nota protegida con contraseña</p>
      </div>
      <input
        autoFocus
        type="password"
        autoComplete="off"
        className="field !h-8 w-full max-w-[260px]"
        placeholder="Contraseña de la nota"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button
        type="submit"
        disabled={!password || busy}
        className="flex items-center gap-1.5 px-3 h-8 rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 text-[12.5px] disabled:opacity-50"
      >
        <LockOpen size={13} /> {busy ? "Verificando…" : "Desbloquear"}
      </button>
      {error && <p className="text-[12px] text-danger max-w-[260px]">{error}</p>}
      <p className="text-[11px] text-muted max-w-[260px]">
        El contenido se descifra solo en memoria mientras la nota está abierta. No se incluye en la búsqueda.
      </p>
    </form>
  );
}

interface SecurityProps {
  name: string;
  isProtected: boolean;
  autoLock: number;
  onAutoLock: (min: number) => void;
  onProtect: (password: string) => Promise<string | null>;
  onChange: (old: string, next: string) => Promise<string | null>;
  onUnprotect: () => Promise<string | null>;
  onLock: () => void;
  onClose: () => void;
}

/** Opciones de protección de la nota actual (proteger, cambiar contraseña, quitar, bloqueo). */
export function NoteSecurity(p: SecurityProps) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [c, setC] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const run = async (job: () => Promise<string | null>) => {
    setBusy(true);
    const err = await job();
    setBusy(false);
    setError(err ?? "");
    if (!err) {
      setA("");
      setB("");
      setC("");
    }
  };

  const pw = (value: string, set: (v: string) => void, placeholder: string, autoFocus = false) => (
    <input
      type="password"
      autoComplete="new-password"
      autoFocus={autoFocus}
      className="field !h-7 !text-[12px]"
      placeholder={placeholder}
      value={value}
      onChange={(e) => set(e.target.value)}
      onKeyDown={(e) => e.key === "Escape" && p.onClose()}
    />
  );

  const autoLock = (
    <label className="flex items-center gap-2 text-[11.5px] text-muted whitespace-nowrap min-w-0">
      Bloqueo por inactividad
      <select className="field !h-7 !w-auto min-w-0 !text-[12px]" value={p.autoLock} onChange={(e) => p.onAutoLock(Number(e.target.value))}>
        {AUTO_LOCK_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {m} min
          </option>
        ))}
      </select>
    </label>
  );

  if (!p.isProtected) {
    const mismatch = b.length > 0 && a !== b;
    const short = a.length > 0 && [...a].length < MIN_NOTE_PASSWORD;
    return (
      <form
        className="border-b border-line px-2 py-2 space-y-1.5 text-[12px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!short && !mismatch && a) run(() => p.onProtect(a));
        }}
      >
        <p className="font-medium">Proteger «{p.name}» con contraseña</p>
        {pw(a, setA, `Contraseña (mín. ${MIN_NOTE_PASSWORD} caracteres)`, true)}
        {pw(b, setB, "Repetir contraseña")}
        {autoLock}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy || !a || short || mismatch || a !== b}
            className="px-2.5 h-7 rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Cifrando…" : "Proteger"}
          </button>
          <span className="text-[11px] text-danger">{short ? "Contraseña muy corta" : mismatch ? "No coinciden" : error}</span>
        </div>
        <p className="text-[11px] text-muted">
          Se cifra en disco y se borra el archivo de texto. Sin la contraseña no hay forma de recuperarla. El nombre de la nota
          sigue visible: no pongas datos sensibles en él.
        </p>
      </form>
    );
  }

  const mismatch = c.length > 0 && b !== c;
  const short = b.length > 0 && [...b].length < MIN_NOTE_PASSWORD;
  return (
    <div className="border-b border-line px-2 py-2 space-y-2 text-[12px]">
      <div className="flex items-center gap-2">
        <button onClick={p.onLock} className="flex items-center gap-1.5 px-2.5 h-7 shrink-0 whitespace-nowrap rounded-md border border-line hover:bg-hover">
          <Lock size={12} /> Bloquear ahora
        </button>
        {autoLock}
      </div>
      <form
        className="space-y-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (a && b && !short && !mismatch && b === c) run(() => p.onChange(a, b));
        }}
      >
        <p className="font-medium">Cambiar contraseña</p>
        {pw(a, setA, "Contraseña actual")}
        {pw(b, setB, `Nueva (mín. ${MIN_NOTE_PASSWORD} caracteres)`)}
        {pw(c, setC, "Repetir nueva")}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy || !a || !b || short || b !== c}
            className="px-2.5 h-7 rounded-md border border-line hover:bg-hover disabled:opacity-50"
          >
            Cambiar
          </button>
          <span className="text-[11px] text-danger">{short ? "Contraseña muy corta" : mismatch ? "No coinciden" : error}</span>
        </div>
      </form>
      <div className="flex items-center gap-2 pt-1 border-t border-line">
        <button
          onClick={() => (confirmRemove ? run(p.onUnprotect) : setConfirmRemove(true))}
          onMouseLeave={() => setConfirmRemove(false)}
          disabled={busy}
          className={`px-2.5 h-7 mt-1.5 rounded-md border border-line hover:bg-hover ${confirmRemove ? "text-danger" : ""}`}
        >
          {confirmRemove ? "Clic para confirmar" : "Quitar protección"}
        </button>
        <span className="text-[11px] text-muted mt-1.5">Vuelve a guardarse como texto plano.</span>
      </div>
    </div>
  );
}
