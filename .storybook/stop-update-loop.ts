// React reports a component that keeps re-rendering itself from useEffect only
// through console.error. The console gate in vitest.setup.ts records that and
// fails the story afterwards, but "afterwards" never comes when the page is
// spinning: Storybook wraps every user-event dispatch, and the first render, in
// React's act(), and act drains the work it is given in one synchronous loop.
// An effect that schedules another render every time it runs keeps that loop
// going for ever, so no timer fires, Vitest's test timeout among them, and the
// storybook-test job hangs until CI kills it.
//
// Throwing from the warning raises an error inside the effect instead. React
// drops the component that threw, which ends the loop, and the console gate
// then fails the story within a fraction of a second, with the warning and the
// component's own stack.
const UPDATE_LOOP_WARNING = 'Maximum update depth exceeded'

/** Throws when a console.error call carries React's update-loop warning. */
export function stopUpdateLoop(args: readonly unknown[]): void {
  const [message] = args
  if (typeof message === 'string' && message.startsWith(UPDATE_LOOP_WARNING)) {
    throw new Error(message)
  }
}
