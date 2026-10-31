/**
 * Catálogo de comandos de uso diario por fabricante. La sintaxis puede variar según
 * plataforma y versión de software; las variables {{así}} se completan al enviar.
 *
 * Riesgo:
 *  - read: solo consulta.
 *  - change: cambia configuración o estado (contadores, sesión, debug).
 *  - disruptive: puede cortar servicio (shutdown, reload, reboot).
 */

export type Risk = "read" | "change" | "disruptive";

export interface CatalogCommand {
  cmd: string;
  desc: string;
  cat: string;
  risk: Risk;
  /** Documentación oficial que respalda la sintaxis (la misma del pack investigado). */
  source?: string;
}

export interface Vendor {
  id: string;
  name: string;
  note: string;
  commands: CatalogCommand[];
}

const c = (cat: string, risk: Risk, cmd: string, desc: string, source?: string): CatalogCommand => ({ cat, risk, cmd, desc, source });

export const CATEGORIES = ["Sistema", "Interfaces", "Capa 2", "Enrutamiento", "Seguridad", "Diagnóstico", "Logs", "Configuración"];

export const vendors: Vendor[] = [
  {
    id: "cisco",
    name: "Cisco",
    note: "IOS / IOS-XE (Catalyst, ISR, ASR). En NX-OS y Arista la mayoría aplica igual.",
    commands: [
      c("Sistema", "read", "show version", "Versión de software, modelo, uptime, imagen de arranque y registro de configuración.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/show_protocols_through_showmon.html"),
      c("Sistema", "read", "show inventory", "PID y número de serie del chasis, módulos y transceivers.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/show_gsr_through_show_monitor_event_trace.html"),
      c("Sistema", "read", "show running-config", "Configuración activa en memoria.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/show_protocols_through_showmon.html"),
      c("Sistema", "read", "show running-config | section {{seccion}}", "Solo un bloque de la configuración (ej: interface, router bgp, line vty).", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/show_protocols_through_showmon.html"),
      c("Sistema", "read", "show startup-config", "Configuración guardada que se carga al reiniciar.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/show_protocols_through_showmon.html"),
      c("Sistema", "read", "show processes cpu sorted", "Procesos ordenados por uso de CPU (5 s, 1 min, 5 min).", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/show_monitor_permit_list_through_show_process_memory.html"),
      c("Sistema", "read", "show processes memory sorted", "Procesos ordenados por uso de memoria.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/show_monitor_permit_list_through_show_process_memory.html"),
      c("Sistema", "read", "show environment all", "Temperatura, fuentes de poder y ventiladores (Catalyst / IOS-XE).", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/show_through_show_fm_summary.html"),
      c("Sistema", "read", "show clock", "Fecha y hora del equipo; clave para correlacionar logs.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/bsm/command/bsm-cr-book/bsm-cr-n1.html"),
      c("Sistema", "read", "show users", "Sesiones de administración activas en el equipo.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/security/s1/sec-s1-cr-book/sec-cr-s5.html"),
      c("Sistema", "read", "terminal length 0", "Desactiva la paginación (--More--) solo en la sesión actual.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/slave_auto-sync_config_through_terminal-type.html"),
      c("Interfaces", "read", "show ip interface brief", "Resumen de interfaces: IP, estado administrativo y de protocolo.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipaddr/command/ipaddr-cr-book/ipaddr-r1.html"),
      c("Interfaces", "read", "show interfaces status", "Puertos de switch: estado, VLAN, dúplex, velocidad y tipo.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/interface/command/ir-cr-book/ir-s4.html"),
      c("Interfaces", "read", "show interfaces {{interfaz}}", "Detalle de una interfaz: tasas de tráfico, errores, CRC, drops y resets.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/interface/command/ir-cr-book/ir-s4.html"),
      c("Interfaces", "read", "show interfaces description", "Descripción y estado de todas las interfaces.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/interface/command/ir-cr-book/ir-s4.html"),
      c("Interfaces", "read", "show interfaces counters errors", "Errores por puerto (FCS, alineación, colisiones).", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/interface/command/ir-cr-book/ir-s4.html"),
      c("Interfaces", "read", "show interfaces transceiver detail", "Niveles ópticos DOM: temperatura, potencia Tx/Rx y umbrales.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/interface/command/ir-cr-book/ir-s4.html"),
      c("Interfaces", "read", "show etherchannel summary", "Estado de port-channels y sus miembros.", "https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9400/software/release/17-16/command_reference/b_1716_9400_cr/layer_2_3_commands.html"),
      c("Interfaces", "change", "clear counters {{interfaz}}", "Reinicia los contadores de la interfaz para medir errores desde cero.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/interface/command/ir-cr-book/ir-c1.html"),
      c("Interfaces", "disruptive", "configure terminal\ninterface {{interfaz}}\nshutdown\nend", "Apaga la interfaz. Corta el tráfico que pasa por ella.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/interface/command/ir-cr-book/ir-s6.html"),
      c("Interfaces", "change", "configure terminal\ninterface {{interfaz}}\nno shutdown\nend", "Levanta una interfaz apagada administrativamente.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/interface/command/ir-cr-book/ir-s6.html"),
      c("Capa 2", "read", "show vlan brief", "VLANs configuradas y puertos de acceso asociados.", "https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9400/software/release/17-16/command_reference/b_1716_9400_cr/layer_2_3_commands.html"),
      c("Capa 2", "read", "show interfaces trunk", "Troncales, VLANs permitidas y activas en cada una.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/interface/command/ir-cr-book/ir-s4.html"),
      c("Capa 2", "read", "show mac address-table", "Tabla MAC: dirección, VLAN y puerto.", "https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9400/software/release/17-16/command_reference/b_1716_9400_cr/system_management_commands.html"),
      c("Capa 2", "read", "show mac address-table address {{mac}}", "Ubica una MAC (formato xxxx.xxxx.xxxx) en el switch.", "https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9400/software/release/17-16/command_reference/b_1716_9400_cr/system_management_commands.html"),
      c("Capa 2", "read", "show spanning-tree summary", "Modo STP, root bridges y puertos bloqueados por VLAN.", "https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9400/software/release/17-16/command_reference/b_1716_9400_cr/layer_2_3_commands.html"),
      c("Capa 2", "read", "show spanning-tree vlan {{vlan}}", "Detalle STP de una VLAN: root, costo y rol de cada puerto.", "https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9400/software/release/17-16/command_reference/b_1716_9400_cr/layer_2_3_commands.html"),
      c("Capa 2", "read", "show cdp neighbors detail", "Vecinos Cisco: modelo, IP de gestión, versión y puerto remoto.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/cdp/command/cdp-cr-book/cdp-cr-a1.html"),
      c("Capa 2", "read", "show lldp neighbors", "Vecinos LLDP (multivendor) por puerto.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/cether/command/ce-cr-book/ce-s1.html"),
      c("Enrutamiento", "read", "show ip route", "Tabla de enrutamiento completa.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/iproute_pi/command/iri-cr-book/iri-cr-s1.html"),
      c("Enrutamiento", "read", "show ip route {{ip}}", "Ruta usada para llegar a una IP y su origen.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/iproute_pi/command/iri-cr-book/iri-cr-s1.html"),
      c("Enrutamiento", "read", "show ip route vrf {{vrf}}", "Tabla de enrutamiento de una VRF.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/iproute_pi/command/iri-cr-book/iri-cr-s1.html"),
      c("Enrutamiento", "read", "show ip protocols", "Protocolos de enrutamiento activos, redes anunciadas y vecinos.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/iproute_pi/command/iri-cr-book/iri-cr-s1.html"),
      c("Enrutamiento", "read", "show ip ospf neighbor", "Vecinos OSPF y estado de adyacencia (FULL esperado).", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/iproute_ospf/command/iro-cr-book/ospf-s1.html"),
      c("Enrutamiento", "read", "show ip bgp summary", "Vecinos BGP, estado y prefijos recibidos.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/iproute_bgp/command/irg-cr-book/bgp-s1.html"),
      c("Enrutamiento", "read", "show ip bgp neighbors {{ip}} advertised-routes", "Prefijos que se anuncian a un vecino BGP.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/iproute_bgp/command/irg-cr-book/bgp-s1.html"),
      c("Enrutamiento", "read", "show ip arp", "Tabla ARP: IP, MAC e interfaz.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipaddr/command/ipaddr-cr-book/ipaddr-r1.html"),
      c("Enrutamiento", "read", "show standby brief", "Estado HSRP: activo, standby y prioridad.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipapp_fhrp/command/fhp-cr-book/fhp-s1.html"),
      c("Enrutamiento", "read", "show vrrp brief", "Estado VRRP por grupo.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/ipapp_fhrp/command/fhp-cr-book/fhp-s1.html"),
      c("Seguridad", "read", "show access-lists", "ACLs con contadores de coincidencias por regla.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/security/s1/sec-s1-cr-book/sec-cr-s2.html"),
      c("Seguridad", "read", "show ip ssh", "Versión SSH habilitada, timeouts y algoritmos.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/security/s1/sec-s1-cr-book/sec-cr-s4.html"),
      c("Seguridad", "read", "show port-security", "Port-security por puerto y violaciones registradas.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/security/s1/sec-s1-cr-book/sec-cr-s5.html"),
      c("Seguridad", "read", "show ip dhcp snooping binding", "Asignaciones DHCP aprendidas por snooping.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/security/s1/sec-s1-cr-book/sec-cr-s4.html"),
      c("Seguridad", "read", "show crypto isakmp sa", "SAs de fase 1 IPsec (IKEv1).", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/security/s1/sec-s1-cr-book/sec-cr-s3.html"),
      c("Seguridad", "read", "show crypto ipsec sa", "SAs de fase 2: túneles, paquetes cifrados y errores.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/security/s1/sec-s1-cr-book/sec-cr-s3.html"),
      c("Diagnóstico", "read", "ping {{ip}} source {{interfaz}}", "Ping indicando la interfaz de origen (valida rutas de retorno).", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/monitor_event-trace_through_Q.html"),
      c("Diagnóstico", "read", "traceroute {{ip}}", "Saltos hasta el destino.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/test_cable-diagnostics_through_xmodem.html"),
      c("Diagnóstico", "read", "show ntp status", "Sincronización NTP y estrato.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/bsm/command/bsm-cr-book/bsm-cr-n1.html"),
      c("Diagnóstico", "change", "undebug all", "Detiene todos los debug activos. Úsalo siempre al terminar un debug.", "https://www.cisco.com/c/en/us/support/docs/dial-access/integrated-services-digital-networks-isdn-channel-associated-signaling-cas/10374-debug.html"),
      c("Logs", "read", "show logging", "Buffer de logs local y configuración de logging.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/show_gsr_through_show_monitor_event_trace.html"),
      c("Logs", "read", "show logging | include {{texto}}", "Logs filtrados por texto (ej: UPDOWN, %SYS).", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/show_gsr_through_show_monitor_event_trace.html"),
      c("Logs", "read", "show archive log config all", "Historial de cambios de configuración (requiere archive log config).", "https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9500/software/release/17-7/configuration_guide/sys_mgmt/b_177_sys_mgmt_9500_cg/configuration_replace_and_configuration_rollback.html"),
      c("Logs", "change", "clear logging", "Vacía el buffer de logs local.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/C_commands.html"),
      c("Configuración", "change", "configure terminal", "Entra al modo de configuración global.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/C_commands.html"),
      c("Configuración", "change", "copy running-config startup-config", "Guarda la configuración activa para que persista tras reiniciar.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/C_commands.html"),
      c("Configuración", "read", "copy running-config tftp://{{ip}}/{{archivo}}", "Respaldo de la configuración a un servidor TFTP.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/C_commands.html"),
      c("Configuración", "disruptive", "reload in {{minutos}}", "Reinicio programado: red de seguridad antes de un cambio remoto riesgoso.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/R_through_setup.html"),
      c("Configuración", "change", "reload cancel", "Cancela un reinicio programado tras confirmar que el cambio funcionó.", "https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/fundamentals/command/cf_command_ref/R_through_setup.html"),
    ],
  },
  {
    id: "huawei",
    name: "Huawei",
    note: "VRP (switches S, routers AR/NE). Muchos comandos aplican igual en H3C Comware.",
    commands: [
      c("Sistema", "read", "display version", "Versión de VRP, modelo, uptime y parches.", "https://support.huawei.com/enterprise/en/doc/EDOC1100517148/116aa164/upgrade-maintenance-configuration-commands"),
      c("Sistema", "read", "display device", "Tarjetas, módulos y su estado de hardware.", "https://support.huawei.com/enterprise/en/doc/EDOC1100517148/c6801428/hardware-management-configuration-commands"),
      c("Sistema", "read", "display esn", "Número de serie del equipo (ESN).", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/91652f17/device-status-checking-commands"),
      c("Sistema", "read", "display elabel", "Etiqueta electrónica: seriales y códigos de cada componente.", "https://support.huawei.com/enterprise/en/doc/EDOC1100517148/c6801428/hardware-management-configuration-commands"),
      c("Sistema", "read", "display current-configuration", "Configuración activa.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/5840eb45/configuring-system-startup-commands"),
      c("Sistema", "read", "display current-configuration | include {{texto}}", "Líneas de configuración que contienen un texto.", "https://support.huawei.com/enterprise/en/doc/EDOC1100279274/cc702209/cli-overview-configuration"),
      c("Sistema", "read", "display saved-configuration", "Configuración guardada que se carga al reiniciar.", "https://support.huawei.com/enterprise/en/doc/EDOC1100513703/e5e30dfa/saving-configurations"),
      c("Sistema", "read", "display cpu-usage", "Uso de CPU y procesos principales.", "https://support.huawei.com/enterprise/en/doc/EDOC1100517148/c6801428/hardware-management-configuration-commands"),
      c("Sistema", "read", "display memory-usage", "Uso de memoria.", "https://support.huawei.com/enterprise/en/doc/EDOC1100517148/c6801428/hardware-management-configuration-commands"),
      c("Sistema", "read", "display clock", "Fecha y hora del equipo.", "https://support.huawei.com/enterprise/en/doc/EDOC1100517148/9bac53ac/system-time-configuration-commands"),
      c("Sistema", "read", "display users", "Usuarios conectados al equipo.", "https://support.huawei.com/enterprise/en/doc/EDOC1100517148/54f8dacb/first-login-to-a-device-configuration-commands"),
      c("Sistema", "read", "screen-length 0 temporary", "Desactiva la paginación solo en la sesión actual.", "https://support.huawei.com/enterprise/en/doc/EDOC1100517148/9ed80f78/cli-based-device-login-configuration-commands"),
      c("Interfaces", "read", "display interface brief", "Resumen de interfaces: estado físico, protocolo y uso de ancho de banda.", "https://support.huawei.com/enterprise/en/doc/EDOC1100517148/98a1b33e/interface-basic-configuration-commands"),
      c("Interfaces", "read", "display ip interface brief", "Interfaces con IP y su estado.", "https://support.huawei.com/enterprise/en/doc/EDOC1100517148/98a1b33e/interface-basic-configuration-commands"),
      c("Interfaces", "read", "display interface {{interfaz}}", "Detalle de una interfaz: tráfico, errores CRC y descartes.", "https://support.huawei.com/enterprise/en/doc/EDOC1100517148/98a1b33e/interface-basic-configuration-commands"),
      c("Interfaces", "read", "display interface description", "Descripción y estado de las interfaces.", "https://support.huawei.com/enterprise/en/doc/EDOC1100517148/98a1b33e/interface-basic-configuration-commands"),
      c("Interfaces", "read", "display transceiver interface {{interfaz}} verbose", "Niveles ópticos del transceiver: potencia Tx/Rx, temperatura.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/91652f17/device-status-checking-commands"),
      c("Interfaces", "read", "display eth-trunk {{id}}", "Estado de un Eth-Trunk y sus miembros.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/54c5f31b/link-aggregation-commands"),
      c("Interfaces", "change", "reset counters interface {{interfaz}}", "Reinicia los contadores de la interfaz.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/cdd85713/basic-interface-configuration-commands"),
      c("Interfaces", "disruptive", "system-view\ninterface {{interfaz}}\nshutdown\nreturn", "Apaga la interfaz.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/cdd85713/basic-interface-configuration-commands"),
      c("Interfaces", "change", "system-view\ninterface {{interfaz}}\nundo shutdown\nreturn", "Levanta una interfaz apagada.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/cdd85713/basic-interface-configuration-commands"),
      c("Capa 2", "read", "display vlan", "VLANs y puertos asociados.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/834147df/vlan-configuration-commands"),
      c("Capa 2", "read", "display port vlan", "Modo de cada puerto (access, trunk, hybrid) y VLANs.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/834147df/vlan-configuration-commands"),
      c("Capa 2", "read", "display mac-address", "Tabla MAC.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/7404084d/mac-address-table-configuration-commands"),
      c("Capa 2", "read", "display mac-address {{mac}}", "Ubica una MAC (formato xxxx-xxxx-xxxx).", "https://support.huawei.com/enterprise/en/doc/EDOC1100517148/47c53775/mac-configuration-commands"),
      c("Capa 2", "read", "display stp brief", "Estado y rol STP de cada puerto.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/9ccc5041/stp-rstp-mstp-vbst-configuration-commands"),
      c("Capa 2", "read", "display lldp neighbor brief", "Vecinos LLDP por puerto.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/8def618c/lldp-configuration-commands"),
      c("Enrutamiento", "read", "display ip routing-table", "Tabla de enrutamiento.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/31b4832a/ip-routing-table-management-commands"),
      c("Enrutamiento", "read", "display ip routing-table {{ip}}", "Ruta hacia una IP.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/31b4832a/ip-routing-table-management-commands"),
      c("Enrutamiento", "read", "display ip routing-table vpn-instance {{vrf}}", "Tabla de una VPN-instance (VRF).", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/31b4832a/ip-routing-table-management-commands"),
      c("Enrutamiento", "read", "display ospf peer brief", "Vecinos OSPF y estado.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/753f0155/ospf-configuration-commands"),
      c("Enrutamiento", "read", "display bgp peer", "Vecinos BGP, estado y prefijos recibidos.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/54c86941/bgp-configuration-commands"),
      c("Enrutamiento", "read", "display arp", "Tabla ARP.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/bbf12ab5/arp-configuration-commands"),
      c("Enrutamiento", "read", "display vrrp brief", "Estado VRRP.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/3f68ca6c/vrrp-configuration-commands"),
      c("Seguridad", "read", "display acl all", "ACLs y coincidencias por regla.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/f3ca4a6c/acl-configuration-commands"),
      c("Seguridad", "read", "display ssh server status", "Estado y parámetros del servidor SSH.", "https://support.huawei.com/enterprise/en/doc/EDOC1100517148/7fa11d5c/ssh-configuration-commands"),
      c("Seguridad", "read", "display local-user", "Usuarios locales configurados (sin contraseñas).", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/330af205/aaa-configuration-commands"),
      c("Seguridad", "read", "display ike sa", "SAs IKE (fase 1).", "https://support.huawei.com/enterprise/en/doc/EDOC1100517148/cdcf5dac/ipsec-configuration-commands"),
      c("Seguridad", "read", "display ipsec sa", "SAs IPsec (fase 2).", "https://support.huawei.com/enterprise/en/doc/EDOC1100517148/cdcf5dac/ipsec-configuration-commands"),
      c("Diagnóstico", "read", "ping -a {{ip_origen}} {{ip}}", "Ping con IP de origen definida.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/4f76106c/ping-and-tracert-configuration-commands"),
      c("Diagnóstico", "read", "tracert {{ip}}", "Saltos hasta el destino.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/4f76106c/ping-and-tracert-configuration-commands"),
      c("Diagnóstico", "read", "display ntp-service status", "Sincronización NTP.", "https://support.huawei.com/enterprise/en/doc/EDOC1100279274/9d51ac4b/ntp-configuration"),
      c("Diagnóstico", "read", "display diagnostic-information", "Información completa para soporte (salida muy extensa).", "https://support.huawei.com/enterprise/en/doc/EDOC1100517148/54f8dacb/first-login-to-a-device-configuration-commands"),
      c("Logs", "read", "display logbuffer", "Buffer de logs.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/cf7845b/information-center-configuration-commands"),
      c("Logs", "read", "display trapbuffer", "Buffer de traps/alarmas.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/cf7845b/information-center-configuration-commands"),
      c("Configuración", "change", "system-view", "Entra al modo de configuración.", "https://support.huawei.com/enterprise/en/doc/EDOC1100279274/cc702209/cli-overview-configuration"),
      c("Configuración", "change", "save", "Guarda la configuración activa.", "https://support.huawei.com/enterprise/en/doc/EDOC1100513703/e5e30dfa/saving-configurations"),
      c("Configuración", "change", "commit", "Confirma cambios en equipos con configuración en dos fases (VRP8).", "https://support.huawei.com/enterprise/en/doc/EDOC1100279274/cc702209/cli-overview-configuration"),
      c("Configuración", "read", "tftp {{ip}} put vrpcfg.zip", "Respaldo del archivo de configuración a un servidor TFTP.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/5906a2c/file-management-commands"),
      c("Configuración", "disruptive", "schedule reboot delay {{tiempo}}", "Reinicio programado (tiempo en formato hh:mm) como red de seguridad antes de un cambio remoto.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/5840eb45/configuring-system-startup-commands"),
      c("Configuración", "change", "undo schedule reboot", "Cancela el reinicio programado.", "https://support.huawei.com/enterprise/en/doc/EDOC1000178165/5840eb45/configuring-system-startup-commands"),
    ],
  },
  {
    id: "fortinet",
    name: "Fortinet",
    note: "FortiOS (FortiGate). En equipos con VDOM, ejecuta 'config vdom' / 'edit {{vdom}}' o 'config global' según el comando.",
    commands: [
      c("Sistema", "read", "get system status", "Versión, número de serie, modo de operación, VDOM y HA.", "https://docs.fortinet.com/document/fortigate/7.6.0/cli-troubleshooting-cheat-sheet"),
      c("Sistema", "read", "get system performance status", "CPU, memoria, sesiones y tasa de sesiones.", "https://docs.fortinet.com/document/fortigate/7.6.0/cli-troubleshooting-cheat-sheet"),
      c("Sistema", "read", "get hardware status", "Modelo, CPU, memoria y almacenamiento.", "https://community.fortinet.com/fortigate-3/technical-tip-explaining-the-get-hardware-status-command-155265"),
      c("Sistema", "read", "get system ha status", "Estado del clúster HA y sincronización.", "https://docs.fortinet.com/document/fortigate/7.6.0/cli-troubleshooting-cheat-sheet"),
      c("Sistema", "read", "diagnose sys top", "Procesos en tiempo real (q para salir).", "https://docs.fortinet.com/document/fortigate/7.6.0/cli-troubleshooting-cheat-sheet"),
      c("Sistema", "read", "show", "Configuración que difiere de los valores por defecto (desde el contexto actual).", "https://docs.fortinet.com/document/fortigate/6.2.0/cookbook/896276/cli-basics"),
      c("Sistema", "read", "show full-configuration", "Configuración completa, incluidos valores por defecto (muy extensa).", "https://docs.fortinet.com/document/fortigate/6.2.0/cookbook/896276/cli-basics"),
      c("Sistema", "change", "config system console\nset output standard\nend", "Desactiva la paginación de la consola (cambio persistente de configuración).", "https://docs.fortinet.com/document/fortigate/7.4.8/cli-reference/141236613/config-system-console"),
      c("Interfaces", "read", "get system interface physical", "Estado físico, velocidad y dúplex de cada puerto.", "https://docs.fortinet.com/document/fortigate/7.6.0/cli-troubleshooting-cheat-sheet"),
      c("Interfaces", "read", "show system interface {{puerto}}", "Configuración de una interfaz.", "https://docs.fortinet.com/document/fortigate/7.4.8/cli-reference/317104469/config-system-interface"),
      c("Interfaces", "read", "diagnose hardware deviceinfo nic {{puerto}}", "Contadores y errores del puerto físico.", "https://docs.fortinet.com/document/fortigate/7.6.0/cli-troubleshooting-cheat-sheet"),
      c("Enrutamiento", "read", "get router info routing-table all", "Tabla de enrutamiento activa.", "https://community.fortinet.com/fortigate-3/technical-tip-fortigate-routing-debug-commands-177121"),
      c("Enrutamiento", "read", "get router info routing-table details {{ip}}", "Ruta hacia una IP.", "https://community.fortinet.com/fortigate-3/technical-tip-fortigate-routing-debug-commands-177121"),
      c("Enrutamiento", "read", "get router info bgp summary", "Vecinos BGP y prefijos.", "https://community.fortinet.com/fortigate-3/technical-tip-fortigate-routing-debug-commands-177121"),
      c("Enrutamiento", "read", "get router info ospf neighbor", "Vecinos OSPF.", "https://docs.fortinet.com/document/fortigate/7.6.0/cli-troubleshooting-cheat-sheet"),
      c("Enrutamiento", "read", "get system arp", "Tabla ARP.", "https://docs.fortinet.com/document/fortigate/7.6.0/cli-troubleshooting-cheat-sheet"),
      c("Seguridad", "read", "show firewall policy", "Políticas de firewall.", "https://docs.fortinet.com/document/fortigate/7.4.8/cli-reference/333889629/config-firewall-policy"),
      c("Seguridad", "read", "show firewall policy {{id}}", "Detalle de una política.", "https://docs.fortinet.com/document/fortigate/7.4.8/cli-reference/333889629/config-firewall-policy"),
      c("Seguridad", "read", "diagnose sys session stat", "Estadísticas de la tabla de sesiones.", "https://docs.fortinet.com/document/fortigate/7.6.0/cli-troubleshooting-cheat-sheet"),
      c("Seguridad", "read", "get vpn ipsec tunnel summary", "Túneles IPsec y su estado.", "https://docs.fortinet.com/document/fortigate/7.6.0/cli-troubleshooting-cheat-sheet"),
      c("Seguridad", "read", "diagnose vpn tunnel list", "Detalle de túneles IPsec: SAs, contadores y errores.", "https://docs.fortinet.com/document/fortigate/7.6.0/cli-troubleshooting-cheat-sheet"),
      c("Seguridad", "read", "diagnose vpn ike gateway list", "Gateways IKE y estado de fase 1.", "https://docs.fortinet.com/document/fortigate/7.6.0/cli-troubleshooting-cheat-sheet"),
      c("Diagnóstico", "read", "execute ping {{ip}}", "Ping desde el FortiGate.", "https://docs.fortinet.com/document/fortigate/7.4.8/cli-reference/134891617/execute-ping"),
      c("Diagnóstico", "change", "execute ping-options source {{ip_origen}}", "Define la IP de origen para los próximos execute ping (cambia las opciones de ping de la sesión; execute ping-options view-settings las muestra).", "https://docs.fortinet.com/document/fortigate/7.4.8/cli-reference/221756471/execute-ping-options"),
      c("Diagnóstico", "read", "execute traceroute {{ip}}", "Saltos hasta el destino.", "https://docs.fortinet.com/document/fortigate/7.4.8/cli-reference/868095304/execute-traceroute"),
      c("Diagnóstico", "read", "diagnose sniffer packet any 'host {{ip}}' 4 {{cantidad}}", "Captura de paquetes en consola con nombre de interfaz (Ctrl+C para detener).", "https://docs.fortinet.com/document/fortigate/7.4.8/cli-reference/303299696/diagnose-sniffer"),
      c(
        "Diagnóstico",
        "change",
        "diagnose debug reset\ndiagnose debug flow filter addr {{ip}}\ndiagnose debug flow show function-name enable\ndiagnose debug enable\ndiagnose debug flow trace start {{cantidad}}",
        "Traza cómo el firewall procesa el tráfico de una IP (política, NAT, ruta). Detén con: diagnose debug disable.",
        "https://docs.fortinet.com/document/fortigate/7.6.0/cli-troubleshooting-cheat-sheet",
      ),
      c("Diagnóstico", "change", "diagnose debug disable\ndiagnose debug reset", "Detiene y limpia los debug activos.", "https://docs.fortinet.com/document/fortigate/7.6.0/cli-troubleshooting-cheat-sheet"),
      c("Configuración", "read", "execute backup config tftp {{archivo}} {{ip}}", "Respaldo de la configuración a un servidor TFTP.", "https://docs.fortinet.com/document/fortigate/7.4.8/cli-reference/229031989/execute-backup"),
      c("Configuración", "change", "config system global\nset hostname {{nombre}}\nend", "Ejemplo de cambio: nombre del equipo (config, set, end).", "https://docs.fortinet.com/document/fortigate/7.4.8/cli-reference/339914554/config-system-global"),
      c("Configuración", "disruptive", "execute reboot", "Reinicia el equipo.", "https://docs.fortinet.com/document/fortigate/7.4.8/cli-reference/292380055/execute-reboot"),
    ],
  },
  {
    id: "juniper",
    name: "Juniper",
    note: "Junos (EX, MX, SRX, QFX). Los cambios se aplican con commit; usa commit confirmed en cambios remotos.",
    commands: [
      c("Sistema", "read", "show version", "Versión de Junos y modelo.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-version.html"),
      c("Sistema", "read", "show chassis hardware", "Inventario: módulos, seriales y transceivers.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-chassis-hardware.html"),
      c("Sistema", "read", "show configuration | display set", "Configuración activa en formato de comandos set.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-configuration.html"),
      c("Sistema", "read", "show system uptime", "Uptime y hora del último commit.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-system-uptime.html"),
      c("Sistema", "read", "show system alarms", "Alarmas de sistema activas.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-system-alarms.html"),
      c("Sistema", "read", "show chassis alarms", "Alarmas de chasis activas.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-chassis-alarms.html"),
      c("Sistema", "read", "show chassis environment", "Temperatura, fuentes y ventiladores.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-chassis-environment.html"),
      c("Sistema", "read", "set cli screen-length 0", "Desactiva la paginación solo en la sesión actual.", "https://www.juniper.net/documentation/us/en/software/junos/cli/topics/topic-map/cli-environment-settings.html"),
      c("Interfaces", "read", "show interfaces terse", "Resumen de interfaces y estado.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-interfaces-terse.html"),
      c("Interfaces", "read", "show interfaces {{interfaz}} extensive", "Detalle de una interfaz: errores, drops y estadísticas.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-interfaces-extensive.html"),
      c("Interfaces", "read", "show interfaces descriptions", "Descripción de las interfaces.", "https://www.juniper.net/documentation/en_US/junos12.3/topics/reference/command-summary/show-interfaces-descriptions.html"),
      c("Interfaces", "read", "show interfaces diagnostics optics {{interfaz}}", "Niveles ópticos del transceiver.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-interfaces-diagnostics-optics-qfx-series.html"),
      c("Interfaces", "read", "show lacp interfaces", "Estado LACP de los agregados (ae).", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-lacp-interfaces.html"),
      c("Interfaces", "change", "clear interfaces statistics {{interfaz}}", "Reinicia contadores de la interfaz.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/clear-interfaces-statistics.html"),
      c("Capa 2", "read", "show vlans", "VLANs y puertos.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-vlans-bridging-qfx-series.html"),
      c("Capa 2", "read", "show ethernet-switching table", "Tabla MAC (EX / QFX).", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-ethernet-switching-table-qfx-series.html"),
      c("Capa 2", "read", "show lldp neighbors", "Vecinos LLDP.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-lldp-neighbors.html"),
      c("Capa 2", "read", "show spanning-tree bridge", "Estado STP del bridge.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-stp-bridge-command.html"),
      c("Enrutamiento", "read", "show route", "Tabla de enrutamiento.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-route.html"),
      c("Enrutamiento", "read", "show route {{ip}}", "Ruta hacia una IP.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-route.html"),
      c("Enrutamiento", "read", "show ospf neighbor", "Vecinos OSPF.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-ospf-ospf3-neighbor.html"),
      c("Enrutamiento", "read", "show bgp summary", "Vecinos BGP y prefijos.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-bgp-summary.html"),
      c("Enrutamiento", "read", "show route advertising-protocol bgp {{ip}}", "Prefijos anunciados a un vecino BGP.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-route-advertising-protocol.html"),
      c("Enrutamiento", "read", "show arp no-resolve", "Tabla ARP sin resolver nombres.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-arp.html"),
      c("Seguridad", "read", "show security policies", "Políticas de seguridad (SRX).", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-security-policies.html"),
      c("Seguridad", "read", "show security flow session", "Sesiones activas (SRX).", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-security-flow-session.html"),
      c("Seguridad", "read", "show firewall", "Contadores de filtros de firewall.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-firewall-filter.html"),
      c("Seguridad", "read", "show security ike security-associations", "SAs IKE (SRX).", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-security-ike-security-associations.html"),
      c("Seguridad", "read", "show security ipsec security-associations", "SAs IPsec (SRX).", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-security-ipsec-security-associations.html"),
      c("Diagnóstico", "read", "ping {{ip}} rapid count 100", "Ping rápido de 100 paquetes.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/ping.html"),
      c("Diagnóstico", "read", "traceroute {{ip}}", "Saltos hasta el destino.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/traceroute.html"),
      c("Diagnóstico", "read", "monitor traffic interface {{interfaz}}", "Captura de tráfico hacia el plano de control (Ctrl+C para detener).", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/monitor-traffic.html"),
      c("Logs", "read", "show log messages | last 50", "Últimas 50 líneas del log principal.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-log-messages.html"),
      c("Logs", "read", "show log messages | match {{texto}}", "Log filtrado por texto.", "https://www.juniper.net/documentation/us/en/software/junos/cli/topics/topic-map/filtering-operational-command.html"),
      c("Configuración", "change", "configure", "Entra al modo de configuración.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/configure.html"),
      c("Configuración", "read", "show | compare", "Diferencia entre la configuración candidata y la activa (en modo configuración).", "https://www.juniper.net/documentation/us/en/software/junos/cli/topics/topic-map/filtering-operational-command.html"),
      c("Configuración", "read", "commit check", "Valida la configuración candidata sin aplicarla.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/commit.html"),
      c("Configuración", "change", "commit confirmed {{minutos}}", "Aplica con rollback automático si no confirmas con commit dentro del plazo.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/commit.html"),
      c("Configuración", "change", "commit", "Aplica la configuración candidata.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/commit.html"),
      c("Configuración", "change", "rollback {{n}}", "Carga una configuración anterior como candidata (luego commit).", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/rollback.html"),
      c("Configuración", "disruptive", "request system reboot", "Reinicia el equipo.", "https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/request-system-reboot.html"),
    ],
  },
];

export const riskLabel: Record<Risk, string> = {
  read: "Consulta",
  change: "Cambia config/estado",
  disruptive: "Puede cortar servicio",
};

/** Fabricante sugerido según el resaltado de la sesión. */
export function vendorFor(highlight?: string): string {
  if (highlight === "huawei" || highlight === "fortinet" || highlight === "juniper") return highlight;
  return "cisco";
}
