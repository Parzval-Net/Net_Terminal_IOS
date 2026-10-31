//! Alertas por palabra clave sobre la salida de las sesiones. Las reglas se compilan una vez
//! en un `RegexSet` (motor lineal, sin ReDoS) y se evalúan por línea completa del texto
//! limpio. Sin reglas el costo es una lectura atómica por fragmento. Solo notifican: nunca
//! responden ni envían nada al equipo.

use regex::{RegexBuilder, RegexSet, RegexSetBuilder};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

pub const MAX_RULES: usize = 200;
const MAX_PATTERN: usize = 500;
/// Máximo un aviso por regla y conexión en esta ventana (evita tormentas, p. ej. un flap).
pub const COOLDOWN: Duration = Duration::from_secs(10);
/// Una línea sin fin de línea se evalúa al llegar a este tamaño.
const MAX_LINE: usize = 4096;
/// Texto de la línea que viaja en el aviso.
const MAX_SHOWN: usize = 300;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: String,
    pub pattern: String,
    /// Expresión regular; si no, texto literal.
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub case_sensitive: bool,
    /// Carpeta de sesiones (incluye subcarpetas). Vacía o ausente: todas las sesiones.
    #[serde(default)]
    pub folder: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Hit {
    pub conn: String,
    pub rule: String,
    pub line: String,
}

type Notify = Arc<dyn Fn(Hit) + Send + Sync>;

struct Compiled {
    set: RegexSet,
    /// Id y carpeta de cada regla, en el orden del set.
    rules: Vec<(String, Option<String>)>,
    notify: Notify,
}

/// Reglas vigentes, compartidas por todas las conexiones.
#[derive(Default)]
pub struct Hub {
    gen: AtomicU64,
    active: RwLock<Option<Arc<Compiled>>>,
}

impl Hub {
    /// Valida y compila. Una lista vacía apaga las alertas. Las reglas inválidas se omiten
    /// (las demás quedan activas) y se informan en el error.
    pub fn configure(&self, rules: Vec<Rule>, notify: Notify) -> Result<(), String> {
        if rules.len() > MAX_RULES {
            return Err(format!("Máximo {MAX_RULES} alertas"));
        }
        let (compiled, errors) = compile(rules, notify);
        *self.active.write().unwrap_or_else(|e| e.into_inner()) = compiled.map(Arc::new);
        self.gen.fetch_add(1, Ordering::Release);
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }

    fn current(&self) -> Option<Arc<Compiled>> {
        self.active.read().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

fn compile(rules: Vec<Rule>, notify: Notify) -> (Option<Compiled>, Vec<String>) {
    let mut patterns = Vec::with_capacity(rules.len());
    let mut valid = Vec::with_capacity(rules.len());
    let mut errors = Vec::new();
    for r in rules {
        let p = r.pattern.trim();
        if p.is_empty() || p.len() > MAX_PATTERN {
            errors.push(format!("\"{}\": el patrón debe tener entre 1 y {MAX_PATTERN} caracteres", r.pattern));
            continue;
        }
        let body = if r.regex { p.to_string() } else { regex::escape(p) };
        let full = if r.case_sensitive { body } else { format!("(?i){body}") };
        // Se compila sola para indicar qué regla falla.
        if let Err(e) = RegexBuilder::new(&full).size_limit(1 << 20).build() {
            errors.push(format!("\"{}\": expresión inválida ({})", r.pattern, first_line(&e.to_string())));
            continue;
        }
        patterns.push(full);
        valid.push((r.id, r.folder.map(|f| f.trim().trim_matches('/').to_string()).filter(|f| !f.is_empty())));
    }
    if valid.is_empty() {
        return (None, errors);
    }
    match RegexSetBuilder::new(&patterns).size_limit(8 << 20).build() {
        Ok(set) => (Some(Compiled { set, rules: valid, notify }), errors),
        Err(e) => {
            errors.push(first_line(&e.to_string()).to_string());
            (None, errors)
        }
    }
}

fn first_line(s: &str) -> &str {
    s.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or(s).trim()
}

/// La sesión está en la carpeta o en una subcarpeta.
fn in_folder(session: &str, scope: &str) -> bool {
    session == scope || session.strip_prefix(scope).is_some_and(|r| r.starts_with('/'))
}

/// Estado por conexión: línea en curso y último aviso de cada regla.
pub struct Watcher {
    hub: Arc<Hub>,
    conn: String,
    folder: String,
    gen: u64,
    compiled: Option<Arc<Compiled>>,
    /// Reglas que aplican a esta sesión (por carpeta) y su último aviso.
    applies: Vec<bool>,
    last: Vec<Option<Instant>>,
    line: String,
}

impl Watcher {
    pub fn new(hub: Arc<Hub>, conn: String, folder: Option<&str>) -> Self {
        Self {
            hub,
            conn,
            folder: folder.unwrap_or("").trim().trim_matches('/').to_string(),
            gen: u64::MAX,
            compiled: None,
            applies: Vec::new(),
            last: Vec::new(),
            line: String::new(),
        }
    }

    fn refresh(&mut self, gen: u64) {
        self.gen = gen;
        self.compiled = self.hub.current();
        self.line.clear();
        let Some(c) = &self.compiled else {
            self.applies.clear();
            self.last.clear();
            return;
        };
        self.applies = c.rules.iter().map(|(_, f)| f.as_deref().is_none_or(|f| in_folder(&self.folder, f))).collect();
        self.last = vec![None; c.rules.len()];
        if !self.applies.contains(&true) {
            self.compiled = None; // ninguna regla aplica a esta sesión: costo cero
        }
    }

    /// Texto limpio (sin ANSI ni \r) recién recibido.
    pub fn feed(&mut self, text: &str) {
        let gen = self.hub.gen.load(Ordering::Acquire);
        if gen != self.gen {
            self.refresh(gen);
        }
        if self.compiled.is_none() {
            return;
        }
        let mut rest = text;
        while let Some(i) = rest.find('\n') {
            if self.line.is_empty() {
                self.check(&rest[..i]);
            } else {
                let mut line = std::mem::take(&mut self.line);
                line.push_str(&rest[..i]);
                self.check(&line);
                line.clear();
                self.line = line;
            }
            rest = &rest[i + 1..];
        }
        self.line.push_str(rest);
        if self.line.len() >= MAX_LINE {
            let line = std::mem::take(&mut self.line);
            self.check(&line);
        }
    }

    fn check(&mut self, line: &str) {
        let Some(c) = &self.compiled else { return };
        if line.trim().is_empty() || !c.set.is_match(line) {
            return;
        }
        let now = Instant::now();
        for i in c.set.matches(line).iter() {
            if !self.applies[i] || self.last[i].is_some_and(|t| now.duration_since(t) < COOLDOWN) {
                continue;
            }
            self.last[i] = Some(now);
            let mut shown = line.trim();
            if shown.len() > MAX_SHOWN {
                let mut cut = MAX_SHOWN;
                while !shown.is_char_boundary(cut) {
                    cut -= 1;
                }
                shown = &shown[..cut];
            }
            (c.notify)(Hit { conn: self.conn.clone(), rule: c.rules[i].0.clone(), line: shown.to_string() });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn rule(id: &str, pattern: &str, regex: bool, case_sensitive: bool, folder: Option<&str>) -> Rule {
        Rule { id: id.into(), pattern: pattern.into(), regex, case_sensitive, folder: folder.map(Into::into) }
    }

    fn hub_with(rules: Vec<Rule>) -> (Arc<Hub>, Arc<Mutex<Vec<Hit>>>) {
        let hub = Arc::new(Hub::default());
        let hits: Arc<Mutex<Vec<Hit>>> = Arc::default();
        let h = hits.clone();
        hub.configure(rules, Arc::new(move |hit| h.lock().unwrap().push(hit))).unwrap();
        (hub, hits)
    }

    #[test]
    fn matches_lines_split_across_chunks() {
        let (hub, hits) = hub_with(vec![
            rule("updown", "%LINK-3-UPDOWN", false, true, None),
            rule("bgp", "BGP.*Down", true, false, None),
        ]);
        let mut w = Watcher::new(hub, "t1#1".into(), Some("Core"));
        w.feed("Mar 1 10:00: %LINK-3-UP");
        assert!(hits.lock().unwrap().is_empty());
        w.feed("DOWN: Interface Gi1/0/1, changed state to down\nok\n");
        w.feed("%bgp-5-adjchange: neighbor 192.0.2.1 down\n");
        let got = hits.lock().unwrap().clone();
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].rule, "updown");
        assert_eq!(got[0].conn, "t1#1");
        assert!(got[0].line.starts_with("Mar 1 10:00: %LINK-3-UPDOWN"));
        assert_eq!(got[1].rule, "bgp");
    }

    #[test]
    fn plain_text_is_literal_and_case_option_works() {
        let (hub, hits) = hub_with(vec![rule("a", "a.b", false, true, None), rule("b", "ERROR", false, true, None)]);
        let mut w = Watcher::new(hub, "c".into(), None);
        w.feed("axb error\n");
        assert!(hits.lock().unwrap().is_empty());
        w.feed("a.b ERROR\n");
        assert_eq!(hits.lock().unwrap().len(), 2);
    }

    #[test]
    fn rate_limits_per_rule_and_connection() {
        let (hub, hits) = hub_with(vec![rule("r", "flap", false, false, None)]);
        let mut a = Watcher::new(hub.clone(), "a".into(), None);
        let mut b = Watcher::new(hub, "b".into(), None);
        for _ in 0..100 {
            a.feed("link flap\n");
        }
        b.feed("link flap\n");
        assert_eq!(hits.lock().unwrap().len(), 2);
        // Pasada la ventana vuelve a avisar.
        a.last[0] = Some(Instant::now() - COOLDOWN - Duration::from_millis(1));
        a.feed("link flap\n");
        assert_eq!(hits.lock().unwrap().len(), 3);
    }

    #[test]
    fn folder_scope_and_reconfiguration() {
        let (hub, hits) = hub_with(vec![rule("r", "down", false, false, Some("Clientes/Sitio A"))]);
        let mut inside = Watcher::new(hub.clone(), "in".into(), Some("Clientes/Sitio A/Piso 2"));
        let mut outside = Watcher::new(hub.clone(), "out".into(), Some("Clientes/Sitio AB"));
        inside.feed("down\n");
        outside.feed("down\n");
        assert_eq!(hits.lock().unwrap().iter().map(|h| h.conn.as_str()).collect::<Vec<_>>(), ["in"]);
        // Sin reglas no se evalúa nada (ni se acumula la línea).
        hub.configure(vec![], Arc::new(|_| {})).unwrap();
        inside.feed("down\nparcial");
        assert!(inside.compiled.is_none() && inside.line.is_empty());
        assert_eq!(hits.lock().unwrap().len(), 1);
    }

    #[test]
    fn rejects_invalid_rules() {
        let hub = Hub::default();
        let n: Notify = Arc::new(|_| {});
        assert!(hub.configure(vec![rule("x", "(", true, false, None)], n.clone()).unwrap_err().contains("inválida"));
        // Una regla inválida no apaga las demás.
        assert!(hub.configure(vec![rule("x", "(?=a)", true, false, None), rule("y", "ok", false, false, None)], n.clone()).is_err());
        assert_eq!(hub.current().unwrap().rules.len(), 1);
        assert!(hub.configure(vec![rule("x", "  ", false, false, None)], n.clone()).is_err());
        assert!(hub.configure(vec![rule("x", &"a".repeat(600), false, false, None)], n.clone()).is_err());
        let many = (0..=MAX_RULES).map(|i| rule(&i.to_string(), "x", false, false, None)).collect();
        assert!(hub.configure(many, n.clone()).is_err());
        // Un patrón "catastrófico" para motores con backtracking es lineal aquí.
        hub.configure(vec![rule("x", "(a+)+$", true, false, None)], n).unwrap();
        let mut w = Watcher::new(Arc::new(hub), "c".into(), None);
        let t = Instant::now();
        w.feed(&("a".repeat(4000) + "!\n"));
        assert!(t.elapsed() < Duration::from_secs(1));
    }
}
