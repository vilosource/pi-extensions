/**
 * Minimal zero-dependency argv parser for the `token-tracker` CLI.
 *
 * Supports `--key=value`, `--key value`, and bare `--flag` (boolean).
 * The first non-flag token is the subcommand; remaining non-flag tokens
 * are positionals.
 */

export interface ParsedArgs {
	readonly command: string | undefined;
	readonly positionals: readonly string[];
	readonly flags: ReadonlyMap<string, string | true>;
}

const VALUE_FLAGS = new Set(["endpoint", "authority", "client-id", "api-scope", "pi-settings"]);

export function parseArgs(argv: readonly string[]): ParsedArgs {
	const positionals: string[] = [];
	const flags = new Map<string, string | true>();
	let command: string | undefined;

	for (let i = 0; i < argv.length; i++) {
		const tok = argv[i];
		if (tok === undefined) continue;
		if (tok.startsWith("--")) {
			const body = tok.slice(2);
			const eq = body.indexOf("=");
			if (eq >= 0) {
				flags.set(body.slice(0, eq), body.slice(eq + 1));
				continue;
			}
			const next = argv[i + 1];
			if (VALUE_FLAGS.has(body) && next !== undefined && !next.startsWith("--")) {
				flags.set(body, next);
				i++;
			} else {
				flags.set(body, true);
			}
			continue;
		}
		if (command === undefined) command = tok;
		else positionals.push(tok);
	}

	return { command, positionals, flags };
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
	const v = args.flags.get(name);
	return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function flagBool(args: ParsedArgs, name: string): boolean {
	return args.flags.has(name);
}
