# NetTerminal para Android (`NetTerminal_Android`)

Port móvil oficial y de código abierto de **NetTerminal** para dispositivos Android (smartphones, tablets y emuladores). Permite a ingenieros de redes, administradores de sistemas y técnicos de telecomunicaciones conectarse a routers, switches, firewalls y servidores directamente desde su dispositivo móvil.

Repositorio del fork Android: [https://github.com/Parzval-Net/NetTerminal_Android](https://github.com/Parzval-Net/NetTerminal_Android)

---

## Características del Port Android

- **Núcleo nativo ultraliviano:** Compilado con **Tauri 2 Mobile** y Rust, con consumo mínimo de batería y memoria.
- **Barra de teclas especiales de red:** Botones dedicados en pantalla táctil para las teclas indispensables en la gestión de equipos de red:
  - `Esc`: Salir de modos o cancelar comandos interactivos.
  - `Tab`: Autocompletado de comandos en CLI de Cisco, Huawei, Juniper, Aruba, Fortinet.
  - `Ctrl`: Modificador táctil para atajos como `Ctrl+C` (interrupción), `Ctrl+Z` (volver al modo privilegiado), `Ctrl+Shift+6` (abortar ping/traceroute/DNS en Cisco).
  - `?`: Ayuda contextual inmediata sin tener que buscar el carácter en el teclado móvil.
  - `|`: Pipe de filtrado rápido (`| include`, `| section`, `| begin`, `| match`).
  - `↑` `↓` `←` `→`: Navegación rápida por el historial de comandos y desplazamiento en la línea de edición.
- **Teclado virtual optimizado:** Configuración nativa `windowSoftInputMode="adjustResize"` en `MainActivity`, garantizando que el teclado táctil de Android redimensione la terminal sin tapar el prompt ni cortar la visualización de la sesión.
- **Permisos de conectividad de red:** Declaración nativa en `AndroidManifest.xml` de `INTERNET`, `ACCESS_NETWORK_STATE` y `ACCESS_WIFI_STATE` para permitir diagnósticos y gestión tanto en redes Wi-Fi locales como a través de túneles VPN corporativos.
- **Protocolos y herramientas operativas:**
  - Telnet nativo y TCP Crudo (puertos consola y servidores de terminales).
  - SNMP v1, v2c y v3 (consultas de interfaces, estado y receptor de traps).
  - Servidores y clientes locales para transferencias rápidas: TFTP, HTTP y FTP con verificación MD5.
  - Herramientas de diagnóstico de enlace: Ping, Traceroute, calculadora de subredes y Speedtest.
  - Bóveda de credenciales cifrada con Argon2id + XChaCha20-Poly1305 para guardar credenciales de forma segura.
  - Catálogo de 2.776 comandos verificados por fabricante con detector de plataforma.
  - Visualización de topología de vecinos CDP/LLDP.

---

## ☁️ Compilación Gratuita en la Nube (GitHub Actions)

No necesitas instalar Android Studio, Java ni el SDK/NDK de Android en tu computadora. Puedes compilar el instalador `.apk` de manera 100% gratuita usando los servidores de GitHub Actions:

### Paso 1: Subir el proyecto a GitHub
Sube tu código a tu repositorio `https://github.com/Parzval-Net/NetTerminal_Android`:

```bash
# Si es la primera vez que configuras el origen:
git remote set-url origin https://github.com/Parzval-Net/NetTerminal_Android.git
git branch -M main
git push -u origin main
```

### Paso 2: Disparar la compilación automática
El workflow de compilación [`.github/workflows/android.yml`](.github/workflows/android.yml) se ejecuta automáticamente:
1. En cada `git push` a la rama `main`.
2. Manualmente en la pestaña **Actions** de GitHub › Seleccionar **Android Build** › Clic en **Run workflow**.
3. Al publicar un tag de versión (ejemplo: `git tag v0.9.19 && git push origin v0.9.19`).

### Paso 3: Descargar el APK listo para instalar
1. Entra a tu repositorio en GitHub y ve a la pestaña **Actions**.
2. Haz clic en la última ejecución completada del workflow **Android Build**.
3. En la sección **Artifacts**, descarga el archivo comprimido **NetTerminal-Android-v...**.
4. Descomprímelo para obtener los archivos `.apk` generados:
   - `NetTerminal_<version>_universal.apk`: Compatible con todos los procesadores Android (recomendado para cualquier teléfono o tablet).
   - `NetTerminal_<version>_arm64-v8a.apk`: Optimizado para dispositivos modernos de 64 bits (la gran mayoría de teléfonos actuales).
   - `NetTerminal_<version>_armeabi-v7a.apk`: Compatible con dispositivos de 32 bits más antiguos.
   - `NetTerminal_<version>_x86_64.apk`: Compatible con emuladores Android, Chromebooks y dispositivos Intel/AMD.
   - `SHA256SUMS-android.txt`: Hashes criptográficos para verificar la integridad de las descargas.
5. Pasa el `.apk` a tu teléfono o ábrelo directamente desde el navegador móvil. Si el sistema lo solicita, habilita la opción **Instalar aplicaciones desconocidas** para tu navegador o explorador de archivos.

> [!TIP]
> **Firma automática de prueba:** Si aún no has configurado tus secretos de firma de producción, GitHub Actions firma los APKs automáticamente con una clave segura de prueba (`debug.keystore`), permitiendo que el APK se instale y funcione de inmediato en cualquier dispositivo físico.

---

## 🔑 Firma de Release para Producción (Opcional)

Si deseas firmar tus APKs con tu propia firma oficial de release para distribución corporativa o Google Play:

1. Genera tu almacén de claves (keystore) si no tienes uno:
   ```bash
   keytool -genkey -v -keystore netterminal-release.jks -alias netterminal \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Convierte el archivo `.jks` a Base64:
   ```bash
   # En macOS:
   base64 -i netterminal-release.jks | pbcopy
   # En Linux:
   base64 -w 0 netterminal-release.jks
   ```
3. En tu repositorio de GitHub, ve a **Settings** › **Secrets and variables** › **Actions** y crea los siguientes **Repository secrets**:
   - `ANDROID_KEYSTORE_BASE64`: El contenido base64 del archivo `.jks`.
   - `ANDROID_KEYSTORE_PASSWORD`: La contraseña de tu almacén de claves.
   - `ANDROID_KEY_ALIAS`: El alias de la clave (ejemplo: `netterminal`).
   - `ANDROID_KEY_PASSWORD`: La contraseña de la clave.

En la siguiente ejecución, GitHub Actions firmará automáticamente los APKs con tu clave oficial de release.

---

## 💻 Compilación Local (macOS, Linux o Windows)

Si prefieres compilar o depurar la aplicación en tu entorno local:

### 1. Requisitos Previos

- **Node.js:** Versión 22 o superior (`node -v`).
- **Rust:** Versión stable (`rustc -vV`).
  - Agrega los targets de Android con rustup:
    ```bash
    rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android
    ```
- **Java JDK:** Java 17 o 21 (Temurin u OpenJDK).
- **Android SDK y NDK:**
  - Instala Android Studio o las herramientas de línea de comandos de Android.
  - Instala NDK (versión 26, 27 o 28) desde el SDK Manager de Android Studio (`Settings > Languages & Frameworks > Android SDK > SDK Tools > NDK (Side by side)`).
  - Configura tus variables de entorno en tu shell (`~/.zshrc` o `~/.bashrc`):
    ```bash
    export ANDROID_HOME="$HOME/Library/Android/sdk" # En macOS
    # export ANDROID_HOME="/usr/local/lib/android/sdk" # En Linux
    export NDK_HOME="$ANDROID_HOME/ndk/27.2.12479018" # Ajusta según tu versión instalada
    export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
    ```

### 2. Inicialización y Preparación del Proyecto

Ejecuta el script automatizado para inicializar la estructura Android y aplicar los parches de red y teclado:

```bash
chmod +x scripts/setup-android.sh
./scripts/setup-android.sh
```

El script se encargará de:
1. Detectar automáticamente tu `ANDROID_HOME` y `NDK_HOME`.
2. Inicializar la plantilla de Tauri Mobile (`npx tauri android init`).
3. Inyectar los permisos `INTERNET`, `ACCESS_NETWORK_STATE` y `ACCESS_WIFI_STATE` en `AndroidManifest.xml`.
4. Configurar `windowSoftInputMode="adjustResize"` en `MainActivity` para que el teclado virtual no interfiera con la terminal.
5. Ajustar `minSdk = 26` en Gradle.

### 3. Comandos de Compilación y Desarrollo

En `package.json` dispones de los siguientes scripts directos:

```bash
# Inicializar o regenerar el proyecto Android
npm run android:init

# Ejecutar en vivo con recarga rápida en un dispositivo o emulador conectado
npm run android:dev

# Compilar los paquetes instaladores (.apk) de producción
npm run android:build

# Compilar el Android App Bundle (.aab) para publicar en Google Play Store
npm run android:aab
```

Los APKs compilados localmente se generarán en:
`src-tauri/gen/android/app/build/outputs/apk/`

---

## 🚀 Cómo Subir y Sincronizar el Fork con GitHub

Para sincronizar tu espacio de trabajo local con el repositorio remoto de GitHub:

```bash
# 1. Verificar el remoto actual
git remote -v

# 2. Si apunta al repositorio original, cámbialo a tu fork Android:
git remote set-url origin https://github.com/Parzval-Net/NetTerminal_Android.git

# 3. Comprobar archivos modificados
git status

# 4. Agregar y commitear todos los cambios
git add .
git commit -m "feat(android): configuración completa de compilación Tauri Mobile, CI/CD y documentación"

# 5. Enviar a la rama principal
git push origin main

# 6. Para publicar una versión oficial con Release automático en GitHub:
git tag v0.9.19
git push origin v0.9.19
```

Al subir el tag `v0.9.19`, GitHub Actions compilará automáticamente los APKs firmados y los adjuntará al Release de [https://github.com/Parzval-Net/NetTerminal_Android/releases](https://github.com/Parzval-Net/NetTerminal_Android/releases) para que cualquier persona pueda descargarlos con un solo clic.
