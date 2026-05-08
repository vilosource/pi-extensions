/**
 * Resolve `Identity` from env vars / git config / fallback.
 *
 * Priority (per design §3.6):
 *   1. PI_USAGE_USER_ID env var (explicit override)
 *   2. git config --global user.email
 *   3. ${USER}@${hostname} (last-resort, flagged unverified)
 *
 * Persists a stable per-machine UUID at ~/.config/pi-usage/machine-id.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { dirname, join } from "node:path";

import type { Identity } from "../shared/types.js";

export function resolveIdentity(env: NodeJS.ProcessEnv = process.env): Identity {
	const userId = resolveUserId(env);
	const machineId = resolveMachineId(env);
	return { userId, machineId };
}

function resolveUserId(env: NodeJS.ProcessEnv): string {
	const explicit = env["PI_USAGE_USER_ID"];
	if (explicit !== undefined && explicit.length > 0) return explicit;

	try {
		const out = execFileSync("git", ["config", "--global", "user.email"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (out.length > 0) return out;
	} catch {
		// Git not installed or not configured — fall through to fallback.
	}

	return `${userInfo().username}@${hostname()}`;
}

function resolveMachineId(env: NodeJS.ProcessEnv): string {
	const path = env["PI_USAGE_MACHINE_ID_PATH"] ?? join(env["HOME"] ?? "/tmp", ".config", "pi-usage", "machine-id");

	if (existsSync(path)) {
		try {
			const existing = readFileSync(path, "utf8").trim();
			if (existing.length > 0) return existing;
		} catch {
			// Fall through — file unreadable, regenerate.
		}
	}

	const fresh = randomUUID();
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${fresh}\n`, { mode: 0o600 });
	} catch {
		// Cannot persist — return the UUID anyway; it'll regenerate next run.
	}
	return fresh;
}
