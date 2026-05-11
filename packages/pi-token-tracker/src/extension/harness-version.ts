/**
 * Detect the running pi-mono version.
 *
 * Pi loads our extension via an absolute file path in settings.json. From
 * the extension's location we cannot reliably resolve pi's package.json
 * (the extension may not have pi in its own node_modules tree).
 *
 * Strategy: walk up from `process.argv[1]` (the pi binary entry) looking
 * for the nearest `package.json`. Pi's bin script lives inside its own
 * package, so the first package.json we find is pi's. Try both supported
 * scopes' shape via the package's "name" field.
 *
 * Falls back to "unknown" if not found.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

const KNOWN_PI_NAMES = ["@earendil-works/pi-coding-agent", "@mariozechner/pi-coding-agent"];

export function detectHarnessVersion(): string {
	const start = process.argv[1];
	if (start === undefined) return "unknown";

	// process.argv[1] is typically a symlink (npm puts a wrapper script in
	// node/bin pointing at .../node_modules/<pkg>/dist/cli.js). Resolve it
	// so we can walk up to the actual package directory.
	let realStart: string;
	try {
		realStart = realpathSync(start);
	} catch {
		realStart = start;
	}

	let dir = dirname(realStart);
	for (let i = 0; i < 8; i++) {
		const pkgPath = join(dir, "package.json");
		if (existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
					name?: unknown;
					version?: unknown;
				};
				if (typeof pkg.name === "string" && KNOWN_PI_NAMES.includes(pkg.name) && typeof pkg.version === "string") {
					return pkg.version;
				}
			} catch {
				// Unreadable / malformed; keep walking up.
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	return "unknown";
}
