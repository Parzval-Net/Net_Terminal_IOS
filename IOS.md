# NetTerminal para iOS (`Net_Terminal_IOS`)

Guía de compilación, ejecución e instalación de la edición iOS de NetTerminal, para iPhone 13 o superior y iPad con iOS 16 o superior.

Repositorio de esta edición: [https://github.com/Parzval-Net/Net_Terminal_IOS](https://github.com/Parzval-Net/Net_Terminal_IOS)
Repositorio de la edición Android (referencia): [https://github.com/Parzval-Net/NetTerminal_Android](https://github.com/Parzval-Net/NetTerminal_Android)

---

## 1. Requisitos

- Mac con macOS y **Xcode 16 o superior** (desde la App Store). Verificar con `xcodebuild -version`.
- Herramientas de línea de comandos de Xcode: `xcode-select --install`.
- **Rust** estable instalado con `rustup`, y los targets de iOS:

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
```

- **Node.js 22** o superior (`engines` del proyecto: `>=22.15`).
- Para instalar en un iPhone o iPad físico: cuenta de Apple ID (gratuita o de pago, ver sección 5).

---

## 2. Preparar el proyecto

```bash
git clone https://github.com/Parzval-Net/Net_Terminal_IOS.git
cd Net_Terminal_IOS
npm ci
```

El proyecto Xcode ya está generado en `src-tauri/gen/apple`. Solo se necesita `npx tauri ios init` si esa carpeta no existe. Volver a ejecutarlo regenera el proyecto y puede pisar cambios manuales.

---

## 3. Ejecutar en el simulador

```bash
npx tauri ios dev "iPhone 17 Pro"
```

Para ver los simuladores disponibles: `xcrun simctl list devices available`.

Para trabajar desde Xcode: `npx tauri ios dev --open` o abrir `src-tauri/gen/apple/net-terminal.xcodeproj`, elegir el esquema `net-terminal_iOS` y pulsar **Run**.

---

## 4. Compilar desde la línea de comandos

| Objetivo | Comando |
| :--- | :--- |
| Simulador (arm64, debug) | `npx tauri ios build --target aarch64-sim --debug` |
| Dispositivo sin firma (Release) | `xcodebuild -project src-tauri/gen/apple/net-terminal.xcodeproj -scheme net-terminal_iOS -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath build/device ARCHS=arm64 CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build` |

El `.app` de simulador queda en `src-tauri/gen/apple/build/`. El `.app` de dispositivo queda en `build/device/Build/Products/Release-iphoneos/`.

El flujo completo también corre en GitHub Actions (`.github/workflows/ios.yml`). Ese workflow publica un `.zip` con el `.app` de simulador y un `.ipa` sin firma.

---

## 5. Instalar en un iPhone 17 Pro (o cualquier iPhone o iPad)

### 5.1 Con Apple ID gratuito (sin membresía de pago)

1. En Xcode: **Settings › Accounts › +**, agregar tu Apple ID.
2. Abrir `src-tauri/gen/apple/net-terminal.xcodeproj`.
3. Seleccionar el target **net-terminal_iOS** y la pestaña **Signing & Capabilities**.
4. Marcar **Automatically manage signing** y elegir tu **Team** (aparece como "Personal Team").
5. Si el *Bundle Identifier* `cl.netterminal.app` ya está en uso por otra cuenta, cambiarlo por uno propio (por ejemplo, `cl.netterminal.app.tuusuario`). Este cambio es local y no debe subirse al repositorio.
6. En el iPhone: **Ajustes › Privacidad y seguridad › Modo desarrollador** (activar y reiniciar).
7. Conectar el iPhone por cable, elegir el dispositivo como destino y pulsar **Run**.
8. En el iPhone: **Ajustes › General › VPN y gestión de dispositivos**, confiar en tu Apple ID.

Limitaciones de la cuenta gratuita:

- El perfil de aprovisionamiento vence a los **7 días**. Hay que volver a compilar e instalar desde Xcode.
- Máximo **3 apps** de desarrollo instaladas por dispositivo y **10 App IDs** por semana, según la documentación de Apple.
- No permite distribuir un enlace de instalación a terceros.

### 5.2 Con membresía paga (Apple Developer Program)

Con la membresía, el perfil vence al año, se pueden instalar más apps y se habilitan TestFlight y App Store Connect. El costo informado por Apple es **USD 99 al año**, con precio local en algunos países.

Fuente: [Apple Developer, comparación de membresías](https://developer.apple.com/support/compare-memberships/). Los límites de la cuenta gratuita se tomaron de fuentes secundarias y deben validarse en esa misma página antes de tomar decisiones de presupuesto.

---

## 6. Instalar un .ipa sin firma (sideload)

El `.ipa` de la sección de releases de GitHub no trae firma de Apple. Debe firmarse al instalarlo:

- **AltStore** (Mac o Windows): requiere AltServer ejecutándose en el equipo y el iPhone en la misma red Wi-Fi.
- **Sideloadly** (Mac o Windows): conectar el iPhone por cable, arrastrar el `.ipa` y entregar el Apple ID.
- **Xcode**: importar el `.ipa` con **Window › Devices and Simulators** o instalar la carpeta `.app` como en la sección 5.1.

Verificar la integridad antes de instalar:

```bash
shasum -a 256 -c SHA256SUMS
```

---

## 7. iPad

El proyecto declara orientación vertical y horizontal para iPad. Antes de publicar una versión, probar en un simulador de iPad (por ejemplo, `npx tauri ios dev "iPad Air 11-inch (M3)"`). El nombre exacto depende de la versión de Xcode instalada.

---

## 8. Limitaciones frente a la edición Android

| Función | Android | iOS |
| :--- | :---: | :---: |
| Serial USB-OTG | Sí | No |
| Shell local (PTY `/bin/sh`) | Sí | No |
| Puertos de servidores de terreno | > 1024 (6969, 8021, 5140) | Por confirmar |

Otras diferencias a considerar:

- iOS suspende las conexiones de red cuando la app pasa a segundo plano. Para transferencias de firmware por TFTP o FTP, mantener la app en primer plano.
- iOS solicita permiso de red local la primera vez que la app accede a la LAN. Sin ese permiso, las conexiones a equipos locales fallan. Revisar el `Info.plist` antes de publicar.

---

## 9. Solución de problemas

- **`Xcode 16 o superior` requerido:** actualizar Xcode y ejecutar `sudo xcode-select -s /Applications/Xcode.app`.
- **Falla la firma en el dispositivo:** revisar el Team, el Bundle Identifier y que el Modo desarrollador esté activo.
- **La app se cierra al abrir en el iPhone:** confirmar que la plataforma del `.app` sea `iphoneos` (no `iphonesimulator`).
