/**
 * Load / save the CLI's `config.json` (endpoint + authority + clientId +
 * apiScope).
 *
 * Resolution order for each field: `TOKEN_TRACKER_*` env var, then the value
 * in `config.json`. Returns `undefined` from `loadCliConfig` if any field is
 * still missing — callers (the extension; the CLI for non-`login` commands)
 * treat that as "not configured".
 */

import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { configFilePath } from "./paths.js";
import type { CliConfig } from "./types.js";

const FIELDS = ["endpoint", "authority", "clientId", "apiScope"] as const;

const ENV_KEYS: Record<(typeof FIELDS)[number], string> = {
	endpoint: "TOKEN_TRACKER_ENDPOINT",
	authority: "TOKEN_TRACKER_AUTHORITY",
	clientId: "TOKEN_TRACKER_CLIENT_ID",
	apiScope: "TOKEN_TRACKER_API_SCOPE",
};

function readConfigFile(env: NodeJS.ProcessEnv): Record<string, string> {
	let raw: string;
	try {
		raw = readFileSync(configFilePath(env), "utf8");
	} catch {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return {};
		const o = parsed as Record<string, unknown>;
		const out: Record<string, string> = {};
		for (const key of FIELDS) {
			const v = o[key];
			if (typeof v === "string" && v.length > 0) out[key] = v;
		}
		return out;
	} catch {
		return {};
	}
}

export function loadCliConfig(env: NodeJS.ProcessEnv = process.env): CliConfig | undefined {
	const file = readConfigFile(env);
	const merged: Record<string, string> = {};
	for (const key of FIELDS) {
		const fromEnv = env[ENV_KEYS[key]];
		const value = fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : file[key];
		if (value !== undefined && value.length > 0) merged[key] = value.replace(/\/+$/, "");
	}
	const { endpoint, authority, clientId, apiScope } = merged;
	if (endpoint === undefined || authority === undefined || clientId === undefined || apiScope === undefined) {
		return undefined;
	}
	return { endpoint, authority, clientId, apiScope };
}

export function saveCliConfig(config: CliConfig, env: NodeJS.ProcessEnv = process.env): void {
	const path = configFilePath(env);
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const tmp = `${path}.${process.pid}.tmp`;
	const body = `${JSON.stringify(config, null, 2)}\n`;
	const fd = openSync(tmp, "w", 0o600);
	try {
		writeSync(fd, body);
	} finally {
		closeSync(fd);
	}
	try {
		renameSync(tmp, path);
	} catch (err) {
		try {
			rmSync(tmp, { force: true });
		} catch {
			// ignore cleanup failure
		}
		throw err;
	}
}
