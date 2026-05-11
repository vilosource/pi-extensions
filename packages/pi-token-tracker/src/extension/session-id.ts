/**
 * Resolve the pi session id from disk.
 *
 * Pi exposes no `session.id` on its ExtensionAPI (verified against pi
 * 0.66.1 and @earendil-works/pi-coding-agent main as of 2026-05-08). The
 * session id is, however, the UUID part of the JSONL filename pi creates
 * for the session at `~/.pi/agent/sessions/<encoded-cwd>/<ts>_<uuid>.jsonl`.
 *
 * Strategy: at session_start, encode the cwd the way pi does, list the
 * session directory, and pick the newest *.jsonl file (mtime within the
 * last 30 seconds). Extract the UUID from the filename.
 *
 * Failure mode: if no recent file is found (pi is older than the session
 * directory, race lost, or session directory missing), fall back to a
 * locally-generated UUID. The dashboard cannot then join to pi's JSONL,
 * but the per-session aggregation still works within the dashboard.
 *
 * Pure-ish: reads the filesystem; no writes, no environment access, no
 * network. Excluded from src/shared/ for that reason but uses no global
 * state.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FILENAME_RE = /^\d{4}-\d{2}-\d{2}T[0-9-]+Z_([0-9a-f-]{36})\.jsonl$/;
const RECENT_WINDOW_MS = 30_000;

export interface ResolveSessionIdOptions {
	/** The current working directory pi was launched from. */
	readonly cwd: string;
	/** Override for the pi sessions root. Defaults to ~/.pi/agent/sessions/. */
	readonly sessionsRoot?: string;
	/** Override for "now". Used by tests. */
	readonly now?: number;
}

export function resolveSessionId(opts: ResolveSessionIdOptions): string {
	const sessionsRoot = opts.sessionsRoot ?? join(process.env["HOME"] ?? "/tmp", ".pi", "agent", "sessions");
	const now = opts.now ?? Date.now();

	const dir = join(sessionsRoot, encodeCwd(opts.cwd));
	if (!existsSync(dir)) {
		return randomUUID();
	}

	try {
		const candidates: { id: string; mtime: number }[] = [];
		for (const name of readdirSync(dir)) {
			const m = name.match(FILENAME_RE);
			if (m === null || m[1] === undefined) continue;
			const fullPath = join(dir, name);
			const stat = statSync(fullPath);
			const mtime = stat.mtimeMs;
			if (now - mtime > RECENT_WINDOW_MS) continue;
			candidates.push({ id: m[1], mtime });
		}
		if (candidates.length === 0) {
			return randomUUID();
		}
		candidates.sort((a, b) => b.mtime - a.mtime);
		// Safe: candidates.length > 0 verified above.
		return (candidates[0] as { id: string; mtime: number }).id;
	} catch {
		return randomUUID();
	}
}

/**
 * Encode a working directory the way pi does for session-file paths.
 *
 *   /home/jasonvi/KB/pi-dev → --home-jasonvi-KB-pi-dev--
 *
 * Verified against pi 0.66.1 layout in scripts/cost.ts.
 */
export function encodeCwd(cwd: string): string {
	const normalized = cwd.startsWith("/") ? cwd.slice(1) : cwd;
	return `--${normalized.replace(/\//g, "-")}--`;
}
