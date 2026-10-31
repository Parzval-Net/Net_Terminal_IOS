/**
 * Variables de plantilla que pueden llevar secretos: no se recuerdan, se piden en un campo
 * oculto y se enmascaran en la vista previa. Se prefiere el falso positivo (pedir de nuevo un
 * valor) a guardar una contraseña en el almacenamiento local.
 * - Por contenido: pass, pwd, secret, clave, contrase(ña), key, token, psk, community,
 *   comunidad, auth, enable, tacacs, radius, snmp.
 * - "pin" solo como palabra (pin, pin_sim, simPin, PIN), para no tomar "ping" ni "spine".
 */
const SECRET_PART = /pass|pwd|secret|clave|contrase|key|token|psk|community|comunidad|auth|enable|tacacs|radius|snmp/i;
const PIN_WORD = /(?:^|[._-])[pP][iI][nN](?:$|[._\d-])|[a-z]Pin(?:$|[A-Z._\d-])/;

export function isSecretVar(name: string): boolean {
  return SECRET_PART.test(name) || PIN_WORD.test(name);
}
