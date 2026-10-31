import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { AlertTriangle, Check, ClipboardCopy, Download } from "lucide-react";
import { DEFAULT_INPUT, PLATFORMS, generate, platformInfo, type GenInput } from "../../lib/snmpconfig";
import { Btn, Label, Section, Toggle } from "./ui";

/**
 * Generador de configuración de agente SNMP de solo lectura. Todo vive en el estado del componente:
 * las contraseñas tecleadas nunca se guardan, no se registran y se pierden al cerrar la herramienta.
 */
export default function SnmpConfigGen() {
  const [inp, setInp] = useState<GenInput>(DEFAULT_INPUT);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (p: Partial<GenInput>) => setInp((c) => ({ ...c, ...p }));
  const info = platformInfo(inp.platform);
  const res = useMemo(() => generate(inp), [inp]);
  const err = (f: keyof GenInput) => res.errors.filter((e) => e.field === f).map((e) => e.msg).join(" ");
  const typed = !!(inp.authPass || inp.privPass || inp.community);
  const v3 = inp.version === "v3";

  const copy = async () => {
    await writeText(res.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  const download = async () => {
    setMsg("");
    const dest = await save({ defaultPath: info.filename });
    if (!dest) return;
    await invoke("save_text", { dest, content: res.text })
      .then(() => setMsg(`Guardado: ${dest}`))
      .catch((e) => setMsg(String(e)));
  };

  const field = (f: keyof GenInput, cls = "") => `field ${cls} ${err(f) ? "!border-danger" : ""}`;
  const Err = ({ f }: { f: keyof GenInput }) => (err(f) ? <p className="mt-1 text-[11.5px] text-danger">{err(f)}</p> : null);
  const pass = (f: "authPass" | "privPass" | "community", label: string, ph: string, disabled = false) => (
    <Label text={label}>
      <input
        className={field(f, "font-mono")}
        type="password"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={`${ph} (opcional)`}
        value={inp[f]}
        onChange={(e) => set({ [f]: e.target.value })}
      />
      <Err f={f} />
    </Label>
  );

  return (
    <div className="space-y-4">
      <Section title="Generador de configuración" hint="Configuración de agente SNMP de solo lectura para tus equipos. Se genera en este PC, no se envía a ningún lado.">
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(170px,100%),1fr))]">
          <Label text="Plataforma">
            <select className="field" value={inp.platform} onChange={(e) => set({ platform: e.target.value as GenInput["platform"] })}>
              {PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Versión">
            <select className="field" value={inp.version} onChange={(e) => set({ version: e.target.value as GenInput["version"] })}>
              <option value="v3">SNMPv3 authPriv (recomendado)</option>
              <option value="v2c">v2c solo lectura</option>
            </select>
          </Label>
          {v3 && (
            <>
              <Label text="Autenticación">
                <select className="field" value={inp.auth} onChange={(e) => set({ auth: e.target.value as GenInput["auth"] })}>
                  <option value="sha256">SHA-256 (RFC 7860)</option>
                  <option value="sha1">SHA-1 (heredado)</option>
                </select>
              </Label>
              <Label text="Privacidad">
                <select className="field" value={inp.priv} onChange={(e) => set({ priv: e.target.value as GenInput["priv"] })}>
                  <option value="aes128">AES-128 (RFC 3826)</option>
                  <option value="aes256" disabled={!info.aes256}>
                    AES-256{info.aes256 ? "" : " (no soportado)"}
                  </option>
                </select>
              </Label>
              <Label text="Usuario">
                <input className={field("user", "font-mono")} value={inp.user} autoComplete="off" onChange={(e) => set({ user: e.target.value })} />
                <Err f="user" />
              </Label>
            </>
          )}
          {(inp.platform === "ios" || inp.platform === "vrp" || inp.platform === "junos") && (
            <Label text="Grupo">
              <input className={field("group", "font-mono")} value={inp.group} onChange={(e) => set({ group: e.target.value })} />
              <Err f="group" />
            </Label>
          )}
          {info.views && (
            <Label text="Vista de lectura">
              <input className={field("view", "font-mono")} value={inp.view} onChange={(e) => set({ view: e.target.value })} />
              <Err f="view" />
            </Label>
          )}
          {(inp.platform === "ios" || inp.platform === "nxos" || inp.platform === "junos") && (
            <Label text={inp.platform === "junos" ? "Prefix-list" : "ACL"}>
              <input className={field("acl", "font-mono")} value={inp.acl} onChange={(e) => set({ acl: e.target.value })} />
              <Err f="acl" />
            </Label>
          )}
        </div>

        <div className="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))]">
          <Label text="NMS autorizados (IPv4 o CIDR)">
            <input className={field("nms", "font-mono")} value={inp.nms} placeholder="192.0.2.10, 198.51.100.0/24" onChange={(e) => set({ nms: e.target.value })} />
            <Err f="nms" />
          </Label>
          <Label text="Receptores de traps (opcional)">
            <input className={field("receivers", "font-mono")} value={inp.receivers} placeholder="192.0.2.20" onChange={(e) => set({ receivers: e.target.value })} />
            <Err f="receivers" />
          </Label>
          <Label text="Notificación">
            <select className="field" value={inp.notify} onChange={(e) => set({ notify: e.target.value as GenInput["notify"] })}>
              <option value="trap">Trap</option>
              <option value="inform">Inform (con confirmación)</option>
            </select>
          </Label>
          <Label text={info.sourceLabel}>
            <input className={field("source", "font-mono")} value={inp.source} placeholder={info.sourcePlaceholder} onChange={(e) => set({ source: e.target.value })} />
            <Err f="source" />
          </Label>
          <Label text="sysContact">
            <input className={field("contact")} value={inp.contact} placeholder="noc@empresa.cl" onChange={(e) => set({ contact: e.target.value })} />
            <Err f="contact" />
          </Label>
          <Label text="sysLocation">
            <input className={field("location")} value={inp.location} placeholder="Santiago DC1 Rack 12" onChange={(e) => set({ location: e.target.value })} />
            <Err f="location" />
          </Label>
        </div>

        <div className="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))]">
          {v3 ? (
            <>
              {pass("authPass", "Contraseña auth", "<AUTH_PASS>", inp.platform === "vrp")}
              {pass("privPass", "Contraseña priv", "<PRIV_PASS>", inp.platform === "vrp")}
            </>
          ) : (
            pass("community", "Community", "<COMMUNITY>")
          )}
        </div>
        <p className="mt-2 text-[11.5px] text-muted">
          {inp.platform === "vrp" && v3
            ? "En Huawei VRP el equipo pide las contraseñas de forma interactiva, por eso no se escriben en el texto."
            : "Si dejas los secretos vacíos se usan marcadores. Lo que escribas queda solo en esta pantalla: no se guarda ni se registra."}
        </p>
        {inp.platform === "netsnmp" && (
          <div className="mt-3">
            <Toggle checked={inp.extend} onChange={(x) => set({ extend: x })} label="Incluir ejemplo de extend" />
          </div>
        )}

        {res.warnings.length > 0 && (
          <ul className="mt-3 space-y-1">
            {res.warnings.map((w) => (
              <li key={w} className="flex items-start gap-1.5 text-[12px] text-warn">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Configuración generada"
        hint="Solo lectura: nunca incluye communities RW ni acceso SET. Revísala antes de aplicarla."
        right={
          <div className="flex items-center gap-1">
            <Btn kind="ghost" disabled={!res.text} onClick={copy} title="Copiar al portapapeles">
              {copied ? <Check size={13} className="text-ok" /> : <ClipboardCopy size={13} />} Copiar
            </Btn>
            <Btn kind="ghost" disabled={!res.text} onClick={download}>
              <Download size={13} /> Descargar
            </Btn>
          </div>
        }
      >
        {typed && res.text && (
          <p className="mb-2 flex items-center gap-1.5 text-[12px] text-warn">
            <AlertTriangle size={13} /> El texto incluye los secretos que escribiste. Si lo descargas, el archivo los guarda en texto claro.
          </p>
        )}
        {res.text ? (
          <pre className="max-h-[480px] overflow-auto rounded-lg bg-hover p-3 font-mono text-[11.5px] leading-[1.5] whitespace-pre select-text">{res.text}</pre>
        ) : (
          <p className="text-[12px] text-muted">Corrige los campos marcados para generar la configuración.</p>
        )}
        {msg && <p className="mt-2 text-[12px] text-muted">{msg}</p>}
        <p className="mt-3 text-[11.5px] text-muted">
          Fuentes: RFC 3414 (USM), RFC 3415 (VACM), RFC 3826 (AES-128), RFC 7860 (SHA-2), página man snmpd.conf(5) de net-snmp, y guías de configuración SNMP de Cisco IOS XE, Cisco NX-OS, Huawei VRP, Juniper Junos y Fortinet FortiOS. Donde la sintaxis depende de la versión, el texto lo indica en un comentario.
        </p>
      </Section>
    </div>
  );
}
