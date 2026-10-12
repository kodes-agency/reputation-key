// The stylesheet of "Your response" (board G07), appended to the response
// area's own (`immersive-response-styles.ts`) so the guest page still hoists one
// element. Closed, the section is one 58 px row; open it lists its rows. Text
// that only has to stay readable over the photo uses white at 0.76 or more,
// above the 0.7 floor `immersive-look.test.ts` holds for any field.

export const IMMERSIVE_SECTION_CSS = `
/* "Your response": one collapsible section. Closed it is a single 58 px row. */
.ih-yr {
  box-sizing: border-box;
  padding: 0 16px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.06);
}
.ih-yr[data-open="false"] { border-color: rgba(255, 255, 255, 0.13); background: rgba(255, 255, 255, 0.05); }
.ih-yr__heading { margin: 0; font: inherit; }
.ih-yr__toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  box-sizing: border-box;
  width: 100%;
  min-height: 58px;
  padding: 0 2px;
  border: 0;
  border-radius: 18px;
  background: transparent;
  font: inherit;
  color: var(--ih-text);
  text-align: start;
  cursor: pointer;
}
.ih-yr__toggle:focus-visible,
.ih-yr__button:focus-visible,
.ih-yr__start-over:focus-visible { outline: 2px solid var(--ih-accent-text); outline-offset: 3px; }
.ih-yr__labels { display: flex; flex-direction: column; }
.ih-yr__title { font-size: 15px; font-weight: 600; line-height: 20px; }
.ih-yr__summary { font-size: 13px; line-height: 18px; color: rgba(255, 255, 255, 0.76); }
.ih-yr__chevron { flex: none; transition: transform 150ms ease-out; }
.ih-yr__toggle[aria-expanded="true"] .ih-yr__chevron { transform: rotate(180deg); }
.ih-yr__body { padding-bottom: 14px; border-top: 1px solid rgba(255, 255, 255, 0.12); }
.ih-yr__body > .ih-banner { margin-top: 12px; }
.ih-yr__notice {
  margin: 12px 0 0;
  padding: 10px 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 15px;
  line-height: 1.35;
}
.ih-yr__notice:focus { outline: none; }
.ih-yr__rows { margin: 0; padding: 0; list-style: none; }
.ih-yr__row { padding: 10px 2px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
.ih-yr__row-main { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ih-yr__row-text { min-width: 0; }
.ih-yr__row-title { margin: 0; font-size: 15px; font-weight: 600; line-height: 20px; }
.ih-yr__detail { margin: 2px 0 0; font-size: 13px; line-height: 18px; color: rgba(255, 255, 255, 0.76); }
.ih-yr .ih-yr__button { flex: none; width: auto; min-height: 44px; padding: 0 16px; font-size: 14px; }
.ih-yr__change { padding: 12px 0 4px; }
.ih-yr__confirm {
  margin-top: 10px;
  padding: 14px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 18px;
  background: rgba(8, 10, 9, 0.28);
}
.ih-yr__confirm-title { margin: 0; font-size: 16px; font-weight: 600; line-height: 22px; }
.ih-yr__confirm-title:focus { outline: none; }
.ih-yr__confirm-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.ih-yr__device { padding: 12px 2px 0; }
.ih-yr .ih-yr__start-over { width: 100%; min-height: 44px; margin-top: 10px; font-size: 14px; }
.ih-removed { margin-top: 14px; padding: 0 4px; text-align: center; }
.ih-removed > .ih-banner { margin: 0 0 12px; text-align: start; }
.ih-removed .ih-yr__detail { margin-top: 4px; }
.ih-removed .ih-removed__start-over { width: 100%; min-height: 44px; margin-top: 12px; font-size: 14px; }
.ih-removed__start-over:focus-visible { outline: 2px solid var(--ih-accent-text); outline-offset: 3px; }
.ih-yr__ready { margin: 0; padding: 10px 14px; border-radius: 14px; background: rgba(255, 255, 255, 0.08); text-align: center; font-size: 15px; }

@media (prefers-reduced-motion: reduce) {
  .ih-yr__chevron { transition: none; }
}
`
