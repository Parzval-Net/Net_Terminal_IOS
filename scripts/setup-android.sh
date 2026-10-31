#!/usr/bin/env bash
set -euo pipefail

# scripts/setup-android.sh
# Automatización de preparación, inicialización y parcheo de Android para NetTerminal
# Repositorio: Parzval-Net/NetTerminal_Android

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$ROOT_DIR"

echo "=========================================================="
echo "  NetTerminal Android: Configuración y Parcheo de Build   "
echo "=========================================================="

# 1. Detectar o configurar variables de entorno ANDROID_HOME y NDK_HOME
if [ -z "${ANDROID_HOME:-}" ]; then
  if [ -n "${ANDROID_SDK_ROOT:-}" ] && [ -d "$ANDROID_SDK_ROOT" ]; then
    export ANDROID_HOME="$ANDROID_SDK_ROOT"
  elif [ -d "$HOME/Library/Android/sdk" ]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
  elif [ -d "/opt/homebrew/share/android-commandlinetools" ]; then
    export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
  elif [ -d "/usr/local/lib/android/sdk" ]; then
    export ANDROID_HOME="/usr/local/lib/android/sdk"
  fi
fi

if [ -n "${ANDROID_HOME:-}" ]; then
  echo "✔ ANDROID_HOME detectado: $ANDROID_HOME"
else
  echo "⚠ ANDROID_HOME no está definido. Asegúrate de tener Android SDK configurado."
fi

if [ -z "${NDK_HOME:-}" ]; then
  if [ -n "${ANDROID_NDK_HOME:-}" ] && [ -d "$ANDROID_NDK_HOME" ]; then
    export NDK_HOME="$ANDROID_NDK_HOME"
  elif [ -n "${ANDROID_NDK_ROOT:-}" ] && [ -d "$ANDROID_NDK_ROOT" ]; then
    export NDK_HOME="$ANDROID_NDK_ROOT"
  elif [ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME/ndk" ]; then
    # Tomar la última versión de NDK instalada
    LATEST_NDK=$(ls -1d "$ANDROID_HOME/ndk/"* 2>/dev/null | sort -V | tail -n 1 || true)
    if [ -n "$LATEST_NDK" ] && [ -d "$LATEST_NDK" ]; then
      export NDK_HOME="$LATEST_NDK"
    fi
  fi
fi

if [ -n "${NDK_HOME:-}" ]; then
  echo "✔ NDK_HOME detectado: $NDK_HOME"
else
  echo "⚠ NDK_HOME no está definido. Tauri Android lo requerirá para compilar el código Rust."
fi

# 2. Inicializar proyecto Android si no existe
ANDROID_DIR="$ROOT_DIR/src-tauri/gen/android"
if [ ! -d "$ANDROID_DIR" ] || [ ! -f "$ANDROID_DIR/app/build.gradle.kts" ]; then
  echo "→ Inicializando proyecto Android con Tauri CLI..."
  npx tauri android init --ci
else
  echo "✔ Proyecto Android ya inicializado en $ANDROID_DIR"
fi

# 3. Parchear AndroidManifest.xml (Permisos de Red y SoftInput adjustResize)
MANIFEST_FILE="$ANDROID_DIR/app/src/main/AndroidManifest.xml"
if [ -f "$MANIFEST_FILE" ]; then
  echo "→ Parcheando AndroidManifest.xml con permisos de red y windowSoftInputMode..."
  python3 - <<'PY'
import os, re

manifest_path = "src-tauri/gen/android/app/src/main/AndroidManifest.xml"
if not os.path.exists(manifest_path):
    print("Error: AndroidManifest.xml no encontrado.")
    exit(1)

with open(manifest_path, "r", encoding="utf-8") as f:
    content = f.read()

# Permisos requeridos para NetTerminal (cliente SSH, Telnet, SNMP, Ping, HTTP, TFTP)
required_permissions = [
    '<uses-permission android:name="android.permission.INTERNET" />',
    '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
    '<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />'
]

# Insertar permisos si faltan
for perm in required_permissions:
    if perm not in content:
        # Insertar justo después de <manifest ...>
        manifest_tag = re.search(r'<manifest[^>]*>', content)
        if manifest_tag:
            insert_pos = manifest_tag.end()
            content = content[:insert_pos] + "\n    " + perm + content[insert_pos:]
            print(f"  + Agregado permiso: {perm}")
        else:
            print(f"  ! Advertencia: no se encontró etiqueta <manifest> para {perm}")
    else:
        print(f"  ✔ Permiso ya presente: {perm}")

# Asegurar android:windowSoftInputMode="adjustResize" en MainActivity para terminal óptima con teclado virtual
activity_match = re.search(r'(<activity[^>]*android:name="\.MainActivity"[^>]*)>', content)
if activity_match:
    activity_tag = activity_match.group(1)
    if 'android:windowSoftInputMode' not in activity_tag:
        new_tag = activity_tag + '\n            android:windowSoftInputMode="adjustResize">'
        content = content[:activity_match.start()] + new_tag + content[activity_match.end():]
        print("  + Agregado android:windowSoftInputMode=\"adjustResize\" a MainActivity")
    else:
        print("  ✔ android:windowSoftInputMode ya configurado en MainActivity")
else:
    # Intento alternativo por si el atributo name está antes o después
    if 'android:windowSoftInputMode="adjustResize"' not in content:
        content = content.replace(
            'android:name=".MainActivity"',
            'android:name=".MainActivity"\n            android:windowSoftInputMode="adjustResize"'
        )
        print("  + Reemplazado atributo para agregar windowSoftInputMode=\"adjustResize\"")

with open(manifest_path, "w", encoding="utf-8") as f:
    f.write(content)

print("✔ AndroidManifest.xml actualizado con éxito.")
PY
else
  echo "⚠ No se encontró $MANIFEST_FILE"
fi

# 4. Asegurar minSdkVersion 26 en app/build.gradle.kts
BUILD_GRADLE="$ANDROID_DIR/app/build.gradle.kts"
if [ -f "$BUILD_GRADLE" ]; then
  echo "→ Verificando minSdkVersion en app/build.gradle.kts..."
  python3 - <<'PY'
import os, re

gradle_path = "src-tauri/gen/android/app/build.gradle.kts"
with open(gradle_path, "r", encoding="utf-8") as f:
    gradle_content = f.read()

# Actualizar minSdk a 26 si está en 24 o menor
if "minSdk = 24" in gradle_content:
    gradle_content = gradle_content.replace("minSdk = 24", "minSdk = 26")
    with open(gradle_path, "w", encoding="utf-8") as f:
        f.write(gradle_content)
    print("  ✔ minSdk actualizado a 26 en build.gradle.kts")
else:
    print("  ✔ minSdk ya configurado correctamente")
PY
fi

# 5. Parchear MainActivity.kt para manejar WindowInsets (systemBars + displayCutout + IME teclado)
# En Android 15/16 (API 35/36), enableEdgeToEdge() hace que el WebView quede debajo de la barra
# de estado (reloj/batería) y la barra de gestos inferior si no se aplican los WindowInsets al contenedor.
MAIN_ACTIVITY="$ANDROID_DIR/app/src/main/java/cl/netterminal/app/MainActivity.kt"
if [ -f "$MAIN_ACTIVITY" ]; then
  cat > "$MAIN_ACTIVITY" <<'KT'
package cl.netterminal.app

import android.os.Bundle
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val content = findViewById<android.view.View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
  }
}
KT
  echo "✔ MainActivity.kt configurado con WindowInsets (systemBars + displayCutout + IME)"
fi

# 6. Asegurar permisos de ejecución para Gradle wrapper
if [ -f "$ANDROID_DIR/gradlew" ]; then
  chmod +x "$ANDROID_DIR/gradlew"
  echo "✔ Permisos de ejecución aplicados a gradlew"
fi

echo "=========================================================="
echo "✔ Configuración de Android finalizada exitosamente."
echo "  Puedes ejecutar: npm run android:build"
echo "=========================================================="
