import { Cable, Globe, Network, Server, SquareTerminal, Zap } from "lucide-react";
import { SessionType } from "../types";

const icons = {
  local: SquareTerminal,
  ssh: Server,
  telnet: Globe,
  serial: Cable,
  raw: Network,
} as const;

/** Rayo de conexión rápida: sutil y visible sobre cualquier fondo. */
export function QuickBolt({ size = 12, className = "" }: { size?: number; className?: string }) {
  return <Zap size={size} strokeWidth={2.2} className={`shrink-0 fill-accent/80 text-accent ${className}`} aria-hidden />;
}

export function SessionIcon({
  type,
  size = 14,
  quick = false,
  className = "",
}: {
  type: SessionType;
  size?: number;
  quick?: boolean;
  className?: string;
}) {
  const Icon = icons[type] || SquareTerminal;
  if (!quick) return <Icon size={size} className={`shrink-0 text-muted group-hover:text-fg transition-colors ${className}`} />;
  // Conexión rápida sin guardar: un rayo junto al ícono del protocolo.
  return (
    <span className="relative shrink-0 inline-flex items-center" title="Conexión rápida sin guardar">
      <Icon size={size} className={`shrink-0 text-muted group-hover:text-fg transition-colors ${className}`} />
      <QuickBolt size={Math.round(size * 0.75)} className="absolute -right-1.5 -bottom-1" />
    </span>
  );
}

/** Pestaña de una conexión rápida (sin sesión guardada). */
export const isQuickSession = (s: { id: string; type: SessionType; scp?: unknown }) => !s.id && s.type !== "local" && !s.scp;

export const typeLabel: Record<SessionType, string> = {
  local: "Local",
  ssh: "SSH",
  telnet: "Telnet",
  serial: "Serial",
  raw: "TCP",
};
