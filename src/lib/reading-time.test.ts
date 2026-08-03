import { describe, expect, test } from "bun:test";
import { readingTime } from "./reading-time";

// T-13, T-14, T-15 — see specs/005-publish/design.md → Test cases → Slice 1.
//
// readingTime is Math.ceil(words / 200), formatted "{n} min", where words are
// whitespace-separated runs. A body of zero or very few words returns
// "1 min", never "0 min" — the schema requires minLength: 1 so "0 min" would
// pass validation and ship nonsense.

describe("readingTime", () => {
	test("T-13: a 200-word body is '1 min'", () => {
		const body = Array.from({ length: 200 }, () => "word").join(" ");

		expect(readingTime(body)).toBe("1 min");
	});

	test("T-14: a 201-word body rounds up to '2 min'", () => {
		const body = Array.from({ length: 201 }, () => "word").join(" ");

		expect(readingTime(body)).toBe("2 min");
	});

	test("T-15: an empty body is '1 min', never '0 min'", () => {
		expect(readingTime("")).toBe("1 min");
	});
});
