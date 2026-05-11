/**
 * Filesystem locations for the CLI's persisted state.
 *
 * Honours `$XDG_CONFIG_HOME`; falls back to `$HOME/.config`. Tests can
 * override the base directory by passing `env` with `TOKEN_TRACKER_CONFIG_DIR`
 * set to a temp directory.
 */

import { join } from "node:path";

const APP_DIR = "token-tracker";

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
	const override = env["TOKEN_TRACKER_CONFIG_DIR"];
	if (override !== undefined && override.length > 0) return override;
	const xdg = env["XDG_CONFIG_HOME"];
	const base = xdg !== undefined && xdg.length > 0 ? xdg : join(env["HOME"] ?? "/tmp", ".config");
	return join(base, APP_DIR);
}

export function configFilePath(env: NodeJS.ProcessEnv = process.env): string {
	return join(configDir(env), "config.json");
}

export function authFilePath(env: NodeJS.ProcessEnv = process.env): string {
	return join(configDir(env), "auth.json");
}

export function machineIdFilePath(env: NodeJS.ProcessEnv = process.env): string {
	return join(configDir(env), "machine-id");
}
