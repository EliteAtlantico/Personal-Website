// What every check in the security suite reports, and how the report is printed.

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface Finding {
  section: string
  check: string
  ok: boolean
  /** How bad it is if it fails. */
  severity: Severity
  detail?: string
}

export class Checks {
  readonly findings: Finding[] = []
  constructor(private section: string) {}

  /** Records a check: `ok` passes, otherwise it's a finding of `severity`. */
  expect(check: string, ok: boolean, severity: Severity, detail?: string) {
    this.findings.push({ section: this.section, check, ok, severity, detail })
    return ok
  }
}

const ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

export function report(findings: Finding[]) {
  const failed = findings.filter((f) => !f.ok).sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity))
  const sections = [...new Set(findings.map((f) => f.section))]
  for (const section of sections) {
    const mine = findings.filter((f) => f.section === section)
    const bad = mine.filter((f) => !f.ok)
    console.log(`${section}: ${mine.length - bad.length}/${mine.length} passed`)
  }
  if (!failed.length) {
    console.log('\nNothing found.')
    return
  }
  console.log('\nFindings, worst first:')
  for (const f of failed) console.log(`  [${f.severity.toUpperCase()}] ${f.section}: ${f.check}${f.detail ? `\n      ${f.detail}` : ''}`)
}

/** Whether the findings should fail the run: anything worse than low. */
export const failing = (findings: Finding[]) => findings.some((f) => !f.ok && ORDER.indexOf(f.severity) <= ORDER.indexOf('medium'))
