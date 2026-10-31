//! Piezas criptográficas compartidas por la bóveda de credenciales y las notas protegidas:
//! derivación Argon2id, cifrado XChaCha20-Poly1305 con la cabecera como AAD, escritura
//! atómica con permisos 600 y espera exponencial tras contraseñas incorrectas.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use std::path::Path;
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

/// Parámetros de Argon2id (memoria en KiB).
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Kdf {
    pub m: u32,
    pub t: u32,
    pub p: u32,
}

/// Recomendación OWASP para Argon2id con 64 MiB (m=64 MiB, t=3, p=1).
pub const KDF_DEFAULT: Kdf = Kdf { m: 64 * 1024, t: 3, p: 1 };

impl Kdf {
    /// Límites al leer un archivo: uno manipulado no debe pedir gigas de memoria.
    pub fn sane(&self) -> bool {
        (8..=1024 * 1024).contains(&self.m) && (1..=10).contains(&self.t) && (1..=8).contains(&self.p)
    }

    pub fn encode(&self, out: &mut [u8]) {
        out[..4].copy_from_slice(&self.m.to_le_bytes());
        out[4..8].copy_from_slice(&self.t.to_le_bytes());
        out[8..12].copy_from_slice(&self.p.to_le_bytes());
    }

    pub fn decode(b: &[u8]) -> Kdf {
        let u = |i: usize| u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]);
        Kdf { m: u(0), t: u(4), p: u(8) }
    }
}

/// Llena `buf` con bytes del RNG del sistema (getrandom). Igual que el `OsRng` anterior, una
/// falla del RNG del sistema detiene la app: no se cifra ni se crea una llave con datos predecibles.
pub fn fill_random(buf: &mut [u8]) {
    getrandom::fill(buf).expect("RNG del sistema no disponible");
}

pub fn random<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    fill_random(&mut b);
    b
}

pub fn derive(password: &str, salt: &[u8], kdf: Kdf) -> Result<Zeroizing<[u8; 32]>, String> {
    let params = Params::new(kdf.m, kdf.t, kdf.p, Some(32)).map_err(|e| e.to_string())?;
    let mut key = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, key.as_mut())
        .map_err(|e| e.to_string())?;
    Ok(key)
}

/// Cifra `plain` autenticando también `aad` (la cabecera, que incluye el nonce).
pub fn encrypt(key: &[u8; 32], nonce: &[u8; 24], plain: &[u8], aad: &[u8]) -> Result<Vec<u8>, String> {
    XChaCha20Poly1305::new(Key::cast_from_core(key))
        .encrypt(XNonce::cast_from_core(nonce), Payload { msg: plain, aad })
        .map_err(|_| "No se pudo cifrar".to_string())
}

/// Descifra; Err(()) si la llave es incorrecta o el archivo fue alterado (no se distinguen).
pub fn decrypt(key: &[u8; 32], nonce: &[u8; 24], ct: &[u8], aad: &[u8]) -> Result<Zeroizing<Vec<u8>>, ()> {
    XChaCha20Poly1305::new(Key::cast_from_core(key))
        .decrypt(XNonce::cast_from_core(nonce), Payload { msg: ct, aad })
        .map(Zeroizing::new)
        .map_err(|_| ())
}

/// Escritura atómica con permisos 600 desde la creación (Unix). El temporal (`<archivo>.tmp`)
/// recibe los mismos bytes que el destino: solo se usa con contenido ya cifrado.
pub fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    let tmp = path.with_file_name(name);
    let _ = std::fs::remove_file(&tmp);
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let result = (|| {
        let mut f = opts.open(&tmp).map_err(|e| e.to_string())?;
        f.write_all(data).and_then(|_| f.sync_all()).map_err(|e| e.to_string())?;
        drop(f);
        std::fs::rename(&tmp, path).map_err(|e| e.to_string())?;
        // El rename queda en disco solo cuando se sincroniza la carpeta (ext4/APFS ante un corte).
        #[cfg(unix)]
        if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
            let _ = std::fs::File::open(dir).and_then(|d| d.sync_all());
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Espera exponencial tras intentos fallidos de contraseña (1, 2, 4… hasta 60 s).
#[derive(Default)]
pub struct Throttle {
    failures: u32,
    pub(crate) retry_at: Option<Instant>,
}

impl Throttle {
    pub fn check(&self) -> Result<(), String> {
        if let Some(at) = self.retry_at {
            let now = Instant::now();
            if now < at {
                return Err(format!("Demasiados intentos. Espera {} s", (at - now).as_secs() + 1));
            }
        }
        Ok(())
    }

    pub fn fail(&mut self) {
        self.failures = self.failures.saturating_add(1);
        let secs = 1u64 << (self.failures - 1).min(6);
        self.retry_at = Some(Instant::now() + Duration::from_secs(secs.min(60)));
    }

    pub fn reset(&mut self) {
        self.failures = 0;
        self.retry_at = None;
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn unhex(s: &str) -> Vec<u8> {
        let s: String = s.split_whitespace().collect();
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    // Vectores fijos para detectar cualquier cambio de salida al actualizar argon2 o
    // chacha20poly1305. Los valores esperados se verificaron con una implementación
    // independiente (OpenSSL vía `crypto.argon2Sync` y `chacha20-poly1305` de Node 24).
    const PW: &str = "correct horse battery staple";
    const SALT: [u8; 16] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

    #[test]
    fn argon2id_output_is_pinned() {
        let k = derive(PW, &SALT, KDF_DEFAULT).unwrap();
        assert_eq!(k.as_ref(), unhex("0d1a3c6523c8f06e4e0af9c515aa5b5448cfebd6838f2d52c3d8b6ef8ddc3c2e").as_slice());
        let k = derive(PW, &SALT, Kdf { m: 64, t: 1, p: 1 }).unwrap();
        assert_eq!(k.as_ref(), unhex("92dc5d67019623868bde079275e522f4b7e8213d3414ed85cbc2ac8a41117288").as_slice());
        assert_eq!(KDF_DEFAULT, Kdf { m: 65536, t: 3, p: 1 }, "parámetros por defecto: m=64 MiB, t=3, p=1");
        // Parámetros inválidos: error, sin pánico.
        assert!(derive(PW, &SALT, Kdf { m: 0, t: 0, p: 0 }).is_err());
        assert!(derive(PW, &[0u8; 4], Kdf { m: 64, t: 1, p: 1 }).is_err(), "sal demasiado corta");
    }

    /// Vector A.3.1 de draft-irtf-cfrg-xchacha (XChaCha20-Poly1305 con AAD).
    #[test]
    fn xchacha20poly1305_output_is_pinned() {
        let key: [u8; 32] = std::array::from_fn(|i| 0x80 + i as u8);
        let nonce: [u8; 24] = std::array::from_fn(|i| 0x40 + i as u8);
        let aad = unhex("50515253c0c1c2c3c4c5c6c7");
        let plain = b"Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.";
        let expected = unhex(
            "bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b4522f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff921f9664c97637da9768812f615c68b13b52e
             c0875924c1c7987947deafd8780acf49",
        );
        let ct = encrypt(&key, &nonce, plain, &aad).unwrap();
        assert_eq!(ct, expected);
        assert_eq!(decrypt(&key, &nonce, &ct, &aad).unwrap().as_slice(), plain);
        // AAD, nonce, llave o texto cifrado alterados: Err, sin pánico.
        assert!(decrypt(&key, &nonce, &ct, b"otra").is_err());
        let mut n2 = nonce;
        n2[23] ^= 1;
        assert!(decrypt(&key, &n2, &ct, &aad).is_err());
        let mut k2 = key;
        k2[0] ^= 1;
        assert!(decrypt(&k2, &nonce, &ct, &aad).is_err());
        let mut c2 = ct.clone();
        c2[0] ^= 1;
        assert!(decrypt(&key, &nonce, &c2, &aad).is_err());
        // Texto cifrado más corto que la etiqueta o vacío.
        assert!(decrypt(&key, &nonce, &ct[..5], &aad).is_err());
        assert!(decrypt(&key, &nonce, &[], &aad).is_err());
    }

    #[test]
    fn random_is_not_constant() {
        let (a, b) = (random::<24>(), random::<24>());
        assert_ne!(a, b);
        assert_ne!(a, [0u8; 24]);
    }

    #[test]
    fn throttle_grows_exponentially() {
        let mut t = Throttle::default();
        let wait = |t: &Throttle| t.retry_at.unwrap().saturating_duration_since(Instant::now()).as_secs_f64();
        assert!(t.check().is_ok());
        t.fail();
        assert!(t.check().unwrap_err().contains("Espera"));
        assert!((0.5..=1.0).contains(&wait(&t)));
        t.fail();
        t.fail();
        assert!((3.5..=4.0).contains(&wait(&t)));
        for _ in 0..20 {
            t.fail();
        }
        assert!((59.5..=60.0).contains(&wait(&t)), "tope de 60 s");
        t.reset();
        assert!(t.check().is_ok());
    }
}
