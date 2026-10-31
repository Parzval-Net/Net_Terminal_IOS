// Diagramas del video "Herramientas de red a fondo" (D1 a D12 del storyboard). Se dibujan sobre
// una vista nueva de window.E (scripts/video/plugins/escenario.js), así E.revelar(n) sirve también
// aquí: los elementos con clase "aparece" se muestran en orden. API: window.D.<diagrama>(opciones).
// Datos ficticios: IPs de documentación (RFC 5737) y nombres genéricos.
const stage = document.getElementById("stage");
const A = "#1d5be0", OK = "#1a7f37", WARN = "#8a5a00", BAD = "#d1242f", UNK = "#6e5f99", MUTED = "#5f6773", LINE = "#d5d9e0";

/** Crea una vista con el mecanismo de escenario.js y le pone el contenido del diagrama. */
function vista(html) {
  window.E.capitulo({ num: "", titulo: "", sub: "" });
  const v = stage.lastElementChild;
  v.className = "vista diag";
  v.innerHTML = html;
  return v;
}
const head = (kicker, titulo) => `<div class="kicker">${kicker}</div><h2>${titulo}</h2>`;

// ---------- Piezas SVG ----------
/** Equipo de red: caja con icono, nombre y detalle. */
function equipo(x, y, nombre, detalle = "", { w = 230, h = 92, color = A, tipo = "switch", fondo = "#fff", clase = "" } = {}) {
  const icon =
    tipo === "pc"
      ? `<rect x="${x + 18}" y="${y + 24}" width="42" height="29" rx="4" fill="none" stroke="${color}" stroke-width="3"/><path d="M${x + 31} ${y + 62}h16M${x + 39} ${y + 53}v9" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`
      : tipo === "router"
        ? `<circle cx="${x + 39}" cy="${y + h / 2}" r="21" fill="none" stroke="${color}" stroke-width="3"/><path d="M${x + 27} ${y + h / 2}h24M${x + 39} ${y + h / 2 - 12}v24" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`
        : `<rect x="${x + 16}" y="${y + h / 2 - 15}" width="46" height="30" rx="5" fill="none" stroke="${color}" stroke-width="3"/>${[0, 1, 2, 3].map((i) => `<rect x="${x + 22 + i * 9.5}" y="${y + h / 2 - 3}" width="6" height="6" rx="1" fill="${color}"/>`).join("")}`;
  return `<g class="${clase}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${fondo}" stroke="${color}" stroke-width="2.5"/>${icon}
    <text x="${x + 76}" y="${y + (detalle ? h / 2 - 4 : h / 2 + 8)}" font-size="23" font-weight="700" fill="#1b1f24">${nombre}</text>
    ${detalle ? `<text x="${x + 76}" y="${y + h / 2 + 22}" font-size="18" fill="${MUTED}" class="mono">${detalle}</text>` : ""}</g>`;
}
const flecha = (id, color) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${color}"/></marker>`;
const etiqueta = (x, y, texto, { color = A, fondo = "#e8effd", size = 18, mono = false, ancla = "middle" } = {}) => {
  const w = texto.length * size * (mono ? 0.62 : 0.55) + 26;
  const x0 = ancla === "middle" ? x - w / 2 : x;
  return `<g><rect x="${x0}" y="${y - size}" width="${w}" height="${size + 14}" rx="${(size + 14) / 2}" fill="${fondo}"/><text x="${x0 + w / 2}" y="${y + 1}" font-size="${size}" font-weight="600" fill="${color}" text-anchor="middle" ${mono ? 'class="mono"' : ""}>${texto}</text></g>`;
};

window.D = {
  /** D1: CDP/LLDP, cada equipo anuncia quién es y por qué puerto. */
  vecinos() {
    vista(`${head("Topología · CDP y LLDP", "Cada equipo anuncia quién es y por qué puerto")}
      <div class="lienzo"><svg viewBox="0 0 1296 470" width="100%" height="100%">
        <defs>${flecha("fa", A)}${flecha("fv", OK)}</defs>
        ${equipo(40, 250, "core-sw01", "Gi1/0/1 · 192.0.2.1", { w: 300 })}
        ${equipo(956, 250, "dist-sw01", "Gi1/0/48 · 192.0.2.11", { w: 300 })}
        <line x1="340" y1="296" x2="956" y2="296" stroke="${LINE}" stroke-width="8" stroke-linecap="round"/>
        <g class="aparece">
          <path d="M1000 250 C 900 170, 700 150, 650 150" fill="none" stroke="${OK}" stroke-width="3" stroke-dasharray="7 7" marker-end="url(#fv)"/>
          <rect x="330" y="60" width="640" height="104" rx="18" fill="#fff" stroke="${OK}" stroke-width="2.5"/>
          <text x="650" y="102" text-anchor="middle" font-size="25" font-weight="700" fill="#1b1f24">"Soy dist-sw01, puerto Gi1/0/48,</text>
          <text x="650" y="138" text-anchor="middle" font-size="25" font-weight="700" fill="#1b1f24">IP 192.0.2.11"</text>
        </g>
        <g class="aparece">
          ${etiqueta(470, 350, "CDP · Cisco", { color: A })}
          ${etiqueta(830, 350, "LLDP · estándar IEEE 802.1AB", { color: OK, fondo: "#e6f4ea" })}
        </g>
        <g class="aparece"><text x="648" y="440" text-anchor="middle" font-size="22" fill="${MUTED}">La app solo lee: show cdp neighbors detail · show lldp neighbors detail</text></g>
      </svg></div>`);
  },

  /** D2: seguir la ruta salto a salto. */
  saltos() {
    const paso = (x, n, t, d) => `<g class="aparece"><circle cx="${x}" cy="356" r="22" fill="#e8effd"/><text x="${x}" y="364" text-anchor="middle" font-size="21" font-weight="700" fill="${A}">${n}</text>
      <text x="${x}" y="414" text-anchor="middle" font-size="23" font-weight="700" fill="#1b1f24">${t}</text><text x="${x}" y="444" text-anchor="middle" font-size="19" fill="${MUTED}">${d}</text></g>`;
    vista(`${head("Topología · salto a salto", "Explora un equipo, conecta al vecino y vuelve a descubrir")}
      <div class="lienzo"><svg viewBox="0 0 1296 470" width="100%" height="100%">
        <defs>${flecha("fa", A)}</defs>
        ${equipo(20, 150, "core-sw01", "explorado", { fondo: "#e8effd", w: 270 })}
        <line x1="290" y1="196" x2="505" y2="196" stroke="${LINE}" stroke-width="7"/>
        ${equipo(505, 150, "dist-sw01", "vecino", { clase: "aparece", w: 270 })}
        <line x1="775" y1="196" x2="990" y2="196" stroke="${LINE}" stroke-width="7" class="aparece"/>
        ${equipo(990, 150, "sw-acceso-01", "siguiente", { color: "#858c97", clase: "aparece", w: 286 })}
        ${paso(155, 1, "Descubrir vecinos", "en el equipo conectado")}
        <path d="M245 356 H 520" stroke="${A}" stroke-width="3" marker-end="url(#fa)" class="aparece"/>
        ${paso(640, 2, "Conectar", "queda elegido solo en Equipo")}
        <path d="M735 356 H 1010" stroke="${A}" stroke-width="3" marker-end="url(#fa)" class="aparece"/>
        ${paso(1125, 3, "Descubrir vecinos", "otra vez, desde el nuevo")}
      </svg></div>`);
  },

  /** D3: escalera de confianza de las sugerencias por MAC y fabricante. */
  confianza() {
    vista(`${head("Sugerencias por MAC y fabricante", "Cuánto confiar en cada pista")}
      <div class="escalera">
        <div class="peldano aparece"><span class="nivel alta">Alta</span><span>MAC virtual de HSRP <code>0000.0c07.acXX</code> o VRRP <code>0000.5e00.01XX</code><span class="det">Detrás de ese puerto hay un router (gateway)</span></span></div>
        <div class="peldano aparece"><span class="nivel media">Media</span><span>4 o más MAC en el puerto, o una sola MAC de un fabricante de red<span class="det">Probablemente otro switch o un equipo de red</span></span></div>
        <div class="peldano aparece"><span class="nivel baja">Baja</span><span>MAC de red con pocas más, o MAC local o aleatoria<span class="det">Caso dudoso: revísalo antes de confirmar</span></span></div>
      </div>
      <div class="pie aparece">Son pistas: tú confirmas cada una. Las descartadas se recuerdan por equipo.</div>`);
  },

  /** Lista de pistas falsas (capítulo 03). */
  pistas() {
    window.E.lista({
      kicker: "Son pistas, no pruebas",
      titulo: "Por qué cada sugerencia pide confirmación",
      items: [
        { ico: "warn", texto: "Una descripción vieja", nota: "El puerto dice \"UPLINK a sw-patio-01\", pero el cable ya cambió" },
        { ico: "warn", texto: "El fabricante de la MAC no dice qué equipo es", nota: "Una MAC Cisco puede ser un teléfono IP, no un switch" },
        { ico: "warn", texto: "La tabla MAC envejece", nota: "Una entrada antigua apunta a un equipo que ya no está" },
      ],
    });
  },

  /** D4: cómo leer el tráfico de un enlace. */
  trafico() {
    vista(`${head("Topología · tráfico en enlaces", "Cómo leer un enlace")}
      <div class="lienzo"><svg viewBox="0 0 1296 330" width="100%" height="100%">
        <defs>${flecha("fo", OK)}${flecha("fw", WARN)}</defs>
        ${equipo(40, 110, "core-sw01", "192.0.2.1")}
        ${equipo(1026, 110, "dist-sw01", "192.0.2.11")}
        <line x1="270" y1="145" x2="1026" y2="145" stroke="${OK}" stroke-width="7" marker-end="url(#fo)"/>
        <line x1="1026" y1="175" x2="270" y2="175" stroke="${OK}" stroke-width="7" stroke-opacity=".55" marker-end="url(#fo)"/>
        <circle r="7" fill="${OK}" class="paquete" style="offset-path: path('M270 145 H 1026')"/>
        <circle r="7" fill="${OK}" class="paquete" style="offset-path: path('M1026 175 H 270'); animation-duration: 4.2s"/>
        <g class="aparece">${etiqueta(648, 92, "core-sw01 → 120 Mb/s · ← 35 Mb/s · 12 %", { mono: true, size: 21, color: "#1b1f24", fondo: "#ffffff" })}</g>
        <g class="aparece">
          <text x="300" y="250" font-size="21" fill="${MUTED}">→ sale del equipo nombrado (core-sw01)</text>
          <text x="300" y="284" font-size="21" fill="${MUTED}">← le llega · pasa el mouse para ver los dos nombres</text>
        </g>
      </svg></div>
      <div class="leyenda-t aparece">
        <span><i style="background:${OK}"></i>Verde · bajo 70 %</span>
        <span><i style="background:${WARN}"></i>Amarillo · 70 a 89 %</span>
        <span><i style="background:${BAD}"></i>Rojo · desde 90 %</span>
        <span><i style="background:${UNK}"></i>Violeta · velocidad desconocida</span>
        <span>≈ aproximada · solo BW configurado</span>
      </div>`);
  },

  /** D5: quién inicia la copia. */
  quienInicia() {
    const pc = (x, y, t = "Tu PC") => equipo(x, y, t, "192.0.2.250", { tipo: "pc", w: 240 });
    vista(`${head("Transferencias", "Quién inicia la copia")}
      <div class="dos">
        <div class="caja aparece"><h3>Tu PC es el servidor</h3><div class="sub2">TFTP · HTTP · FTP</div>
          <svg viewBox="0 0 560 300"><defs>${flecha("fa", A)}</defs>
            ${pc(10, 40)}
            ${equipo(310, 40, "core-sw01", "192.0.2.1", { tipo: "router", w: 240 })}
            <path d="M310 110 C 250 170, 250 170, 250 110" fill="none" stroke="none"/>
            <path d="M430 140 Q 340 230 140 140" fill="none" stroke="${A}" stroke-width="3" marker-end="url(#fa)"/>
            <text x="290" y="238" text-anchor="middle" font-size="20" fill="#1b1f24" font-weight="600">el equipo ejecuta copy y descarga</text>
            <text x="290" y="272" text-anchor="middle" font-size="18" fill="${MUTED}" class="mono">copy http://192.0.2.250:8080/… flash:</text>
          </svg></div>
        <div class="caja aparece"><h3>El equipo es el servidor</h3><div class="sub2">SCP · SFTP (dentro de SSH)</div>
          <svg viewBox="0 0 560 300"><defs>${flecha("fv", OK)}</defs>
            ${pc(10, 40)}
            ${equipo(310, 40, "core-sw01", "192.0.2.1", { tipo: "router", w: 240, color: OK })}
            <path d="M140 140 Q 290 230 430 140" fill="none" stroke="${OK}" stroke-width="3" marker-end="url(#fv)"/>
            <text x="290" y="238" text-anchor="middle" font-size="20" fill="#1b1f24" font-weight="600">tu PC se conecta por SSH</text>
            <text x="290" y="272" text-anchor="middle" font-size="18" fill="${OK}">cifrado de punta a punta</text>
          </svg></div>
      </div>`);
  },

  /** D6: tabla de protocolos. */
  protocolos() {
    const si = (t) => `<span class="si">${t}</span>`, no = (t) => `<span class="no">${t}</span>`, md = (t) => `<span class="decl">${t}</span>`;
    window.E.tabla({
      kicker: "Transferencias",
      titulo: "Qué protocolo usar",
      columnas: ["Protocolo", "Cifrado", "Credenciales", "Velocidad", "Soporte en equipos"],
      filas: [
        ["<b>TFTP</b> · UDP 69", no("No"), no("No pide"), md("Baja: un bloque y espera"), "Casi todos"],
        ["<b>HTTP</b> · TCP 8080", no("No"), no("No pide"), si("Alta"), "Muchos"],
        ["<b>FTP</b> · TCP 21", no("No"), md("En claro"), si("Alta"), "Muchos"],
        ["<b>SCP / SFTP</b> · SSH", si("Sí"), si("Las del equipo"), si("Alta"), "Si tiene el servidor activo"],
      ],
    });
  },

  /** D7: el PC como servidor TFTP. */
  pcTftp() {
    vista(`${head("Servidor TFTP", "Tu PC sirve el archivo; el equipo lo pide")}
      <div class="lienzo"><svg viewBox="0 0 1296 430" width="100%" height="100%">
        <defs>${flecha("fa", A)}</defs>
        ${equipo(40, 70, "Tu PC", "192.0.2.250", { tipo: "pc", w: 300 })}
        <g><rect x="60" y="190" width="260" height="120" rx="14" fill="#f8f9fb" stroke="${LINE}" stroke-width="2"/>
          <path d="M84 222h38l10 10h56v52H84z" fill="#e8effd" stroke="${A}" stroke-width="2"/>
          <text x="204" y="250" font-size="19" font-weight="700" fill="#1b1f24">Carpeta</text><text x="204" y="274" font-size="19" font-weight="700" fill="#1b1f24">compartida</text>
          <text x="84" y="300" font-size="15" fill="${MUTED}" class="mono">c9300-…17.12.04.SPA.bin</text></g>
        ${etiqueta(190, 360, "Escucha en UDP 69", { size: 19 })}
        ${equipo(940, 70, "core-sw01", "192.0.2.1", { tipo: "router", w: 300 })}
        <path d="M940 140 C 760 190, 560 190, 345 140" fill="none" stroke="${A}" stroke-width="3" stroke-dasharray="9 7" marker-end="url(#fa)"/>
        <circle r="7" fill="${A}" class="paquete" style="offset-path: path('M345 140 C 560 190, 760 190, 940 140'); animation-duration: 2s"/>
        <g class="aparece"><rect x="560" y="236" width="690" height="60" rx="12" fill="#ffffff" stroke="${LINE}"/>
          <text x="582" y="274" font-size="20" class="mono" fill="#1b1f24">core-sw01# copy tftp://192.0.2.250/c9300-…bin flash:</text></g>
        <g class="aparece">${etiqueta(905, 350, "El equipo inicia la copia y descarga", { size: 19, color: "#1b1f24", fondo: "#eef1f5" })}</g>
      </svg></div>
      <div class="aviso aparece"><b>!</b> Sin contraseña ni cifrado: apágalo al terminar</div>`);
  },

  /** D8: flujo típico para un firmware. */
  flujoFirmware() {
    const p = (n, t, d, cls = "") => `<div class="p aparece ${cls}"><div class="n">${n}</div><b>${t}</b>${d}</div>`;
    vista(`${head("Flujo típico", "Actualizar el firmware de un equipo")}
      <div class="pasos">
        ${p(1, "Agregar", "La imagen a la carpeta compartida")}
        ${p(2, "Espacio libre", "Revisa cuánto queda en el equipo")}
        ${p(3, "Iniciar HTTP", "O TFTP si el equipo no soporta HTTP")}
        ${p(4, "Pegar el copy", "En la sesión del equipo")}
        ${p(5, "Avance", "Síguelo en Transferencias")}
        ${p(6, "MD5", "Compáralo con el del fabricante")}
        ${p(7, "Detener", "Apaga el servidor al terminar")}
        ${p(8, "Arranque y reinicio", "Quedan a tu cargo", "gris")}
      </div>`);
  },

  /** D12: puertos sin privilegios. */
  puertos() {
    const fila = (s, a, b) => [s, `<span class="mono">${a}</span>`, "→", `<b class="mono">${b}</b>`];
    window.E.tabla({
      kicker: "Linux y macOS",
      titulo: "Puertos bajo 1024: usa uno alto",
      columnas: ["Servicio", "Puerto estándar", "", "Alternativa"],
      filas: [fila("TFTP", "UDP 69", "1069"), fila("FTP", "TCP 21", "2121"), fila("Traps SNMP", "UDP 162", "1162"), fila("Syslog", "UDP 514", "1514"), ["HTTP", '<span class="mono">TCP 8080</span>', "", "<span class='si'>Ya es un puerto alto</span>"]],
      pie: "Si cambias el puerto, configúralo también en el equipo.",
    });
    document.querySelectorAll(".vista:last-child td:nth-child(3)").forEach((td) => td.classList.add("flecha-t"));
  },

  /** D9: SCP clásico en Cisco IOS-XE. */
  scp({ simple = false } = {}) {
    vista(`${head("SFTP y SCP", simple ? "Con el OpenSSH de tu sistema" : "Por qué SCP clásico")}
      <div class="lienzo"><svg viewBox="0 0 1296 400" width="100%" height="100%">
        <defs>${flecha("fv", OK)}</defs>
        ${equipo(40, 60, "Tu PC", "OpenSSH 9 o superior", { tipo: "pc", w: 330 })}
        ${equipo(926, 60, "core-sw01", "Cisco IOS-XE", { tipo: "router", w: 330, color: OK })}
        <path d="M370 106 H 926" stroke="${OK}" stroke-width="5" marker-end="url(#fv)"/>
        ${etiqueta(648, 92, "SSH · TCP 22", { color: OK, fondo: "#e6f4ea" })}
        <text x="648" y="150" text-anchor="middle" font-size="19" fill="${MUTED}">usuario, puerto, llave y jump host de la sesión</text>
        ${
          simple
            ? `<g class="aparece">${etiqueta(648, 250, "sftp>  ls · cd · get · put · bye", { mono: true, size: 21, color: "#1b1f24", fondo: "#eef1f5" })}</g>`
            : `<g class="aparece"><text x="1091" y="236" text-anchor="middle" font-size="20" fill="#1b1f24">IOS-XE responde SCP clásico</text>
                 <text x="1091" y="270" text-anchor="middle" font-size="19" fill="${OK}" class="mono">ip scp server enable</text>
                 <text x="1091" y="300" text-anchor="middle" font-size="18" fill="${MUTED}">NX-OS (SFTP): feature sftp-server</text></g>
               <g class="aparece"><text x="205" y="236" text-anchor="middle" font-size="20" fill="#1b1f24">OpenSSH moderno usa SFTP por defecto</text>
                 <text x="205" y="270" text-anchor="middle" font-size="20" fill="${A}" font-weight="700">la app agrega -O (SCP clásico)</text></g>`
        }
      </svg></div>
      ${simple ? "" : `<div class="nota-b aparece">Al terminar con código 0, el gestor corre el MD5 en la sesión del equipo</div>`}`);
  },

  /** D10: SNMP, gestor y agente; con completo=true agrega el receptor de traps. */
  snmp({ completo = false } = {}) {
    vista(`${head("SNMP", completo ? "Consultas y traps" : "Gestor y agente")}
      <div class="lienzo"><svg viewBox="0 0 1296 380" width="100%" height="100%">
        <defs>${flecha("fa", A)}${flecha("fw", WARN)}</defs>
        ${equipo(40, 60, "Tu PC (gestor)", "192.0.2.250", { tipo: "pc", w: 340 })}
        ${equipo(916, 60, "core-sw01 (agente)", "192.0.2.1", { tipo: "router", w: 340 })}
        <path d="M380 92 H 916" stroke="${A}" stroke-width="4" marker-end="url(#fa)"/>
        ${etiqueta(648, 78, "GET · GETNEXT · GETBULK → UDP 161", { size: 19 })}
        <text x="648" y="140" text-anchor="middle" font-size="19" fill="${MUTED}">solo lectura: el cliente nunca escribe en el equipo</text>
        ${
          completo
            ? `<g class="aparece"><path d="M916 190 C 760 260, 540 260, 380 190" fill="none" stroke="${WARN}" stroke-width="4" marker-end="url(#fw)"/>
                ${etiqueta(648, 282, "trap → UDP 162 (o 1162)", { size: 19, color: WARN, fondo: "#fdf3dc" })}</g>`
            : ""
        }
      </svg></div>
      ${completo ? `<div class="aviso aparece"><b>!</b> Receptor en 127.0.0.1: el equipo no llega. Usa "Escuchar en 192.0.2.250"</div>` : ""}`);
  },

  /** D11: secretos enmascarados en el diff, con la marca "secreto cambiado". */
  enmascarado() {
    vista(`${head("Respaldos · comparar", "Secretos enmascarados, cambios visibles")}
      <div class="diff2">
        <div class="ventana aparece"><div class="barra"><span class="arch">A · 2026-10-14_093000.txt</span></div>
          <pre><span class="l">hostname core-sw01</span><span class="l">enable secret 9 ****</span><span class="l">snmp-server community **** RO 10</span></pre></div>
        <div class="ventana aparece"><div class="barra"><span class="arch">B · 2026-10-20_181500.txt</span></div>
          <pre><span class="l">hostname core-sw01</span><span class="l">enable secret 9 ****</span><span class="l">snmp-server community **** RO 10<span class="marca">secreto cambiado</span></span></pre></div>
      </div>
      <div class="pie aparece">La app compara una huella del valor, nunca el secreto: no lo guarda ni lo muestra.</div>`);
  },
};
