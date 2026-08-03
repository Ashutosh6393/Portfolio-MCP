// The byline estimate. One pure function, no network, no state.
//
// Purpose:            turn a body into the `readingTime` string the site's
//                     schema requires — `{n} min`, matching the live posts.
// Non-responsibilities: no MDX parse. Code fences, JSX and import lines are
//                     counted as words on purpose. Stripping them would be a
//                     second parser, which is the thing ADR-005 spent a
//                     decision avoiding, and the consumer of this number is a
//                     human glancing at a byline, not a scheduler.
//
// 200 words a minute is the conventional figure. It is not tuned and nothing
// downstream depends on its accuracy.

export function readingTime(body: string): string {
	// Whitespace-separated runs. `filter(Boolean)` is what makes an empty or
	// whitespace-only body count 0 rather than 1 — `"".split(/\s+/)` is `[""]`.
	const words = body.split(/\s+/).filter(Boolean).length;
	// The floor of one minute is the only rule here that is not arithmetic.
	// The site's schema requires `minLength: 1`, so `"0 min"` would validate
	// cleanly and ship a nonsense value to a reader (design.md → Open questions).
	const minutes = Math.max(1, Math.ceil(words / 200));
	return `${minutes} min`;
}
