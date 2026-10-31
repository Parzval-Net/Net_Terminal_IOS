import { Component, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

/**
 * Un error al dibujar la app dejaba la ventana en blanco y sin pista. Se muestra el error
 * y un botón para recargar; las sesiones, notas y ajustes en disco no se tocan.
 */
class Fallback extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="h-full grid place-items-center bg-bg text-fg p-6">
        <div className="max-w-[520px] space-y-3">
          <h1 className="text-[16px] font-semibold">NetTerminal no pudo mostrar la ventana</h1>
          <p className="text-muted">
            Tus sesiones, notas y ajustes siguen en la carpeta de datos. Recarga la ventana; si el error se repite, revisa
            settings.json en esa carpeta o informa el error.
          </p>
          <pre className="text-[12px] whitespace-pre-wrap break-words max-h-48 overflow-y-auto select-text">{String(error.stack ?? error)}</pre>
          <button className="px-3.5 h-8 rounded-md bg-accent text-accent-fg font-medium" onClick={() => location.reload()}>
            Recargar
          </button>
        </div>
      </div>
    );
  }
}

// Sin StrictMode: el doble montaje en desarrollo abriría cada conexión dos veces.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Fallback>
    <App />
  </Fallback>,
);
