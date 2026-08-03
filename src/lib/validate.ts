// The schema interpreter. Pure: a schema document and a metadata object in, a
// list of error strings out. No fetch, no throw, no dependency.
//
// Purpose:            check a draft's metadata against the site's own live
//                     `api/schema.json` before anything is written to the
//                     public repo.
// Non-responsibilities: no MDX parse (ADR-005 decision 2), no `show`/`order`
//                     (absent from the write schema by design — they are
//                     attached after this runs), no network.
//
// Why not a JSON Schema library: the two live documents use ten keywords
// between them, with no `$ref`, no composition and no nesting past one array
// of strings. ADR-005 decision 1 weighed a dependency against ~60 lines and
// chose the lines. Adding `ajv` here needs a new ADR.
//
// **The rule that makes this safe: an unrecognised keyword is an error.**
// Never a skip, never "assume satisfied". A partial validator that silently
// ignores what it does not understand is worse than no validator, because it
// manufactures confidence — the schema layer becomes theatre and an invalid
// post ships looking checked. If the site adds a keyword, publishing fails
// loudly and someone teaches this file about it.
//
// Every error is collected rather than returning the first. A model that
// fixes one field per turn costs four round trips on a new writing.

// Keywords this interpreter implements, and therefore the ones it will not
// refuse. Anything outside these sets is an error by the rule above.
const documentKeywords = new Set([
	// `$schema` names the dialect. It is an annotation, not a constraint, so
	// recognising it satisfies nothing and hides nothing — the distinction
	// matters, because every other entry in this set is a rule that gets
	// checked below. Both live documents carry it (Zod's `toJSONSchema` always
	// emits it), and refusing it made the interpreter reject every real post.
	"$schema",
	"type",
	"properties",
	"required",
	"additionalProperties",
]);

const propertyKeywords = new Set([
	"type",
	"minLength",
	"enum",
	"pattern",
	"format",
	"minItems",
	"items",
]);

// `items` in the live schema is a single subschema describing a scalar —
// `{ type: "string", minLength: 1 }`. The scalar constraints are allowed
// inside it; the collection ones are not, so `items.items` and
// `items.minItems` are still refused. That is what "no nesting past one
// array of strings" means in practice.
const itemsKeywords = new Set([
	"type",
	"minLength",
	"enum",
	"pattern",
	"format",
]);

// The `type` values in use across both live documents.
const typeCheckers: Record<string, (value: unknown) => boolean> = {
	string: (value) => typeof value === "string",
	array: (value) => Array.isArray(value),
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// `format` has exactly one real implementation.
//
// `uri` is checked with the platform's own URL parser — no dependency, and no
// second opinion about what a URL is.
//
// **`date` is accepted as satisfied on purpose, and that is not an oversight.**
// The live schema puts a full `pattern` beside it on `writing.date` which is
// strictly stronger than any date check this file would write, so `pattern`
// below is what actually rejects `2026-13-45` (T-07 proves it). A second date
// parser here could disagree with the site's own regex and produce a refusal
// nobody can explain.
//
// The cost, stated so it is visible: if the site ever drops that `pattern` and
// keeps only `format: "date"`, dates stop being checked and nothing detects it
// (design.md → Risks). Any format value other than these two is still an
// error, by the same rule as an unknown keyword.
function checkFormat(field: string, format: string, value: string): string[] {
	if (format === "date") return [];

	if (format === "uri") {
		try {
			new URL(value);
			return [];
		} catch {
			return [`\`${field}\` must be a URL.`];
		}
	}

	return [
		`The schema wants \`${field}\` to be format \`${format}\`, which this validator does not implement.`,
	];
}

// Which keywords a subschema uses, checked against what this file implements.
// Runs on the schema alone — it never looks at the metadata, which is the
// point: recognition cannot depend on whether a draft filled the field in.
function checkSchemaKeywords(
	field: string,
	subschema: Record<string, unknown>,
): string[] {
	const errors: string[] = [];

	for (const keyword of Object.keys(subschema)) {
		if (!propertyKeywords.has(keyword)) {
			errors.push(
				`The schema constrains \`${field}\` with \`${keyword}\`, which this validator does not implement. It cannot confirm \`${field}\` is valid.`,
			);
		}
	}

	if (isObject(subschema.items)) {
		for (const keyword of Object.keys(subschema.items)) {
			if (!itemsKeywords.has(keyword)) {
				errors.push(
					`The schema constrains the items of \`${field}\` with \`${keyword}\`, which this validator does not implement.`,
				);
			}
		}
	}

	return errors;
}

// The constraint keywords, for one field whose `type` already matched.
function checkConstraints(
	field: string,
	subschema: Record<string, unknown>,
	value: unknown,
): string[] {
	const errors: string[] = [];

	if (Array.isArray(subschema.enum) && !subschema.enum.includes(value)) {
		// The allowed values are listed because the model is being told what to
		// write next, not just that it was wrong.
		errors.push(`\`${field}\` must be one of: ${subschema.enum.join(", ")}.`);
	}

	if (typeof value === "string") {
		if (
			typeof subschema.minLength === "number" &&
			value.length < subschema.minLength
		) {
			errors.push(
				`\`${field}\` must be at least ${subschema.minLength} character${subschema.minLength === 1 ? "" : "s"} long.`,
			);
		}

		if (
			typeof subschema.pattern === "string" &&
			!new RegExp(subschema.pattern).test(value)
		) {
			errors.push(`\`${field}\` is not in the format the site expects.`);
		}

		if (typeof subschema.format === "string") {
			errors.push(...checkFormat(field, subschema.format, value));
		}
	}

	if (Array.isArray(value)) {
		if (
			typeof subschema.minItems === "number" &&
			value.length < subschema.minItems
		) {
			errors.push(
				`\`${field}\` must have at least ${subschema.minItems} item${subschema.minItems === 1 ? "" : "s"}.`,
			);
		}

		// Keyword recognition for `items` is NOT done here — it lives in
		// checkSchemaKeywords, which runs whether or not the array is present.
		if (isObject(subschema.items)) {
			const expected = subschema.items.type;
			if (typeof expected === "string") {
				const checker = typeCheckers[expected];
				if (!checker) {
					errors.push(
						`The schema wants the items of \`${field}\` to be type \`${expected}\`, which this validator does not implement.`,
					);
				} else if (!value.every(checker)) {
					errors.push(`Every item in \`${field}\` must be ${expected}.`);
				} else {
					// The elements are the right type, so the scalar constraints on
					// them are worth checking. Deduped: one message per violated
					// constraint, not one per offending element — a ten-item stack
					// with ten empty strings is one problem, not ten.
					const perItem = new Set<string>();
					for (const element of value) {
						for (const error of checkConstraints(
							`each item in ${field}`,
							subschema.items,
							element,
						)) {
							perItem.add(error);
						}
					}
					errors.push(...perItem);
				}
			}
		}
	}

	return errors;
}

export function validate(
	schema: unknown,
	metadata: Record<string, unknown>,
): string[] {
	if (!isObject(schema)) {
		return ["The site's schema is not an object, so nothing can be checked."];
	}

	const errors: string[] = [];

	for (const keyword of Object.keys(schema)) {
		if (!documentKeywords.has(keyword)) {
			errors.push(
				`The schema uses \`${keyword}\`, which this validator does not implement. It cannot confirm the metadata is valid.`,
			);
		}
	}

	// `type: "object"` at the document level needs no check: `metadata` is a
	// record by the time it reaches here. It is listed as known so it is not
	// refused as unrecognised.
	const properties = isObject(schema.properties) ? schema.properties : {};

	for (const field of Array.isArray(schema.required) ? schema.required : []) {
		if (typeof field === "string" && !(field in metadata)) {
			errors.push(`\`${field}\` is required and is missing.`);
		}
	}

	if (schema.additionalProperties === false) {
		for (const key of Object.keys(metadata)) {
			if (!(key in properties)) {
				errors.push(
					`\`${key}\` is not a field the site's schema allows, and the schema forbids extra fields.`,
				);
			}
		}
	}

	for (const [field, subschema] of Object.entries(properties)) {
		if (!isObject(subschema)) {
			errors.push(`The schema entry for \`${field}\` is not an object.`);
			continue;
		}

		// Keyword recognition first, and unconditionally. What this validator
		// understands is a property of the schema, not of what the draft
		// happens to contain — an unimplemented keyword on an optional field
		// nobody filled in is still a keyword this file cannot honour, and
		// staying quiet about it would be the silent pass the whole design
		// refuses.
		errors.push(...checkSchemaKeywords(field, subschema));

		// An absent optional field is not a type error. Whether it is allowed to
		// be absent was already settled by `required` above.
		const value = metadata[field];
		if (value === undefined) continue;

		const expected = subschema.type;
		if (typeof expected !== "string") {
			// A known keyword in a shape this file cannot act on. Skipping here
			// would silently drop every constraint on the field — a bare
			// `{ enum: [...] }` would be checked against nothing — which is the
			// same failure as ignoring an unknown keyword, wearing a different hat.
			errors.push(
				`The schema does not give \`${field}\` a type this validator can check, so its other constraints cannot be applied.`,
			);
			continue;
		}

		const checker = typeCheckers[expected];
		if (!checker) {
			errors.push(
				`The schema wants \`${field}\` to be type \`${expected}\`, which this validator does not implement.`,
			);
			continue;
		}

		if (!checker(value)) {
			// A wrong type makes every constraint below meaningless — `minLength`
			// on a number would report nothing useful. Report the type and move on.
			errors.push(`\`${field}\` must be ${expected}.`);
			continue;
		}

		errors.push(...checkConstraints(field, subschema, value));
	}

	return errors;
}
