import { useMemo, useState } from "react";
import { calc, splitV4 } from "../../lib/subnet";
import { CopyText, Label, Section } from "./ui";

export function SubnetTool() {
  const [input, setInput] = useState("192.168.10.77/26");
  const [split, setSplit] = useState(0);
  const r = useMemo(() => calc(input), [input]);
  const subnets = useMemo(
    () => (r?.version === 4 && split > r.prefix ? splitV4(r.network, r.prefix, split) : []),
    [r, split],
  );

  const rows: [string, string][] = !r
    ? []
    : r.version === 4
      ? [
          ["Red", `${r.network}/${r.prefix}`],
          ["Máscara", r.mask],
          ["Wildcard (ACL)", r.wildcard],
          ["Broadcast", r.broadcast],
          ["Primer host", r.first],
          ["Último host", r.last],
          ["Hosts útiles", r.hosts.toLocaleString("es-CL")],
          ["Direcciones totales", r.total.toLocaleString("es-CL")],
          ["Clase / tipo", `${r.cls} · ${r.scope}`],
          ["Binario", r.binary],
        ]
      : [
          ["Red", r.network],
          ["Primera", r.first],
          ["Última", r.last],
          ["Direcciones", r.total],
          ["Tipo", r.scope],
        ];

  return (
    <div className="space-y-4">
      <Section title="Calculadora de subredes" hint="IPv4 con prefijo o máscara (10.0.0.1/24, 10.0.0.1 255.255.255.0) o IPv6 (2001:db8::1/64).">
        <input
          autoFocus
          className="field font-mono mb-3 w-full"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
        />
        {!r && input.trim() && <p className="text-[12px] text-danger">Dirección o máscara inválida</p>}
        {r && (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <tbody>
                {rows.map(([k, v]) => (
                  <tr key={k} className="border-t border-line first:border-0">
                    <td className="py-1.5 pr-2 sm:pr-4 text-muted whitespace-nowrap w-24 sm:w-28 @[36rem]:w-48">{k}</td>
                    <td className="min-w-0">
                      <CopyText text={v} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {r?.version === 4 && r.prefix < 32 && (
        <Section title="Dividir en subredes">
          <Label text="Nuevo prefijo" className="w-full sm:w-56 mb-3">
            <select className="field w-full" value={split} onChange={(e) => setSplit(Number(e.target.value))}>
              <option value={0}>Selecciona</option>
              {Array.from({ length: 32 - r.prefix }, (_, i) => r.prefix + i + 1).map((p) => (
                <option key={p} value={p}>
                  /{p} · {(2 ** (p - r.prefix)).toLocaleString("es-CL")} subredes
                </option>
              ))}
            </select>
          </Label>
          {subnets.length > 0 && (
            <div className="max-h-[300px] overflow-auto">
              <table className="w-full text-[12px] font-mono min-w-[280px]">
                <thead className="text-muted text-left font-sans">
                  <tr>
                    <th className="font-medium py-1">Subred</th>
                    <th className="font-medium">Primer host</th>
                    <th className="font-medium">Último host</th>
                  </tr>
                </thead>
                <tbody>
                  {subnets.map((s) => (
                    <tr key={s.cidr} className="border-t border-line">
                      <td className="py-1">{s.cidr}</td>
                      <td>{s.first}</td>
                      <td>{s.last}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {2 ** (split - r.prefix) > 1024 && <p className="mt-2 text-[11.5px] text-muted">Se muestran las primeras 1.024.</p>}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
