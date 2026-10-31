import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, Code2, FolderOpen, FolderInput, Package, Play, RefreshCw, Trash2 } from "lucide-react";
import { Btn, Console, Section, Toggle } from "./ui";

interface Action {
  id: string;
  label: string;
  description?: string;
}

interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  permissions: string[];
  actions: Action[];
  enabled: boolean;
  tampered: boolean;
}

interface Preview {
  staging: string;
  manifest: Omit<Plugin, "enabled" | "tampered"> & { entry: string };
  files: [string, number][];
  code: string;
  replaces: string | null;
}

const PERM_TEXT: Record<string, string> = {
  session: "Leer y enviar comandos a la sesión conectada",
  network: "Conectarse a la red por su cuenta",
  files: "Leer o escribir archivos en tu equipo",
  "vault-type": "Pedir que la app escriba la contraseña guardada de la sesión en su pedido de login (el plugin no la ve; se aprueba en cada ejecución)",
};

export function PluginsTool({
  connId,
  onConfirm,
}: {
  /** Conexión activa (para acciones con permiso "session"). */
  connId: () => string | null;
  onConfirm: (req: { title: string; message: string; label: string; danger?: boolean; action: () => void }) => void;
}) {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [code, setCode] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState("");
  const [output, setOutput] = useState<string[]>([]);
  const runs = useRef(new Set<string>());
  // Plugins con "vault-type" a los que el usuario permitió escribir la contraseña guardada en la
  // próxima ejecución. Se desmarca al ejecutar: la aprobación es por ejecución.
  const [vaultOk, setVaultOk] = useState<Set<string>>(new Set());
  // Intérprete que usan scripts y plugins; "Volver a detectar" evita reiniciar tras instalarlo.
  const [py, setPy] = useState<{ ok: boolean; text: string } | null>(null);
  const checkPython = useCallback((again: boolean) => {
    setPy(null);
    invoke<string>(again ? "python_redetect" : "python_status")
      .then((text) => setPy({ ok: true, text }))
      .catch((e) => setPy({ ok: false, text: String(e) }));
  }, []);
  useEffect(() => checkPython(false), [checkPython]);

  const load = useCallback(() => invoke<Plugin[]>("plugins_list").then(setPlugins), []);

  useEffect(() => {
    load();
    const un = listen<{ run: string; script: string; kind: string; message: string }>("script-event", ({ payload }) => {
      if (runs.current.has(payload.run)) setOutput((o) => [...o.slice(-500), `[${payload.script}] ${payload.message}`]);
    });
    return () => {
      un.then((f) => f());
    };
  }, [load]);

  const install = async (directory: boolean) => {
    setError("");
    const path = await open({
      directory,
      multiple: false,
      title: directory ? "Carpeta del plugin" : "Plugin (.zip)",
      filters: directory ? undefined : [{ name: "Plugin", extensions: ["zip"] }],
    });
    if (typeof path !== "string") return;
    try {
      setPreview(await invoke<Preview>("plugin_stage", { path }));
    } catch (e) {
      setError(String(e));
    }
  };

  const confirmInstall = async () => {
    if (!preview) return;
    try {
      await invoke("plugin_confirm", { staging: preview.staging });
      setPreview(null);
      load();
    } catch (e) {
      setError(String(e));
    }
  };

  const run = async (p: Plugin, a: Action) => {
    setError("");
    const needsSession = p.permissions.includes("session");
    const conn = needsSession ? connId() : null;
    if (needsSession && !conn) return setError(`${p.name} necesita una sesión conectada en la pestaña activa.`);
    const vaultType = p.permissions.includes("vault-type") && vaultOk.has(p.id);
    setVaultOk((s) => {
      const n = new Set(s);
      n.delete(p.id);
      return n;
    });
    try {
      const id = await invoke<string>("plugin_run", { id: p.id, action: a.id, conn, vaultType });
      runs.current.add(id);
      setOutput((o) => [...o, `▶ ${p.name} · ${a.label}`]);
    } catch (e) {
      setError(String(e));
      load();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-muted">
          Un plugin es una carpeta con <code>plugin.json</code> y un script Python que usa la API <code>netterminal</code>.
          Antes de activarlo revisas sus permisos y su código; si sus archivos cambian después, se bloquea hasta que lo
          vuelvas a aprobar.
        </p>
        <div className="flex gap-1.5 shrink-0">
          <Btn onClick={() => install(false)}>
            <Package size={14} /> Instalar .zip
          </Btn>
          <Btn onClick={() => install(true)}>
            <FolderInput size={14} /> Desde carpeta
          </Btn>
          <Btn kind="ghost" title="Abrir carpeta de plugins" onClick={() => invoke("open_dir", { which: "plugins" })}>
            <FolderOpen size={14} />
          </Btn>
        </div>
      </div>
      <div className="flex items-center gap-2 text-[12px]">
        <span className={py && !py.ok ? "text-danger" : "text-muted"}>
          Python: {py ? py.text : "buscando…"}
        </span>
        <Btn kind="ghost" title="Volver a detectar Python" disabled={!py} onClick={() => checkPython(true)}>
          <RefreshCw size={13} /> Volver a detectar
        </Btn>
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}

      {preview && (
        <Section title={`Revisar antes de instalar: ${preview.manifest.name} ${preview.manifest.version}`} hint={preview.manifest.author ? `Autor declarado: ${preview.manifest.author}` : "Sin autor declarado"}>
          {preview.replaces && (
            <p className="mb-2 text-[12px] text-warn">▲ Reemplazará la versión instalada de este plugin.</p>
          )}
          <p className="text-[12.5px] mb-2">{preview.manifest.description}</p>
          <div className="mb-3">
            <div className="text-[11.5px] font-medium text-muted mb-1">Permisos solicitados</div>
            {preview.manifest.permissions.length === 0 ? (
              <p className="text-[12px]">Ninguno (solo muestra mensajes)</p>
            ) : (
              <ul className="text-[12px] space-y-0.5">
                {preview.manifest.permissions.map((p) => (
                  <li key={p}>
                    <span className="font-mono">{p}</span> · {PERM_TEXT[p]}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="text-[11.5px] font-medium text-muted mb-1">
            Código Python del plugin · {preview.files.length} archivos
          </div>
          <pre className="max-h-64 overflow-auto rounded-lg bg-hover p-3 font-mono text-[11.5px] select-text">{preview.code}</pre>
          <p className="mt-2 text-[11.5px] text-muted flex gap-1.5">
            <AlertTriangle size={13} className="shrink-0 text-warn" />
            Los permisos son una declaración: el script corre con tus privilegios de usuario. Instala solo plugins de origen
            confiable y que entiendas.
          </p>
          <div className="flex justify-end gap-2 mt-3">
            <Btn
              onClick={() => {
                invoke("plugin_cancel", { staging: preview.staging });
                setPreview(null);
              }}
            >
              Cancelar
            </Btn>
            <Btn kind="primary" onClick={confirmInstall}>
              Instalar y habilitar
            </Btn>
          </div>
        </Section>
      )}

      {plugins.length === 0 && !preview && (
        <div className="rounded-xl border border-dashed border-line p-8 text-center text-[12.5px] text-muted">
          No hay plugins instalados. El repositorio incluye un ejemplo en <code>plugins/ejemplo-inventario</code>.
        </div>
      )}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(360px,1fr))]">
        {plugins.map((p) => (
          <Section
            key={p.id}
            title={`${p.name} ${p.version}`}
            hint={p.author || undefined}
            right={
              <div className="flex items-center gap-1">
                <Toggle
                  checked={p.enabled}
                  label=""
                  onChange={async (v) => {
                    // Un plugin alterado no se reaprueba con un clic: primero se muestra su código.
                    if (v && p.tampered) {
                      const text = await invoke<string>("plugin_code", { id: p.id }).catch((e) => String(e));
                      setCode({ id: p.id, text });
                      return;
                    }
                    await invoke("plugin_set_enabled", { id: p.id, enabled: v }).catch((e) => setError(String(e)));
                    load();
                  }}
                />
                <Btn
                  kind="ghost"
                  className="!px-1.5"
                  title="Ver código"
                  onClick={async () =>
                    setCode(
                      code?.id === p.id
                        ? null
                        : { id: p.id, text: await invoke<string>("plugin_code", { id: p.id }).catch((e) => String(e)) },
                    )
                  }
                >
                  <Code2 size={14} />
                </Btn>
                <Btn
                  kind="ghost"
                  className="!px-1.5 hover:!text-danger"
                  title="Desinstalar"
                  onClick={() =>
                    onConfirm({
                      title: `¿Desinstalar ${p.name}?`,
                      message: "Se eliminarán sus archivos de la carpeta de plugins.",
                      label: "Desinstalar",
                      danger: true,
                      action: () => invoke("plugin_uninstall", { id: p.id }).then(load),
                    })
                  }
                >
                  <Trash2 size={13} />
                </Btn>
              </div>
            }
          >
            {p.tampered && (
              <div className="mb-2 text-[12px] text-danger space-y-1.5">
                <p>✕ Sus archivos cambiaron desde que lo aprobaste. Revisa el código y apruébalo solo si reconoces el cambio.</p>
                {code?.id === p.id ? (
                  <Btn
                    kind="danger"
                    onClick={async () => {
                      await invoke("plugin_set_enabled", { id: p.id, enabled: true }).catch((e) => setError(String(e)));
                      setCode(null);
                      load();
                    }}
                  >
                    Aprobar estos cambios y habilitar
                  </Btn>
                ) : (
                  <Btn
                    onClick={async () =>
                      setCode({ id: p.id, text: await invoke<string>("plugin_code", { id: p.id }).catch((e) => String(e)) })
                    }
                  >
                    Revisar código
                  </Btn>
                )}
              </div>
            )}
            <p className="text-[12.5px] mb-2">{p.description}</p>
            <div className="flex flex-wrap gap-1 mb-3">
              {p.permissions.map((perm) => (
                <span key={perm} title={PERM_TEXT[perm]} className="px-1.5 h-5 inline-flex items-center rounded border border-line text-[11px] font-mono">
                  {perm}
                </span>
              ))}
            </div>
            {p.permissions.includes("vault-type") && (
              <label className="mb-2 flex items-start gap-2 text-[12px] cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--accent)]"
                  checked={vaultOk.has(p.id)}
                  disabled={!p.enabled}
                  onChange={(e) =>
                    setVaultOk((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(p.id);
                      else n.delete(p.id);
                      return n;
                    })
                  }
                />
                <span>
                  Permitir que el script escriba contraseñas guardadas en: la sesión de la pestaña activa
                  <span className="block text-muted">Solo para la próxima ejecución; el plugin nunca ve la contraseña.</span>
                </span>
              </label>
            )}
            <div className="flex flex-wrap gap-1.5">
              {p.actions.map((a) => (
                <Btn key={a.id} disabled={!p.enabled} title={a.description} onClick={() => run(p, a)}>
                  <Play size={12} /> {a.label}
                </Btn>
              ))}
            </div>
            {code?.id === p.id && (
              <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-hover p-3 font-mono text-[11.5px] select-text">{code.text}</pre>
            )}
          </Section>
        ))}
      </div>

      {output.length > 0 && (
        <Section title="Salida de plugins" right={<Btn kind="ghost" onClick={() => setOutput([])}>Limpiar</Btn>}>
          <Console lines={output} height={180} />
        </Section>
      )}
    </div>
  );
}
