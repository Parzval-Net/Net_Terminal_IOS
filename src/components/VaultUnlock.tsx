import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LockKeyhole } from "lucide-react";

/** Campo para desbloquear la bóveda con la contraseña maestra. */
export function VaultUnlock({ onUnlocked, autoFocus }: { onUnlocked: () => void; autoFocus?: boolean }) {
  const [master, setMaster] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const unlock = async () => {
    if (!master || busy) return;
    setBusy(true);
    setError("");
    try {
      await invoke("vault_unlock", { master });
      setMaster("");
      onUnlocked();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex gap-1.5">
        <input
          type="password"
          className="field flex-1"
          autoFocus={autoFocus}
          autoComplete="off"
          placeholder="Contraseña maestra"
          value={master}
          onChange={(e) => setMaster(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              unlock();
            }
          }}
        />
        <button
          type="button"
          disabled={!master || busy}
          onClick={unlock}
          className="flex items-center gap-1.5 px-3 h-8 rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-50"
        >
          <LockKeyhole size={13} />
          {busy ? "Verificando…" : "Desbloquear"}
        </button>
      </div>
      {error && <p className="text-[11.5px] text-danger">{error}</p>}
    </div>
  );
}
