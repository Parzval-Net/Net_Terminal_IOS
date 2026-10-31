import { useMemo, useState } from "react";
import type { ITheme } from "@xterm/xterm";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ClipboardCopy, ClipboardPaste, Copy, Plus, Trash2 } from "lucide-react";
import { Settings } from "../lib/settings";
import {
  COLOR_NAMES,
  HlRule,
  HlStyle,
  colorLabel,
  compile,
  cssColor,
  effectiveRules,
  regexError,
  riskyRegex,
  runs,
  schemes,
} from "../lib/highlight";
import { fontStack } from "../lib/theme";

import { plural } from "../lib/plural";
interface Props {
  settings: Settings;
  theme: ITheme;
  onChange: (patch: Partial<Settings>) => void;
}

const SAMPLE = `Core-SCL#show ip interface brief
Interface              IP-Address      OK? Method Status                Protocol
GigabitEthernet0/0/0   10.10.0.1       YES NVRAM  up                    up
GigabitEthernet0/0/2   unassigned      YES unset  administratively down down
Te1/0/1                10.20.1.1       YES manual up                    down
Gi1/0/1   uplink      connected    1     a-full  a-1000
Gi1/0/2   user        notconnect   10    auto    auto
Gi1/0/3   loop        err-disabled 10    auto    auto
*Oct 13 12:30:45: %LINK-3-UPDOWN: Interface Gi0/0/2, changed state to down
     0 input errors, 12 CRC, 0 frame, 3 overrun
interface Port-channel10
 description Uplink a PE-ANF
 no shutdown
access-list 10 permit 10.0.0.0 0.0.0.255
noc@mx01> show bgp summary
192.168.255.2   65001   Established   fe80::1   00:1a:2b:3c:4d:5e
set interfaces xe-0/1/0 description "to core"
<HUAWEI>display interface brief
[HUAWEI-GigabitEthernet0/0/1] undo shutdown`;

const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function HighlightSettings({ settings: s, theme, onChange }: Props) {
  const [sample, setSample] = useState(SAMPLE);
  const [editSample, setEditSample] = useState(false);
  const [notice, setNotice] = useState("");

  const rules = s.customRules;
  const setRules = (customRules: HlRule[]) => onChange({ customRules });
  const updateRule = (id: string, patch: Partial<HlRule>) =>
    setRules(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const updateStyle = (id: string, patch: Partial<HlStyle>) =>
    setRules(rules.map((r) => (r.id === id ? { ...r, style: { ...r.style, ...patch } } : r)));

  const toggleScheme = (id: string) =>
    onChange({
      highlightSchemes: s.highlightSchemes.includes(id)
        ? s.highlightSchemes.filter((x) => x !== id)
        : [...s.highlightSchemes, id],
    });

  const customize = (schemeId: string) => {
    const sc = schemes.find((x) => x.id === schemeId);
    if (!sc) return;
    setRules([...rules, ...sc.rules.map((r) => ({ ...r, id: newId(), name: `${sc.name}: ${r.name}` }))]);
    flash(`Reglas de ${sc.name} copiadas abajo: edítalas y tendrán prioridad`);
  };

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(""), 3500);
  };

  const exportRules = async () => {
    await writeText(JSON.stringify(rules, null, 2));
    flash(`${plural(rules.length, "regla copiada", "reglas copiadas")} al portapapeles`);
  };

  const importRules = async () => {
    try {
      const data = JSON.parse(await readText());
      const list = (Array.isArray(data) ? data : [data]).filter(
        (r): r is HlRule =>
          r && typeof r.pattern === "string" && typeof r.style === "object" && !riskyRegex(r.pattern),
      );
      if (!list.length) throw new Error();
      setRules([...rules, ...list.map((r) => ({ ...r, id: newId(), name: r.name || r.pattern }))]);
      flash(`${plural(list.length, "regla importada", "reglas importadas")}`);
    } catch {
      flash("El portapapeles no contiene reglas válidas (JSON)");
    }
  };

  const compiled = useMemo(
    () =>
      compile(
        effectiveRules({ enabled: s.highlightEnabled, schemes: s.highlightSchemes, custom: rules }),
        theme,
      ),
    [s.highlightEnabled, s.highlightSchemes, rules, theme],
  );

  return (
    <>
      <Row label="Resaltar salida de la terminal" hint="Aplica a sesiones SSH, Telnet y Serial">
        <Switch checked={s.highlightEnabled} onChange={(v) => onChange({ highlightEnabled: v })} />
      </Row>

      <div>
        <Label>Esquemas por defecto</Label>
        <div className="rounded-lg border border-line divide-y divide-[var(--border)]">
          {schemes.map((sc) => (
            <div key={sc.id} className="flex items-center gap-3 px-3 py-2">
              <input
                type="checkbox"
                className="accent-[var(--accent)]"
                checked={s.highlightSchemes.includes(sc.id)}
                onChange={() => toggleScheme(sc.id)}
              />
              <div className="min-w-0 flex-1">
                <div>{sc.name}</div>
                <div className="text-[11.5px] text-muted truncate">{sc.description}</div>
              </div>
              <button
                onClick={() => customize(sc.id)}
                title="Copiar estas reglas a personalizadas para cambiar colores"
                className="flex items-center gap-1 px-2 h-6 rounded text-[11.5px] text-muted hover:text-fg hover:bg-hover shrink-0"
              >
                <Copy size={12} />
                Personalizar
              </button>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[11.5px] text-muted">
          Cada sesión puede fijar su fabricante en Editar sesión. Prioridad: reglas propias, fabricante, comunes.
        </p>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-1 mb-2">
          <Label inline>Vista previa</Label>
          <button onClick={() => setEditSample((v) => !v)} className="text-[11.5px] text-accent hover:underline">
            {editSample ? "Listo" : "Probar con mi salida"}
          </button>
        </div>
        {editSample && (
          <textarea
            className="field !h-28 py-2 mb-2 font-mono text-[11.5px] resize-y"
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            spellCheck={false}
          />
        )}
        <Preview text={sample} compiled={compiled} theme={theme} font={s.fontFamily} />
        <Legend theme={theme} />
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-1 mb-2">
          <Label inline>Reglas personalizadas</Label>
          <div className="flex flex-wrap items-center gap-1">
            <SmallBtn onClick={importRules} title="Importar reglas JSON desde el portapapeles">
              <ClipboardPaste size={12} /> Importar
            </SmallBtn>
            <SmallBtn onClick={exportRules} disabled={!rules.length} title="Copiar reglas como JSON">
              <ClipboardCopy size={12} /> Exportar
            </SmallBtn>
            <SmallBtn
              onClick={() =>
                setRules([
                  ...rules,
                  { id: newId(), name: "Nueva regla", pattern: "", style: { color: "brightYellow", bold: true } },
                ])
              }
            >
              <Plus size={12} /> Agregar
            </SmallBtn>
          </div>
        </div>
        {notice && <p className="mb-2 text-[11.5px] text-accent">{notice}</p>}

        {rules.length === 0 && (
          <p className="text-[12px] text-muted rounded-lg border border-dashed border-line px-3 py-4 text-center">
            Agrega reglas para destacar hostnames, clientes, VLANs críticas o palabras propias de tu red.
          </p>
        )}

        <div className="space-y-2">
          {rules.map((rule) => {
            const err = rule.pattern ? (regexError(rule.pattern) ?? riskyRegex(rule.pattern)) : null;
            const custom = rule.style.color?.startsWith("#");
            return (
              <div key={rule.id} className="rounded-lg border border-line p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    title="Activa"
                    className="accent-[var(--accent)]"
                    checked={rule.enabled !== false}
                    onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })}
                  />
                  <input
                    className="field !h-7 flex-1 min-w-0"
                    value={rule.name}
                    placeholder="Nombre"
                    onChange={(e) => updateRule(rule.id, { name: e.target.value })}
                  />
                  <button
                    title="Eliminar regla"
                    onClick={() => setRules(rules.filter((r) => r.id !== rule.id))}
                    className="w-7 h-7 grid place-items-center rounded-md text-muted hover:text-danger hover:bg-hover shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <input
                  className={`field !h-7 font-mono !text-[12px] ${err ? "!border-danger" : ""}`}
                  value={rule.pattern}
                  placeholder={String.raw`Expresión regular, ej: \bVLAN\s?(?:100|200)\b`}
                  spellCheck={false}
                  onChange={(e) => updateRule(rule.id, { pattern: e.target.value })}
                />
                {err && <p className="text-[11px] text-danger">{err}</p>}
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    className="field !h-7 flex-1 sm:flex-initial sm:!w-36 !text-[12px] min-w-[110px]"
                    value={custom ? "custom" : (rule.style.color ?? "")}
                    onChange={(e) =>
                      updateStyle(rule.id, {
                        color: e.target.value === "custom" ? "#ff8800" : e.target.value || undefined,
                      })
                    }
                  >
                    <option value="">Sin color</option>
                    {COLOR_NAMES.map((c) => (
                      <option key={c} value={c}>
                        {colorLabel[c]}
                      </option>
                    ))}
                    <option value="custom">Personalizado…</option>
                  </select>
                  {custom && (
                    <input
                      type="color"
                      className="w-7 h-7 rounded border border-line bg-transparent shrink-0"
                      value={rule.style.color}
                      onChange={(e) => updateStyle(rule.id, { color: e.target.value })}
                    />
                  )}
                  <select
                    title="Fondo"
                    className="field !h-7 flex-1 sm:flex-initial sm:!w-32 !text-[12px] min-w-[110px]"
                    value={rule.style.bg ?? ""}
                    onChange={(e) => updateStyle(rule.id, { bg: e.target.value || undefined })}
                  >
                    <option value="">Sin fondo</option>
                    {COLOR_NAMES.map((c) => (
                      <option key={c} value={c}>
                        Fondo {colorLabel[c].toLowerCase()}
                      </option>
                    ))}
                  </select>
                  <Toggle on={!!rule.style.bold} onClick={() => updateStyle(rule.id, { bold: !rule.style.bold })} title="Negrita">
                    <b>B</b>
                  </Toggle>
                  <Toggle on={!!rule.style.italic} onClick={() => updateStyle(rule.id, { italic: !rule.style.italic })} title="Cursiva">
                    <i>I</i>
                  </Toggle>
                  <Toggle
                    on={!!rule.style.underline}
                    onClick={() => updateStyle(rule.id, { underline: !rule.style.underline })}
                    title="Subrayado"
                  >
                    <u>U</u>
                  </Toggle>
                  <Toggle
                    on={!!rule.ignoreCase}
                    onClick={() => updateRule(rule.id, { ignoreCase: !rule.ignoreCase })}
                    title="Ignorar mayúsculas"
                  >
                    Aa
                  </Toggle>
                  <label className="flex items-center gap-1 text-[11.5px] text-muted" title="Colorear solo un grupo de captura">
                    Grupo
                    <input
                      type="number"
                      min={0}
                      max={9}
                      className="field !h-7 !w-12 !px-1.5 !text-[12px]"
                      value={rule.group ?? 0}
                      onChange={(e) => updateRule(rule.id, { group: Number(e.target.value) || 0 })}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function Preview({
  text,
  compiled,
  theme,
  font,
}: {
  text: string;
  compiled: ReturnType<typeof compile>;
  theme: ITheme;
  font: string;
}) {
  return (
    <pre
      className="rounded-lg border border-line p-3 text-[11.5px] leading-[1.45] overflow-x-auto select-text"
      style={{ background: theme.background, color: theme.foreground, fontFamily: fontStack(font) }}
    >
      {text.split("\n").map((line, li) => {
        const spans = runs(line, compiled);
        const parts: React.ReactNode[] = [];
        let pos = 0;
        spans.forEach(([st, en, i], k) => {
          if (st > pos) parts.push(line.slice(pos, st));
          const style = compiled[i].style;
          parts.push(
            <span
              key={k}
              style={{
                color: cssColor(style.color, theme),
                background: cssColor(style.bg, theme, true),
                fontWeight: style.bold ? 700 : undefined,
                fontStyle: style.italic ? "italic" : undefined,
                textDecoration: style.underline ? "underline" : undefined,
              }}
            >
              {line.slice(st, en)}
            </span>,
          );
          pos = en;
        });
        parts.push(line.slice(pos));
        return <div key={li}>{parts.length ? parts : " "}</div>;
      })}
    </pre>
  );
}

/** Roles del resaltado con el color que realmente toman en el tema activo (ver hlPalette.ts). */
function Legend({ theme }: { theme: ITheme }) {
  const roles: [string, string, boolean][] = [
    ["Bueno", "green", false],
    ["Malo", "red", true],
    ["Advertencia", "yellow", false],
    ["Interfaz", "cyan", false],
    ["IP / MAC", "magenta", false],
    ["Sección", "brightBlue", true],
  ];
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px]">
      {roles.map(([label, color, bold]) => (
        <span key={label} className="flex items-center gap-1">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm border border-line"
            style={{ background: cssColor(color, theme) }}
          />
          <span className={bold ? "font-bold" : undefined}>{label}</span>
        </span>
      ))}
      <span className="text-muted">Los colores se ajustan al tema para mantener contraste y distinguirse del texto.</span>
    </div>
  );
}

function Label({ children, inline }: { children: React.ReactNode; inline?: boolean }) {
  return <div className={`text-[12px] font-medium text-muted ${inline ? "" : "mb-2"}`}>{children}</div>;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 min-h-8">
      <div>
        <div>{label}</div>
        {hint && <div className="text-[11.5px] text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 w-9 h-5 rounded-full transition-colors before:absolute before:-inset-[3px] before:content-[''] ${checked ? "bg-accent" : "bg-line"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

function Toggle({ on, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { on: boolean }) {
  return (
    <button
      {...props}
      className={`min-w-7 h-7 px-1.5 rounded-md border text-[12px] ${
        on ? "border-accent bg-selected text-fg" : "border-line text-muted hover:text-fg"
      }`}
    />
  );
}

function SmallBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="flex items-center gap-1 px-2 h-6 rounded-md border border-line text-[11.5px] text-muted hover:text-fg hover:bg-hover disabled:opacity-40"
    />
  );
}
