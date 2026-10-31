import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { Settings, newToken } from "../lib/settings";

interface Props {
  settings: Settings;
  status: string;
  onChange: (patch: Partial<Settings>) => void;
}

export function AiSettings({ settings: s, status, onChange }: Props) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState("");
  const url = `http://127.0.0.1:${s.mcpPort}/mcp`;
  const token = s.mcpToken || "TOKEN";

  const copy = async (key: string, text: string) => {
    await writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 2000);
  };

  const clients: [string, string, string][] = [
    [
      "Claude Code",
      "Terminal",
      `claude mcp add --transport http --scope user --header "Authorization: Bearer ${token}" netterminal ${url}`,
    ],
    [
      "Gemini CLI",
      "~/.gemini/settings.json",
      JSON.stringify(
        { mcpServers: { netterminal: { httpUrl: url, headers: { Authorization: `Bearer ${token}` } } } },
        null,
        2,
      ),
    ],
    [
      "Codex (OpenAI)",
      "~/.codex/config.toml  +  variable NETTERMINAL_TOKEN",
      `[mcp_servers.netterminal]\nurl = "${url}"\nbearer_token_env_var = "NETTERMINAL_TOKEN"\n\n# En tu shell:\n# export NETTERMINAL_TOKEN=${token}`,
    ],
    [
      "Claude Desktop",
      "claude_desktop_config.json (requiere Node.js)",
      JSON.stringify(
        {
          mcpServers: {
            netterminal: {
              command: "npx",
              args: ["-y", "mcp-remote", url, "--header", `Authorization: Bearer ${token}`],
            },
          },
        },
        null,
        2,
      ),
    ],
    [
      "Otra aplicación (API HTTP)",
      "JSON-RPC 2.0 por POST: tools/list y tools/call; send_command pide aprobación en NetTerminal",
      `# Conexiones abiertas (id de cada pestaña)\ncurl -s ${url} -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_connections","arguments":{}}}'\n\n# Ejecutar un comando (el usuario lo aprueba en la app)\ncurl -s ${url} -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"send_command","arguments":{"connection_id":"ID","command":"show clock","wait_seconds":10}}}'`,
    ],
  ];

  return (
    <>
      <p className="text-[12px] text-muted">
        Expone NetTerminal como servidor MCP local para que un agente de IA liste sesiones, lea la salida de la
        terminal y proponga comandos. Solo escucha en 127.0.0.1 y requiere token.
      </p>

      <Row label="Activar servidor MCP" hint={s.mcpEnabled ? status : "Apagado"}>
        <Switch
          checked={s.mcpEnabled}
          onChange={(v) => onChange(v && !s.mcpToken ? { mcpEnabled: v, mcpToken: newToken() } : { mcpEnabled: v })}
        />
      </Row>

      <Row label="Aprobar cada comando" hint="En la terminal local siempre se pide aprobación">
        <Switch checked={s.mcpApproval} onChange={(v) => onChange({ mcpApproval: v })} />
      </Row>
      {!s.mcpApproval && (
        <p className="-mt-2 text-[11.5px] text-danger">
          Sin aprobación, el agente puede ejecutar comandos en equipos remotos sin que lo veas antes. Úsalo solo en
          laboratorio.
        </p>
      )}

      <Row label="Solo lectura" hint="El agente puede listar y leer, pero no enviar comandos ni abrir sesiones">
        <Switch checked={s.mcpReadOnly} onChange={(v) => onChange({ mcpReadOnly: v })} />
      </Row>

      <Row label="Puerto">
        <input
          type="number"
          min={1024}
          max={65535}
          className="field !w-28"
          value={s.mcpPort}
          onChange={(e) => onChange({ mcpPort: Number(e.target.value) || 47821 })}
        />
      </Row>

      <div>
        <div className="mb-1.5 text-[12px] font-medium text-muted">Token</div>
        <div className="flex gap-1.5">
          <input
            readOnly
            className="field font-mono !text-[12px] flex-1"
            type={show ? "text" : "password"}
            value={s.mcpToken}
            placeholder="Se genera al activar"
          />
          <IconBtn title={show ? "Ocultar" : "Mostrar"} onClick={() => setShow(!show)}>
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </IconBtn>
          <IconBtn title="Copiar token" onClick={() => copy("token", s.mcpToken)} disabled={!s.mcpToken}>
            <Copy size={14} />
          </IconBtn>
          <IconBtn title="Generar nuevo (invalida el anterior)" onClick={() => onChange({ mcpToken: newToken() })}>
            <RefreshCw size={14} />
          </IconBtn>
        </div>
        {copied === "token" && <p className="mt-1 text-[11.5px] text-accent">Token copiado</p>}
      </div>

      <div>
        <div className="mb-1.5 text-[12px] font-medium text-muted">Configurar tu agente</div>
        <div className="space-y-2">
          {clients.map(([name, where, snippet]) => (
            <details key={name} className="rounded-lg border border-line group">
              <summary className="flex items-center justify-between px-3 h-9 cursor-default list-none">
                <span>
                  {name} <span className="text-[11.5px] text-muted">· {where}</span>
                </span>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    copy(name, snippet);
                  }}
                  className="flex items-center gap-1 px-2 h-6 rounded text-[11.5px] text-muted hover:text-fg hover:bg-hover"
                >
                  <Copy size={12} /> {copied === name ? "Copiado" : "Copiar"}
                </button>
              </summary>
              <pre className="mx-3 mb-3 p-2.5 rounded-md bg-hover font-mono text-[11px] whitespace-pre-wrap break-all select-text">
                {show ? snippet : snippet.split(token).join("••••••••")}
              </pre>
            </details>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-muted">
          ChatGPT de escritorio no se conecta a servidores MCP locales; para OpenAI usa Codex. Trata el token como una
          contraseña: no lo compartas ni lo subas a repositorios.
        </p>
      </div>
    </>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 min-h-8">
      <div className="min-w-0">
        <div>{label}</div>
        {hint && <div className="text-[11.5px] text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors before:absolute before:-inset-[3px] before:content-[''] ${checked ? "bg-accent" : "bg-line"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

function IconBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="w-8 h-[30px] shrink-0 grid place-items-center rounded-md border border-line text-muted hover:text-fg hover:bg-hover disabled:opacity-40"
    />
  );
}
