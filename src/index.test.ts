import { describe, expect, test } from "bun:test";
import { createApp } from "./index";

// T-04, T-05, T-06, T-07 — see specs/001-server-skeleton/design.md → Test cases.
// createApp takes the parsed env as an argument (never touches process.env), so
// every test here builds its own app from a literal test secret.

const secret = "a".repeat(32);
const wrongSecret = "b".repeat(32);
const testEnv = { MCP_SECRET_PATH: secret, PORT: 3000 };

describe("GET /health", () => {
	test("T-04: is cheap and public — 200, and makes no outbound fetch", async () => {
		const app = createApp(testEnv);
		const originalFetch = globalThis.fetch;
		let fetchWasCalled = false;
		// `typeof fetch` is a call signature plus a `preconnect` static method (Bun-specific).
		// Object.assign carries the real `preconnect` across so the stand-in structurally
		// satisfies `typeof fetch` with no cast — the throwing body is still exactly what
		// gets called and asserted on below.
		globalThis.fetch = Object.assign(
			() => {
				fetchWasCalled = true;
				throw new Error("GET /health must not perform any outbound fetch");
			},
			{ preconnect: originalFetch.preconnect },
		);

		try {
			const response = await app.handle(new Request("http://localhost/health"));
			expect(response.status).toBe(200);
		} finally {
			globalThis.fetch = originalFetch;
		}

		expect(fetchWasCalled).toBe(false);
	});
});

describe("GET /{secret}/health", () => {
	test("T-05: deep health is reachable behind the secret and returns a checks object", async () => {
		const app = createApp(testEnv);

		const response = await app.handle(
			new Request(`http://localhost/${secret}/health`),
		);
		expect(response.status).toBe(200);

		// response.json() resolves to `unknown` under this toolchain — a decoded body
		// genuinely has no shape until something narrows it. The guard below *is* the
		// assertion that `checks` is an object; the expect()s just make that assertion
		// visible in test output instead of failing silently via a thrown TypeError.
		const body = await response.json();
		if (typeof body !== "object" || body === null || !("checks" in body)) {
			throw new Error("expected response body to have a checks property");
		}
		expect(typeof body.checks).toBe("object");
		expect(body.checks).not.toBeNull();
		if (typeof body.checks !== "object" || body.checks === null) {
			throw new Error("expected checks to be an object");
		}
		// This slice has no checks to run yet — design.md says empty is correct here.
		expect(Object.keys(body.checks)).toEqual([]);
	});
});

describe("the secret path is not an oracle", () => {
	test("T-06: a wrong secret is byte-identical to an unknown route", async () => {
		const app = createApp(testEnv);

		const wrongSecretResponse = await app.handle(
			new Request(`http://localhost/${wrongSecret}/health`),
		);
		const unknownRouteResponse = await app.handle(
			new Request("http://localhost/nonsense"),
		);

		expect(wrongSecretResponse.status).toBe(unknownRouteResponse.status);
		expect(wrongSecretResponse.status).toBe(404);

		const wrongSecretBody = await wrongSecretResponse.text();
		const unknownRouteBody = await unknownRouteResponse.text();
		expect(wrongSecretBody).toBe(unknownRouteBody);

		expect(wrongSecretResponse.headers.get("content-type")).toBe(
			unknownRouteResponse.headers.get("content-type"),
		);
	});

	test("T-07: root reveals nothing — identical to an unknown route", async () => {
		const app = createApp(testEnv);

		const rootResponse = await app.handle(new Request("http://localhost/"));
		const unknownRouteResponse = await app.handle(
			new Request("http://localhost/some-typo-path"),
		);

		expect(rootResponse.status).toBe(unknownRouteResponse.status);
		expect(rootResponse.status).toBe(404);

		const rootBody = await rootResponse.text();
		const unknownRouteBody = await unknownRouteResponse.text();
		expect(rootBody).toBe(unknownRouteBody);

		expect(rootResponse.headers.get("content-type")).toBe(
			unknownRouteResponse.headers.get("content-type"),
		);
	});
});
