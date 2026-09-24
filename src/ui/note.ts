// The editor's note at the top of the front page: what personalizing noticed
// and what it changed, with the way to see everything the browser shared and
// to turn it off. JavaScript adds it, since only JavaScript personalizes; a
// visitor without it gets the page everyone gets, and no note.
//
// A change of mind (off, on, yes, no, forget) works the edition out again and
// announces it with a "kc:edition" event; the router redraws the page for it.
import { esc } from '../render/html'
import { choose, edition, everything, forget } from '../signals'
import { changes, facts, note, type Action } from '../signals/words'

const LABELS: Record<Action, string> = {
  panel: 'What your browser told me',
  off: "Don't personalize",
  on: 'Personalize it again',
  yes: 'Yes, tailor it',
  no: 'No thanks',
}

/** Adds the note under the front page's masthead. */
export function addNote(page: HTMLElement, signal: AbortSignal) {
  const ed = edition()
  const header = page.querySelector('.masthead--full')
  if (!ed || !header) return
  const { hello, text, resume, actions } = note(ed.decision, ed.signals, ed.first)
  const resumeUrl = ed.site.config.links.find((link) => link.url.endsWith('.pdf'))?.url
  let words = esc(text)
  if (resume && resumeUrl) words = words.replace('my résumé', `<a href="${esc(resumeUrl)}">my résumé</a>`)
  const aside = document.createElement('aside')
  aside.className = 'note'
  aside.setAttribute('aria-label', "Editor's note")
  aside.innerHTML = `<p class="note__text"><span class="note__kicker">${ed.debug ? 'Debug' : "Editor's note"}</span>${hello ? ` <strong class="note__hello">${esc(hello)}</strong>` : ''} ${words}</p>
  <p class="note__actions">${actions.map((action) => `<button type="button" data-note="${action}">${LABELS[action]}</button>`).join('')}</p>`
  header.after(aside)
  aside.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-note]')
    if (!button) return
    const action = button.dataset.note as Action
    if (action === 'panel') void openPanel()
    else decideAgain({ personalize: action === 'on' || action === 'yes' })
  }, { signal })
}

const decideAgain = (change: { personalize: boolean }) => void choose(change)

/** The panel: every signal, what was done with it, and the switches. */
export async function openPanel() {
  const ed = edition()
  if (!ed) return
  const signals = await everything()
  document.querySelector('dialog.signals')?.remove()
  const dialog = document.createElement('dialog')
  dialog.className = 'signals'
  dialog.setAttribute('aria-labelledby', 'signals-title')
  const done = ed.decision.mode === 'on' || ed.decision.mode === 'ask' ? changes(ed.decision, ed.first, ed.terminal) : []
  const blocked = ed.decision.mode === 'gpc' || ed.decision.mode === 'dnt'
  const unread = ed.decision.mode !== 'on'
  dialog.innerHTML = `<form method="dialog" class="signals__close"><button aria-label="Close">×</button></form>
  <h2 class="signals__title" id="signals-title">What your browser told me</h2>
  <p class="signals__lede">Any site can read all of this without asking. This one reads it in your browser to decide what goes first on the front page. None of it is kept or sent anywhere, and it's gone when you close the tab.${unread ? ' <strong>Nothing about your device was used on this visit;</strong> it was read just now, because you asked to see it.' : ''}</p>
  <div class="signals__groups">${facts(signals)
    .map(({ group, rows }) => `<section><h3>${esc(group)}</h3><dl>${rows.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}</dl></section>`)
    .join('')}</div>
  <section class="signals__changed"><h3>What I did with it</h3>${
    done.length ? `<ul>${done.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>` : `<p>Nothing: you're seeing the page everyone sees.</p>`
  }</section>
  <div class="signals__controls">
    <label><input type="checkbox" data-personalize${ed.decision.mode === 'on' ? ' checked' : ''}${blocked ? ' disabled' : ''}> Personalize this page${blocked ? ' <span>(your browser asks not to be tracked, so it stays off)</span>' : ''}</label>
    <button type="button" data-forget>Forget my choices</button>
  </div>
  <p class="signals__more">See what else your browser gives away: <a href="https://coveryourtracks.eff.org/" target="_blank" rel="noopener">Cover Your Tracks</a> from the EFF, and <a href="https://neberej.github.io/exposedbydefault/" target="_blank" rel="noopener">Exposed by Default</a>.</p>`
  document.body.append(dialog)
  dialog.addEventListener('close', () => dialog.remove())
  // A click on the backdrop (outside the panel) closes it.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close()
  })
  dialog.querySelector<HTMLInputElement>('[data-personalize]')?.addEventListener('change', (event) => {
    const on = (event.target as HTMLInputElement).checked
    dialog.close()
    decideAgain({ personalize: on })
  })
  dialog.querySelector('[data-forget]')?.addEventListener('click', () => {
    dialog.close()
    void forget()
  })
  dialog.showModal()
}
