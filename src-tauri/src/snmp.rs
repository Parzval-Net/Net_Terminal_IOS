//! Cliente SNMP de prueba (v1, v2c y v3 con USM) y decodificación de traps.
//!
//! Codificación BER propia y acotada (RFC 3416, 3412 y 3414), con autenticación HMAC
//! (MD5/SHA-1 de RFC 3414 y SHA-2 de RFC 7860) y privacidad AES-128-CFB (RFC 3826) sobre
//! las primitivas de RustCrypto, más AES-192/256 en sus variantes Blumenthal y Reeder y
//! DES-CBC solo como legado para equipos antiguos (DES está roto). No se implementa SET:
//! es una herramienta de consulta.
//!
//! Los secretos (community y contraseñas v3) nunca se registran ni se devuelven a la
//! interfaz; viven en búferes que se borran al soltarse.

use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

// ---------- BER ----------

const T_INT: u8 = 0x02;
const T_OCTETS: u8 = 0x04;
const T_NULL: u8 = 0x05;
const T_OID: u8 = 0x06;
const T_SEQ: u8 = 0x30;
const T_IP: u8 = 0x40;
const T_COUNTER32: u8 = 0x41;
const T_GAUGE32: u8 = 0x42;
const T_TICKS: u8 = 0x43;
const T_OPAQUE: u8 = 0x44;
const T_COUNTER64: u8 = 0x46;
const T_NO_SUCH_OBJECT: u8 = 0x80;
const T_NO_SUCH_INSTANCE: u8 = 0x81;
const T_END_OF_MIB: u8 = 0x82;

pub const PDU_GET: u8 = 0xA0;
pub const PDU_GETNEXT: u8 = 0xA1;
pub const PDU_RESPONSE: u8 = 0xA2;
pub const PDU_TRAP_V1: u8 = 0xA4;
pub const PDU_GETBULK: u8 = 0xA5;
pub const PDU_INFORM: u8 = 0xA6;
pub const PDU_TRAP_V2: u8 = 0xA7;
pub const PDU_REPORT: u8 = 0xA8;

/// Tamaño máximo de mensaje que se acepta y se anuncia (msgMaxSize).
const MAX_MSG: usize = 65507;
/// Subidentificadores por OID (RFC 2578: máximo 128).
const MAX_OID_LEN: usize = 128;
/// Varbinds por mensaje recibido: acota la memoria ante un paquete hostil.
const MAX_VARBINDS: usize = 4096;

pub type Oid = Vec<u32>;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Int(i64),
    Str(Vec<u8>),
    Null,
    Oid(Oid),
    Ip([u8; 4]),
    Counter32(u32),
    Gauge32(u32),
    Ticks(u32),
    Opaque(Vec<u8>),
    Counter64(u64),
    NoSuchObject,
    NoSuchInstance,
    EndOfMib,
}

fn push_len(out: &mut Vec<u8>, n: usize) {
    if n < 0x80 {
        out.push(n as u8);
    } else {
        let bytes = (n as u32).to_be_bytes();
        let skip = bytes.iter().take_while(|b| **b == 0).count();
        out.push(0x80 | (4 - skip) as u8);
        out.extend(&bytes[skip..]);
    }
}

/// Largo de la cabecera (tipo + largo) de un TLV con `n` bytes de contenido.
fn hdr_len(n: usize) -> usize {
    match n {
        0..=0x7F => 2,
        0x80..=0xFF => 3,
        0x100..=0xFFFF => 4,
        0x1_0000..=0xFF_FFFF => 5,
        _ => 6,
    }
}

fn tlv(tag: u8, content: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(content.len() + 6);
    out.push(tag);
    push_len(&mut out, content.len());
    out.extend_from_slice(content);
    out
}

fn enc_int(v: i64) -> Vec<u8> {
    let bytes = v.to_be_bytes();
    let mut i = 0;
    // Forma mínima en complemento a dos.
    while i < 7 && ((bytes[i] == 0 && bytes[i + 1] & 0x80 == 0) || (bytes[i] == 0xFF && bytes[i + 1] & 0x80 != 0)) {
        i += 1;
    }
    tlv(T_INT, &bytes[i..])
}

fn enc_uint(tag: u8, v: u64) -> Vec<u8> {
    let bytes = v.to_be_bytes();
    let skip = bytes.iter().take(7).take_while(|b| **b == 0).count();
    let mut content = Vec::with_capacity(9);
    if bytes[skip] & 0x80 != 0 {
        content.push(0);
    }
    content.extend(&bytes[skip..]);
    tlv(tag, &content)
}

fn enc_oid(oid: &[u32]) -> Result<Vec<u8>, String> {
    if oid.len() < 2 || oid.len() > MAX_OID_LEN || oid[0] > 2 || (oid[0] < 2 && oid[1] >= 40) {
        return Err("OID inválido".into());
    }
    let mut content = Vec::with_capacity(oid.len() * 2);
    let mut push_arc = |mut v: u64| {
        let mut tmp = [0u8; 10];
        let mut n = 0;
        loop {
            tmp[n] = (v & 0x7F) as u8;
            v >>= 7;
            n += 1;
            if v == 0 {
                break;
            }
        }
        for i in (0..n).rev() {
            content.push(tmp[i] | if i > 0 { 0x80 } else { 0 });
        }
    };
    push_arc(oid[0] as u64 * 40 + oid[1] as u64);
    for &a in &oid[2..] {
        push_arc(a as u64);
    }
    Ok(tlv(T_OID, &content))
}

fn enc_value(v: &Value) -> Result<Vec<u8>, String> {
    Ok(match v {
        Value::Int(i) => enc_int(*i),
        Value::Str(s) => tlv(T_OCTETS, s),
        Value::Null => tlv(T_NULL, &[]),
        Value::Oid(o) => enc_oid(o)?,
        Value::Ip(ip) => tlv(T_IP, ip),
        Value::Counter32(n) => enc_uint(T_COUNTER32, *n as u64),
        Value::Gauge32(n) => enc_uint(T_GAUGE32, *n as u64),
        Value::Ticks(n) => enc_uint(T_TICKS, *n as u64),
        Value::Opaque(b) => tlv(T_OPAQUE, b),
        Value::Counter64(n) => enc_uint(T_COUNTER64, *n),
        Value::NoSuchObject => tlv(T_NO_SUCH_OBJECT, &[]),
        Value::NoSuchInstance => tlv(T_NO_SUCH_INSTANCE, &[]),
        Value::EndOfMib => tlv(T_END_OF_MIB, &[]),
    })
}

/// Lector BER sobre un búfer. Solo largos definidos y acotados al búfer.
struct Rd<'a> {
    b: &'a [u8],
    p: usize,
}

const BAD: &str = "Respuesta SNMP mal formada";

impl<'a> Rd<'a> {
    fn new(b: &'a [u8]) -> Self {
        Rd { b, p: 0 }
    }

    fn done(&self) -> bool {
        self.p >= self.b.len()
    }

    fn tlv(&mut self) -> Result<(u8, &'a [u8]), String> {
        let tag = *self.b.get(self.p).ok_or(BAD)?;
        // Tipos de varios bytes (0x1F) no existen en SNMP.
        if tag & 0x1F == 0x1F {
            return Err(BAD.into());
        }
        let first = *self.b.get(self.p + 1).ok_or(BAD)? as usize;
        let mut p = self.p + 2;
        let len = if first < 0x80 {
            first
        } else {
            let n = first & 0x7F;
            // 0x80 sería largo indefinido (prohibido en SNMP); más de 3 bytes excede MAX_MSG.
            if n == 0 || n > 3 {
                return Err(BAD.into());
            }
            let bytes = self.b.get(p..p + n).ok_or(BAD)?;
            p += n;
            bytes.iter().fold(0usize, |acc, b| (acc << 8) | *b as usize)
        };
        let content = self.b.get(p..p.checked_add(len).ok_or(BAD)?).ok_or(BAD)?;
        self.p = p + len;
        Ok((tag, content))
    }

    fn expect(&mut self, tag: u8) -> Result<&'a [u8], String> {
        match self.tlv()? {
            (t, c) if t == tag => Ok(c),
            _ => Err(BAD.into()),
        }
    }

    fn int(&mut self) -> Result<i64, String> {
        dec_int(self.expect(T_INT)?)
    }
}

fn dec_int(c: &[u8]) -> Result<i64, String> {
    if c.is_empty() || c.len() > 8 {
        return Err(BAD.into());
    }
    let mut v: i64 = if c[0] & 0x80 != 0 { -1 } else { 0 };
    for b in c {
        v = (v << 8) | *b as i64;
    }
    Ok(v)
}

/// Entero sin signo (Counter, Gauge, TimeTicks, Counter64). Tolera agentes que omiten el
/// cero inicial y codifican el valor como si fuera negativo.
fn dec_uint(c: &[u8], max_bytes: usize) -> Result<u64, String> {
    let c = if c.len() > 1 && c[0] == 0 { &c[1..] } else { c };
    if c.is_empty() || c.len() > max_bytes {
        return Err(BAD.into());
    }
    Ok(c.iter().fold(0u64, |acc, b| (acc << 8) | *b as u64))
}

fn dec_oid(c: &[u8]) -> Result<Oid, String> {
    if c.is_empty() {
        return Err(BAD.into());
    }
    let mut arcs: Vec<u64> = Vec::with_capacity(c.len() + 1);
    let mut cur: u64 = 0;
    let mut started = false;
    for (i, &b) in c.iter().enumerate() {
        if !started && b == 0x80 {
            return Err(BAD.into()); // relleno no mínimo
        }
        started = true;
        cur = (cur << 7) | (b & 0x7F) as u64;
        if cur > u32::MAX as u64 * 2 + 80 {
            return Err(BAD.into());
        }
        if b & 0x80 == 0 {
            arcs.push(cur);
            cur = 0;
            started = false;
        } else if i == c.len() - 1 {
            return Err(BAD.into());
        }
        if arcs.len() > MAX_OID_LEN {
            return Err(BAD.into());
        }
    }
    let first = arcs[0];
    let (a, b) = if first < 80 { (first / 40, first % 40) } else { (2, first - 80) };
    let mut oid = vec![a as u32, u32::try_from(b).map_err(|_| BAD)?];
    for &x in &arcs[1..] {
        oid.push(u32::try_from(x).map_err(|_| BAD)?);
    }
    Ok(oid)
}

fn dec_value(tag: u8, c: &[u8]) -> Result<Value, String> {
    Ok(match tag {
        T_INT => Value::Int(dec_int(c)?),
        T_OCTETS => Value::Str(c.to_vec()),
        T_NULL => Value::Null,
        T_OID => Value::Oid(dec_oid(c)?),
        T_IP => Value::Ip(c.try_into().map_err(|_| BAD)?),
        T_COUNTER32 => Value::Counter32(dec_uint(c, 4)? as u32),
        T_GAUGE32 => Value::Gauge32(dec_uint(c, 4)? as u32),
        T_TICKS => Value::Ticks(dec_uint(c, 4)? as u32),
        T_OPAQUE => Value::Opaque(c.to_vec()),
        T_COUNTER64 => Value::Counter64(dec_uint(c, 8)?),
        T_NO_SUCH_OBJECT => Value::NoSuchObject,
        T_NO_SUCH_INSTANCE => Value::NoSuchInstance,
        T_END_OF_MIB => Value::EndOfMib,
        _ => return Err(format!("Tipo SNMP desconocido 0x{tag:02X}")),
    })
}

pub fn parse_oid(s: &str) -> Result<Oid, String> {
    let s = s.trim().trim_start_matches('.');
    let err = || format!("OID inválido: {}", s.chars().take(80).collect::<String>());
    let oid: Oid = s.split('.').map(|p| p.parse::<u32>().map_err(|_| err())).collect::<Result<_, _>>()?;
    enc_oid(&oid).map_err(|_| err())?;
    Ok(oid)
}

pub fn oid_str(oid: &[u32]) -> String {
    oid.iter().map(|a| a.to_string()).collect::<Vec<_>>().join(".")
}

// ---------- PDU y mensajes ----------

#[derive(Debug, Clone, PartialEq)]
pub struct Pdu {
    pub kind: u8,
    pub req_id: i32,
    /// error-status (o non-repeaters en GETBULK).
    pub err_status: i64,
    /// error-index (o max-repetitions en GETBULK).
    pub err_index: i64,
    pub vbs: Vec<(Oid, Value)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct V1Trap {
    pub enterprise: Oid,
    pub agent: [u8; 4],
    pub generic: i64,
    pub specific: i64,
    pub ticks: u32,
    pub vbs: Vec<(Oid, Value)>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Body {
    Pdu(Pdu),
    V1Trap(V1Trap),
}

fn enc_vbs(vbs: &[(Oid, Value)]) -> Result<Vec<u8>, String> {
    let mut list = Vec::new();
    for (oid, v) in vbs {
        let mut vb = enc_oid(oid)?;
        vb.extend(enc_value(v)?);
        list.extend(tlv(T_SEQ, &vb));
    }
    Ok(tlv(T_SEQ, &list))
}

pub fn enc_pdu(p: &Pdu) -> Result<Vec<u8>, String> {
    let mut c = enc_int(p.req_id as i64);
    c.extend(enc_int(p.err_status));
    c.extend(enc_int(p.err_index));
    c.extend(enc_vbs(&p.vbs)?);
    Ok(tlv(p.kind, &c))
}

fn dec_vbs(c: &[u8]) -> Result<Vec<(Oid, Value)>, String> {
    let mut rd = Rd::new(c);
    let mut out = Vec::new();
    while !rd.done() {
        if out.len() >= MAX_VARBINDS {
            return Err(BAD.into());
        }
        let mut vb = Rd::new(rd.expect(T_SEQ)?);
        let oid = dec_oid(vb.expect(T_OID)?)?;
        let (tag, val) = vb.tlv()?;
        out.push((oid, dec_value(tag, val)?));
    }
    Ok(out)
}

fn dec_body(tag: u8, c: &[u8]) -> Result<Body, String> {
    let mut rd = Rd::new(c);
    if tag == PDU_TRAP_V1 {
        let enterprise = dec_oid(rd.expect(T_OID)?)?;
        let agent: [u8; 4] = rd.expect(T_IP)?.try_into().map_err(|_| BAD)?;
        let generic = rd.int()?;
        let specific = rd.int()?;
        let ticks = dec_uint(rd.expect(T_TICKS)?, 4)? as u32;
        let vbs = dec_vbs(rd.expect(T_SEQ)?)?;
        return Ok(Body::V1Trap(V1Trap { enterprise, agent, generic, specific, ticks, vbs }));
    }
    if !(PDU_GET..=PDU_REPORT).contains(&tag) {
        return Err(BAD.into());
    }
    let req_id = i32::try_from(rd.int()?).map_err(|_| BAD)?;
    let err_status = rd.int()?;
    let err_index = rd.int()?;
    let vbs = dec_vbs(rd.expect(T_SEQ)?)?;
    Ok(Body::Pdu(Pdu { kind: tag, req_id, err_status, err_index, vbs }))
}

/// Mensaje v1 (versión 0) o v2c (versión 1).
pub fn enc_community(version: i64, community: &[u8], pdu: &Pdu) -> Result<Vec<u8>, String> {
    let mut c = enc_int(version);
    c.extend(tlv(T_OCTETS, community));
    c.extend(enc_pdu(pdu)?);
    Ok(tlv(T_SEQ, &c))
}

/// Parámetros de seguridad USM y datos de un mensaje v3 recibido.
#[derive(Debug)]
pub struct V3Msg {
    pub msg_id: i32,
    pub flags: u8,
    pub engine_id: Vec<u8>,
    pub boots: u32,
    pub time: u32,
    pub user: Vec<u8>,
    pub auth_params: Vec<u8>,
    /// Posición de msgAuthenticationParameters dentro del mensaje completo.
    pub auth_off: usize,
    pub priv_params: Vec<u8>,
    /// ScopedPDU en claro (SEQUENCE completo) o cifrado (contenido del OCTET STRING).
    pub data: Vec<u8>,
    pub encrypted: bool,
    /// Mensaje completo (para verificar el HMAC).
    pub raw: Vec<u8>,
}

#[derive(Debug)]
pub enum Message {
    Community { version: i64, community: Vec<u8>, body: Body },
    V3(V3Msg),
}

const FLAG_AUTH: u8 = 0x01;
const FLAG_PRIV: u8 = 0x02;
const FLAG_REPORTABLE: u8 = 0x04;

fn offset(whole: &[u8], part: &[u8]) -> usize {
    part.as_ptr() as usize - whole.as_ptr() as usize
}

pub fn decode(buf: &[u8]) -> Result<Message, String> {
    if buf.len() > MAX_MSG {
        return Err(BAD.into());
    }
    let mut outer = Rd::new(buf);
    let mut rd = Rd::new(outer.expect(T_SEQ)?);
    let version = rd.int()?;
    match version {
        0 | 1 => {
            let community = rd.expect(T_OCTETS)?.to_vec();
            let (tag, c) = rd.tlv()?;
            Ok(Message::Community { version, community, body: dec_body(tag, c)? })
        }
        3 => {
            let mut g = Rd::new(rd.expect(T_SEQ)?);
            let msg_id = i32::try_from(g.int()?).map_err(|_| BAD)?;
            let _max = g.int()?;
            let flags = *g.expect(T_OCTETS)?.first().ok_or(BAD)?;
            if g.int()? != 3 {
                return Err("Modelo de seguridad SNMPv3 no soportado (solo USM)".into());
            }
            let sec = rd.expect(T_OCTETS)?;
            let mut u = Rd::new(Rd::new(sec).expect(T_SEQ)?);
            let engine_id = u.expect(T_OCTETS)?.to_vec();
            let boots = u32::try_from(u.int()?).map_err(|_| BAD)?;
            let time = u32::try_from(u.int()?).map_err(|_| BAD)?;
            let user = u.expect(T_OCTETS)?.to_vec();
            let auth = u.expect(T_OCTETS)?;
            let auth_off = offset(buf, auth);
            let priv_params = u.expect(T_OCTETS)?.to_vec();
            let (tag, data) = rd.tlv()?;
            let (data, encrypted) = match tag {
                T_SEQ => (buf[offset(buf, data) - hdr_len(data.len())..offset(buf, data) + data.len()].to_vec(), false),
                T_OCTETS => (data.to_vec(), true),
                _ => return Err(BAD.into()),
            };
            Ok(Message::V3(V3Msg {
                msg_id,
                flags,
                engine_id,
                boots,
                time,
                user,
                auth_params: auth.to_vec(),
                auth_off,
                priv_params,
                data,
                encrypted,
                raw: buf.to_vec(),
            }))
        }
        _ => Err(format!("Versión SNMP desconocida ({version})")),
    }
}

/// ScopedPDU: contextEngineID, contextName y la PDU.
fn dec_scoped(seq: &[u8]) -> Result<(Vec<u8>, Vec<u8>, Body), String> {
    let mut outer = Rd::new(seq);
    let mut rd = Rd::new(outer.expect(T_SEQ)?);
    let ctx_engine = rd.expect(T_OCTETS)?.to_vec();
    let ctx_name = rd.expect(T_OCTETS)?.to_vec();
    let (tag, c) = rd.tlv()?;
    Ok((ctx_engine, ctx_name, dec_body(tag, c)?))
}

fn enc_scoped(ctx_engine: &[u8], ctx_name: &[u8], pdu: &Pdu) -> Result<Vec<u8>, String> {
    let mut c = tlv(T_OCTETS, ctx_engine);
    c.extend(tlv(T_OCTETS, ctx_name));
    c.extend(enc_pdu(pdu)?);
    Ok(tlv(T_SEQ, &c))
}

pub struct V3Header<'a> {
    pub msg_id: i32,
    pub flags: u8,
    pub engine_id: &'a [u8],
    pub boots: u32,
    pub time: u32,
    pub user: &'a [u8],
    pub auth_len: usize,
    pub priv_params: &'a [u8],
}

/// Arma un mensaje v3 con msgAuthenticationParameters en cero. Devuelve el mensaje y la
/// posición de esos bytes, que luego se reemplazan por el HMAC del mensaje completo.
pub fn enc_v3(h: &V3Header, data: &[u8]) -> (Vec<u8>, usize) {
    let mut global = enc_int(h.msg_id as i64);
    global.extend(enc_int(MAX_MSG as i64));
    global.extend(tlv(T_OCTETS, &[h.flags]));
    global.extend(enc_int(3));
    let global = tlv(T_SEQ, &global);

    let mut usm = tlv(T_OCTETS, h.engine_id);
    usm.extend(enc_int(h.boots as i64));
    usm.extend(enc_int(h.time as i64));
    usm.extend(tlv(T_OCTETS, h.user));
    let auth_in_usm = usm.len() + hdr_len(h.auth_len);
    usm.extend(tlv(T_OCTETS, &vec![0u8; h.auth_len]));
    usm.extend(tlv(T_OCTETS, h.priv_params));
    let usm_seq = tlv(T_SEQ, &usm);
    let auth_in_seq = hdr_len(usm.len()) + auth_in_usm;
    let sec = tlv(T_OCTETS, &usm_seq);
    let auth_in_sec = hdr_len(usm_seq.len()) + auth_in_seq;

    let version = enc_int(3);
    let mut body = version.clone();
    body.extend(&global);
    let auth_in_body = body.len() + auth_in_sec;
    body.extend(&sec);
    body.extend(data);
    let auth_off = hdr_len(body.len()) + auth_in_body;
    (tlv(T_SEQ, &body), auth_off)
}

// ---------- USM: claves, HMAC y AES ----------

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthProto {
    Md5,
    Sha,
    Sha224,
    Sha256,
    Sha384,
    Sha512,
}

impl AuthProto {
    /// Largo de msgAuthenticationParameters (RFC 3414 y RFC 7860).
    pub fn mac_len(self) -> usize {
        match self {
            AuthProto::Md5 | AuthProto::Sha => 12,
            AuthProto::Sha224 => 16,
            AuthProto::Sha256 => 24,
            AuthProto::Sha384 => 32,
            AuthProto::Sha512 => 48,
        }
    }

    fn hash(self, parts: &[&[u8]]) -> Zeroizing<Vec<u8>> {
        macro_rules! h {
            ($d:ty) => {{
                let mut d = <$d>::new();
                for p in parts {
                    Digest::update(&mut d, p);
                }
                Zeroizing::new(d.finalize().to_vec())
            }};
        }
        match self {
            AuthProto::Md5 => h!(md5::Md5),
            AuthProto::Sha => h!(sha1::Sha1),
            AuthProto::Sha224 => h!(sha2::Sha224),
            AuthProto::Sha256 => h!(sha2::Sha256),
            AuthProto::Sha384 => h!(sha2::Sha384),
            AuthProto::Sha512 => h!(sha2::Sha512),
        }
    }

    pub fn hmac(self, key: &[u8], data: &[u8]) -> Vec<u8> {
        macro_rules! h {
            ($d:ty) => {{
                // HMAC acepta llaves de cualquier largo: new_from_slice no falla.
                let mut m = <Hmac<$d> as KeyInit>::new_from_slice(key).expect("HMAC");
                m.update(data);
                m.finalize().into_bytes().to_vec()
            }};
        }
        match self {
            AuthProto::Md5 => h!(md5::Md5),
            AuthProto::Sha => h!(sha1::Sha1),
            AuthProto::Sha224 => h!(sha2::Sha224),
            AuthProto::Sha256 => h!(sha2::Sha256),
            AuthProto::Sha384 => h!(sha2::Sha384),
            AuthProto::Sha512 => h!(sha2::Sha512),
        }
    }

    /// Clave localizada (RFC 3414 A.2): Ku = H(1 MB de la contraseña repetida) y
    /// Kul = H(Ku || engineID || Ku).
    pub fn localize(self, password: &[u8], engine_id: &[u8]) -> Zeroizing<Vec<u8>> {
        self.localize_ku(&self.password_key(password), engine_id)
    }

    /// Kul a partir de Ku: barato, a diferencia de `password_key`.
    fn localize_ku(self, ku: &[u8], engine_id: &[u8]) -> Zeroizing<Vec<u8>> {
        self.hash(&[ku, engine_id, ku])
    }

    /// Ku (RFC 3414 A.2.1): el paso costoso (1 MB de hash), independiente del motor.
    fn password_key(self, password: &[u8]) -> Zeroizing<Vec<u8>> {
        if password.is_empty() {
            // Evita la división por cero de abajo; check_secret ya exige un largo mínimo.
            return Zeroizing::new(vec![]);
        }
        macro_rules! ku {
            ($d:ty) => {{
                let mut d = <$d>::new();
                let mut block = Zeroizing::new([0u8; 64]);
                let mut idx = 0;
                for _ in 0..(1_048_576 / 64) {
                    for b in block.iter_mut() {
                        *b = password[idx % password.len()];
                        idx += 1;
                    }
                    Digest::update(&mut d, &block[..]);
                }
                Zeroizing::new(d.finalize().to_vec())
            }};
        }
        match self {
            AuthProto::Md5 => ku!(md5::Md5),
            AuthProto::Sha => ku!(sha1::Sha1),
            AuthProto::Sha224 => ku!(sha2::Sha224),
            AuthProto::Sha256 => ku!(sha2::Sha256),
            AuthProto::Sha384 => ku!(sha2::Sha384),
            AuthProto::Sha512 => ku!(sha2::Sha512),
        }
    }
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Protocolo de privacidad. AES-128 es el estándar (RFC 3826). AES-192/256 no tienen RFC:
/// se usa el mismo IV que RFC 3826 y, si la clave localizada es corta (MD5/SHA-1), se
/// extiende según draft-blumenthal-aes-usm-04 ("aes192"/"aes256", net-snmp) o según
/// draft-reeder-snmpv3-usm-3desede-00 ("aes192c"/"aes256c", el que usa Cisco). Con
/// SHA-256 o superior ambas variantes coinciden. DES (RFC 3414 8) solo como legado.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PrivProto {
    Des,
    Aes,
    Aes192,
    Aes256,
    Aes192c,
    Aes256c,
}

impl PrivProto {
    fn key_len(self) -> usize {
        match self {
            PrivProto::Des | PrivProto::Aes => 16,
            PrivProto::Aes192 | PrivProto::Aes192c => 24,
            PrivProto::Aes256 | PrivProto::Aes256c => 32,
        }
    }

    /// Clave de privacidad localizada y extendida al largo del cifrado.
    pub fn key(self, auth: AuthProto, password: &[u8], engine_id: &[u8]) -> Zeroizing<Vec<u8>> {
        self.key_from_ku(auth, &auth.password_key(password), engine_id)
    }

    /// Igual que `key`, con el Ku de la contraseña ya calculado.
    fn key_from_ku(self, auth: AuthProto, ku: &[u8], engine_id: &[u8]) -> Zeroizing<Vec<u8>> {
        let mut key = auth.localize_ku(ku, engine_id);
        while key.len() < self.key_len() {
            let more = match self {
                // Blumenthal: Kul || H(Kul), luego || H(todo lo anterior).
                PrivProto::Aes192 | PrivProto::Aes256 => auth.hash(&[&key]),
                // Reeder: Kul || localize(password_to_key(Kul)).
                _ => auth.localize(&key, engine_id),
            };
            key.extend_from_slice(&more);
        }
        key.truncate(self.key_len());
        key
    }

    /// Cifra o descifra en el lugar. Devuelve el salt (msgPrivacyParameters) usado.
    fn apply(self, key: &[u8], boots: u32, time: u32, salt: &[u8], data: &mut Vec<u8>, encrypt: bool) -> Result<(), String> {
        use aes::cipher::{Array, BlockModeDecrypt, BlockModeEncrypt, KeyIvInit};
        const BAD_KEY: &str = "Parámetros de privacidad inválidos";
        if key.len() < self.key_len() || salt.len() != 8 {
            return Err("Parámetros de privacidad inválidos".into());
        }
        if self == PrivProto::Des {
            // RFC 3414 8.1.1: clave = 8 primeros bytes, IV = pre-IV (bytes 8..16) XOR salt.
            let mut iv = [0u8; 8];
            for (i, b) in iv.iter_mut().enumerate() {
                *b = key[8 + i] ^ salt[i];
            }
            if encrypt {
                // Relleno a múltiplo de 8: el largo BER marca el fin real del ScopedPDU.
                data.resize(data.len().div_ceil(8) * 8, 0);
                let mut enc = cbc::Encryptor::<des::Des>::new_from_slices(&key[..8], &iv).map_err(|_| BAD_KEY)?;
                enc.encrypt_blocks(Array::slice_as_chunks_mut(data).0);
            } else {
                if !data.len().is_multiple_of(8) {
                    return Err("Largo cifrado inválido".into());
                }
                let mut dec = cbc::Decryptor::<des::Des>::new_from_slices(&key[..8], &iv).map_err(|_| BAD_KEY)?;
                dec.decrypt_blocks(Array::slice_as_chunks_mut(data).0);
            }
            return Ok(());
        }
        let mut iv = [0u8; 16];
        iv[..4].copy_from_slice(&boots.to_be_bytes());
        iv[4..8].copy_from_slice(&time.to_be_bytes());
        iv[8..].copy_from_slice(salt);
        macro_rules! cfb {
            ($c:ty) => {
                if encrypt {
                    cfb_mode::Encryptor::<$c>::new_from_slices(&key[..self.key_len()], &iv).map_err(|_| BAD_KEY)?.encrypt(data)
                } else {
                    cfb_mode::Decryptor::<$c>::new_from_slices(&key[..self.key_len()], &iv).map_err(|_| BAD_KEY)?.decrypt(data)
                }
            };
        }
        match self.key_len() {
            16 => cfb!(aes::Aes128),
            24 => cfb!(aes::Aes192),
            _ => cfb!(aes::Aes256),
        }
        Ok(())
    }

    /// Salt de 64 bits: en DES los 4 primeros bytes son engineBoots (RFC 3414 8.1.1.1).
    fn salt(self, boots: u32) -> [u8; 8] {
        let mut s = random_bytes::<8>();
        if self == PrivProto::Des {
            s[..4].copy_from_slice(&boots.to_be_bytes());
        }
        s
    }
}

// ---------- Cliente ----------

pub struct V3Creds {
    pub user: String,
    pub auth: Option<(AuthProto, Zeroizing<String>)>,
    pub privacy: Option<(PrivProto, Zeroizing<String>)>,
    pub context: String,
}

pub enum Security {
    /// v1 (`v2 = false`) o v2c.
    Community { v2: bool, community: Zeroizing<String> },
    V3(V3Creds),
}

/// Destino y credenciales de una consulta. API interna reutilizable (auditorías, etc.):
/// ver [`query`] y [`Client`].
pub struct Target {
    pub host: String,
    pub port: u16,
    pub timeout: Duration,
    pub retries: u32,
    pub sec: Security,
}

/// Estado de la sesión v3 con el motor autoritativo (el agente).
struct Engine {
    id: Vec<u8>,
    boots: u32,
    time: u32,
    at: Instant,
    auth_key: Zeroizing<Vec<u8>>,
    priv_key: Zeroizing<Vec<u8>>,
}

impl Engine {
    fn now(&self) -> u32 {
        self.time.saturating_add(self.at.elapsed().as_secs().min(u32::MAX as u64) as u32)
    }
}

/// Arma el mensaje de una solicitud a partir de su request-id/msgID.
type BuildFn<'a> = dyn FnMut(&mut Client, i32) -> Result<Vec<u8>, ReqError> + 'a;
/// Reconoce la respuesta a esa solicitud (None: otro datagrama, se ignora).
type MatchFn<'a> = dyn FnMut(&mut Client, &[u8], i32) -> Option<Result<Body, ReqError>> + 'a;

pub struct Client {
    sock: UdpSocket,
    peer: SocketAddr,
    target: Target,
    next_id: i32,
    engine: Option<Engine>,
}

/// Contador de USM o MPD que llega en un Report (RFC 3414 y 3412).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum UsmReport {
    UnsupportedSecLevel,
    NotInTimeWindow,
    UnknownUser,
    UnknownEngineId,
    WrongDigest,
    DecryptionError,
    UnknownContext,
    Other,
}

impl UsmReport {
    fn from_oid(oid: &[u32]) -> Self {
        let usm = [1, 3, 6, 1, 6, 3, 15, 1, 1];
        if oid.len() == 11 && oid[..9] == usm {
            return match oid[9] {
                1 => UsmReport::UnsupportedSecLevel,
                2 => UsmReport::NotInTimeWindow,
                3 => UsmReport::UnknownUser,
                4 => UsmReport::UnknownEngineId,
                5 => UsmReport::WrongDigest,
                6 => UsmReport::DecryptionError,
                _ => UsmReport::Other,
            };
        }
        let mpd = [1, 3, 6, 1, 6, 3, 12, 1];
        if oid.len() == 10 && oid[..8] == mpd && (oid[8] == 4 || oid[8] == 5) {
            return UsmReport::UnknownContext;
        }
        UsmReport::Other
    }

    pub fn text(self) -> &'static str {
        match self {
            UsmReport::UnsupportedSecLevel => "El usuario no admite ese nivel de seguridad en el equipo (usmStatsUnsupportedSecLevels)",
            UsmReport::NotInTimeWindow => "Hora del motor SNMP fuera de ventana (usmStatsNotInTimeWindows)",
            UsmReport::UnknownUser => "Usuario SNMPv3 desconocido en el equipo (usmStatsUnknownUserNames)",
            UsmReport::UnknownEngineId => "Engine ID desconocido (usmStatsUnknownEngineIDs)",
            UsmReport::WrongDigest => "Autenticación fallida: contraseña o protocolo de autenticación incorrecto (usmStatsWrongDigests)",
            UsmReport::DecryptionError => "No se pudo descifrar: contraseña o protocolo de privacidad incorrecto (usmStatsDecryptionErrors)",
            UsmReport::UnknownContext => "Contexto SNMPv3 desconocido o no disponible en el equipo",
            UsmReport::Other => "El equipo rechazó la solicitud SNMPv3",
        }
    }
}

const ERR_STATUS: [&str; 19] = [
    "noError",
    "tooBig",
    "noSuchName",
    "badValue",
    "readOnly",
    "genErr",
    "noAccess",
    "wrongType",
    "wrongLength",
    "wrongEncoding",
    "wrongValue",
    "noCreation",
    "inconsistentValue",
    "resourceUnavailable",
    "commitFailed",
    "undoFailed",
    "authorizationError",
    "notWritable",
    "inconsistentName",
];

pub fn error_name(code: i64) -> String {
    usize::try_from(code).ok().and_then(|i| ERR_STATUS.get(i)).map(|s| s.to_string()).unwrap_or_else(|| format!("error {code}"))
}

fn random_bytes<const N: usize>() -> [u8; N] {
    crate::seal::random()
}

/// Respuesta con error-status distinto de cero.
#[derive(Debug, Clone, PartialEq)]
pub struct PduError {
    pub status: i64,
    pub index: i64,
}

/// Error tipado de una consulta. Nunca contiene secretos.
#[derive(Debug, Clone, PartialEq)]
pub enum ReqError {
    /// Sin respuesta tras los reintentos (agente caído, ACL, community o usuario incorrecto).
    Timeout(String),
    /// Report de USM/MPD (SNMPv3): credenciales, nivel o contexto.
    Usm(UsmReport),
    /// El agente respondió con error-status (noSuchName, authorizationError, etc.).
    Pdu(PduError),
    /// Resolución, socket, mensaje mal formado u otro.
    Other(String),
}

impl From<String> for ReqError {
    fn from(e: String) -> Self {
        ReqError::Other(e)
    }
}

impl From<&str> for ReqError {
    fn from(e: &str) -> Self {
        ReqError::Other(e.to_string())
    }
}

impl ReqError {
    pub fn text(&self) -> String {
        match self {
            ReqError::Timeout(s) | ReqError::Other(s) => s.clone(),
            ReqError::Usm(r) => r.text().to_string(),
            ReqError::Pdu(e) => format!("El equipo respondió {} (varbind {})", error_name(e.status), e.index),
        }
    }
}

/// Operación de lectura.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Get,
    GetNext,
    GetBulk { max_rep: u32 },
}

/// Una consulta completa (descubrimiento v3 incluido) con resultados y errores tipados.
pub fn query(target: Target, op: Op, oids: &[Oid]) -> Result<Vec<(Oid, Value)>, ReqError> {
    let mut c = Client::connect(target).map_err(|e| e.text())?;
    match op {
        Op::Get => c.get(oids),
        Op::GetNext => c.get_next(oids),
        Op::GetBulk { max_rep } => c.get_bulk(oids, 0, max_rep),
    }
}

fn report_of(p: &Pdu) -> ReqError {
    ReqError::Usm(UsmReport::from_oid(p.vbs.first().map(|v| v.0.as_slice()).unwrap_or(&[])))
}

impl Client {
    pub fn connect(target: Target) -> Result<Self, ReqError> {
        let peer = (target.host.as_str(), target.port)
            .to_socket_addrs()
            .map_err(|e| format!("No se pudo resolver {}: {e}", target.host))?
            .next()
            .ok_or_else(|| format!("No se pudo resolver {}", target.host))?;
        let bind: SocketAddr = if peer.is_ipv4() { "0.0.0.0:0".parse().unwrap() } else { "[::]:0".parse().unwrap() };
        let sock = UdpSocket::bind(bind).map_err(|e| e.to_string())?;
        // connect(): el sistema descarta datagramas de otros orígenes.
        sock.connect(peer).map_err(|e| e.to_string())?;
        let mut c = Client { sock, peer, target, next_id: (u32::from_be_bytes(random_bytes::<4>()) >> 1) as i32, engine: None };
        if matches!(c.target.sec, Security::V3(_)) {
            c.discover()?;
        }
        Ok(c)
    }

    fn id(&mut self) -> i32 {
        self.next_id = self.next_id.wrapping_add(1) & 0x7FFF_FFFF;
        self.next_id
    }

    fn no_answer(&self) -> ReqError {
        let hint = match self.target.sec {
            Security::Community { .. } => "community, ACL del agente",
            Security::V3(_) => "usuario, ACL del agente",
        };
        ReqError::Timeout(format!(
            "Sin respuesta de {} (timeout {} ms, {} reintentos). Revisa IP, puerto, {hint} y que UDP {} esté permitido.",
            self.peer,
            self.target.timeout.as_millis(),
            self.target.retries,
            self.target.port
        ))
    }

    /// Envía y espera la respuesta que corresponde (mismo request-id o msgID).
    fn roundtrip(&mut self, build: &mut BuildFn<'_>, matches: &mut MatchFn<'_>) -> Result<Body, ReqError> {
        let mut buf = vec![0u8; MAX_MSG];
        for _ in 0..=self.target.retries {
            let id = self.id();
            let msg = build(self, id)?;
            self.sock.send(&msg).map_err(|e| format!("No se pudo enviar a {}: {e}", self.peer))?;
            let deadline = Instant::now() + self.target.timeout;
            loop {
                let left = deadline.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    break;
                }
                self.sock.set_read_timeout(Some(left)).ok();
                let n = match self.sock.recv(&mut buf) {
                    Ok(n) => n,
                    Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => break,
                    // ICMP puerto inalcanzable llega como error en el socket conectado.
                    Err(e) if e.kind() == std::io::ErrorKind::ConnectionRefused => {
                        return Err(ReqError::Other(format!("{} rechazó la conexión: no hay agente SNMP en UDP {}", self.peer, self.target.port)))
                    }
                    Err(_) => break,
                };
                if let Some(r) = matches(self, &buf[..n], id) {
                    return r;
                }
            }
        }
        Err(self.no_answer())
    }

    /// Descubre engineID, engineBoots y engineTime del agente (RFC 3414 sección 4): GET
    /// vacío, sin autenticación y "reportable"; el agente contesta un Report
    /// usmStatsUnknownEngineIDs con sus valores.
    fn discover(&mut self) -> Result<(), ReqError> {
        let mut build = |_: &mut Self, id: i32| -> Result<Vec<u8>, ReqError> {
            let pdu = Pdu { kind: PDU_GET, req_id: id, err_status: 0, err_index: 0, vbs: vec![] };
            let h = V3Header { msg_id: id, flags: FLAG_REPORTABLE, engine_id: &[], boots: 0, time: 0, user: &[], auth_len: 0, priv_params: &[] };
            Ok(enc_v3(&h, &enc_scoped(&[], &[], &pdu)?).0)
        };
        let mut found: Option<(Vec<u8>, u32, u32)> = None;
        let mut matches = |_: &mut Self, bytes: &[u8], id: i32| -> Option<Result<Body, ReqError>> {
            let Ok(Message::V3(m)) = decode(bytes) else { return None };
            if m.msg_id != id {
                return None;
            }
            if m.engine_id.len() < 5 || m.engine_id.len() > 32 {
                return Some(Err("El agente no informó un engine ID válido (RFC 3411: 5 a 32 bytes)".into()));
            }
            found = Some((m.engine_id.clone(), m.boots, m.time));
            Some(Ok(Body::Pdu(Pdu { kind: PDU_REPORT, req_id: id, err_status: 0, err_index: 0, vbs: vec![] })))
        };
        self.roundtrip(&mut build, &mut matches)?;
        let (id, boots, time) = found.ok_or("Sin engine ID")?;
        let Security::V3(creds) = &self.target.sec else { unreachable!() };
        let auth_key = match &creds.auth {
            Some((p, pass)) => p.localize(pass.as_bytes(), &id),
            None => Zeroizing::new(vec![]),
        };
        let priv_key = match (&creds.auth, &creds.privacy) {
            (Some((a, _)), Some((p, pass))) => p.key(*a, pass.as_bytes(), &id),
            _ => Zeroizing::new(vec![]),
        };
        self.engine = Some(Engine { id, boots, time, at: Instant::now(), auth_key, priv_key });
        Ok(())
    }

    fn encode_v3(&self, pdu: &Pdu, msg_id: i32) -> Result<Vec<u8>, ReqError> {
        let Security::V3(creds) = &self.target.sec else { unreachable!() };
        let e = self.engine.as_ref().ok_or("Sesión SNMPv3 sin engine ID")?;
        let mut flags = FLAG_REPORTABLE;
        let auth = creds.auth.as_ref().map(|(p, _)| *p);
        if auth.is_some() {
            flags |= FLAG_AUTH;
        }
        let (boots, time) = (e.boots, e.now());
        let scoped = enc_scoped(&e.id, creds.context.as_bytes(), pdu)?;
        let mut salt = Vec::new();
        let data = if let Some((p, _)) = &creds.privacy {
            flags |= FLAG_PRIV;
            salt = p.salt(boots).to_vec();
            let mut enc = scoped;
            p.apply(&e.priv_key, boots, time, &salt, &mut enc, true)?;
            tlv(T_OCTETS, &enc)
        } else {
            scoped
        };
        let h = V3Header {
            msg_id,
            flags,
            engine_id: &e.id,
            boots,
            time,
            user: creds.user.as_bytes(),
            auth_len: auth.map(|p| p.mac_len()).unwrap_or(0),
            priv_params: &salt,
        };
        let (mut msg, off) = enc_v3(&h, &data);
        if let Some(p) = auth {
            let mac = p.hmac(&e.auth_key, &msg);
            msg[off..off + p.mac_len()].copy_from_slice(&mac[..p.mac_len()]);
        }
        Ok(msg)
    }

    /// Valida y abre una respuesta v3. None: no es para esta solicitud (se ignora).
    fn open_v3(&mut self, bytes: &[u8], msg_id: i32) -> Option<Result<Body, ReqError>> {
        let Ok(Message::V3(m)) = decode(bytes) else { return None };
        if m.msg_id != msg_id {
            return None;
        }
        let Security::V3(creds) = &self.target.sec else { return None };
        let auth = creds.auth.as_ref().map(|(p, _)| *p);
        let privacy = creds.privacy.as_ref().map(|(p, _)| *p);
        let e = self.engine.as_mut()?;
        // Sin autenticación solo se acepta un Report (errores de USM), nunca datos si se
        // pidió autenticación.
        if m.flags & FLAG_AUTH == 0 {
            if m.encrypted {
                return None;
            }
            let Ok((_, _, Body::Pdu(p))) = dec_scoped(&m.data) else { return None };
            if p.kind == PDU_REPORT {
                // Un Report de tiempo sin autenticar trae los valores para resincronizar.
                if UsmReport::from_oid(p.vbs.first().map(|v| v.0.as_slice()).unwrap_or(&[])) == UsmReport::NotInTimeWindow && m.engine_id == e.id {
                    e.boots = m.boots;
                    e.time = m.time;
                    e.at = Instant::now();
                }
                return Some(Err(report_of(&p)));
            }
            if auth.is_some() {
                return None;
            }
            return Some(Ok(Body::Pdu(p)));
        }
        let p = auth?;
        if m.engine_id != e.id || m.user != creds.user.as_bytes() || m.auth_params.len() != p.mac_len() {
            return None;
        }
        let mut copy = bytes.to_vec();
        copy[m.auth_off..m.auth_off + p.mac_len()].fill(0);
        let mac = p.hmac(&e.auth_key, &copy);
        if !ct_eq(&mac[..p.mac_len()], &m.auth_params) {
            return None; // firma inválida: se descarta como si no hubiera llegado
        }
        // Mensaje auténtico: se sincroniza el reloj del motor (RFC 3414 3.2.7).
        if m.boots > e.boots || (m.boots == e.boots && m.time > e.time) {
            e.boots = m.boots;
            e.time = m.time;
            e.at = Instant::now();
        }
        let scoped = if m.encrypted {
            let pp = privacy?;
            let mut data = m.data.clone();
            if pp.apply(&e.priv_key, m.boots, m.time, &m.priv_params, &mut data, false).is_err() {
                return Some(Err("No se pudo descifrar la respuesta".into()));
            }
            data
        } else {
            let Ok((_, _, Body::Pdu(p))) = dec_scoped(&m.data) else { return None };
            if p.kind == PDU_REPORT {
                return Some(Err(report_of(&p)));
            }
            // Pedimos cifrado: una respuesta en claro con datos se rechaza.
            if privacy.is_some() {
                return None;
            }
            m.data.clone()
        };
        match dec_scoped(&scoped) {
            Ok((_, _, Body::Pdu(p))) if p.kind == PDU_REPORT => Some(Err(report_of(&p))),
            Ok((_, _, body)) => Some(Ok(body)),
            Err(_) => Some(Err(ReqError::Usm(UsmReport::DecryptionError))),
        }
    }

    /// Una solicitud con su respuesta. Si el agente informa notInTimeWindows, el Report ya
    /// actualizó boots/time (RFC 3414 3.2.7): se reintenta una vez.
    pub fn request(&mut self, kind: u8, vbs: Vec<(Oid, Value)>, a: i64, b: i64) -> Result<Pdu, ReqError> {
        for attempt in 0..2 {
            let mut build = |c: &mut Self, id: i32| -> Result<Vec<u8>, ReqError> {
                let pdu = Pdu { kind, req_id: id, err_status: a, err_index: b, vbs: vbs.clone() };
                match &c.target.sec {
                    Security::Community { v2, community } => Ok(enc_community(if *v2 { 1 } else { 0 }, community.as_bytes(), &pdu)?),
                    Security::V3(_) => c.encode_v3(&pdu, id),
                }
            };
            let mut matches = |c: &mut Self, bytes: &[u8], id: i32| -> Option<Result<Body, ReqError>> {
                match &c.target.sec {
                    Security::Community { .. } => match decode(bytes) {
                        Ok(Message::Community { body: Body::Pdu(p), .. }) if p.req_id == id && p.kind == PDU_RESPONSE => Some(Ok(Body::Pdu(p))),
                        _ => None,
                    },
                    Security::V3(_) => c.open_v3(bytes, id),
                }
            };
            match self.roundtrip(&mut build, &mut matches) {
                Ok(Body::Pdu(p)) if p.kind == PDU_RESPONSE => {
                    if p.err_status != 0 {
                        return Err(ReqError::Pdu(PduError { status: p.err_status, index: p.err_index }));
                    }
                    return Ok(p);
                }
                Ok(_) => return Err(ReqError::Other(BAD.into())),
                Err(ReqError::Usm(UsmReport::NotInTimeWindow)) if attempt == 0 => continue,
                Err(e) => return Err(e),
            }
        }
        Err(ReqError::Usm(UsmReport::NotInTimeWindow))
    }

    pub fn is_v1(&self) -> bool {
        matches!(self.target.sec, Security::Community { v2: false, .. })
    }

    pub fn get(&mut self, oids: &[Oid]) -> Result<Vec<(Oid, Value)>, ReqError> {
        Ok(self.request(PDU_GET, oids.iter().map(|o| (o.clone(), Value::Null)).collect(), 0, 0)?.vbs)
    }

    pub fn get_next(&mut self, oids: &[Oid]) -> Result<Vec<(Oid, Value)>, ReqError> {
        Ok(self.request(PDU_GETNEXT, oids.iter().map(|o| (o.clone(), Value::Null)).collect(), 0, 0)?.vbs)
    }

    pub fn get_bulk(&mut self, oids: &[Oid], non_repeaters: u32, max_rep: u32) -> Result<Vec<(Oid, Value)>, ReqError> {
        if self.is_v1() {
            return Err(ReqError::Other("GETBULK no existe en SNMPv1: usa v2c o v3".into()));
        }
        Ok(self.request(PDU_GETBULK, oids.iter().map(|o| (o.clone(), Value::Null)).collect(), non_repeaters as i64, max_rep as i64)?.vbs)
    }

    /// Recorre el subárbol `root` con GETNEXT o GETBULK. Se detiene al salir del subárbol,
    /// al llegar a `limit` filas, si el agente devuelve un OID que no avanza o al cancelar.
    /// Devuelve (filas, truncado).
    pub fn walk(
        &mut self,
        root: &Oid,
        bulk: Option<u32>,
        limit: usize,
        cancel: &AtomicBool,
        sink: &mut dyn FnMut(Vec<(Oid, Value)>),
    ) -> Result<(usize, bool), ReqError> {
        let mut cur = root.clone();
        let mut count = 0;
        let bulk = bulk.filter(|_| !self.is_v1());
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Ok((count, true));
            }
            let res = match bulk {
                Some(n) => self.get_bulk(std::slice::from_ref(&cur), 0, n.clamp(1, 100)),
                None => self.get_next(std::slice::from_ref(&cur)),
            };
            let vbs = match res {
                Ok(v) => v,
                // v1: noSuchName en GETNEXT marca el fin de la MIB.
                Err(ReqError::Pdu(e)) if e.status == 2 => break,
                Err(e) => return Err(e),
            };
            if vbs.is_empty() {
                break;
            }
            let mut batch = Vec::new();
            let mut end = false;
            for (oid, v) in vbs {
                if matches!(v, Value::EndOfMib) || !oid.starts_with(root) {
                    end = true;
                    break;
                }
                if oid <= cur {
                    sink(batch);
                    return Err(ReqError::Other(format!("El agente devolvió un OID que no avanza ({}): recorrido detenido", oid_str(&oid))));
                }
                cur = oid.clone();
                batch.push((oid, v));
                count += 1;
                if count >= limit {
                    sink(batch);
                    return Ok((count, true));
                }
            }
            sink(batch);
            if end {
                break;
            }
        }
        // Un OID escalar (sysDescr.0) no tiene hijos: igual que snmpwalk, se pide con GET.
        if count == 0 {
            if let Ok(vbs) = self.get(std::slice::from_ref(root)) {
                let vbs: Vec<_> = vbs.into_iter().filter(|(_, v)| !matches!(v, Value::NoSuchObject | Value::NoSuchInstance | Value::EndOfMib)).collect();
                count = vbs.len();
                sink(vbs);
            }
        }
        Ok((count, false))
    }
}

// ---------- Presentación ----------

#[derive(Serialize, Clone, Debug)]
pub struct Row {
    pub oid: String,
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub value: String,
}

fn hex(b: &[u8], sep: &str) -> String {
    b.iter().map(|x| format!("{x:02X}")).collect::<Vec<_>>().join(sep)
}

fn ticks_text(t: u32) -> String {
    let cs = t % 100;
    let s = t / 100;
    format!("{t} ({}d {}h {}m {}.{cs:02}s)", s / 86400, s / 3600 % 24, s / 60 % 60, s % 60)
}

/// Texto si los bytes son UTF-8 imprimible; si no, hexadecimal (MAC con ":").
fn octets_text(b: &[u8]) -> (&'static str, String) {
    let trimmed = b.strip_suffix(&[0]).unwrap_or(b);
    if let Ok(s) = std::str::from_utf8(trimmed) {
        if !trimmed.is_empty() && s.chars().all(|c| !c.is_control() || matches!(c, '\r' | '\n' | '\t')) {
            return ("OCTET STRING", s.chars().take(4096).collect());
        }
    }
    if b.is_empty() {
        return ("OCTET STRING", String::new());
    }
    let sep = if b.len() == 6 { ":" } else { " " };
    ("Hex-STRING", hex(&b[..b.len().min(1024)], sep))
}

pub fn display(v: &Value) -> (&'static str, String) {
    match v {
        Value::Int(i) => ("INTEGER", i.to_string()),
        Value::Str(s) => octets_text(s),
        Value::Null => ("NULL", String::new()),
        Value::Oid(o) => ("OID", oid_str(o)),
        Value::Ip(ip) => ("IpAddress", format!("{}.{}.{}.{}", ip[0], ip[1], ip[2], ip[3])),
        Value::Counter32(n) => ("Counter32", n.to_string()),
        Value::Gauge32(n) => ("Gauge32", n.to_string()),
        Value::Ticks(t) => ("Timeticks", ticks_text(*t)),
        Value::Opaque(b) => ("Opaque", hex(&b[..b.len().min(1024)], " ")),
        Value::Counter64(n) => ("Counter64", n.to_string()),
        Value::NoSuchObject => ("noSuchObject", "No existe el objeto en este agente".into()),
        Value::NoSuchInstance => ("noSuchInstance", "No existe la instancia".into()),
        Value::EndOfMib => ("endOfMibView", "Fin de la MIB".into()),
    }
}

pub fn rows(vbs: &[(Oid, Value)]) -> Vec<Row> {
    vbs.iter()
        .map(|(o, v)| {
            let (kind, value) = display(v);
            Row { oid: oid_str(o), kind, value }
        })
        .collect()
}

// ---------- Traps ----------

#[derive(Serialize, Clone, Debug)]
pub struct Trap {
    pub ts: i64,
    pub src: String,
    pub version: &'static str,
    /// "trap", "inform" o "v1".
    pub kind: &'static str,
    pub trap_oid: String,
    pub uptime: Option<String>,
    pub user: Option<String>,
    pub note: Option<String>,
    pub vbs: Vec<Row>,
}

impl Trap {
    /// Paquete que llegó al puerto de traps pero no se pudo decodificar.
    pub fn invalid(src: SocketAddr, error: String) -> Self {
        Trap {
            ts: chrono::Utc::now().timestamp_millis(),
            src: src.ip().to_string(),
            version: "?",
            kind: "invalid",
            trap_oid: String::new(),
            uptime: None,
            user: None,
            note: Some(error),
            vbs: vec![],
        }
    }
}

const SYS_UPTIME: [u32; 9] = [1, 3, 6, 1, 2, 1, 1, 3, 0];
const SNMP_TRAP_OID: [u32; 11] = [1, 3, 6, 1, 6, 3, 1, 1, 4, 1, 0];

fn trap_from_pdu(p: Pdu, src: &SocketAddr, version: &'static str) -> Trap {
    let mut uptime = None;
    let mut trap_oid = String::new();
    let mut rest = Vec::new();
    for (oid, v) in p.vbs {
        match (oid.as_slice(), &v) {
            (o, Value::Ticks(t)) if o == SYS_UPTIME => uptime = Some(ticks_text(*t)),
            (o, Value::Oid(t)) if o == SNMP_TRAP_OID => trap_oid = oid_str(t),
            _ => rest.push((oid, v)),
        }
    }
    Trap {
        ts: chrono::Utc::now().timestamp_millis(),
        src: src.ip().to_string(),
        version,
        kind: if p.kind == PDU_INFORM { "inform" } else { "trap" },
        trap_oid,
        uptime,
        user: None,
        note: None,
        vbs: rows(&rest),
    }
}

/// Decodifica un trap o inform. Devuelve además la respuesta a enviar si es un inform v2c
/// (el emisor lo reintenta hasta recibirla). Nunca incluye la community.
pub fn decode_trap(buf: &[u8], src: SocketAddr, usm: Option<&mut TrapUsm>) -> Result<(Trap, Option<Vec<u8>>), String> {
    match decode(buf)? {
        Message::Community { version, community, body } => match body {
            Body::V1Trap(t) if version == 0 => {
                // RFC 3584 3.1: traps genéricos v1 a snmpTraps.(generic+1); específicos a enterprise.0.specific.
                let trap_oid = if (0..6).contains(&t.generic) {
                    format!("1.3.6.1.6.3.1.1.5.{}", t.generic + 1)
                } else {
                    format!("{}.0.{}", oid_str(&t.enterprise), t.specific)
                };
                let mut vbs = vec![Row { oid: "agent-addr".into(), kind: "IpAddress", value: format!("{}.{}.{}.{}", t.agent[0], t.agent[1], t.agent[2], t.agent[3]) }];
                vbs.extend(rows(&t.vbs));
                Ok((
                    Trap {
                        ts: chrono::Utc::now().timestamp_millis(),
                        src: src.ip().to_string(),
                        version: "v1",
                        kind: "v1",
                        trap_oid,
                        uptime: Some(ticks_text(t.ticks)),
                        user: None,
                        note: None,
                        vbs,
                    },
                    None,
                ))
            }
            Body::Pdu(p) if version == 1 && (p.kind == PDU_TRAP_V2 || p.kind == PDU_INFORM) => {
                let reply = (p.kind == PDU_INFORM)
                    .then(|| enc_community(1, &community, &Pdu { kind: PDU_RESPONSE, err_status: 0, err_index: 0, ..p.clone() }).ok())
                    .flatten();
                Ok((trap_from_pdu(p, &src, "v2c"), reply))
            }
            _ => Err("No es un trap SNMP".into()),
        },
        Message::V3(m) => {
            let user = Some(String::from_utf8_lossy(&m.user).chars().take(64).collect::<String>());
            if m.flags & FLAG_AUTH == 0 && !m.encrypted {
                // Degradación: si el receptor verifica a este usuario con autenticación, un
                // trap noAuthNoPriv con su nombre es falsificable por cualquiera y no se
                // muestra como si viniera de él.
                if usm.as_ref().is_some_and(|u| u.creds.auth.is_some() && u.creds.user.as_bytes() == m.user.as_slice()) {
                    return Err("Trap v3 sin autenticación de un usuario que la exige: descartado".into());
                }
                if let Ok((_, _, Body::Pdu(p))) = dec_scoped(&m.data) {
                    if p.kind == PDU_TRAP_V2 || p.kind == PDU_INFORM {
                        let mut t = trap_from_pdu(p, &src, "v3");
                        t.user = user;
                        t.note = Some("noAuthNoPriv: sin autenticación".into());
                        return Ok((t, None));
                    }
                }
                return Err("Mensaje SNMPv3 que no es trap".into());
            }
            let engine = hex(&m.engine_id[..m.engine_id.len().min(32)], "");
            let opaque = |note: String| Trap {
                ts: chrono::Utc::now().timestamp_millis(),
                src: src.ip().to_string(),
                version: "v3",
                kind: "trap",
                trap_oid: String::new(),
                uptime: None,
                user: user.clone(),
                note: Some(note),
                vbs: vec![],
            };
            let Some(usm) = usm.filter(|u| u.creds.user.as_bytes() == m.user.as_slice()) else {
                return Ok((opaque(format!("Trap v3 de engine {engine}: configura este usuario en el receptor para verificarlo y descifrarlo")), None));
            };
            match usm.open(&m) {
                Ok(p) if p.kind == PDU_TRAP_V2 || p.kind == PDU_INFORM => {
                    let mut t = trap_from_pdu(p, &src, "v3");
                    t.user = user.clone();
                    t.note = Some(format!(
                        "{} verificado · engine {engine}{}",
                        if m.encrypted { "authPriv" } else { "authNoPriv" },
                        if t.kind == "inform" { " · inform v3 no se responde" } else { "" }
                    ));
                    Ok((t, None))
                }
                Ok(_) => Err("Mensaje SNMPv3 que no es trap".into()),
                Err(e) => Ok((opaque(format!("Trap v3 de engine {engine} rechazado: {e}")), None)),
            }
        }
    }
}

/// Claves localizadas y último boots/time auténtico de un emisor de traps v3.
type EngineKeys = (Zeroizing<Vec<u8>>, Zeroizing<Vec<u8>>, u32, u32, Instant);

/// Usuario USM del receptor de traps. En traps v3 el emisor es el motor autoritativo: las
/// claves se localizan con su engineID (una vez por equipo) y se aplica la ventana de
/// tiempo de RFC 3414 3.2.7 para descartar repeticiones.
pub struct TrapUsm {
    pub creds: V3Creds,
    engines: std::collections::HashMap<Vec<u8>, EngineKeys>,
    /// Ku de las contraseñas (RFC 3414 A.2.1), calculado una vez: así un trap con un
    /// engineID inventado solo cuesta un hash corto y un HMAC, no 1 MB de hash.
    ku_auth: Zeroizing<Vec<u8>>,
    ku_priv: Zeroizing<Vec<u8>>,
}

impl TrapUsm {
    pub fn new(creds: V3Creds) -> Self {
        let (ku_auth, ku_priv) = match (&creds.auth, &creds.privacy) {
            (Some((a, pass)), privacy) => (a.password_key(pass.as_bytes()), privacy.as_ref().map(|(_, pp)| a.password_key(pp.as_bytes())).unwrap_or_default()),
            _ => Default::default(),
        };
        TrapUsm { creds, engines: Default::default(), ku_auth, ku_priv }
    }

    fn open(&mut self, m: &V3Msg) -> Result<Pdu, String> {
        let Some((auth, _)) = &self.creds.auth else {
            return Err("el usuario del receptor no tiene autenticación".into());
        };
        let auth = *auth;
        if m.flags & FLAG_AUTH == 0 || m.auth_params.len() != auth.mac_len() {
            return Err("sin autenticación o parámetros inválidos".into());
        }
        if m.engine_id.len() < 5 || m.engine_id.len() > 32 {
            return Err("engine ID inválido".into());
        }
        let ak = match self.engines.get(&m.engine_id) {
            Some(e) => e.0.clone(),
            None => auth.localize_ku(&self.ku_auth, &m.engine_id),
        };
        let mut copy = Vec::new();
        copy.extend_from_slice(&m.raw);
        copy[m.auth_off..m.auth_off + auth.mac_len()].fill(0);
        let mac = auth.hmac(&ak, &copy);
        if !ct_eq(&mac[..auth.mac_len()], &m.auth_params) {
            return Err("firma inválida (contraseña o protocolo de autenticación)".into());
        }
        // Solo un emisor auténtico entra en la caché: un tercero sin la clave no puede
        // vaciarla (lo que borraría la protección contra repeticiones) ni hacerla crecer.
        if !self.engines.contains_key(&m.engine_id) {
            if self.engines.len() >= 256 {
                self.engines.clear();
            }
            let pk = match &self.creds.privacy {
                Some((p, _)) => p.key_from_ku(auth, &self.ku_priv, &m.engine_id),
                None => Zeroizing::new(vec![]),
            };
            self.engines.insert(m.engine_id.clone(), (ak, pk, 0, 0, Instant::now()));
        }
        let entry = self.engines.get_mut(&m.engine_id).ok_or("engine")?;
        // Ventana de 150 s respecto del último mensaje auténtico de ese motor.
        let (boots, time, at) = (entry.2, entry.3, entry.4);
        let expected = time as u64 + at.elapsed().as_secs();
        if m.boots < boots || (m.boots == boots && boots != 0 && (m.time as u64) + 150 < expected) {
            return Err("fuera de la ventana de tiempo (posible repetición)".into());
        }
        entry.2 = m.boots;
        entry.3 = m.time;
        entry.4 = Instant::now();
        let scoped = if m.encrypted {
            let Some((p, _)) = &self.creds.privacy else { return Err("el trap viene cifrado y el usuario no tiene privacidad".into()) };
            let mut data = m.data.clone();
            p.apply(&entry.1, m.boots, m.time, &m.priv_params, &mut data, false)?;
            data
        } else {
            if self.creds.privacy.is_some() {
                return Err("se esperaba un trap cifrado".into());
            }
            m.data.clone()
        };
        match dec_scoped(&scoped) {
            Ok((_, _, Body::Pdu(p))) => Ok(p),
            _ => Err("no se pudo descifrar (contraseña o protocolo de privacidad)".into()),
        }
    }
}

// ---------- Comandos ----------

use crate::credentials::NS_SNMP as VAULT_NS;

/// Destino y credenciales tal como llegan de la interfaz. Los secretos se pasan a búferes
/// que se borran al soltarse apenas se reciben.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetParams {
    pub host: String,
    pub port: Option<u16>,
    /// "1", "2c" o "3".
    pub version: String,
    pub community: Option<String>,
    pub user: Option<String>,
    /// "noAuthNoPriv", "authNoPriv" o "authPriv".
    pub level: Option<String>,
    pub auth_proto: Option<AuthProto>,
    pub auth_pass: Option<String>,
    pub priv_proto: Option<PrivProto>,
    pub priv_pass: Option<String>,
    pub context: Option<String>,
    pub timeout_ms: Option<u64>,
    pub retries: Option<u32>,
    /// Perfil con secretos en la bóveda: se usan si los campos llegan vacíos.
    pub profile: Option<String>,
}

/// Secretos de un perfil guardados en la bóveda (JSON cifrado dentro de ella), atados al
/// destino con que se guardaron: un frontend comprometido (o un host editado en el perfil)
/// no puede mandar la community en claro, ni un HMAC v3 atacable offline, a otro equipo.
#[derive(Serialize, Deserialize, Default)]
struct Saved {
    #[serde(default)]
    host: String,
    #[serde(default)]
    port: u16,
    #[serde(default)]
    community: String,
    #[serde(default)]
    auth_pass: String,
    #[serde(default)]
    priv_pass: String,
}

impl Drop for Saved {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.community.zeroize();
        self.auth_pass.zeroize();
        self.priv_pass.zeroize();
    }
}

fn check_host(h: &str) -> Result<String, String> {
    let h = h.trim();
    if h.is_empty() || h.len() > 253 || h.starts_with('-') || !h.chars().all(|c| c.is_ascii_alphanumeric() || ".-:_%[]".contains(c)) {
        return Err("Host inválido".into());
    }
    Ok(h.trim_start_matches('[').trim_end_matches(']').to_string())
}

fn check_secret(s: &str, what: &str, min: usize) -> Result<(), String> {
    if s.chars().count() < min || s.len() > 256 || s.chars().any(|c| c.is_control()) {
        return Err(if min > 1 {
            format!("{what}: entre {min} y 256 caracteres (RFC 3414 exige al menos 8)")
        } else {
            format!("{what}: entre 1 y 256 caracteres, sin saltos de línea")
        });
    }
    Ok(())
}

impl TargetParams {
    pub fn into_target(self, saved: impl FnOnce(&str) -> Result<Option<Zeroizing<String>>, String>) -> Result<Target, String> {
        let take = |s: Option<String>| Zeroizing::new(s.unwrap_or_default());
        let mut community = take(self.community);
        let mut auth_pass = take(self.auth_pass);
        let mut priv_pass = take(self.priv_pass);
        let host = check_host(&self.host)?;
        let port = self.port.filter(|p| *p != 0).unwrap_or(161);
        let level = self.level.as_deref().unwrap_or("authPriv");
        let v3 = self.version == "3";
        let needs = if v3 {
            (level != "noAuthNoPriv" && auth_pass.is_empty()) || (level == "authPriv" && priv_pass.is_empty())
        } else {
            community.is_empty()
        };
        if needs {
            if let Some(profile) = self.profile.as_deref().filter(|p| !p.is_empty()) {
                if let Some(json) = saved(profile)? {
                    let s: Saved = serde_json::from_str(&json).unwrap_or_default();
                    // Sin destino guardado (o con otro) no se usan: nunca viajan a otro equipo.
                    if s.host.is_empty() || !s.host.eq_ignore_ascii_case(&host) || s.port != port {
                        return Err(SAVED_OTHER_TARGET.into());
                    }
                    if community.is_empty() {
                        community = Zeroizing::new(s.community.clone());
                    }
                    if auth_pass.is_empty() {
                        auth_pass = Zeroizing::new(s.auth_pass.clone());
                    }
                    if priv_pass.is_empty() {
                        priv_pass = Zeroizing::new(s.priv_pass.clone());
                    }
                }
            }
        }
        let sec = match self.version.as_str() {
            "1" | "2c" => {
                check_secret(&community, "Community", 1)?;
                Security::Community { v2: self.version == "2c", community }
            }
            "3" => {
                let user = self.user.unwrap_or_default().trim().to_string();
                if user.is_empty() || user.len() > 32 || user.chars().any(|c| c.is_control()) {
                    return Err("Usuario SNMPv3: entre 1 y 32 caracteres".into());
                }
                let context = self.context.unwrap_or_default();
                if context.len() > 32 || context.chars().any(|c| c.is_control()) {
                    return Err("Contexto inválido".into());
                }
                let auth = match level {
                    "noAuthNoPriv" => None,
                    "authNoPriv" | "authPriv" => {
                        check_secret(&auth_pass, "Contraseña de autenticación", 8)?;
                        Some((self.auth_proto.unwrap_or(AuthProto::Sha), auth_pass))
                    }
                    _ => return Err("Nivel de seguridad inválido".into()),
                };
                let privacy = if level == "authPriv" {
                    check_secret(&priv_pass, "Contraseña de privacidad", 8)?;
                    Some((self.priv_proto.unwrap_or(PrivProto::Aes), priv_pass))
                } else {
                    None
                };
                Security::V3(V3Creds { user, auth, privacy, context })
            }
            _ => return Err("Versión SNMP inválida".into()),
        };
        Ok(Target {
            host,
            port,
            timeout: Duration::from_millis(self.timeout_ms.unwrap_or(2000).clamp(200, 30_000)),
            retries: self.retries.unwrap_or(1).min(5),
            sec,
        })
    }
}

const SAVED_OTHER_TARGET: &str =
    "Los secretos guardados de este perfil son de otro host o puerto. Ingrésalos de nuevo y guarda el perfil";

/// Serializa los secretos de un perfil, con su destino, para guardarlos en la bóveda.
pub fn saved_json(
    host: &str,
    port: Option<u16>,
    community: Option<String>,
    auth_pass: Option<String>,
    priv_pass: Option<String>,
) -> Result<Zeroizing<String>, String> {
    let s = Saved {
        host: check_host(host)?,
        port: port.filter(|p| *p != 0).unwrap_or(161),
        community: community.unwrap_or_default(),
        auth_pass: auth_pass.unwrap_or_default(),
        priv_pass: priv_pass.unwrap_or_default(),
    };
    for (v, what) in [(&s.community, "Community"), (&s.auth_pass, "Contraseña de autenticación"), (&s.priv_pass, "Contraseña de privacidad")] {
        if !v.is_empty() {
            check_secret(v, what, 1)?;
        }
    }
    if s.community.is_empty() && s.auth_pass.is_empty() && s.priv_pass.is_empty() {
        return Err("No hay secretos para guardar".into());
    }
    // Búfer con capacidad de sobra: sin realocaciones que dejen copias sin borrar.
    let cap = 64 + s.host.len() + 6 * (s.community.len() + s.auth_pass.len() + s.priv_pass.len());
    let mut out = Zeroizing::new(Vec::with_capacity(cap));
    serde_json::to_writer(&mut *out, &s).map_err(|e| e.to_string())?;
    Ok(Zeroizing::new(String::from_utf8(std::mem::take(&mut *out)).map_err(|e| e.to_string())?))
}

pub fn check_profile(id: &str) -> Result<String, String> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Perfil inválido".into());
    }
    Ok(format!("{VAULT_NS}{id}"))
}

// ---------- Comandos de la interfaz ----------

/// Secretos guardados de un perfil. Error solo si la bóveda está bloqueada.
fn vault_secret(state: &crate::AppState, profile: &str) -> Result<Option<Zeroizing<String>>, String> {
    let key = check_profile(profile)?;
    Ok(if state.creds.has(&key)? { state.creds.get(&key) } else { None })
}

fn parse_oids(oids: &[String]) -> Result<Vec<Oid>, String> {
    if oids.is_empty() || oids.len() > 32 {
        return Err("Indica entre 1 y 32 OID".into());
    }
    oids.iter().map(|o| parse_oid(o)).collect()
}

/// GET, GETNEXT o GETBULK. Devuelve las filas (OID, tipo, valor).
#[tauri::command(async)]
pub fn snmp_request(
    target: TargetParams,
    op: String,
    oids: Vec<String>,
    max_rep: Option<u32>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<Row>, String> {
    let oids = parse_oids(&oids)?;
    let op = match op.as_str() {
        "get" => Op::Get,
        "getnext" => Op::GetNext,
        "getbulk" => Op::GetBulk { max_rep: max_rep.unwrap_or(10).clamp(1, 100) },
        _ => return Err("Operación SNMP inválida".into()),
    };
    let target = target.into_target(|p| vault_secret(&state, p))?;
    query(target, op, &oids).map(|v| rows(&v)).map_err(|e| e.text())
}

#[derive(Serialize)]
pub struct WalkResult {
    oid: String,
    rows: Vec<Row>,
    truncated: bool,
    error: Option<String>,
}

/// Varios recorridos en una sola sesión (un descubrimiento v3): columnas de una tabla para
/// los conjuntos de OIDs. Un error en una columna no detiene las demás.
#[tauri::command(async)]
pub fn snmp_walk_many(
    target: TargetParams,
    oids: Vec<String>,
    max_rows: Option<usize>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<WalkResult>, String> {
    let roots = parse_oids(&oids)?;
    let target = target.into_target(|p| vault_secret(&state, p))?;
    let limit = max_rows.unwrap_or(2000).clamp(1, 20_000);
    let mut c = Client::connect(target).map_err(|e| e.text())?;
    let never = AtomicBool::new(false);
    let mut out = Vec::new();
    for (root, text) in roots.iter().zip(oids) {
        let mut vbs = Vec::new();
        let res = c.walk(root, Some(25), limit, &never, &mut |b| vbs.extend(b));
        // Sin respuesta en la primera columna: el resto también fallaría.
        if let Err(ReqError::Timeout(e)) = &res {
            if out.is_empty() {
                return Err(e.clone());
            }
        }
        out.push(WalkResult { oid: text, rows: rows(&vbs), truncated: matches!(res, Ok((_, true))), error: res.err().map(|e| e.text()) });
    }
    Ok(out)
}

/// Receptor de traps. `bind`: IP local donde escuchar (127.0.0.1, la de gestión o 0.0.0.0
/// si el usuario lo elige). `v3`: usuario USM para verificar y descifrar traps v3.
#[tauri::command(async)]
pub fn snmp_trap_start(
    port: u16,
    bind: String,
    v3: Option<TargetParams>,
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    let ip: std::net::IpAddr = bind.trim().parse().map_err(|_| "Dirección de escucha inválida")?;
    let usm = match v3 {
        Some(p) if !p.user.as_deref().unwrap_or("").trim().is_empty() => match p.into_target(|x| vault_secret(&state, x))?.sec {
            Security::V3(c) => Some(c),
            _ => None,
        },
        _ => None,
    };
    state.servers.start_snmptrap(app.clone(), SocketAddr::new(ip, port), usm)
}

/// Recorrido (WALK) cancelable con tool_stop. Emite las filas por lotes en "tool-job".
#[tauri::command(async)]
pub fn snmp_walk(
    target: TargetParams,
    oid: String,
    max_rows: Option<usize>,
    bulk: Option<u32>,
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    use crate::nettools::emit;
    let root = parse_oid(&oid)?;
    let target = target.into_target(|p| vault_secret(&state, p))?;
    let limit = max_rows.unwrap_or(10_000).clamp(1, 100_000);
    let (job, cancel, finish) = state.jobs.cancelable();
    let id = job.clone();
    std::thread::spawn(move || {
        let start = Instant::now();
        let mut pending: Vec<Row> = Vec::new();
        let mut last = Instant::now();
        let res = Client::connect(target).and_then(|mut c| {
            c.walk(&root, bulk, limit, &cancel, &mut |b| {
                pending.extend(rows(&b));
                // Lotes cada 250 ms: un ifTable grande no satura la interfaz.
                if last.elapsed() > Duration::from_millis(250) || pending.len() >= 1000 {
                    emit(&app, &id, "line", String::new(), Some(serde_json::json!({ "rows": std::mem::take(&mut pending) })));
                    last = Instant::now();
                }
            })
        });
        if !pending.is_empty() {
            emit(&app, &id, "line", String::new(), Some(serde_json::json!({ "rows": pending })));
        }
        match res {
            Ok((count, truncated)) => emit(
                &app,
                &id,
                "result",
                String::new(),
                Some(serde_json::json!({
                    "count": count,
                    "truncated": truncated,
                    "cancelled": cancel.load(Ordering::SeqCst),
                    "ms": start.elapsed().as_millis() as u64,
                })),
            ),
            Err(e) => emit(&app, &id, "error", e.text(), None),
        }
        finish();
        emit(&app, &id, "done", String::new(), None);
    });
    Ok(job)
}

/// Guarda los secretos de un perfil en la bóveda cifrada. Nunca se devuelven.
#[tauri::command(async)]
pub fn snmp_secret_set(
    profile: String,
    host: String,
    port: Option<u16>,
    community: Option<String>,
    auth_pass: Option<String>,
    priv_pass: Option<String>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let key = check_profile(&profile)?;
    let json = saved_json(&host, port, community, auth_pass, priv_pass)?;
    state.creds.set(&key, &json, &state.store.ids())
}

#[tauri::command(async)]
pub fn snmp_secret_has(profile: String, state: tauri::State<'_, crate::AppState>) -> Result<bool, String> {
    state.creds.has(&check_profile(&profile)?)
}

#[tauri::command(async)]
pub fn snmp_secret_delete(profile: String, state: tauri::State<'_, crate::AppState>) -> Result<(), String> {
    state.creds.delete(&check_profile(&profile)?)
}

// ---------- Topología y tráfico por SNMP (solo lectura, OIDs de una lista fija) ----------
//
// Herramientas › Topología descubre vecinos y lee contadores con el perfil SNMP del equipo.
// Este comando solo admite los OID de las tablas que necesita (nada de SET ni subárboles
// arbitrarios): un frontend comprometido no puede usar el perfil para recorrer otra cosa.
// Cada OID está verificado contra el archivo MIB oficial citado. La lista se repite en
// src/lib/topoSnmp.ts y un test de scripts/tests/topology.test.mjs comprueba que coincidan.

/// Tablas y columnas que se pueden recorrer (WALK con GETBULK).
pub const TOPO_WALK_ROOTS: &[(&str, &str)] = &[
    // IF-MIB, RFC 2863: ifDescr { ifEntry 2 }, ifOperStatus { ifEntry 8 }; ifName { ifXEntry 1 },
    // ifHighSpeed { ifXEntry 15 }, ifAlias { ifXEntry 18 }. ifEntry = 1.3.6.1.2.1.2.2.1,
    // ifXEntry = 1.3.6.1.2.1.31.1.1.1.
    ("1.3.6.1.2.1.2.2.1.2", "ifDescr"),
    ("1.3.6.1.2.1.2.2.1.8", "ifOperStatus"),
    ("1.3.6.1.2.1.31.1.1.1.1", "ifName"),
    ("1.3.6.1.2.1.31.1.1.1.15", "ifHighSpeed"),
    ("1.3.6.1.2.1.31.1.1.1.18", "ifAlias"),
    // LLDP-MIB, IEEE Std 802.1AB-2005 cláusula 12.1 (lldpMIB = 1.0.8802.1.1.2):
    // lldpLocPortTable { lldpLocalSystemData 7 } = 1.0.8802.1.1.2.1.3.7,
    // lldpRemEntry { lldpRemTable 1 } = 1.0.8802.1.1.2.1.4.1.1 (columnas 4 a 10),
    // lldpRemManAddrEntry { lldpRemManAddrTable 1 } = 1.0.8802.1.1.2.1.4.2.1 (IfSubtype, columna 3).
    ("1.0.8802.1.1.2.1.3.7", "lldpLocPortTable"),
    ("1.0.8802.1.1.2.1.4.1.1.4", "lldpRemChassisIdSubtype"),
    ("1.0.8802.1.1.2.1.4.1.1.5", "lldpRemChassisId"),
    ("1.0.8802.1.1.2.1.4.1.1.6", "lldpRemPortIdSubtype"),
    ("1.0.8802.1.1.2.1.4.1.1.7", "lldpRemPortId"),
    ("1.0.8802.1.1.2.1.4.1.1.8", "lldpRemPortDesc"),
    ("1.0.8802.1.1.2.1.4.1.1.9", "lldpRemSysName"),
    ("1.0.8802.1.1.2.1.4.1.1.10", "lldpRemSysDesc"),
    ("1.0.8802.1.1.2.1.4.2.1.3", "lldpRemManAddrIfSubtype"),
    // LLDP-V2-MIB, IEEE Std 802.1AB-2009 (alternativa si LLDP-MIB no responde): lldpV2MIB =
    // { ieee802dot1mibs 13 } con ieee802dot1mibs = 1.3.111.2.802.1.1 (LLDP-V2-TC-MIB);
    // lldpV2RemEntry { lldpV2RemTable 1 } = 1.3.111.2.802.1.1.13.1.4.1.1 (ChassisIdSubtype 5 a
    // SysDesc 11) y lldpV2RemManAddrEntry { lldpV2RemManAddrTable 1 } = 1.3.111.2.802.1.1.13.1.4.2.1
    // (IfSubtype, columna 3). https://www.ieee802.org/1/files/public/MIBs/LLDP-V2-MIB-200906080000Z.txt
    ("1.3.111.2.802.1.1.13.1.4.1.1.5", "lldpV2RemChassisIdSubtype"),
    ("1.3.111.2.802.1.1.13.1.4.1.1.6", "lldpV2RemChassisId"),
    ("1.3.111.2.802.1.1.13.1.4.1.1.7", "lldpV2RemPortIdSubtype"),
    ("1.3.111.2.802.1.1.13.1.4.1.1.8", "lldpV2RemPortId"),
    ("1.3.111.2.802.1.1.13.1.4.1.1.9", "lldpV2RemPortDesc"),
    ("1.3.111.2.802.1.1.13.1.4.1.1.10", "lldpV2RemSysName"),
    ("1.3.111.2.802.1.1.13.1.4.1.1.11", "lldpV2RemSysDesc"),
    ("1.3.111.2.802.1.1.13.1.4.2.1.3", "lldpV2RemManAddrIfSubtype"),
    // CISCO-CDP-MIB (ciscoCdpMIB = { ciscoMgmt 23 } = 1.3.6.1.4.1.9.9.23), cdpCacheEntry =
    // { cdpCacheTable 1 } = 1.3.6.1.4.1.9.9.23.1.2.1.1: AddressType 3, Address 4, DeviceId 6,
    // DevicePort 7, Platform 8.
    ("1.3.6.1.4.1.9.9.23.1.2.1.1.3", "cdpCacheAddressType"),
    ("1.3.6.1.4.1.9.9.23.1.2.1.1.4", "cdpCacheAddress"),
    ("1.3.6.1.4.1.9.9.23.1.2.1.1.6", "cdpCacheDeviceId"),
    ("1.3.6.1.4.1.9.9.23.1.2.1.1.7", "cdpCacheDevicePort"),
    ("1.3.6.1.4.1.9.9.23.1.2.1.1.8", "cdpCachePlatform"),
    // OSPF-MIB, RFC 4750 (igual en RFC 1850): ospfNbrEntry = { ospfNbrTable 1 } = 1.3.6.1.2.1.14.10.1,
    // ospfNbrRtrId 3, ospfNbrState 6.
    ("1.3.6.1.2.1.14.10.1.3", "ospfNbrRtrId"),
    ("1.3.6.1.2.1.14.10.1.6", "ospfNbrState"),
    // BGP4-MIB, RFC 4273: bgpPeerEntry = { bgpPeerTable 1 } = 1.3.6.1.2.1.15.3.1,
    // bgpPeerState 2, bgpPeerRemoteAs 9.
    ("1.3.6.1.2.1.15.3.1.2", "bgpPeerState"),
    ("1.3.6.1.2.1.15.3.1.9", "bgpPeerRemoteAs"),
    // IP-MIB, RFC 4293: ipAddrEntry { ipAddrTable 1 } = 1.3.6.1.2.1.4.20.1 (ipAdEntIfIndex 2,
    // ipAdEntNetMask 3); ipNetToPhysicalEntry = 1.3.6.1.2.1.4.35.1 (PhysAddress 4, Type 6);
    // ipNetToMediaEntry = 1.3.6.1.2.1.4.22.1 (PhysAddress 2, Type 4), alternativa obsoleta.
    ("1.3.6.1.2.1.4.20.1.2", "ipAdEntIfIndex"),
    ("1.3.6.1.2.1.4.20.1.3", "ipAdEntNetMask"),
    ("1.3.6.1.2.1.4.35.1.4", "ipNetToPhysicalPhysAddress"),
    ("1.3.6.1.2.1.4.35.1.6", "ipNetToPhysicalType"),
    ("1.3.6.1.2.1.4.22.1.2", "ipNetToMediaPhysAddress"),
    ("1.3.6.1.2.1.4.22.1.4", "ipNetToMediaType"),
    // BRIDGE-MIB, RFC 4188 (dot1dBridge = { mib-2 17 }): dot1dBasePortIfIndex
    // { dot1dBasePortEntry 2 } = 1.3.6.1.2.1.17.1.4.1.2; dot1dTpFdbEntry = 1.3.6.1.2.1.17.4.3.1
    // (dot1dTpFdbPort 2, dot1dTpFdbStatus 3).
    ("1.3.6.1.2.1.17.1.4.1.2", "dot1dBasePortIfIndex"),
    ("1.3.6.1.2.1.17.4.3.1.2", "dot1dTpFdbPort"),
    ("1.3.6.1.2.1.17.4.3.1.3", "dot1dTpFdbStatus"),
    // Q-BRIDGE-MIB, RFC 4363 (qBridgeMIB = { dot1dBridge 7 }): dot1qTpFdbEntry =
    // 1.3.6.1.2.1.17.7.1.2.2.1 (dot1qTpFdbPort 2, dot1qTpFdbStatus 3).
    ("1.3.6.1.2.1.17.7.1.2.2.1.2", "dot1qTpFdbPort"),
    ("1.3.6.1.2.1.17.7.1.2.2.1.3", "dot1qTpFdbStatus"),
    // CISCO-VTP-MIB (ciscoVtpMIB = { ciscoMgmt 46 } = 1.3.6.1.4.1.9.9.46): vtpMIBObjects 1,
    // vlanInfo 3, vtpVlanTable 1, vtpVlanEntry 1 (índice managementDomainIndex.vtpVlanIndex),
    // vtpVlanState 2 = 1.3.6.1.4.1.9.9.46.1.3.1.1.2.
    // https://github.com/cisco/cisco-mibs/blob/main/v2/CISCO-VTP-MIB.my
    ("1.3.6.1.4.1.9.9.46.1.3.1.1.2", "vtpVlanState"),
];

/// Tablas que se pueden leer en el contexto de una VLAN (`community@vlan` o contexto v3
/// `vlan-N`): en Cisco la tabla MAC de BRIDGE-MIB es por VLAN. Subconjunto de TOPO_WALK_ROOTS.
pub const TOPO_VLAN_WALKS: &[&str] = &["1.3.6.1.2.1.17.1.4.1.2", "1.3.6.1.2.1.17.4.3.1.2", "1.3.6.1.2.1.17.4.3.1.3"];

/// Columnas cuyas instancias se pueden pedir con GET (contadores de tráfico y velocidad).
pub const TOPO_GET_COLUMNS: &[(&str, &str)] = &[
    // IF-MIB, RFC 2863: ifSpeed { ifEntry 5 }, ifInOctets { ifEntry 10 }, ifOutOctets { ifEntry 16 },
    // ifHCInOctets { ifXEntry 6 }, ifHCOutOctets { ifXEntry 10 }, ifHighSpeed { ifXEntry 15 }.
    ("1.3.6.1.2.1.2.2.1.5", "ifSpeed"),
    ("1.3.6.1.2.1.2.2.1.10", "ifInOctets"),
    ("1.3.6.1.2.1.2.2.1.16", "ifOutOctets"),
    ("1.3.6.1.2.1.31.1.1.1.6", "ifHCInOctets"),
    ("1.3.6.1.2.1.31.1.1.1.10", "ifHCOutOctets"),
    ("1.3.6.1.2.1.31.1.1.1.15", "ifHighSpeed"),
];

/// Escalares que se pueden pedir con GET (con su ".0").
pub const TOPO_GET_SCALARS: &[(&str, &str)] = &[
    // SNMPv2-MIB, RFC 3418: sysObjectID { system 2 } (fabricante) y sysName { system 5 }.
    ("1.3.6.1.2.1.1.2.0", "sysObjectID"),
    ("1.3.6.1.2.1.1.5.0", "sysName"),
    // OSPF-MIB, RFC 4750: ospfRouterId { ospfGeneralGroup 1 }.
    ("1.3.6.1.2.1.14.1.1.0", "ospfRouterId"),
    // BGP4-MIB, RFC 4273: bgpLocalAs { bgp 2 }, bgpIdentifier { bgp 4 }.
    ("1.3.6.1.2.1.15.2.0", "bgpLocalAs"),
    ("1.3.6.1.2.1.15.4.0", "bgpIdentifier"),
];

/// Topes del comando: filas y tiempo por tabla y tiempo total.
#[derive(Clone, Copy, Debug)]
pub struct TopoLimits {
    pub max_rows: usize,
    pub table_time: Duration,
    pub total_time: Duration,
}

pub const TOPO_LIMITS: TopoLimits = TopoLimits { max_rows: 10_000, table_time: Duration::from_secs(20), total_time: Duration::from_secs(120) };
/// Máximo de recorridos y de OID para GET en una llamada.
pub const TOPO_MAX_WALKS: usize = 40;
pub const TOPO_MAX_GETS: usize = 192;
/// OID por PDU de GET: 48 contadores caben holgados en un datagrama.
const TOPO_GET_CHUNK: usize = 48;
/// Largo máximo del índice de una instancia pedida con GET (ifIndex es un solo número).
const TOPO_MAX_INSTANCE: usize = 1;

fn topo_listed(list: &[(&str, &str)], oid: &Oid) -> bool {
    list.iter().any(|(r, _)| parse_oid(r).is_ok_and(|r| &r == oid))
}

/// Recorrido permitido: coincidencia exacta con una raíz de la lista (por componentes).
pub fn topo_walk_oid(s: &str) -> Result<Oid, String> {
    let oid = parse_oid(s)?;
    if topo_listed(TOPO_WALK_ROOTS, &oid) {
        Ok(oid)
    } else {
        Err(format!("OID no permitido en Topología: {}", oid_str(&oid)))
    }
}

/// GET permitido: un escalar de la lista o una instancia (ifIndex) de una columna permitida.
pub fn topo_get_oid(s: &str) -> Result<Oid, String> {
    let oid = parse_oid(s)?;
    let instance = TOPO_GET_COLUMNS.iter().any(|(c, _)| {
        parse_oid(c).is_ok_and(|c| oid.len() > c.len() && oid.len() - c.len() <= TOPO_MAX_INSTANCE && oid.starts_with(&c))
    });
    if instance || topo_listed(TOPO_GET_SCALARS, &oid) {
        Ok(oid)
    } else {
        Err(format!("OID no permitido en Topología: {}", oid_str(&oid)))
    }
}

/// Fila con el valor legible y, para cadenas de octetos, también en hexadecimal: una MAC o una
/// IP (cdpCacheAddress, lldpRemChassisId) pueden parecer texto imprimible.
#[derive(Serialize, Clone, Debug)]
pub struct TopoRow {
    pub oid: String,
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hex: Option<String>,
}

fn topo_rows(vbs: &[(Oid, Value)]) -> Vec<TopoRow> {
    vbs.iter()
        .map(|(o, v)| {
            let (kind, value) = display(v);
            let hex = match v {
                Value::Str(b) => Some(hex(&b[..b.len().min(64)], "")),
                _ => None,
            };
            TopoRow { oid: oid_str(o), kind, value, hex }
        })
        .collect()
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TopoWalk {
    pub oid: String,
    pub rows: Vec<TopoRow>,
    /// Se alcanzó el tope de filas.
    pub truncated: bool,
    /// Se alcanzó el tope de tiempo de la tabla o el total: resultado parcial.
    pub timed_out: bool,
    pub error: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TopoRead {
    pub gets: Vec<TopoRow>,
    pub get_error: Option<String>,
    pub walks: Vec<TopoWalk>,
    pub ms: u64,
}

/// GET (en grupos) y recorridos con topes de filas y tiempo. Un error o un tope en una tabla
/// no detiene las demás; si el agente no responde al primer pedido, se devuelve el error.
pub fn topo_read(c: &mut Client, gets: &[Oid], walks: &[(Oid, String)], lim: TopoLimits) -> Result<TopoRead, ReqError> {
    let start = Instant::now();
    let mut out = TopoRead { gets: Vec::new(), get_error: None, walks: Vec::new(), ms: 0 };
    let mut answered = false;
    for chunk in gets.chunks(TOPO_GET_CHUNK) {
        match c.get(chunk) {
            Ok(vbs) => {
                answered = true;
                out.gets.extend(topo_rows(&vbs));
            }
            Err(e @ ReqError::Timeout(_)) if !answered => return Err(e),
            Err(e) => {
                out.get_error = Some(e.text());
                break;
            }
        }
    }
    for (root, text) in walks {
        let left = lim.total_time.saturating_sub(start.elapsed());
        if left.is_zero() {
            out.walks.push(TopoWalk { oid: text.clone(), rows: Vec::new(), truncated: false, timed_out: true, error: Some("Tiempo total agotado: tabla no leída".into()) });
            continue;
        }
        let deadline = Instant::now() + lim.table_time.min(left);
        let stop = AtomicBool::new(false);
        let mut vbs = Vec::new();
        let res = c.walk(root, Some(25), lim.max_rows, &stop, &mut |b| {
            vbs.extend(b);
            // El recorrido revisa `stop` antes de cada pedido: así se corta por tiempo.
            if Instant::now() >= deadline {
                stop.store(true, Ordering::SeqCst);
            }
        });
        if !answered && vbs.is_empty() {
            if let Err(ReqError::Timeout(e)) = &res {
                return Err(ReqError::Timeout(e.clone()));
            }
        }
        answered |= res.is_ok() || !vbs.is_empty();
        let timed_out = stop.load(Ordering::SeqCst);
        out.walks.push(TopoWalk {
            oid: text.clone(),
            truncated: matches!(res, Ok((_, true))) && !timed_out,
            timed_out,
            error: res.err().map(|e| e.text()),
            rows: topo_rows(&vbs),
        });
    }
    out.ms = start.elapsed().as_millis() as u64;
    Ok(out)
}

/// OIDs para GET y recorridos (OID y su texto original) ya validados.
pub type TopoPlan = (Vec<Oid>, Vec<(Oid, String)>);

/// Valida la lista de OID pedida desde la interfaz contra las listas permitidas.
pub fn topo_check(gets: &[String], walks: &[String]) -> Result<TopoPlan, String> {
    if gets.len() > TOPO_MAX_GETS || walks.len() > TOPO_MAX_WALKS || (gets.is_empty() && walks.is_empty()) {
        return Err(format!("Indica hasta {TOPO_MAX_GETS} OID para GET y {TOPO_MAX_WALKS} tablas"));
    }
    let g = gets.iter().map(|o| topo_get_oid(o)).collect::<Result<Vec<_>, _>>()?;
    let w = walks.iter().map(|o| topo_walk_oid(o).map(|r| (r, o.clone()))).collect::<Result<Vec<_>, _>>()?;
    Ok((g, w))
}

/// Lectura por VLAN: solo las tablas de BRIDGE-MIB, sin GET, con una VLAN 1 a 4094.
pub fn topo_vlan_check(gets: &[String], walks: &[String], vlan: u16) -> Result<(), String> {
    if !(1..=4094).contains(&vlan) {
        return Err("VLAN inválida (1 a 4094)".into());
    }
    let allowed: Vec<Oid> = TOPO_VLAN_WALKS.iter().filter_map(|o| parse_oid(o).ok()).collect();
    if !gets.is_empty() || walks.iter().any(|w| parse_oid(w).map_or(true, |o| !allowed.contains(&o))) {
        return Err("Por VLAN solo se leen las tablas MAC de BRIDGE-MIB".into());
    }
    Ok(())
}

/// Contexto de una VLAN en Cisco: con v1/v2c la community pasa a `community@vlan`
/// ("community string indexing"); con v3, el contextName `vlan-N`. La community sigue atada al
/// host y puerto del perfil: solo cambia la instancia de BRIDGE-MIB que responde el agente.
pub fn vlan_scope(sec: &mut Security, vlan: u16) {
    match sec {
        Security::Community { community, .. } => {
            let indexed = Zeroizing::new(format!("{}@{vlan}", community.as_str()));
            *community = indexed;
        }
        Security::V3(c) => c.context = format!("vlan-{vlan}"),
    }
}

/// Lectura para Topología con un perfil SNMP: GET de contadores y escalares permitidos y
/// recorridos de las tablas permitidas, con topes de filas y tiempo. Solo lectura. Con `vlan`,
/// lee la tabla MAC de esa VLAN (Cisco: community@vlan o contexto vlan-N en v3).
#[tauri::command(async)]
pub fn snmp_topo_read(
    target: TargetParams,
    gets: Vec<String>,
    walks: Vec<String>,
    vlan: Option<u16>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<TopoRead, String> {
    if let Some(v) = vlan {
        topo_vlan_check(&gets, &walks, v)?;
    }
    let (gets, walks) = topo_check(&gets, &walks)?;
    let mut target = target.into_target(|p| vault_secret(&state, p))?;
    if let Some(v) = vlan {
        vlan_scope(&mut target.sec, v);
    }
    // Un equipo que no responde no deja la herramienta esperando minutos por tabla.
    target.timeout = target.timeout.min(Duration::from_secs(5));
    target.retries = target.retries.min(2);
    let mut c = Client::connect(target).map_err(|e| e.text())?;
    topo_read(&mut c, &gets, &walks, TOPO_LIMITS).map_err(|e| e.text())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn hexs(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    #[test]
    fn ber_integers_roundtrip() {
        for v in [0i64, 1, 127, 128, 255, 256, -1, -128, -129, i32::MAX as i64, i32::MIN as i64, i64::MAX, i64::MIN] {
            let e = enc_int(v);
            let (tag, c) = Rd::new(&e).tlv().unwrap();
            assert_eq!(tag, T_INT);
            assert_eq!(dec_int(c).unwrap(), v, "{v}");
        }
        assert_eq!(enc_int(0), vec![2, 1, 0]);
        assert_eq!(enc_int(128), vec![2, 2, 0, 0x80]);
        assert_eq!(enc_int(-129), vec![2, 2, 0xFF, 0x7F]);
        assert_eq!(enc_uint(T_COUNTER32, 0xFFFF_FFFF), vec![0x41, 5, 0, 0xFF, 0xFF, 0xFF, 0xFF]);
        assert_eq!(dec_uint(&[0, 0xFF, 0xFF, 0xFF, 0xFF], 4).unwrap(), 0xFFFF_FFFF);
        assert_eq!(dec_uint(&[0, 0xFF, 0, 0, 0, 0, 0, 0, 1], 8).unwrap(), 0xFF00_0000_0000_0001);
        assert!(dec_uint(&[1, 0, 0, 0, 0], 4).is_err());
        assert!(dec_int(&[]).is_err());
    }

    #[test]
    fn ber_long_lengths() {
        for n in [0usize, 127, 128, 255, 256, 65535, 65536] {
            let t = tlv(T_OCTETS, &vec![7u8; n]);
            assert_eq!(hdr_len(n), t.len() - n);
            let (_, c) = Rd::new(&t).tlv().unwrap();
            assert_eq!(c.len(), n);
        }
    }

    #[test]
    fn ber_rejects_malformed() {
        // Largo mayor que el búfer, indefinido y tipo multibyte.
        assert!(Rd::new(&[0x04, 0x05, 1, 2]).tlv().is_err());
        assert!(Rd::new(&[0x30, 0x80, 0, 0]).tlv().is_err());
        assert!(Rd::new(&[0x1F, 0x01, 0]).tlv().is_err());
        assert!(Rd::new(&[0x04, 0x84, 0xFF, 0xFF, 0xFF, 0xFF]).tlv().is_err());
        assert!(Rd::new(&[0x04]).tlv().is_err());
        // OID truncado, relleno no mínimo y arco fuera de u32.
        assert!(dec_oid(&[0x2B, 0x86]).is_err());
        assert!(dec_oid(&[0x2B, 0x80, 0x01]).is_err());
        assert!(dec_oid(&[0x2B, 0x9F, 0xFF, 0xFF, 0xFF, 0x7F]).is_err());
        // Ningún prefijo de un mensaje válido debe hacer pánico.
        let msg = enc_community(1, b"public", &Pdu { kind: PDU_GET, req_id: 7, err_status: 0, err_index: 0, vbs: vec![(vec![1, 3, 6, 1, 2, 1, 1, 1, 0], Value::Null)] }).unwrap();
        for i in 0..msg.len() {
            let _ = decode(&msg[..i]);
            let mut bad = msg.clone();
            bad[i] ^= 0xFF;
            let _ = decode(&bad);
        }
    }

    #[test]
    fn oid_encoding() {
        let oid = parse_oid(".1.3.6.1.2.1.1.1.0").unwrap();
        let e = enc_oid(&oid).unwrap();
        assert_eq!(e, vec![0x06, 0x08, 0x2B, 6, 1, 2, 1, 1, 1, 0]);
        assert_eq!(dec_oid(&e[2..]).unwrap(), oid);
        let big = vec![1, 3, 6, 1, 4, 1, 2011, 4294967295];
        assert_eq!(dec_oid(&enc_oid(&big).unwrap()[2..]).unwrap(), big);
        assert_eq!(dec_oid(&enc_oid(&[2, 999, 3]).unwrap()[2..]).unwrap(), vec![2, 999, 3]);
        assert!(parse_oid("1.3.6.x").is_err());
        assert!(parse_oid("1").is_err());
        assert!(parse_oid("1.45").is_err());
        assert!(parse_oid("1.3.6.1.4294967296").is_err());
        assert_eq!(oid_str(&oid), "1.3.6.1.2.1.1.1.0");
    }

    #[test]
    fn v2c_get_matches_reference_encoding() {
        // GET v2c de sysDescr.0, community public, request-id 0x1234 (BER según RFC 3416).
        let pdu = Pdu { kind: PDU_GET, req_id: 0x1234, err_status: 0, err_index: 0, vbs: vec![(parse_oid("1.3.6.1.2.1.1.1.0").unwrap(), Value::Null)] };
        let msg = enc_community(1, b"public", &pdu).unwrap();
        assert_eq!(msg, hexs("302702010104067075626c6963a01a02021234020100020100300e300c06082b060102010101000500"));
        match decode(&msg).unwrap() {
            Message::Community { version: 1, community, body: Body::Pdu(p) } => {
                assert_eq!(community, b"public");
                assert_eq!(p, pdu);
            }
            _ => panic!(),
        }
    }

    #[test]
    fn decodes_all_value_types() {
        let vals = vec![
            Value::Int(-5),
            Value::Str(b"Cisco IOS".to_vec()),
            Value::Null,
            Value::Oid(vec![1, 3, 6, 1, 4, 1, 9, 1, 1]),
            Value::Ip([192, 0, 2, 1]),
            Value::Counter32(4_000_000_000),
            Value::Gauge32(1_000_000_000),
            Value::Ticks(123456),
            Value::Opaque(vec![1, 2]),
            Value::Counter64(u64::MAX),
            Value::NoSuchObject,
            Value::NoSuchInstance,
            Value::EndOfMib,
        ];
        let vbs: Vec<_> = vals.iter().enumerate().map(|(i, v)| (vec![1, 3, 6, 1, i as u32], v.clone())).collect();
        let pdu = Pdu { kind: PDU_RESPONSE, req_id: 0x7FFF_FFFF, err_status: 0, err_index: 0, vbs };
        let Message::Community { body: Body::Pdu(p), .. } = decode(&enc_community(0, b"x", &pdu).unwrap()).unwrap() else { panic!() };
        assert_eq!(p, pdu);
        assert_eq!(display(&Value::Ticks(8_640_123)).1, "8640123 (1d 0h 0m 1.23s)");
        assert_eq!(display(&Value::Str(vec![0, 0x1A, 0x2B, 0x3C, 0x4D, 0x5E])).1, "00:1A:2B:3C:4D:5E");
        assert_eq!(display(&Value::Str(b"GigabitEthernet0/1\0".to_vec())).1, "GigabitEthernet0/1");
        assert_eq!(display(&Value::Str(vec![1, 2, 3])).0, "Hex-STRING");
    }

    #[test]
    fn rfc3414_key_localization() {
        // RFC 3414 A.3.1 y A.3.2: contraseña "maplesyrup", engineID 00..02.
        let engine = hexs("000000000000000000000002");
        assert_eq!(AuthProto::Md5.localize(b"maplesyrup", &engine).to_vec(), hexs("526f5eed9fcce26f8964c2930787d82b"));
        assert_eq!(AuthProto::Sha.localize(b"maplesyrup", &engine).to_vec(), hexs("6695febc9288e36282235fc7151f128497b38f3f"));
        // RFC 7860 no trae vectores: SHA-256 se contrastó con un cálculo independiente (hashlib).
        assert_eq!(
            AuthProto::Sha256.localize(b"maplesyrup", &engine).to_vec(),
            hexs("8982e0e549e866db361a6b625d84cccc11162d453ee8ce3a6445c2d6776f0f8b")
        );
        // Ku intermedio de RFC 3414 A.3.1 (MD5) y A.3.2 (SHA-1).
        assert_eq!(AuthProto::Md5.password_key(b"maplesyrup").to_vec(), hexs("9faf3283884e92834ebc9847d8edd963"));
        assert_eq!(AuthProto::Sha.password_key(b"maplesyrup").to_vec(), hexs("9fb5cc0381497b3793528939ff788d5d79145211"));
        // Resto de RFC 7860 (SHA-224/384/512), contrastado con hashlib con el mismo algoritmo de A.2.
        assert_eq!(
            AuthProto::Sha224.localize(b"maplesyrup", &engine).to_vec(),
            hexs("0bd8827c6e29f8065e08e09237f177e410f69b90e1782be682075674")
        );
        assert_eq!(
            AuthProto::Sha384.localize(b"maplesyrup", &engine).to_vec(),
            hexs("3b298f16164a11184279d5432bf169e2d2a48307de02b3d3f7e2b4f36eb6f0455a53689a3937eea07319a633d2ccba78")
        );
        assert_eq!(
            AuthProto::Sha512.localize(b"maplesyrup", &engine).to_vec(),
            hexs(concat!(
                "22a5a36cedfcc085807a128d7bc6c2382167ad6c0dbc5fdff856740f3d84c099",
                "ad1ea87a8db096714d9788bd544047c9021e4229ce27e4c0a69250adfcffbb0b"
            ))
        );
    }

    #[test]
    fn v3_auth_offset_points_to_placeholder() {
        let h = V3Header { msg_id: 99, flags: 7, engine_id: &[0x80, 0, 0, 9, 3, 1], boots: 3, time: 1000, user: b"monitor", auth_len: 24, priv_params: &[1; 8] };
        let data = tlv(T_OCTETS, &vec![0xAB; 300]);
        let (msg, off) = enc_v3(&h, &data);
        let Message::V3(m) = decode(&msg).unwrap() else { panic!() };
        assert_eq!(m.auth_off, off);
        assert_eq!(m.auth_params, vec![0u8; 24]);
        assert_eq!((m.msg_id, m.flags, m.boots, m.time), (99, 7, 3, 1000));
        assert_eq!(m.user, b"monitor");
        assert!(m.encrypted);
        assert_eq!(m.data, vec![0xAB; 300]);
    }

    #[test]
    fn aes_cfb_roundtrip_and_known_vector() {
        // NIST SP 800-38A F.3.13 (CFB128-AES128.Encrypt), primer bloque.
        let key = hexs("2b7e151628aed2a6abf7158809cf4f3c");
        let iv = hexs("000102030405060708090a0b0c0d0e0f");
        let mut data = hexs("6bc1bee22e409f96e93d7e117393172a");
        let boots = u32::from_be_bytes(iv[0..4].try_into().unwrap());
        let time = u32::from_be_bytes(iv[4..8].try_into().unwrap());
        PrivProto::Aes.apply(&key, boots, time, &iv[8..], &mut data, true).unwrap();
        assert_eq!(data, hexs("3b3fd92eb72dad20333449f8e83cfb4a"));
        PrivProto::Aes.apply(&key, boots, time, &iv[8..], &mut data, false).unwrap();
        assert_eq!(data, hexs("6bc1bee22e409f96e93d7e117393172a"));
        assert!(PrivProto::Aes.apply(&key[..8], 0, 0, &iv[8..], &mut data, true).is_err());

        // NIST SP 800-38A F.3.17 (CFB128-AES256.Encrypt), primer bloque.
        let key = hexs("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
        let mut data = hexs("6bc1bee22e409f96e93d7e117393172a");
        PrivProto::Aes256.apply(&key, boots, time, &iv[8..], &mut data, true).unwrap();
        assert_eq!(data, hexs("dc7e84bfda79164b7ecd8486985d3860"));

        // NIST SP 800-38A F.3.15 (CFB128-AES192.Encrypt), primer bloque.
        let key = hexs("8e73b0f7da0e6452c810f32b809079e562f8ead2522c6b7b");
        let mut data = hexs("6bc1bee22e409f96e93d7e117393172a");
        PrivProto::Aes192.apply(&key, boots, time, &iv[8..], &mut data, true).unwrap();
        assert_eq!(data, hexs("cdc80d6fddf18cab34c25909c99a4174"));

        // F.3.13 con 40 bytes: el ScopedPDU rara vez es múltiplo de 16 y el último bloque va parcial.
        let key = hexs("2b7e151628aed2a6abf7158809cf4f3c");
        let plain = hexs("6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411");
        let mut data = plain.clone();
        PrivProto::Aes.apply(&key, boots, time, &iv[8..], &mut data, true).unwrap();
        assert_eq!(data, hexs("3b3fd92eb72dad20333449f8e83cfb4ac8a64537a0b3a93fcde3cdad9f1ce58b26751f67a3cbb140"));
        PrivProto::Aes.apply(&key, boots, time, &iv[8..], &mut data, false).unwrap();
        assert_eq!(data, plain);

        // Cadena completa: clave AES-192 Cisco desde MD5 (extensión Reeder), IV de RFC 3826 y
        // 37 bytes. Contrastado con `openssl enc -aes-192-cfb`.
        let engine = hexs("000000000000000000000002");
        let key = PrivProto::Aes192c.key(AuthProto::Md5, b"maplesyrup", &engine);
        let plain = b"show interfaces status, 37 bytes long".to_vec();
        let mut data = plain.clone();
        PrivProto::Aes192c.apply(&key, 3, 1000, &hexs("0102030405060708"), &mut data, true).unwrap();
        assert_eq!(data, hexs("f223ebaee4c983997911fb246841d6eea72354ca7e6490ebafccf9025e0648885193cc37dd"));
        PrivProto::Aes192c.apply(&key, 3, 1000, &hexs("0102030405060708"), &mut data, false).unwrap();
        assert_eq!(data, plain);
    }

    #[test]
    fn priv_key_extension_and_des() {
        let engine = hexs("000000000000000000000002");
        // SHA-1 da 20 bytes: AES-256 extiende. Valores calculados de forma independiente
        // (hashlib) según draft-blumenthal-aes-usm-04 y draft-reeder-snmpv3-usm-3desede-00.
        let blu = PrivProto::Aes256.key(AuthProto::Sha, b"maplesyrup", &engine);
        let ree = PrivProto::Aes256c.key(AuthProto::Sha, b"maplesyrup", &engine);
        assert_eq!(blu.to_vec(), hexs("6695febc9288e36282235fc7151f128497b38f3f505e07eb9af25568fa1f5dbe"));
        assert_eq!(ree.to_vec(), hexs("6695febc9288e36282235fc7151f128497b38f3f9b8b6d78936ba6e7d19dfd9c"));
        // SHA-256 da 32 bytes: no hay extensión y ambas variantes coinciden.
        assert_eq!(PrivProto::Aes256.key(AuthProto::Sha256, b"maplesyrup", &engine), PrivProto::Aes256c.key(AuthProto::Sha256, b"maplesyrup", &engine));
        assert_eq!(PrivProto::Aes.key(AuthProto::Sha, b"maplesyrup", &engine).len(), 16);
        // MD5 da 16 bytes: AES-192 y AES-256 extienden en las dos variantes (hashlib).
        let md5_keys = [
            (PrivProto::Aes192, "526f5eed9fcce26f8964c2930787d82bfa24a92467426c2f"),
            (PrivProto::Aes192c, "526f5eed9fcce26f8964c2930787d82b79eff44a90650ee0"),
            (PrivProto::Aes256, "526f5eed9fcce26f8964c2930787d82bfa24a92467426c2f4b09192be10dfaec"),
            (PrivProto::Aes256c, "526f5eed9fcce26f8964c2930787d82b79eff44a90650ee0a3a40abfac5acc12"),
        ];
        for (p, want) in md5_keys {
            assert_eq!(p.key(AuthProto::Md5, b"maplesyrup", &engine).to_vec(), hexs(want), "{p:?}");
        }

        // DES-CBC: relleno a 8 y vuelta al texto original (el largo BER marca el fin).
        let key = PrivProto::Des.key(AuthProto::Md5, b"maplesyrup", &engine);
        let salt = PrivProto::Des.salt(7);
        assert_eq!(&salt[..4], &7u32.to_be_bytes());
        let plain = enc_scoped(&engine, b"", &Pdu { kind: PDU_GET, req_id: 1, err_status: 0, err_index: 0, vbs: vec![] }).unwrap();
        let mut data = plain.clone();
        PrivProto::Des.apply(&key, 7, 0, &salt, &mut data, true).unwrap();
        assert_eq!(data.len() % 8, 0);
        PrivProto::Des.apply(&key, 7, 0, &salt, &mut data, false).unwrap();
        assert_eq!(&data[..plain.len()], &plain[..]);
        assert!(dec_scoped(&data).is_ok());

        // Vector fijo (RFC 3414 8.1.1.1): clave 526f5eed9fcce26f, IV = pre-IV 8964c2930787d82b
        // XOR salt 0000000700000001. Contrastado con `openssl enc -des-cbc -nopad`.
        let salt = hexs("0000000700000001");
        let mut data = b"NetTerminal SNMP".to_vec();
        PrivProto::Des.apply(&key, 7, 0, &salt, &mut data, true).unwrap();
        assert_eq!(data, hexs("7d8ad50e72bc5e633337c5ea9b29e813"));
        PrivProto::Des.apply(&key, 7, 0, &salt, &mut data, false).unwrap();
        assert_eq!(data, b"NetTerminal SNMP");
    }

    /// Arma un trap v3 como lo haría un equipo (motor autoritativo).
    fn v3_trap(user: &str, auth: AuthProto, privacy: Option<PrivProto>, boots: u32, time: u32) -> Vec<u8> {
        let engine = hexs("800000090300aabbccddeeff");
        let pdu = Pdu {
            kind: PDU_TRAP_V2,
            req_id: 5,
            err_status: 0,
            err_index: 0,
            vbs: vec![(SYS_UPTIME.to_vec(), Value::Ticks(500)), (SNMP_TRAP_OID.to_vec(), Value::Oid(vec![1, 3, 6, 1, 6, 3, 1, 1, 5, 3]))],
        };
        let scoped = enc_scoped(&engine, b"", &pdu).unwrap();
        let (mut flags, mut salt, mut data) = (FLAG_AUTH, vec![], scoped);
        if let Some(p) = privacy {
            flags |= FLAG_PRIV;
            salt = p.salt(boots).to_vec();
            let key = p.key(auth, b"privpass123", &engine);
            p.apply(&key, boots, time, &salt, &mut data, true).unwrap();
            data = tlv(T_OCTETS, &data);
        }
        let h = V3Header { msg_id: 9, flags, engine_id: &engine, boots, time, user: user.as_bytes(), auth_len: auth.mac_len(), priv_params: &salt };
        let (mut msg, off) = enc_v3(&h, &data);
        let mac = auth.hmac(&auth.localize(b"authpass123", &engine), &msg);
        msg[off..off + auth.mac_len()].copy_from_slice(&mac[..auth.mac_len()]);
        msg
    }

    #[test]
    fn verifies_and_decrypts_v3_traps() {
        let src: SocketAddr = "192.0.2.9:50000".parse().unwrap();
        let creds = |privacy: Option<PrivProto>| V3Creds {
            user: "traps".into(),
            auth: Some((AuthProto::Sha256, Zeroizing::new("authpass123".into()))),
            privacy: privacy.map(|p| (p, Zeroizing::new("privpass123".into()))),
            context: String::new(),
        };
        let mut usm = TrapUsm::new(creds(Some(PrivProto::Aes)));
        let (t, _) = decode_trap(&v3_trap("traps", AuthProto::Sha256, Some(PrivProto::Aes), 3, 1000), src, Some(&mut usm)).unwrap();
        assert_eq!(t.trap_oid, "1.3.6.1.6.3.1.1.5.3");
        assert!(t.note.unwrap().contains("authPriv verificado"));
        // Repetición fuera de ventana (boots anterior) y firma con otra contraseña.
        let (t, _) = decode_trap(&v3_trap("traps", AuthProto::Sha256, Some(PrivProto::Aes), 2, 1000), src, Some(&mut usm)).unwrap();
        assert!(t.note.unwrap().contains("ventana"));
        let mut bad = v3_trap("traps", AuthProto::Sha256, Some(PrivProto::Aes), 3, 1001);
        let n = bad.len();
        bad[n - 1] ^= 1;
        let (t, _) = decode_trap(&bad, src, Some(&mut usm)).unwrap();
        assert!(t.note.unwrap().contains("firma"));
        // Otro usuario o receptor sin usuario: se muestra solo la cabecera.
        let (t, _) = decode_trap(&v3_trap("otro", AuthProto::Sha256, None, 3, 1000), src, Some(&mut usm)).unwrap();
        assert!(t.trap_oid.is_empty() && t.note.unwrap().contains("configura"));
        let mut usm = TrapUsm::new(creds(None));
        let (t, _) = decode_trap(&v3_trap("traps", AuthProto::Sha256, None, 1, 10), src, Some(&mut usm)).unwrap();
        assert!(t.note.unwrap().contains("authNoPriv verificado"));
    }

    #[test]
    fn hmac_truncation_lengths() {
        for p in [AuthProto::Md5, AuthProto::Sha, AuthProto::Sha224, AuthProto::Sha256, AuthProto::Sha384, AuthProto::Sha512] {
            assert!(p.hmac(b"k", b"d").len() >= p.mac_len());
        }
        // RFC 2202 caso 2 (HMAC-SHA1).
        assert_eq!(AuthProto::Sha.hmac(b"Jefe", b"what do ya want for nothing?"), hexs("effcdf6ae5eb2fa2d27416d5f184df9c259a7c79"));
        // RFC 2202 caso 2 (HMAC-MD5) y RFC 4231 caso 2 (HMAC-SHA-224/256/384/512).
        let jefe = |p: AuthProto| p.hmac(b"Jefe", b"what do ya want for nothing?");
        assert_eq!(jefe(AuthProto::Md5), hexs("750c783e6ab0b503eaa86e310a5db738"));
        assert_eq!(jefe(AuthProto::Sha224), hexs("a30e01098bc6dbbf45690f3a7e9e6d0f8bbea2a39e6148008fd05e44"));
        assert_eq!(jefe(AuthProto::Sha256), hexs("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"));
        assert_eq!(
            jefe(AuthProto::Sha384),
            hexs("af45d2e376484031617f78d2b58a6b1b9c7ef464f5a01b47e42ec3736322445e8e2240ca5e69e2c78b3239ecfab21649")
        );
        assert_eq!(
            jefe(AuthProto::Sha512),
            hexs(concat!(
                "164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea250554",
                "9758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737"
            ))
        );
        assert!(ct_eq(b"abc", b"abc") && !ct_eq(b"abc", b"abd") && !ct_eq(b"ab", b"abc"));
    }

    /// Generador pseudoaleatorio determinista (xorshift64) para las pruebas de fuzzing.
    pub(crate) struct Rng(pub(crate) u64);

    impl Rng {
        pub(crate) fn next(&mut self) -> u64 {
            let mut x = self.0;
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            self.0 = x;
            x
        }
        pub(crate) fn below(&mut self, n: usize) -> usize {
            (self.next() % n.max(1) as u64) as usize
        }
        pub(crate) fn bytes(&mut self, n: usize) -> Vec<u8> {
            (0..n).map(|_| self.next() as u8).collect()
        }
    }

    fn trap_creds(privacy: Option<PrivProto>) -> V3Creds {
        V3Creds {
            user: "traps".into(),
            auth: Some((AuthProto::Sha256, Zeroizing::new("authpass123".into()))),
            privacy: privacy.map(|p| (p, Zeroizing::new("privpass123".into()))),
            context: String::new(),
        }
    }

    /// Todos los decodificadores sobre la misma entrada: ninguno puede entrar en pánico
    /// (con panic = "abort" un datagrama hostil cerraría la app).
    fn decode_all(buf: &[u8], usm: &mut TrapUsm) {
        let src: SocketAddr = "192.0.2.9:162".parse().unwrap();
        let _ = decode(buf);
        let _ = decode_trap(buf, src, None);
        let _ = decode_trap(buf, src, Some(usm));
        let _ = dec_scoped(buf);
        let _ = dec_vbs(buf);
        let _ = dec_oid(buf);
        for tag in [T_INT, T_OCTETS, T_OID, T_IP, T_COUNTER32, T_TICKS, T_COUNTER64, PDU_TRAP_V1, PDU_GET, PDU_REPORT] {
            let _ = dec_value(tag, buf);
            let _ = dec_body(tag, buf);
        }
    }

    #[test]
    fn fuzz_ber_decoder_never_panics() {
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
        let mut usm = TrapUsm::new(trap_creds(Some(PrivProto::Aes)));
        // 1) Bytes aleatorios, con y sin cabecera SEQUENCE plausible.
        for i in 0..20_000 {
            let n = rng.below(256);
            let mut b = rng.bytes(n);
            if i % 2 == 0 && b.len() > 2 {
                b[0] = T_SEQ;
                b[1] = (b.len() - 2).min(0x7F) as u8;
            }
            decode_all(&b, &mut usm);
        }
        // 2) Mensajes válidos truncados en cada largo y con bytes mutados o insertados.
        let pdu = Pdu {
            kind: PDU_INFORM,
            req_id: 7,
            err_status: 0,
            err_index: 0,
            vbs: vec![
                (SYS_UPTIME.to_vec(), Value::Ticks(100)),
                (SNMP_TRAP_OID.to_vec(), Value::Oid(vec![1, 3, 6, 1, 6, 3, 1, 1, 5, 4])),
                (vec![1, 3, 6, 1, 2, 1, 1, 5, 0], Value::Str(b"sw1".to_vec())),
                (vec![1, 3, 6, 1, 2, 1, 4, 20], Value::Ip([10, 0, 0, 1])),
                (vec![1, 3, 6, 1, 2, 1, 31, 1, 1, 1, 6, 1], Value::Counter64(u64::MAX)),
            ],
        };
        let mut v1 = enc_oid(&[1, 3, 6, 1, 4, 1, 9]).unwrap();
        v1.extend(tlv(T_IP, &[192, 0, 2, 9]));
        v1.extend(enc_int(6));
        v1.extend(enc_int(1));
        v1.extend(enc_uint(T_TICKS, 4200));
        v1.extend(enc_vbs(&pdu.vbs).unwrap());
        let mut v1msg = enc_int(0);
        v1msg.extend(tlv(T_OCTETS, b"public"));
        v1msg.extend(tlv(PDU_TRAP_V1, &v1));
        let seeds = [
            enc_community(1, b"public", &pdu).unwrap(),
            tlv(T_SEQ, &v1msg),
            v3_trap("traps", AuthProto::Sha256, Some(PrivProto::Aes), 3, 1000),
            v3_trap("traps", AuthProto::Sha256, None, 3, 1000),
            v3_trap("otro", AuthProto::Md5, Some(PrivProto::Des), 1, 1),
        ];
        for seed in &seeds {
            for n in 0..=seed.len() {
                decode_all(&seed[..n], &mut usm);
            }
            for _ in 0..3000 {
                let mut m = seed.clone();
                for _ in 0..1 + rng.below(4) {
                    let i = rng.below(m.len());
                    match rng.below(4) {
                        0 => m[i] = rng.next() as u8,
                        1 => m[i] ^= 1 << rng.below(8),
                        2 => m.insert(i, rng.next() as u8),
                        _ => {
                            m.remove(i);
                        }
                    }
                }
                decode_all(&m, &mut usm);
            }
        }
    }

    #[test]
    fn ber_hostile_lengths_oids_and_nesting() {
        // Largos declarados mayores que el búfer, de más de 3 bytes o indefinidos.
        assert!(decode(&[0x30, 0x83, 0xFF, 0xFF, 0xFF, 0x02, 0x01, 0x01]).is_err());
        assert!(decode(&[0x30, 0x84, 0xFF, 0xFF, 0xFF, 0xFF]).is_err());
        assert!(decode(&[0x30, 0x80, 0x00, 0x00]).is_err());
        assert!(decode(&[0x30]).is_err() && decode(&[]).is_err());
        assert!(decode(&vec![0u8; MAX_MSG + 1]).is_err());
        // Anidamiento profundo: el lector es iterativo, no hay recursión que desborde la pila.
        let mut nested = Vec::new();
        for _ in 0..10_000 {
            nested = tlv(T_SEQ, &nested);
        }
        assert!(decode(&nested).is_err());
        // OID: arco mayor que u32, 129 subidentificadores, relleno 0x80 y último byte abierto.
        assert!(dec_oid(&[0x2B, 0x90, 0x80, 0x80, 0x80, 0x00]).is_err());
        assert!(dec_oid(&[0x2B; 129]).is_err());
        assert!(dec_oid(&[0x2B, 0x80, 0x01]).is_err());
        assert!(dec_oid(&[0x2B, 0x81]).is_err());
        assert!(dec_oid(&[0xFF; 64]).is_err());
        assert_eq!(dec_oid(&[0x2B, 0x8F, 0xFF, 0xFF, 0xFF, 0x7F]).unwrap()[2], u32::MAX);
        // Tope de varbinds por mensaje.
        let mut one = enc_oid(&[1, 3]).unwrap();
        one.extend(tlv(T_NULL, &[]));
        let one = tlv(T_SEQ, &one);
        assert_eq!(dec_vbs(&one.repeat(10)).unwrap().len(), 10);
        assert!(dec_vbs(&one.repeat(MAX_VARBINDS + 1)).is_err());
        // Enteros fuera de rango.
        assert!(dec_int(&[0; 9]).is_err() && dec_int(&[]).is_err());
        assert!(dec_uint(&[1, 0, 0, 0, 0], 4).is_err());
        assert!(dec_value(T_IP, &[1, 2, 3]).is_err());
        // Contraseña vacía: sin división por cero al derivar la clave.
        assert!(AuthProto::Sha.password_key(b"").is_empty());
    }

    #[test]
    fn trap_receiver_rejects_downgrade_and_forged_engines() {
        let src: SocketAddr = "192.0.2.9:50000".parse().unwrap();
        let mut usm = TrapUsm::new(trap_creds(None));
        let engine = hexs("800000090300aabbccddeeff");
        let pdu = Pdu { kind: PDU_TRAP_V2, req_id: 1, err_status: 0, err_index: 0, vbs: vec![(SYS_UPTIME.to_vec(), Value::Ticks(1))] };
        let scoped = enc_scoped(&engine, b"", &pdu).unwrap();
        let noauth = |user: &[u8]| {
            let h = V3Header { msg_id: 1, flags: 0, engine_id: &engine, boots: 1, time: 1, user, auth_len: 0, priv_params: &[] };
            enc_v3(&h, &scoped).0
        };
        // noAuthNoPriv con el nombre del usuario que exige autenticación: descartado.
        assert!(decode_trap(&noauth(b"traps"), src, Some(&mut usm)).unwrap_err().contains("descartado"));
        // Otro usuario sin autenticación: se muestra, marcado como tal.
        let (t, _) = decode_trap(&noauth(b"otro"), src, Some(&mut usm)).unwrap();
        assert!(t.note.unwrap().contains("noAuthNoPriv"));
        // Ráfaga de engineID inventados sin la clave: no entran en la caché.
        for i in 0..300u32 {
            let mut e = engine.clone();
            e.extend(i.to_be_bytes());
            let h = V3Header { msg_id: 1, flags: FLAG_AUTH, engine_id: &e, boots: 1, time: 1, user: b"traps", auth_len: 24, priv_params: &[] };
            let (t, _) = decode_trap(&enc_v3(&h, &scoped).0, src, Some(&mut usm)).unwrap();
            assert!(t.note.unwrap().contains("firma"));
        }
        assert!(usm.engines.is_empty());
        // Uno auténtico sí entra y la protección contra repeticiones sigue vigente.
        let (t, _) = decode_trap(&v3_trap("traps", AuthProto::Sha256, None, 5, 100), src, Some(&mut usm)).unwrap();
        assert!(t.note.unwrap().contains("verificado"));
        assert_eq!(usm.engines.len(), 1);
        let (t, _) = decode_trap(&v3_trap("traps", AuthProto::Sha256, None, 4, 100), src, Some(&mut usm)).unwrap();
        assert!(t.note.unwrap().contains("ventana"));
    }

    #[test]
    fn decodes_v1_and_v2c_traps() {
        let src: SocketAddr = "192.0.2.9:50000".parse().unwrap();
        // v1 linkDown (generic 2) con ifIndex.
        let mut c = enc_oid(&[1, 3, 6, 1, 4, 1, 9]).unwrap();
        c.extend(tlv(T_IP, &[192, 0, 2, 9]));
        c.extend(enc_int(2));
        c.extend(enc_int(0));
        c.extend(enc_uint(T_TICKS, 4200));
        c.extend(enc_vbs(&[(vec![1, 3, 6, 1, 2, 1, 2, 2, 1, 1, 3], Value::Int(3))]).unwrap());
        let mut m = enc_int(0);
        m.extend(tlv(T_OCTETS, b"secreta"));
        m.extend(tlv(PDU_TRAP_V1, &c));
        let (t, reply) = decode_trap(&tlv(T_SEQ, &m), src, None).unwrap();
        assert_eq!(t.trap_oid, "1.3.6.1.6.3.1.1.5.3");
        assert_eq!(t.version, "v1");
        assert!(reply.is_none());
        assert_eq!(t.vbs[1].value, "3");
        assert!(!format!("{t:?}").contains("secreta"));

        // v2c inform: requiere respuesta con el mismo request-id.
        let pdu = Pdu {
            kind: PDU_INFORM,
            req_id: 4242,
            err_status: 0,
            err_index: 0,
            vbs: vec![
                (SYS_UPTIME.to_vec(), Value::Ticks(100)),
                (SNMP_TRAP_OID.to_vec(), Value::Oid(vec![1, 3, 6, 1, 6, 3, 1, 1, 5, 4])),
                (vec![1, 3, 6, 1, 2, 1, 2, 2, 1, 1, 7], Value::Int(7)),
            ],
        };
        let (t, reply) = decode_trap(&enc_community(1, b"secreta", &pdu).unwrap(), src, None).unwrap();
        assert_eq!((t.kind, t.trap_oid.as_str(), t.vbs.len()), ("inform", "1.3.6.1.6.3.1.1.5.4", 1));
        assert_eq!(t.uptime.as_deref(), Some("100 (0d 0h 0m 1.00s)"));
        let Message::Community { body: Body::Pdu(r), .. } = decode(&reply.unwrap()).unwrap() else { panic!() };
        assert_eq!((r.kind, r.req_id), (PDU_RESPONSE, 4242));
        assert!(!format!("{t:?}").contains("secreta"));

        // Un GET no es un trap.
        let get = Pdu { kind: PDU_GET, ..pdu };
        assert!(decode_trap(&enc_community(1, b"x", &get).unwrap(), src, None).is_err());
    }

    #[test]
    fn validates_params_and_profiles() {
        let base = || TargetParams {
            host: "192.0.2.1".into(),
            port: None,
            version: "2c".into(),
            community: Some("public".into()),
            user: None,
            level: None,
            auth_proto: None,
            auth_pass: None,
            priv_proto: None,
            priv_pass: None,
            context: None,
            timeout_ms: Some(1),
            retries: Some(99),
            profile: None,
        };
        let t = base().into_target(|_| Ok(None)).unwrap();
        assert_eq!((t.port, t.timeout, t.retries), (161, Duration::from_millis(200), 5));
        assert!(TargetParams { host: "-oProxy".into(), ..base() }.into_target(|_| Ok(None)).is_err());
        assert!(TargetParams { community: Some(String::new()), ..base() }.into_target(|_| Ok(None)).is_err());
        // v3 con contraseña corta.
        let v3 = || TargetParams { version: "3".into(), user: Some("mon".into()), auth_pass: Some("corta".into()), priv_pass: Some("12345678".into()), ..base() };
        assert!(v3().into_target(|_| Ok(None)).err().unwrap().contains("8"));
        // Secretos desde la bóveda cuando los campos vienen vacíos.
        let saved = saved_json("192.0.2.1", None, None, Some("authpass123".into()), Some("privpass123".into())).unwrap();
        let t = TargetParams { auth_pass: None, priv_pass: None, profile: Some("p1".into()), ..v3() }
            .into_target(|p| {
                assert_eq!(p, "p1");
                Ok(Some(saved.clone()))
            })
            .unwrap();
        let Security::V3(c) = t.sec else { panic!() };
        assert_eq!(c.auth.unwrap().1.as_str(), "authpass123");
        assert_eq!(c.privacy.unwrap().1.as_str(), "privpass123");
        // Atados al destino: otro host, otro puerto o una entrada sin destino se rechazan.
        let other = |host: &str, port: Option<u16>, json: Zeroizing<String>| {
            TargetParams { host: host.into(), port, auth_pass: None, priv_pass: None, profile: Some("p1".into()), ..v3() }
                .into_target(|_| Ok(Some(json)))
                .err()
                .unwrap_or_default()
        };
        assert_eq!(other("198.51.100.7", None, saved.clone()), SAVED_OTHER_TARGET);
        assert_eq!(other("192.0.2.1", Some(1161), saved.clone()), SAVED_OTHER_TARGET);
        let legacy = Zeroizing::new(r#"{"auth_pass":"authpass123","priv_pass":"privpass123"}"#.to_string());
        assert_eq!(other("192.0.2.1", None, legacy), SAVED_OTHER_TARGET);
        // Secretos tecleados: no se consulta la bóveda y el host es libre.
        assert!(TargetParams { host: "198.51.100.7".into(), auth_pass: Some("authpass123".into()), ..v3() }
            .into_target(|_| panic!("no debe leer la bóveda"))
            .is_ok());
        assert!(saved_json("-x", None, Some("c".into()), None, None).is_err());
        assert_eq!(check_profile("abc-1").unwrap(), "snmp:abc-1");
        assert!(check_profile("../x").is_err());
        assert!(saved_json("192.0.2.1", None, None, None, None).is_err());
        assert!(saved_json("192.0.2.1", None, Some("a\nb".into()), None, None).is_err());
    }

    /// Contra un snmpd real (net-snmp): `NT_SNMP_LAB=127.0.0.1:16161 cargo test -- --ignored snmp_lab`.
    /// Usuarios: shaaes (SHA/AES), shaonly (SHA), md5user (MD5), noauth; community labpub;
    /// contraseñas authpass123 / privpass123.
    #[test]
    #[ignore]
    fn snmp_lab_net_snmp_agent() {
        let lab: SocketAddr = std::env::var("NT_SNMP_LAB").expect("NT_SNMP_LAB").parse().unwrap();
        let sys_name = parse_oid("1.3.6.1.2.1.1.5.0").unwrap();
        let v3 = |user: &str, auth: Option<AuthProto>, privacy: bool| Target {
            host: lab.ip().to_string(),
            port: lab.port(),
            timeout: Duration::from_millis(1500),
            retries: 1,
            sec: Security::V3(V3Creds {
                user: user.into(),
                auth: auth.map(|p| (p, Zeroizing::new("authpass123".to_string()))),
                privacy: privacy.then(|| (PrivProto::Aes, Zeroizing::new("privpass123".to_string()))),
                context: String::new(),
            }),
        };
        let mut targets = vec![
            Target { sec: Security::Community { v2: false, community: Zeroizing::new("labpub".into()) }, ..target(lab, "labpub") },
            target(lab, "labpub"),
            v3("shaaes", Some(AuthProto::Sha), true),
            v3("shaonly", Some(AuthProto::Sha), false),
            v3("md5user", Some(AuthProto::Md5), false),
            v3("noauth", None, false),
            Target {
                sec: Security::V3(V3Creds {
                    user: "desuser".into(),
                    auth: Some((AuthProto::Sha, Zeroizing::new("authpass123".to_string()))),
                    privacy: Some((PrivProto::Des, Zeroizing::new("privpass123".to_string()))),
                    context: String::new(),
                }),
                ..v3("x", None, false)
            },
        ];
        for t in targets.drain(..) {
            let mut c = Client::connect(t).unwrap();
            let v = c.get(std::slice::from_ref(&sys_name)).expect("GET");
            assert_eq!(v[0].1, Value::Str(b"nt-lab".to_vec()));
            let mut n = 0;
            let (count, _) = c.walk(&parse_oid("1.3.6.1.2.1.2.2.1.2").unwrap(), Some(5), 500, &AtomicBool::new(false), &mut |b| n += b.len()).unwrap();
            assert!(count > 0 && n == count);
        }
        // Contraseñas incorrectas: el error lo explica.
        let mut bad = v3("shaaes", Some(AuthProto::Sha), true);
        if let Security::V3(c) = &mut bad.sec {
            c.auth = Some((AuthProto::Sha, Zeroizing::new("incorrecta1".to_string())));
        }
        let err = Client::connect(bad).unwrap().get(std::slice::from_ref(&sys_name)).err().unwrap().text();
        assert!(err.contains("WrongDigests"), "{err}");
        let err = Client::connect(v3("nadie", Some(AuthProto::Sha), false)).unwrap().get(std::slice::from_ref(&sys_name)).err().unwrap().text();
        assert!(err.contains("UnknownUserNames"), "{err}");
        let mut bad = v3("shaaes", Some(AuthProto::Sha), true);
        if let Security::V3(c) = &mut bad.sec {
            c.privacy = Some((PrivProto::Aes, Zeroizing::new("otraprivada".to_string())));
        }
        let err = Client::connect(bad).unwrap().get(std::slice::from_ref(&sys_name)).err().unwrap().text();
        assert!(err.contains("descifrar") || err.contains("DecryptionErrors") || err.contains("Sin respuesta"), "{err}");
    }

    /// Traps reales de net-snmp (`snmptrap`/`snmpinform`) hacia un socket local:
    /// `cargo test -- --ignored snmp_lab_traps` (requiere net-snmp instalado).
    #[test]
    #[ignore]
    fn snmp_lab_traps_from_net_snmp() {
        let sock = UdpSocket::bind("127.0.0.1:0").unwrap();
        sock.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let dest = format!("127.0.0.1:{}", sock.local_addr().unwrap().port());
        let run = |args: &[&str]| {
            assert!(std::process::Command::new("snmptrap").args(args).status().unwrap().success());
        };
        let mut buf = [0u8; 65535];
        let mut recv = |usm: Option<&mut TrapUsm>| {
            let (n, from) = sock.recv_from(&mut buf).unwrap();
            let r = decode_trap(&buf[..n], from, usm).unwrap();
            if let Some(reply) = &r.1 {
                sock.send_to(reply, from).unwrap();
            }
            r.0
        };
        run(&["-v1", "-c", "labpub", &dest, "1.3.6.1.4.1.9", "127.0.0.1", "2", "0", "", "1.3.6.1.2.1.2.2.1.1.3", "i", "3"]);
        let t = recv(None);
        assert_eq!((t.version, t.trap_oid.as_str()), ("v1", "1.3.6.1.6.3.1.1.5.3"));
        run(&["-v2c", "-c", "labpub", &dest, "", "1.3.6.1.6.3.1.1.5.4", "1.3.6.1.2.1.2.2.1.1.3", "i", "3"]);
        let t = recv(None);
        assert_eq!((t.version, t.kind, t.trap_oid.as_str()), ("v2c", "trap", "1.3.6.1.6.3.1.1.5.4"));
        // Inform: snmptrap -Ci espera la respuesta; si no llega, reintenta.
        let child = std::process::Command::new("snmptrap").args(["-Ci", "-r", "0", "-t", "3", "-v2c", "-c", "labpub", &dest, "", "1.3.6.1.6.3.1.1.5.1"]).spawn().unwrap();
        let t = recv(None);
        assert_eq!(t.kind, "inform");
        assert!(child.wait_with_output().unwrap().status.success(), "el inform no se confirmó");
        // v3 authPriv con engineID del emisor.
        run(&["-v3", "-e", "0x8000000001020304", "-u", "traps", "-l", "authPriv", "-a", "SHA", "-A", "authpass123", "-x", "AES", "-X", "privpass123", &dest, "", "1.3.6.1.6.3.1.1.5.2"]);
        let mut usm = TrapUsm::new(V3Creds {
            user: "traps".into(),
            auth: Some((AuthProto::Sha, Zeroizing::new("authpass123".into()))),
            privacy: Some((PrivProto::Aes, Zeroizing::new("privpass123".into()))),
            context: String::new(),
        });
        let t = recv(Some(&mut usm));
        assert_eq!(t.trap_oid, "1.3.6.1.6.3.1.1.5.2", "{:?}", t.note);
    }

    /// Agente v2c mínimo en un puerto efímero: responde un subárbol fijo.
    fn fake_agent(community: &'static [u8], tree: Vec<(Oid, Value)>) -> SocketAddr {
        let sock = UdpSocket::bind("127.0.0.1:0").unwrap();
        let addr = sock.local_addr().unwrap();
        std::thread::spawn(move || {
            let mut buf = [0u8; 65535];
            while let Ok((n, peer)) = sock.recv_from(&mut buf) {
                let Ok(Message::Community { version, community: c, body: Body::Pdu(p) }) = decode(&buf[..n]) else { continue };
                if c != community {
                    continue; // community incorrecta: el agente calla
                }
                let next = |o: &Oid| tree.iter().find(|(k, _)| k > o).cloned().unwrap_or((o.clone(), Value::EndOfMib));
                let vbs: Vec<(Oid, Value)> = match p.kind {
                    PDU_GET => p.vbs.iter().map(|(o, _)| tree.iter().find(|(k, _)| k == o).cloned().unwrap_or((o.clone(), Value::NoSuchObject))).collect(),
                    PDU_GETNEXT => p.vbs.iter().map(|(o, _)| next(o)).collect(),
                    PDU_GETBULK => {
                        let mut out = vec![];
                        let mut cur = p.vbs[0].0.clone();
                        for _ in 0..p.err_index {
                            let (o, v) = next(&cur);
                            let end = v == Value::EndOfMib;
                            out.push((o.clone(), v));
                            if end {
                                break;
                            }
                            cur = o;
                        }
                        out
                    }
                    _ => continue,
                };
                let r = Pdu { kind: PDU_RESPONSE, req_id: p.req_id, err_status: 0, err_index: 0, vbs };
                let _ = sock.send_to(&enc_community(version, &c, &r).unwrap(), peer);
            }
        });
        addr
    }

    fn target(addr: SocketAddr, community: &str) -> Target {
        Target {
            host: addr.ip().to_string(),
            port: addr.port(),
            timeout: Duration::from_millis(300),
            retries: 0,
            sec: Security::Community { v2: true, community: Zeroizing::new(community.into()) },
        }
    }

    #[test]
    fn walk_get_and_bulk_against_fake_agent() {
        let mut tree: Vec<(Oid, Value)> = (1..=25).map(|i| (vec![1, 3, 6, 1, 2, 1, 2, 2, 1, 2, i], Value::Str(format!("Gi0/{i}").into_bytes()))).collect();
        tree.insert(0, (vec![1, 3, 6, 1, 2, 1, 1, 1, 0], Value::Str(b"Router".to_vec())));
        tree.push((vec![1, 3, 6, 1, 2, 1, 2, 2, 1, 3, 1], Value::Int(6)));
        let addr = fake_agent(b"public", tree);
        let mut c = Client::connect(target(addr, "public")).unwrap();
        let v = c.get(&[parse_oid("1.3.6.1.2.1.1.1.0").unwrap()]).ok().unwrap();
        assert_eq!(v[0].1, Value::Str(b"Router".to_vec()));
        let cancel = AtomicBool::new(false);
        let root = parse_oid("1.3.6.1.2.1.2.2.1.2").unwrap();
        for bulk in [None, Some(10)] {
            let mut got = vec![];
            let (n, truncated) = c.walk(&root, bulk, 1000, &cancel, &mut |b| got.extend(b)).unwrap();
            assert_eq!((n, truncated, got.len()), (25, false, 25));
        }
        let (n, truncated) = c.walk(&root, Some(10), 7, &cancel, &mut |_| {}).unwrap();
        assert_eq!((n, truncated), (7, true));
        // Escalar: walk de sysDescr.0 lo trae con GET.
        let (n, _) = c.walk(&parse_oid("1.3.6.1.2.1.1.1.0").unwrap(), None, 10, &cancel, &mut |_| {}).unwrap();
        assert_eq!(n, 1);
        cancel.store(true, Ordering::SeqCst);
        assert_eq!(c.walk(&root, None, 1000, &cancel, &mut |_| {}).unwrap(), (0, true));

        // Community incorrecta: sin respuesta, con mensaje claro y sin revelar el secreto.
        let mut bad = Client::connect(target(addr, "otra-secreta")).unwrap();
        let err = bad.get(&[parse_oid("1.3.6.1.2.1.1.1.0").unwrap()]).err().unwrap().text();
        assert!(err.contains("Sin respuesta") && !err.contains("otra-secreta"), "{err}");
    }

    #[test]
    fn topo_allowlist_enforced() {
        // Raíces y columnas permitidas, también con punto inicial.
        for ok in [
            "1.0.8802.1.1.2.1.4.1.1.9",
            ".1.3.6.1.4.1.9.9.23.1.2.1.1.6",
            "1.3.6.1.2.1.17.7.1.2.2.1.2",
            "1.3.6.1.2.1.4.35.1.4",
            "1.3.6.1.4.1.9.9.46.1.3.1.1.2",
            "1.3.111.2.802.1.1.13.1.4.1.1.10",
            "1.3.111.2.802.1.1.13.1.4.2.1.3",
        ] {
            assert!(topo_walk_oid(ok).is_ok(), "{ok}");
        }
        // Subárboles no listados: system completo, la MIB entera, CISCO-CONFIG-COPY, hijos o
        // padres de una raíz permitida y prefijos de texto engañosos (".1.1.90" no es ".1.1.9").
        for bad in [
            "1.3.6.1.2.1.1",
            "1.3",
            "1.3.6.1.4.1.9.9.96.1.1.1.1",
            "1.0.8802.1.1.2.1.4.1.1.9.0",
            "1.0.8802.1.1.2.1.4.1",
            "1.0.8802.1.1.2.1.4.1.1.90",
            "1.3.6.1.2.1.25.4.2.1.5",
            "1.3.6.1.2.1.31.1.1.1.6",
            // VTP: solo vtpVlanState, no la tabla entera ni otras columnas (vtpVlanName).
            "1.3.6.1.4.1.9.9.46.1.3.1",
            "1.3.6.1.4.1.9.9.46.1.3.1.1.4",
            // LLDP-V2: no la MIB entera ni la tabla local.
            "1.3.111.2.802.1.1.13",
            "1.3.111.2.802.1.1.13.1.3.7",
            "x",
        ] {
            assert!(topo_walk_oid(bad).is_err(), "{bad}");
        }
        // GET: instancias de los contadores (un ifIndex) y escalares listados.
        for ok in ["1.3.6.1.2.1.31.1.1.1.6.10101", "1.3.6.1.2.1.2.2.1.10.3", "1.3.6.1.2.1.1.5.0", "1.3.6.1.2.1.1.2.0", "1.3.6.1.2.1.15.2.0"] {
            assert!(topo_get_oid(ok).is_ok(), "{ok}");
        }
        for bad in ["1.3.6.1.2.1.31.1.1.1.6", "1.3.6.1.2.1.31.1.1.1.6.1.2", "1.3.6.1.2.1.1.1.0", "1.3.6.1.2.1.1.5", "1.3.6.1.2.1.25.4.2.1.5.1", "1.3.6.1.2.1.2.2.1.100.1"] {
            assert!(topo_get_oid(bad).is_err(), "{bad}");
        }
        // Topes de cantidad.
        let many = |n: usize, o: &str| vec![o.to_string(); n];
        assert!(topo_check(&many(TOPO_MAX_GETS, "1.3.6.1.2.1.31.1.1.1.6.1"), &[]).is_ok());
        assert!(topo_check(&many(TOPO_MAX_GETS + 1, "1.3.6.1.2.1.31.1.1.1.6.1"), &[]).is_err());
        assert!(topo_check(&[], &many(TOPO_MAX_WALKS + 1, "1.3.6.1.2.1.31.1.1.1.1")).is_err());
        assert!(topo_check(&[], &[]).is_err());
        assert!(topo_check(&[], &["1.3.6.1.2.1.1".into()]).err().unwrap().contains("no permitido"));
        // Toda raíz y columna de las listas es un OID válido y no hay repetidos.
        let all: Vec<_> = TOPO_WALK_ROOTS.iter().chain(TOPO_GET_COLUMNS).chain(TOPO_GET_SCALARS).collect();
        for (o, _) in &all {
            parse_oid(o).unwrap();
        }
        let walk: std::collections::HashSet<_> = TOPO_WALK_ROOTS.iter().map(|x| x.0).collect();
        assert_eq!(walk.len(), TOPO_WALK_ROOTS.len());
    }

    #[test]
    fn vlan_reads_use_indexed_community_or_v3_context() {
        // Solo BRIDGE-MIB, sin GET y con una VLAN válida.
        let fdb: Vec<String> = TOPO_VLAN_WALKS.iter().map(|s| s.to_string()).collect();
        assert!(topo_vlan_check(&[], &fdb, 10).is_ok());
        for w in TOPO_VLAN_WALKS {
            assert!(topo_walk_oid(w).is_ok(), "{w} también está en TOPO_WALK_ROOTS");
        }
        assert!(topo_vlan_check(&[], &fdb, 0).is_err());
        assert!(topo_vlan_check(&[], &fdb, 4095).is_err());
        assert!(topo_vlan_check(&["1.3.6.1.2.1.1.5.0".into()], &fdb, 10).is_err());
        assert!(topo_vlan_check(&[], &["1.0.8802.1.1.2.1.4.1.1.9".into()], 10).is_err());
        assert!(topo_vlan_check(&[], &["x".into()], 10).is_err());
        // v2c: community@vlan; v3: contexto vlan-N.
        let mut sec = Security::Community { v2: true, community: Zeroizing::new("lectura".into()) };
        vlan_scope(&mut sec, 20);
        assert!(matches!(&sec, Security::Community { community, .. } if community.as_str() == "lectura@20"));
        let mut sec = Security::V3(V3Creds { user: "noc".into(), auth: None, privacy: None, context: String::new() });
        vlan_scope(&mut sec, 300);
        assert!(matches!(&sec, Security::V3(c) if c.context == "vlan-300"));
        // Contra un agente que solo responde a "public@20": la tabla MAC de la VLAN 20.
        let port = parse_oid("1.3.6.1.2.1.17.4.3.1.2").unwrap();
        let tree = vec![([port.clone(), vec![0, 17, 34, 51, 68, 85]].concat(), Value::Int(3))];
        let addr = fake_agent(b"public@20", tree);
        let mut t = target(addr, "public");
        vlan_scope(&mut t.sec, 20);
        let mut c = Client::connect(t).unwrap();
        let r = topo_read(&mut c, &[], &[(port, "1.3.6.1.2.1.17.4.3.1.2".into())], TOPO_LIMITS).unwrap();
        assert_eq!(r.walks[0].rows.len(), 1);
        assert_eq!(r.walks[0].rows[0].oid, "1.3.6.1.2.1.17.4.3.1.2.0.17.34.51.68.85");
    }

    #[test]
    fn topo_read_limits_rows_time_and_mixed_results() {
        let name = parse_oid("1.3.6.1.2.1.31.1.1.1.1").unwrap();
        let hc = parse_oid("1.3.6.1.2.1.31.1.1.1.6").unwrap();
        let mut tree: Vec<(Oid, Value)> = (1..=60).map(|i| ([name.clone(), vec![i]].concat(), Value::Str(format!("Gi1/0/{i}").into_bytes()))).collect();
        tree.extend((1..=3).map(|i| ([hc.clone(), vec![i]].concat(), Value::Counter64(1_000 * i as u64))));
        tree.sort_by(|a, b| a.0.cmp(&b.0));
        let addr = fake_agent(b"public", tree);
        let mut c = Client::connect(target(addr, "public")).unwrap();
        let gets: Vec<Oid> = (1..=3).chain([99]).map(|i| [hc.clone(), vec![i]].concat()).collect();
        let walks = vec![(name.clone(), "1.3.6.1.2.1.31.1.1.1.1".to_string()), (parse_oid("1.0.8802.1.1.2.1.4.1.1.9").unwrap(), "lldp".to_string())];
        // Tope de filas: 10 de 60, marcado como truncado; LLDP vacío sin error.
        let lim = TopoLimits { max_rows: 10, table_time: Duration::from_secs(20), total_time: Duration::from_secs(120) };
        let r = topo_read(&mut c, &gets, &walks, lim).unwrap();
        assert_eq!(r.gets.len(), 4);
        assert_eq!((r.gets[2].kind, r.gets[2].value.as_str()), ("Counter64", "3000"));
        assert_eq!(r.gets[3].kind, "noSuchObject");
        assert_eq!((r.walks[0].rows.len(), r.walks[0].truncated, r.walks[0].timed_out), (10, true, false));
        assert_eq!(r.walks[0].rows[0].hex.as_deref(), Some("4769312F302F31"), "cadenas también en hex");
        assert!(r.walks[1].rows.is_empty() && r.walks[1].error.is_none());
        // Tope de tiempo por tabla: se corta tras el primer lote, resultado parcial.
        let lim = TopoLimits { max_rows: 10_000, table_time: Duration::ZERO, total_time: Duration::from_secs(120) };
        let r = topo_read(&mut c, &[], &walks[..1], lim).unwrap();
        assert!(r.walks[0].timed_out && !r.walks[0].truncated && r.walks[0].rows.len() == 25, "{:?}", r.walks[0].rows.len());
        // Tope total agotado: las tablas siguientes no se leen.
        let lim = TopoLimits { max_rows: 10_000, table_time: Duration::from_secs(20), total_time: Duration::ZERO };
        let r = topo_read(&mut c, &[], &walks, lim).unwrap();
        assert!(r.walks.iter().all(|w| w.timed_out && w.rows.is_empty() && w.error.is_some()));
        // Agente que no responde: error claro sin secretos.
        let mut bad = Client::connect(target(addr, "otra-secreta")).unwrap();
        let e = topo_read(&mut bad, &gets, &walks, TOPO_LIMITS).err().unwrap().text();
        assert!(e.contains("Sin respuesta") && !e.contains("otra-secreta"), "{e}");
    }
}
