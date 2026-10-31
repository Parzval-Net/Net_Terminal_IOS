import { isIOS } from "./platform";

/**
 * Ajustes de layout para iOS/iPadOS (WKWebView).
 * - Marca <html class="ios"> para los estilos específicos (App.css).
 * - WKWebView no redimensiona la página con el teclado virtual (no hay adjustResize): se publica
 *   la altura visible en --vvh y se marca html.kb-open mientras el teclado está arriba. #root usa
 *   esa altura, así la terminal y la MobileKeyBar quedan sobre el teclado y el ResizeObserver de
 *   xterm vuelve a ajustar filas y columnas.
 */
export function initIosLayout(): void {
  if (!isIOS || typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.add("ios");

  // Campos de host, usuario, comandos, etc.: sin autocorrección ni mayúscula inicial. Se aplica al
  // enfocar para cubrir también los que se montan después (diálogos).
  document.addEventListener("focusin", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    if (!el.hasAttribute("autocorrect")) el.setAttribute("autocorrect", "off");
    if (!el.hasAttribute("autocapitalize")) el.setAttribute("autocapitalize", "none");
    if (!el.hasAttribute("spellcheck")) el.spellcheck = false;
  });

  const vv = window.visualViewport;
  if (!vv) return;

  let frame = 0;
  const apply = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
      // Diferencia grande entre la ventana y el viewport visual = teclado virtual (el teclado
      // flotante del iPad o la barra de atajos no llegan a este umbral).
      const kb = window.innerHeight - vv.height - vv.offsetTop;
      root.classList.toggle("kb-open", kb > 120);
      // Safari desplaza la página para mostrar el campo enfocado; la interfaz es de pantalla fija.
      if (window.scrollY !== 0 || vv.offsetTop !== 0) window.scrollTo(0, 0);
    });
  };
  vv.addEventListener("resize", apply);
  vv.addEventListener("scroll", apply);
  window.addEventListener("orientationchange", apply);
  apply();
}
