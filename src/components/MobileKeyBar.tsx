import { memo } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Clipboard,
  Search,
} from "lucide-react";
import type { TermController } from "./TerminalView";

export interface MobileKeyBarProps {
  activeCtrl?: TermController;
  ctrlActive: boolean;
  onToggleCtrl: () => void;
  onConsumeCtrl: () => void;
  onPaste?: () => void;
  onFind?: () => void;
}

interface KeyBtnProps {
  label: React.ReactNode;
  title: string;
  ariaLabel?: string;
  active?: boolean;
  accent?: boolean;
  onPress: () => void;
}

function KeyBtn({ label, title, ariaLabel, active, accent, onPress }: KeyBtnProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel || title}
      onPointerDown={(e) => {
        // e.preventDefault() evita que el teclado virtual de Android pierda el foco o se cierre
        e.preventDefault();
        onPress();
      }}
      onClick={(e) => e.preventDefault()}
      className={`shrink-0 h-8 min-[400px]:h-8.5 min-w-[36px] min-[400px]:min-w-[40px] px-2 min-[400px]:px-2.5 flex items-center justify-center gap-1 text-[12px] min-[400px]:text-[12.5px] font-mono rounded-lg border select-none touch-manipulation transition-all active:scale-95 ${
        active
          ? "bg-accent text-accent-fg border-accent ring-2 ring-accent/30 font-bold shadow-xs"
          : accent
            ? "bg-panel text-accent border-line hover:bg-hover active:bg-hover font-semibold"
            : "bg-panel text-fg border-line hover:bg-hover active:bg-hover"
      }`}
    >
      {label}
    </button>
  );
}

function Divider() {
  return <div className="shrink-0 w-px h-4 bg-line my-auto mx-0.5" aria-hidden="true" />;
}

export const MobileKeyBar = memo(function MobileKeyBar({
  activeCtrl,
  ctrlActive,
  onToggleCtrl,
  onConsumeCtrl,
  onPaste,
  onFind,
}: MobileKeyBarProps) {
  const handleType = (text: string) => {
    if (activeCtrl) {
      activeCtrl.type(text);
      if (ctrlActive) onConsumeCtrl();
      activeCtrl.focus();
    }
  };

  const handleKey = (key: string, seqFallback: string) => {
    if (activeCtrl) {
      if (activeCtrl.sendKey) {
        activeCtrl.sendKey(key);
      } else {
        activeCtrl.type(seqFallback);
      }
      if (ctrlActive) onConsumeCtrl();
      activeCtrl.focus();
    }
  };

  const handleCtrlCombo = (code: string) => {
    if (activeCtrl) {
      activeCtrl.type(code);
      onConsumeCtrl();
      activeCtrl.focus();
    }
  };

  const handlePaste = () => {
    if (onPaste) onPaste();
    else activeCtrl?.paste?.();
    if (ctrlActive) onConsumeCtrl();
    activeCtrl?.focus();
  };

  const handleFind = () => {
    if (onFind) onFind();
    else activeCtrl?.openFind();
    if (ctrlActive) onConsumeCtrl();
    activeCtrl?.focus();
  };

  return (
    <div
      className="shrink-0 h-11 min-[400px]:h-11.5 bg-chrome border-t border-line flex items-center px-1.5 gap-1 min-[400px]:gap-1.5 overflow-x-auto select-none touch-manipulation z-10 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      role="toolbar"
      aria-label="Teclas táctiles para terminal"
    >
      {/* Teclas básicas de control */}
      <KeyBtn
        label="Esc"
        title="Escape (Esc)"
        onPress={() => handleKey("Escape", "\x1b")}
      />
      <KeyBtn
        label="Tab"
        title="Tabulador / autocompletar (Tab)"
        onPress={() => handleKey("Tab", "\t")}
      />
      <KeyBtn
        label="Ctrl"
        title="Modificador Ctrl activo (toca para activar o desactivar)"
        active={ctrlActive}
        onPress={() => {
          onToggleCtrl();
          activeCtrl?.focus();
        }}
      />

      {/* Botones de control rápido */}
      {ctrlActive ? (
        <>
          <KeyBtn
            label="^C"
            title="Interrumpir comando (Ctrl+C)"
            accent
            onPress={() => handleCtrlCombo("\x03")}
          />
          <KeyBtn
            label="^Z"
            title="Salir / Suspender (Ctrl+Z)"
            accent
            onPress={() => handleCtrlCombo("\x1a")}
          />
          <KeyBtn
            label="^A"
            title="Inicio de línea (Ctrl+A)"
            onPress={() => handleCtrlCombo("\x01")}
          />
          <KeyBtn
            label="^E"
            title="Fin de línea (Ctrl+E)"
            onPress={() => handleCtrlCombo("\x05")}
          />
          <KeyBtn
            label="^W"
            title="Borrar palabra previa (Ctrl+W)"
            onPress={() => handleCtrlCombo("\x17")}
          />
          <KeyBtn
            label="^L"
            title="Limpiar pantalla (Ctrl+L)"
            onPress={() => handleCtrlCombo("\x0c")}
          />
        </>
      ) : (
        <>
          <KeyBtn
            label="^C"
            title="Interrumpir comando (Ctrl+C)"
            onPress={() => handleType("\x03")}
          />
          <KeyBtn
            label="^Z"
            title="Salir / Suspender (Ctrl+Z)"
            onPress={() => handleType("\x1a")}
          />
        </>
      )}

      <Divider />

      {/* Caracteres de consola y CLI */}
      <KeyBtn
        label="?"
        title="Ayuda contextual IOS/VRP (?)"
        onPress={() => handleType("?")}
      />
      <KeyBtn
        label="|"
        title="Filtro pipe (|)"
        onPress={() => handleType("|")}
      />
      <KeyBtn
        label="-"
        title="Guion (-)"
        onPress={() => handleType("-")}
      />
      <KeyBtn
        label="/"
        title="Barra (/)"
        onPress={() => handleType("/")}
      />
      <KeyBtn
        label=":"
        title="Dos puntos (:)"
        onPress={() => handleType(":")}
      />

      <Divider />

      {/* Flechas de cursor y navegación */}
      <KeyBtn
        label={<ArrowUp size={13} />}
        title="Historial anterior (Flecha arriba)"
        ariaLabel="Flecha arriba"
        onPress={() => handleKey("ArrowUp", "\x1b[A")}
      />
      <KeyBtn
        label={<ArrowDown size={13} />}
        title="Historial siguiente (Flecha abajo)"
        ariaLabel="Flecha abajo"
        onPress={() => handleKey("ArrowDown", "\x1b[B")}
      />
      <KeyBtn
        label={<ArrowLeft size={13} />}
        title="Mover cursor a la izquierda"
        ariaLabel="Flecha izquierda"
        onPress={() => handleKey("ArrowLeft", "\x1b[D")}
      />
      <KeyBtn
        label={<ArrowRight size={13} />}
        title="Mover cursor a la derecha / aceptar sugerencia"
        ariaLabel="Flecha derecha"
        onPress={() => handleKey("ArrowRight", "\x1b[C")}
      />

      <Divider />

      {/* Utilidades de terminal */}
      <KeyBtn
        label={
          <span className="flex items-center gap-1 font-sans text-[11px]">
            <Clipboard size={12} className="shrink-0" />
            Pegar
          </span>
        }
        title="Pegar del portapapeles"
        onPress={handlePaste}
      />
      <KeyBtn
        label={
          <span className="flex items-center gap-1 font-sans text-[11px]">
            <Search size={12} className="shrink-0" />
            Buscar
          </span>
        }
        title="Buscar en el historial de la terminal"
        onPress={handleFind}
      />
    </div>
  );
});
