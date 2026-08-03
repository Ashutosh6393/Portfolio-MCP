import { describe, expect, test } from "bun:test";
import { createApp } from "./index";
import type { Github, Repo } from "./lib/github";
import type { Site } from "./lib/site";

// T-04, T-05, T-06, T-07 — see specs/001-server-skeleton/design.md → Test cases.
// createApp takes the parsed env as an argument (never touches process.env), so
// every test here builds its own app from a literal test secret.

const secret = "a".repeat(32);
const wrongSecret = "b".repeat(32);
// Test revision, 2026-07-31 — see Test revisions table in
// specs/002-github-access/implementation.md. Spec 002 Task 1 adds GITHUB_TOKEN
// to Env, so an environment without it no longer type-checks. Never a real
// token (.claude/rules/security.md); no route below reads its value.
const testEnv = {
	MCP_SECRET_PATH: secret,
	GITHUB_TOKEN: `github_pat_${"x".repeat(22)}`,
	PORT: 3000,
};

// Test revision, 2026-07-31 — see Test revisions table in implementation.md.
// `createApp`'s `deps` parameter is now required. T-04..T-07 were written when
// createApp took one argument; they now pass this fake explicitly so no test in
// this file can silently fall back to the real site singleton.
// Test revision, 2026-08-03 — see Test revisions table in
// specs/005-publish/implementation.md. Task 4 widens `Site` with
// `fetchSchema`, so every fake must carry it to typecheck. Nothing in this
// file reaches the publish path, so this throws rather than return a
// plausible value: an accidental call fails loudly instead of passing
// silently.
const fakeSite: Site = {
	async fetchContent() {
		return [];
	},
	async fetchSchema(): Promise<never> {
		throw new Error("fetchSchema is not part of this test");
	},
};

// Test revision, 2026-07-31 — see Test revisions table in
// specs/002-github-access/implementation.md. Spec 002 Task 2 adds `github` to
// createApp's deps, so every call below passes `testDeps` instead of a bare
// `{ site }`. Same reason spec 001 made `deps` required: forgetting to inject
// is a compile error, never a live call to api.github.com from a test run.
// Test revision, 2026-08-02 — see Test revisions table in
// specs/004-drafts/implementation.md. Spec 004 Task 2 widens `Github` with
// readFileWithSha, writeFile and deleteFile, so every fake must carry them to
// typecheck. Nothing in this file reaches the write path, so these throw rather
// than return a plausible value: an accidental call fails loudly instead of
// passing silently.
const noWritePath = {
	async readFileWithSha(): Promise<never> {
		throw new Error("readFileWithSha is not part of this test");
	},
	async writeFile(): Promise<never> {
		throw new Error("writeFile is not part of this test");
	},
	async deleteFile(): Promise<never> {
		throw new Error("deleteFile is not part of this test");
	},
};

const fakeGithub: Github = {
	async listDirectory() {
		return [];
	},
	async readFile() {
		return "";
	},
	...noWritePath,
};

const testDeps = { site: fakeSite, github: fakeGithub };

describe("GET /health", () => {
	test("T-04: is cheap and public — 200, and makes no outbound fetch", async () => {
		const app = createApp(testEnv, testDeps);
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
		const app = createApp(testEnv, testDeps);

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
		// Test revision, 2026-07-31 — see Test revisions table in implementation.md.
		// Was `expect(Object.keys(body.checks)).toEqual([])`, correct for Slice 1
		// (design.md Slice 1 acceptance criterion 2). Task 9 adds a real site check,
		// so an empty object is no longer the right answer for this route. T-16 and
		// T-17 own the pass/fail *value* of that check; this test only confirms the
		// check now exists.
		expect(Object.keys(body.checks)).toContain("site");
	});

	test("T-16: site reachable — 200, checks.site is ok", async () => {
		const app = createApp(testEnv, testDeps);

		const response = await app.handle(
			new Request(`http://localhost/${secret}/health`),
		);
		expect(response.status).toBe(200);

		const body = await response.json();
		if (typeof body !== "object" || body === null || !("checks" in body)) {
			throw new Error("expected response body to have a checks property");
		}
		const { checks } = body;
		if (typeof checks !== "object" || checks === null || !("site" in checks)) {
			throw new Error("expected checks.site to be present");
		}
		expect(checks.site).toBe("ok");
	});

	test("T-17: site unreachable — 503, body names site as the failed check", async () => {
		const unreachableSite: Site = {
			async fetchContent() {
				throw new Error("simulated site outage");
			},
			async fetchSchema(): Promise<never> {
				throw new Error("fetchSchema is not part of this test");
			},
		};
		const app = createApp(testEnv, { ...testDeps, site: unreachableSite });

		const response = await app.handle(
			new Request(`http://localhost/${secret}/health`),
		);
		expect(response.status).toBe(503);

		const body = await response.json();
		if (typeof body !== "object" || body === null || !("checks" in body)) {
			throw new Error("expected response body to have a checks property");
		}
		const { checks } = body;
		if (typeof checks !== "object" || checks === null || !("site" in checks)) {
			throw new Error("expected checks.site to be present");
		}
		expect(checks.site).not.toBe("ok");
	});
});

// 002-T-04, 002-T-05, 002-T-06 — see specs/002-github-access/design.md → Test
// cases. Prefixed because spec 001 already owns T-04…T-07 in this file.
//
// design.md → API surface: the github check is one entry, not two. It is "ok"
// only when *both* repos are reachable — checking portfolio matters even though
// no tool reads it this slice, because a token scoped to only one repo is the
// most likely P-2 mistake and this is what catches it.

// Reads the `checks` object off a deep-health response. The narrowing guards are
// the assertion that the body has the right shape; response.json() is `unknown`
// under this toolchain, exactly as spec 001's tests above already handle.
async function readChecks(response: Response) {
	const body = await response.json();
	if (typeof body !== "object" || body === null || !("checks" in body)) {
		throw new Error("expected response body to have a checks property");
	}
	const { checks } = body;
	if (typeof checks !== "object" || checks === null) {
		throw new Error("expected checks to be an object");
	}
	return checks as Record<string, unknown>;
}

describe("GET /{secret}/health — the github check", () => {
	test("002-T-04: both repos reachable — 200, checks.github is ok and checks.site still is too", async () => {
		const app = createApp(testEnv, testDeps);

		const response = await app.handle(
			new Request(`http://localhost/${secret}/health`),
		);
		expect(response.status).toBe(200);

		const checks = await readChecks(response);
		expect(checks.github).toBe("ok");
		expect(checks.site).toBe("ok");
	});

	test("002-T-05: github unreachable — 503, checks.github fails and site is untouched", async () => {
		const unreachableGithub: Github = {
			async listDirectory() {
				throw new Error("simulated GitHub outage");
			},
			async readFile() {
				throw new Error("simulated GitHub outage");
			},
			...noWritePath,
		};
		const app = createApp(testEnv, {
			...testDeps,
			github: unreachableGithub,
		});

		const response = await app.handle(
			new Request(`http://localhost/${secret}/health`),
		);
		expect(response.status).toBe(503);

		const checks = await readChecks(response);
		expect(checks.github).toBe("unreachable");
		expect(checks.site).toBe("ok");
	});

	test("002-T-06: one repo reachable is not enough — portfolio failing alone gives 503", async () => {
		const readsWorkshopOnly: Github = {
			async listDirectory(repo: Repo) {
				if (repo === "portfolio") {
					throw new Error("token is not scoped to the site repo");
				}
				return [];
			},
			async readFile() {
				return "";
			},
			...noWritePath,
		};
		const app = createApp(testEnv, {
			...testDeps,
			github: readsWorkshopOnly,
		});

		const response = await app.handle(
			new Request(`http://localhost/${secret}/health`),
		);
		expect(response.status).toBe(503);

		const checks = await readChecks(response);
		expect(checks.github).toBe("unreachable");
	});
});

describe("the secret path is not an oracle", () => {
	test("T-06: a wrong secret is byte-identical to an unknown route", async () => {
		const app = createApp(testEnv, testDeps);

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
		const app = createApp(testEnv, testDeps);

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

// T-08, T-09 — see specs/001-server-skeleton/design.md → Test cases, and → Seams:
// "MCP | A real JSON-RPC body through `app.handle`". Task 8 needs the site
// dependency to build the MCP handler, so `createApp` grows to
// `createApp(env, { site })` — the same `fakeSite` declared above is reused here.

async function postInitialize(app: ReturnType<typeof createApp>, path: string) {
	const response = await app.handle(
		new Request(`http://localhost${path}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "test-client", version: "0.0.0" },
				},
			}),
		}),
	);
	return response;
}

describe("POST /{secret}/mcp", () => {
	test("T-08: a correct secret handshakes and gets back a negotiated protocol version", async () => {
		const app = createApp(testEnv, testDeps);

		const response = await postInitialize(app, `/${secret}/mcp`);
		expect(response.status).toBe(200);

		const text = await response.text();
		const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
		if (!dataLine) {
			throw new Error(`expected an SSE data frame, got: ${text}`);
		}
		const payload = JSON.parse(dataLine.slice("data:".length).trim());

		expect(payload.error).toBeUndefined();
		// Not pinning the exact string: the SDK negotiates this, and pinning it
		// would turn a routine SDK bump into a test revision. A non-empty string
		// is the negotiation happening at all.
		expect(typeof payload.result.protocolVersion).toBe("string");
		expect(payload.result.protocolVersion.length).toBeGreaterThan(0);
	});

	test("T-09: a wrong secret on /mcp is byte-identical to an unknown route", async () => {
		const app = createApp(testEnv, testDeps);

		const wrongSecretResponse = await postInitialize(
			app,
			`/${wrongSecret}/mcp`,
		);
		const unknownRouteResponse = await app.handle(
			new Request("http://localhost/nonsense-mcp-path"),
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
});
