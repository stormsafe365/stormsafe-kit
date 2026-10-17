/**
 * Scroll the options panel (only the panel - never the page) so `el` shows, above the pinned
 * Back / Next bar. scrollIntoView could move the page itself on a phone; and it would not know the
 * bar covers the bottom of the panel (re-check 10/16/26: the "Added ..." note sat under the bar).
 */
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function revealInPanel(el: HTMLElement, panel: HTMLElement | null = el.closest<HTMLElement>('.panel-scroll')) {
  if (!panel) return;
  const p = panel.getBoundingClientRect();
  const e = el.getBoundingClientRect();
  const bar = panel.querySelector<HTMLElement>('.stepnav');
  const barH = bar && getComputedStyle(bar).display !== 'none' ? bar.offsetHeight : 0;
  const top = p.top + 8;
  const bottom = p.bottom - barH - 8;
  let dy = 0;
  if (e.top < top) dy = e.top - top;
  else if (e.bottom > bottom) dy = Math.min(e.bottom - bottom, e.top - top);
  if (dy) panel.scrollTo({ top: panel.scrollTop + dy, behavior: reduceMotion() ? 'auto' : 'smooth' });
}
