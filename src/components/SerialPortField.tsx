import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { SerialPortInfo } from "../types";

const MANUAL = "\u0000manual";

/**
 * Puerto serial: lista desplegable con todos los puertos detectados (un <datalist> filtra por el
 * texto escrito y solo mostraba el puerto ya elegido) y opción de escribirlo a mano.
 */
export function SerialPortField({
  value,
  ports,
  onChange,
  onRefresh,
  autoFocus,
}: {
  value: string;
  ports: SerialPortInfo[];
  onChange: (v: string) => void;
  onRefresh: () => void;
  autoFocus?: boolean;
}) {
  const detected = ports.some((p) => p.port_name === value);
  const [manual, setManual] = useState(false);
  const typing = manual || ports.length === 0;

  return (
    <div className="flex gap-1.5">
      {typing ? (
        <input
          className="field"
          required
          autoFocus={autoFocus || manual}
          value={value}
          placeholder={navigator.userAgent.includes("Windows") ? "COM3" : "/dev/ttyUSB0"}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <select
          className="field"
          required
          autoFocus={autoFocus}
          value={value}
          title={ports.find((p) => p.port_name === value)?.port_type ?? value}
          onChange={(e) => (e.target.value === MANUAL ? setManual(true) : onChange(e.target.value))}
        >
          {!value && <option value="">Elige un puerto</option>}
          {value && !detected && <option value={value}>{value} · no detectado</option>}
          {ports.map((p) => (
            <option key={p.port_name} value={p.port_name}>
              {p.port_name} ({p.port_type})
            </option>
          ))}
          <option value={MANUAL}>Escribir otro…</option>
        </select>
      )}
      <button
        type="button"
        title="Detectar puertos"
        onClick={() => {
          setManual(false);
          onRefresh();
        }}
        className="w-8 shrink-0 grid place-items-center rounded-md border border-line text-muted hover:text-fg hover:bg-hover"
      >
        <RefreshCw size={14} />
      </button>
    </div>
  );
}
