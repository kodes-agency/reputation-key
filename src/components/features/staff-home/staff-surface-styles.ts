// The staff phone's own stylesheet, in its lazy chunk: the first-paint stylesheet
// is built by scanning src/ for class names, and a measure this specific would land
// in every page's. Colours come from `staff-look.ts`, type from the guest pair on
// the pass (DESIGN.md) and the product's own everywhere else.
export const STAFF_SURFACE_CSS = `
.staff-phone {
  --primary: var(--staff-accent-light); --primary-foreground: var(--staff-on-accent-light);
  --ring: var(--primary); --chart-1: var(--primary); --link: var(--primary);
  container-type: size; display: flex; flex-direction: column;
  height: 100dvh; width: 100%; overflow: hidden;
  /* The tabs and the full-screen steps carry the bottom inset themselves. */
  padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left);
  background: var(--background); color: var(--foreground);
}
.dark .staff-phone, .staff-phone.dark {
  --primary: var(--staff-accent-dark); --primary-foreground: var(--staff-on-accent-dark);
}
.staff-phone[data-tab=code] { --background: var(--staff-field); }
.staff-phone[data-embedded=true] { height: 72svh; min-height: 620px; border-radius: 14px; }
.staff-home__tabs { flex: 1; min-height: 0; gap: 0; }
.staff-home__panels { flex: 1; min-height: 0; display: flex; }
.staff-home__panels > [data-slot=tabs-content] { flex: 1; min-width: 0; min-height: 0; }
.staff-home__panels > [data-results] { overflow-y: auto; -webkit-overflow-scrolling: touch; }
.staff-phone [data-slot=tabs-list] { position: static; flex-shrink: 0; }
.staff-phone [data-slot=tabs-trigger] {
  flex-direction: column; gap: 3px; padding: 8px 0 7px; font-size: 11px; font-weight: 500;
}
.staff-phone [data-slot=tabs-trigger] svg { width: 24px; height: 24px; }
.staff-phone [data-slot=tabs-trigger][data-state=active] { color: var(--primary); border-color: transparent; }

.staff-code__frame { display: flex; flex-direction: column; align-items: center; height: 100%; }
.staff-code__frame[data-switch] { --pass-switch: 56px; }
.staff-code__frame > [data-slot=select-trigger] { flex-shrink: 0; margin-top: 12px; }
/* The auto margins centre the pass; if it can't fit it scrolls here, rather than sliding under the tabs. */
.staff-code { flex: 1; min-height: 0; width: 100%; display: flex; overflow-y: auto; padding: 12px 18px; }
.staff-pass {
  --pass-chrome: 330px;
  display: flex; flex-direction: column; width: 100%; max-width: 400px; flex-shrink: 0; margin: auto;
  overflow: hidden; border-radius: 26px; background: var(--staff-paper); color: var(--staff-ink);
  box-shadow: 0 18px 50px rgb(0 0 0 / 0.42);
  /* Paper even on the dark Code tab, so whatever is drawn on it takes paper's tokens. */
  --foreground: var(--staff-ink); --background: var(--staff-paper);
  --border: color-mix(in srgb, var(--staff-ink) 14%, var(--staff-paper));
  --input: color-mix(in srgb, var(--staff-ink) 26%, var(--staff-paper));
  --ring: var(--staff-accent-light);
}
.staff-pass[data-photo=true] { --pass-chrome: 370px; }
.staff-pass__head {
  position: relative; display: flex; align-items: center; justify-content: center; text-align: center;
  min-height: clamp(64px, 11cqh, 92px); padding: 12px 22px;
  background: var(--staff-band); color: var(--staff-on-band);
}
.staff-pass[data-photo=true] .staff-pass__head {
  min-height: clamp(96px, 18cqh, 150px); align-items: flex-end; padding-bottom: 12px;
  background: var(--staff-field); color: var(--staff-paper);
}
.staff-pass__photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.staff-pass[data-photo=true] .staff-pass__head::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(180deg, rgb(0 0 0 / 0) 15%, rgb(0 0 0 / 0.55) 55%, rgb(0 0 0 / 0.72) 100%);
}
.staff-pass__name {
  position: relative; z-index: 1; margin: 0; overflow-wrap: anywhere; text-wrap: balance;
  font-family: var(--font-guest-display); font-weight: 600; line-height: 1.1;
  font-size: clamp(21px, 7cqw, 27px); letter-spacing: -0.003em;
}
.staff-pass__name[data-long=true] { font-size: clamp(18px, 5.6cqw, 22px); }
.staff-pass[data-photo=true] .staff-pass__name { text-shadow: 0 1px 10px rgb(0 0 0 / 0.5); }
.staff-pass__logo { position: relative; z-index: 1; display: block; max-height: 52px; max-width: 70%; object-fit: contain; }
.staff-pass__logo[data-plate=true] { padding: 6px 12px; border-radius: 10px; box-sizing: content-box; max-height: 40px; }
.staff-pass__words { padding: 16px 22px 0; text-align: center; }
.staff-pass__headline {
  margin: 0; text-wrap: balance; overflow-wrap: anywhere;
  font-family: var(--font-guest-display); font-weight: 600; line-height: 1.06;
  font-size: clamp(25px, 8.4cqw, 33px); letter-spacing: -0.01em;
}
.staff-pass__sub { margin: 4px 0 0; font-family: var(--font-guest-body); font-size: 15.5px; color: var(--staff-soft); }
.staff-pass__slot { display: flex; justify-content: center; padding: 6px 0 4px; }
.staff-pass__code { display: block; width: min(100%, calc(100cqh - var(--pass-chrome) - var(--pass-switch, 0px))); aspect-ratio: 1; image-rendering: pixelated; }
.staff-pass__code[data-slot=skeleton] { clip-path: inset(11% round 8px); }
.staff-pass__bone { width: 62%; height: 33px; margin-inline: auto; }
.staff-pass__bone[data-short] { width: 38%; height: 16px; margin-top: 8px; }
.staff-pass__note { padding: 40px 24px 44px; text-align: center; font-family: var(--font-guest-body); font-size: 17px; }
.staff-pass__cue {
  margin: 0; padding: 12px 16px 13px; text-align: center;
  font-family: var(--font-guest-body); font-weight: 600; font-size: 15px;
  background: var(--staff-band); color: var(--staff-on-band);
}
/* Sideways: a two-part ticket. The hotel's colour or photo holds the words; the code
   stays on its paper, as tall as the screen allows. */
@container (max-height: 500px) and (min-width: 560px) {
  .staff-code { padding: 8px 18px; }
  .staff-pass {
    display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: auto 1fr auto;
    max-width: 680px; border-radius: 20px;
    background: var(--staff-band); color: var(--staff-on-band);
  }
  .staff-pass[data-photo=true] { background: var(--staff-field); color: var(--staff-paper); }
  .staff-pass__head { grid-area: 1 / 1 / 4 / 2; align-items: flex-start; min-height: 0; padding: 18px 22px 0; }
  .staff-pass[data-photo=true] .staff-pass__head { min-height: 0; align-items: flex-start; padding-bottom: 0; }
  .staff-pass[data-photo=true] .staff-pass__head::after {
    background: linear-gradient(180deg, rgb(0 0 0 / 0.62) 0%, rgb(0 0 0 / 0.62) 60%, rgb(0 0 0 / 0.78) 100%);
  }
  .staff-pass__name, .staff-pass__name[data-long=true] { font-size: 17px; font-weight: 500; }
  .staff-pass[data-photo=true] .staff-pass__words, .staff-pass[data-photo=true] .staff-pass__cue { text-shadow: 0 1px 12px rgb(0 0 0 / 0.6); }
  .staff-pass__logo { max-height: 36px; }
  .staff-pass__words { grid-area: 2 / 1; position: relative; z-index: 1; align-self: center; padding: 8px 22px; }
  .staff-pass__headline { font-size: 32px; }
  .staff-pass__sub { color: inherit; }
  .staff-pass__cue { grid-area: 3 / 1; position: relative; z-index: 1; padding: 0 22px 18px; background: transparent; color: inherit; font-size: 14px; }
  .staff-pass__slot { grid-area: 1 / 2 / 4 / 3; padding: 0; background: var(--staff-paper); }
  .staff-pass__code { width: calc(100cqh - 84px - var(--pass-switch, 0px)); }
  .staff-pass__note { grid-area: 1 / 2 / 4 / 3; max-width: 280px; padding: 20px; align-self: stretch; display: flex; flex-direction: column; justify-content: center; align-items: center; background: var(--staff-paper); color: var(--staff-ink); }
  .staff-phone [data-slot=tabs-trigger] { flex-direction: row; gap: 8px; padding-block: 5px; font-size: 12px; }
  .staff-phone [data-slot=tabs-trigger] svg { width: 20px; height: 20px; }
}

.staff-results { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 560px; margin-inline: auto; padding: 14px 20px 24px; }
.staff-results__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.staff-results__title { margin: 0; font-size: 30px; line-height: 1.15; font-weight: 700; letter-spacing: -0.02em; }
.staff-results__controls { display: flex; flex-wrap: wrap; gap: 8px; }
.staff-results [data-slot=staff-goal] [role=progressbar] > * { background: var(--primary); }

.staff-step { display: flex; flex-direction: column; height: 100%; width: 100%; max-width: 480px; margin-inline: auto; overflow-y: auto; padding: 20px 24px calc(14px + env(safe-area-inset-bottom)); }
.staff-step__title { margin: 0; font-size: 30px; line-height: 1.12; font-weight: 700; letter-spacing: -0.02em; text-wrap: balance; }
.staff-step__list { list-style: none; margin: 24px 0 auto; padding: 0; display: flex; flex-direction: column; gap: 18px; }
.staff-step__list li { display: flex; gap: 14px; align-items: flex-start; font-size: 16px; line-height: 1.42; }
.staff-step__glyph { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--border); background: var(--muted); color: var(--muted-foreground); }
.staff-step__glyph svg { width: 17px; height: 17px; }
.staff-step__foot { display: flex; flex-direction: column; align-items: center; align-self: stretch; gap: 6px; padding-top: 24px; }
.staff-step__foot [data-slot=button] { width: 100%; height: 52px; border-radius: 14px; font-size: 16px; font-weight: 600; }
.staff-step__foot a { display: inline-flex; align-items: center; min-height: 44px; }
.staff-step--center { text-align: center; align-items: center; }
.staff-step__app { display: flex; flex-direction: column; align-items: center; gap: 8px; margin: auto 0 22px; font-size: 13px; font-weight: 500; color: var(--muted-foreground); }
.staff-step__app img { width: 92px; height: 92px; border-radius: 21px; box-shadow: 0 14px 34px rgb(0 0 0 / 0.35); }
.staff-step__steps { list-style: none; align-self: stretch; margin: 24px 0 auto; padding: 0; border: 1px solid var(--border); border-radius: 16px; background: var(--card); text-align: left; }
.staff-step__steps li { display: flex; align-items: center; gap: 12px; padding: 14px 16px; font-size: 16px; }
.staff-step__steps li + li { border-top: 1px solid var(--border); }
.staff-step__steps svg { display: inline; width: 18px; height: 18px; vertical-align: -3px; }
.staff-step__num { flex: none; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--border); background: var(--muted); font-size: 13px; font-weight: 700; color: var(--muted-foreground); }
.staff-message { margin: auto; padding: 24px; text-align: center; }
`
