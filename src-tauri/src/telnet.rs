//! Cliente Telnet mínimo (RFC 854) con negociación de ECHO, SGA, TTYPE y NAWS.

pub const IAC: u8 = 255;
const DONT: u8 = 254;
const DO: u8 = 253;
const WONT: u8 = 252;
const WILL: u8 = 251;
const SB: u8 = 250;
pub const BRK: u8 = 243;
const SE: u8 = 240;

const OPT_ECHO: u8 = 1;
const OPT_SGA: u8 = 3;
const OPT_TTYPE: u8 = 24;
const OPT_NAWS: u8 = 31;

pub struct TelnetShared {
    pub cols: u16,
    pub rows: u16,
    pub naws: bool,
    answered: [bool; 512],
}

impl TelnetShared {
    pub fn new(cols: u16, rows: u16) -> Self {
        Self {
            cols,
            rows,
            naws: false,
            answered: [false; 512],
        }
    }
}

#[derive(Default)]
enum State {
    #[default]
    Data,
    Iac,
    Cmd(u8),
    Sub,
    SubIac,
}

#[derive(Default)]
pub struct Parser {
    state: State,
    sub: Vec<u8>,
}

impl Parser {
    /// Separa datos de comandos Telnet. Devuelve (datos para la terminal, respuesta al host).
    pub fn feed(
        &mut self,
        input: &[u8],
        shared: &std::sync::Mutex<TelnetShared>,
    ) -> (Vec<u8>, Vec<u8>) {
        let mut data = Vec::with_capacity(input.len());
        let mut reply = Vec::new();
        for &b in input {
            self.state = match std::mem::take(&mut self.state) {
                State::Data if b == IAC => State::Iac,
                State::Data => {
                    data.push(b);
                    State::Data
                }
                State::Iac => match b {
                    IAC => {
                        data.push(IAC);
                        State::Data
                    }
                    DO | DONT | WILL | WONT => State::Cmd(b),
                    SB => {
                        self.sub.clear();
                        State::Sub
                    }
                    _ => State::Data,
                },
                State::Cmd(cmd) => {
                    let mut s = shared.lock().unwrap();
                    // Responder una sola vez por opción evita bucles de negociación.
                    let key = b as usize + if cmd == DO { 0 } else { 256 };
                    if (cmd == DO || cmd == WILL) && !s.answered[key] {
                        s.answered[key] = true;
                        match (cmd, b) {
                            (DO, OPT_NAWS) => {
                                s.naws = true;
                                reply.extend([IAC, WILL, OPT_NAWS]);
                                reply.extend(naws(s.cols, s.rows));
                            }
                            (DO, OPT_TTYPE) | (DO, OPT_SGA) => reply.extend([IAC, WILL, b]),
                            (DO, _) => reply.extend([IAC, WONT, b]),
                            (WILL, OPT_ECHO) | (WILL, OPT_SGA) => reply.extend([IAC, DO, b]),
                            (WILL, _) => reply.extend([IAC, DONT, b]),
                            _ => {}
                        }
                    }
                    State::Data
                }
                State::Sub if b == IAC => State::SubIac,
                State::Sub => {
                    // Límite: un servidor malicioso no puede crecer este búfer sin fin.
                    if self.sub.len() < 1024 {
                        self.sub.push(b);
                    }
                    State::Sub
                }
                State::SubIac if b == SE => {
                    // TTYPE SEND -> TTYPE IS "XTERM-256COLOR"
                    if self.sub.first() == Some(&OPT_TTYPE) && self.sub.get(1) == Some(&1) {
                        reply.extend([IAC, SB, OPT_TTYPE, 0]);
                        reply.extend_from_slice(b"XTERM-256COLOR");
                        reply.extend([IAC, SE]);
                    }
                    State::Data
                }
                State::SubIac => {
                    if self.sub.len() < 1024 {
                        self.sub.push(b);
                    }
                    State::Sub
                }
            };
        }
        (data, reply)
    }
}

/// Subnegociación NAWS con el tamaño de ventana (escapa bytes 0xFF).
pub fn naws(cols: u16, rows: u16) -> Vec<u8> {
    let mut v = vec![IAC, SB, OPT_NAWS];
    for byte in cols.to_be_bytes().into_iter().chain(rows.to_be_bytes()) {
        v.push(byte);
        if byte == IAC {
            v.push(IAC);
        }
    }
    v.extend([IAC, SE]);
    v
}

/// Escapa IAC y convierte CR en CR NUL según la NVT.
pub fn encode_input(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() + 4);
    for &b in data {
        match b {
            IAC => out.extend([IAC, IAC]),
            b'\r' => out.extend([b'\r', 0]),
            _ => out.push(b),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn negotiates_and_strips_commands() {
        let shared = Mutex::new(TelnetShared::new(80, 24));
        let mut p = Parser::default();
        let (data, reply) = p.feed(&[b'a', IAC, DO, OPT_NAWS, IAC, WILL, OPT_ECHO, b'b'], &shared);
        assert_eq!(data, b"ab");
        assert!(shared.lock().unwrap().naws);
        assert_eq!(&reply[..3], &[IAC, WILL, OPT_NAWS]);
        assert!(reply.ends_with(&[IAC, DO, OPT_ECHO]));
    }

    #[test]
    fn handles_split_sequences_and_ttype() {
        let shared = Mutex::new(TelnetShared::new(80, 24));
        let mut p = Parser::default();
        let (d1, _) = p.feed(&[b'x', IAC], &shared);
        let (d2, r2) = p.feed(&[SB, OPT_TTYPE, 1, IAC, SE, IAC, IAC], &shared);
        assert_eq!(d1, b"x");
        assert_eq!(d2, vec![IAC]);
        assert!(r2.windows(14).any(|w| w == b"XTERM-256COLOR"));
    }

    #[test]
    fn answers_each_option_once() {
        let shared = Mutex::new(TelnetShared::new(80, 24));
        let mut p = Parser::default();
        let (_, r1) = p.feed(&[IAC, DO, OPT_SGA], &shared);
        let (_, r2) = p.feed(&[IAC, DO, OPT_SGA], &shared);
        assert!(!r1.is_empty());
        assert!(r2.is_empty());
    }
}
