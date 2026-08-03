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
	"type",
	"properties",
	"required",
	"additionalProperties",
]);

const propertyKeywords = new Set(["type"]);

// The `type` values in use across both live documents.
const typeCheckers: Record<string, (value: unknown) => boolean> = {
	string: (value) => typeof value === "string",
	array: (value) => Array.isArray(value),
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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

		for (const keyword of Object.keys(subschema)) {
			if (!propertyKeywords.has(keyword)) {
				errors.push(
					`The schema constrains \`${field}\` with \`${keyword}\`, which this validator does not implement. It cannot confirm \`${field}\` is valid.`,
				);
			}
		}

		// An absent optional field is not a type error. Whether it is allowed to
		// be absent was already settled by `required` above.
		const value = metadata[field];
		if (value === undefined) continue;

		const expected = subschema.type;
		if (typeof expected !== "string") continue;

		const checker = typeCheckers[expected];
		if (!checker) {
			errors.push(
				`The schema wants \`${field}\` to be type \`${expected}\`, which this validator does not implement.`,
			);
			continue;
		}

		if (!checker(value)) {
			errors.push(`\`${field}\` must be ${expected}.`);
		}
	}

	return errors;
}
