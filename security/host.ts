// The desk itself (the Arch desktop that will serve the site), looked at over
// SSH, reading only: what listens on the network, whether a firewall is up,
// how SSH lets people in, and whether the running kernel is the patched one.
// The site reaches the internet only through the tunnel, but anything else
// the desk exposes is a way in to the machine the site runs on.
import { execFileSync } from 'node:child_process'
import { Checks, type Finding } from './checks'

/** Addresses only this machine (loopback) or the owner's own private network (Tailscale) can reach. */
const PRIVATE = /^(?:127\.|\[?::1\]?|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|\[?fd7a:115c:a1e0:)/

export function auditHost(desk = process.env.DESK ?? 'kc@archlinux'): Finding[] {
  const checks = new Checks(`The desk (${desk})`)
  const ssh = (command: string) => execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', desk, command], { encoding: 'utf8' })
  try {
    ssh('true')
  } catch {
    checks.expect('the desk could be reached over SSH', false, 'info', `ssh ${desk} failed`)
    return checks.findings
  }

  // --- What listens, and to whom ---
  const listening = ssh('ss -Htlnp 2>/dev/null || ss -Htln')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const cols = line.trim().split(/\s+/)
      const local = cols[3] ?? ''
      const program = /users:\(\("([^"]+)"/.exec(line)?.[1] ?? '?'
      return { local, program }
    })
  const open = listening.filter(({ local }) => !PRIVATE.test(local))
  checks.expect(
    'nothing listens on the local network except SSH',
    open.every(({ local }) => /:22$/.test(local)),
    'medium',
    `reachable from the network: ${open.map(({ local, program }) => `${local} (${program})`).join(', ')}`,
  )
  const site = listening.filter(({ local }) => /:8787$/.test(local))
  if (site.length) checks.expect("the site's server listens on this machine only", site.every(({ local }) => PRIVATE.test(local)), 'high', site.map((s) => s.local).join(', '))

  // --- A firewall ---
  const firewalls = ssh('for u in firewalld ufw nftables iptables; do printf "%s=%s " $u "$(systemctl is-active $u 2>/dev/null)"; done; true')
  checks.expect('a firewall is running', /=active\b/.test(firewalls), 'medium', firewalls.trim())

  // --- SSH ---
  const sshd = ssh("cat /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null | grep -Ei '^[[:space:]]*(PasswordAuthentication|PermitRootLogin|KbdInteractiveAuthentication)[[:space:]]' ; true")
  const setting = (name: string) => new RegExp(`^\\s*${name}\\s+(\\S+)`, 'im').exec(sshd)?.[1]?.toLowerCase()
  checks.expect('SSH does not accept passwords (keys only)', setting('PasswordAuthentication') === 'no', 'medium', `PasswordAuthentication ${setting('PasswordAuthentication') ?? 'not set (the default is yes)'}`)
  checks.expect('root cannot log in over SSH', ['no', 'prohibit-password', 'without-password'].includes(setting('PermitRootLogin') ?? 'prohibit-password'), 'medium', `PermitRootLogin ${setting('PermitRootLogin') ?? 'not set'}`)

  // --- Patched ---
  const running = ssh('uname -r').trim()
  const installed = ssh("pacman -Q linux 2>/dev/null | awk '{print $2}'; true").trim()
  if (installed) {
    const same = running.replace(/-arch/, '.arch').startsWith(installed.replace(/-arch/, '.arch').split('-')[0]!)
    checks.expect('the running kernel is the installed one (no reboot pending for security fixes)', same, 'low', `running ${running}, installed ${installed}`)
  }
  return checks.findings
}
