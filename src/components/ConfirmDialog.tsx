import { type ReactNode, useEffect, useRef } from "react";
import { useDragResize } from "../lib/useDragResize";

interface Props {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** El foco inicial va a Cancelar: para acciones que cortan varias sesiones a la vez. */
  defaultCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel, danger, defaultCancel, onConfirm, onCancel }: Props) {
  const win = useDragResize("confirmWindow", false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // En captura para que Enter/Esc no lleguen a la terminal que está detrás.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      // Enter activa el botón con foco; con el foco en otra parte vale el botón por defecto.
      const focused = document.activeElement;
      const confirm =
        e.key === "Enter" && (focused === confirmRef.current || (focused !== cancelRef.current && !defaultCancel));
      if (confirm) onConfirm();
      else onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onConfirm, onCancel, defaultCancel]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-2 sm:p-4" onMouseDown={onCancel}>
      <div
        role="alertdialog"
        {...win.box}
        className="w-full sm:w-[400px] max-w-[calc(100vw-1rem)] sm:max-w-[96vw] bg-panel border border-line rounded-xl shadow-pop p-4 sm:p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 {...win.handle} className="text-[14px] font-semibold mb-1 select-none">
          {title}
        </h2>
        <div className="text-muted mb-5 whitespace-pre-wrap break-words max-h-[55vh] overflow-y-auto font-[inherit]">{message}</div>
        <div className="flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} autoFocus={defaultCancel} onClick={onCancel} className="px-4 sm:px-3.5 h-10 sm:h-8 rounded-xl sm:rounded-md border border-line hover:bg-hover text-[13px] font-medium sm:font-normal touch-manipulation">
            Cancelar
          </button>
          <button
            autoFocus={!defaultCancel}
            ref={confirmRef}
            onClick={onConfirm}
            className={`px-4 sm:px-3.5 h-10 sm:h-8 rounded-xl sm:rounded-md font-medium hover:opacity-90 text-[13px] touch-manipulation ${danger ? "bg-danger text-danger-fg" : "bg-accent text-accent-fg"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
