import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy, FileKey, KeyRound, Trash2 } from "lucide-react";

interface KeyInfo {
  name: string;
  /** Ruta relativa para identity_file ("keys/<nombre>"). */
  path: string;
}

interface Props {
  value: string;
  onChange: (path: string) => void;
}

const btn =
  "inline-flex items-center gap-1.5 px-2.5 h-9 sm:h-8 rounded-lg sm:rounded-md border border-line hover:bg-hover text-[12.5px] touch-manipulation disabled:opacity-50";

/**
 * Llave privada en iOS: no hay ~/.ssh y la carpeta de datos no se ve en Archivos, así que la llave
 * se importa con el selector de documentos (el backend la copia a keys/ con permisos 0600) o se
 * genera en la app. La sesión guarda la ruta relativa "keys/<nombre>".
 */
export function IosKeyField({ value, onChange }: Props) {
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  // Borrar pide un segundo toque (los confirm() del navegador no se muestran en WKWebView).
  const [confirmDel, setConfirmDel] = useState(false);

  const reload = () =>
    invoke<KeyInfo[]>("ssh_key_list")
      .then(setKeys)
      .catch(() => setKeys([]));

  useEffect(() => {
    reload();
  }, []);
  useEffect(() => setConfirmDel(false), [value]);

  const selected = keys.find((k) => k.path === value);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ text: String(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  const importKey = () =>
    run(async () => {
      // Sin filtros: las llaves no suelen tener extensión y el selector mostraría todo deshabilitado.
      const picked = await open({ multiple: false, directory: false, title: "Llave privada SSH" });
      if (typeof picked !== "string") return;
      const path = await invoke<string>("ssh_key_import", { path: picked });
      await reload();
      onChange(path);
      setMsg({ text: `Llave importada como ${path}` });
    });

  const generate = () =>
    run(async () => {
      const g = await invoke<{ path: string; public: string }>("ssh_key_generate", { name: "id_ed25519" });
      await reload();
      onChange(g.path);
      await writeText(g.public);
      setMsg({ text: "Llave ed25519 creada. La pública se copió al portapapeles: agrégala a authorized_keys del equipo." });
    });

  const copyPublic = () =>
    run(async () => {
      const pub = await invoke<string>("ssh_key_public", { name: value });
      await writeText(pub);
      setMsg({ text: "Llave pública copiada al portapapeles." });
    });

  const remove = () => {
    if (!confirmDel) {
      setConfirmDel(true);
      return;
    }
    run(async () => {
      await invoke("ssh_key_delete", { name: value });
      await reload();
      onChange("");
      setMsg({ text: "Llave borrada." });
    });
  };

  return (
    <div className="block min-w-0 space-y-2">
      <span className="block mb-1 text-[11.5px] font-medium text-muted">Llave privada (opcional)</span>
      <select className="field" value={selected ? value : ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">{keys.length ? "Sin llave (contraseña)" : "Importa una llave"}</option>
        {keys.map((k) => (
          <option key={k.path} value={k.path}>
            {k.name}
          </option>
        ))}
        {/* Ruta que no es una llave importada (sesión creada en otro equipo): se muestra tal cual. */}
        {value && !selected && <option value={value}>{value} (no encontrada)</option>}
      </select>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={busy} onClick={importKey}>
          <FileKey size={14} /> Importar llave…
        </button>
        <button type="button" className={btn} disabled={busy} onClick={generate}>
          <KeyRound size={14} /> Generar ed25519
        </button>
        {selected && (
          <>
            <button type="button" className={btn} disabled={busy} onClick={copyPublic}>
              <Copy size={14} /> Copiar pública
            </button>
            <button
              type="button"
              className={`${btn} ${confirmDel ? "text-red-500 border-red-500/60" : ""}`}
              disabled={busy}
              onClick={remove}
            >
              <Trash2 size={14} /> {confirmDel ? "¿Borrar?" : "Borrar"}
            </button>
          </>
        )}
      </div>
      {msg && <p className={`text-[11.5px] ${msg.error ? "text-red-500" : "text-muted"}`}>{msg.text}</p>}
    </div>
  );
}
