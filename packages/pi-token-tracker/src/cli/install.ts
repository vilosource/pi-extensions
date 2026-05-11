/**
 * `token-tracker install` / `uninstall` — register (or remove) this
 * package's pi-extension directory in pi's `settings.json` (`extensions`
 * array). Idempotent; preserves any other extensions and the rest of the
 * file; creates the file if it doesn't exist yet.
 *
 * The default settings path is `~/.pi/agent/settings.json` (pi-mono's
 * layout); override with `--pi-settings=<path>` or `$TOKEN_TRACKER_PI_SETTINGS`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type Logger = (line: string) => void;

interface PiSettingsState {
	readonly settings: Record<string, unknown>;
	readonly existed: boolean;
}

function readSettings(path: string): PiSettingsState {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return { settings: {}, existed: false };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`pi settings file is not valid JSON: ${path}`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(`pi settings file is not a JSON object: ${path}`);
	}
	return { settings: parsed as Record<string, unknown>, existed: true };
}

function extensionsOf(settings: Record<string, unknown>): string[] {
	const ext = settings["extensions"];
	if (ext === undefined) return [];
	if (!Array.isArray(ext) || !ext.every((e): e is string => typeof e === "string")) {
		throw new Error("pi settings `extensions` is not an array of strings — refusing to modify it");
	}
	return [...ext];
}

function writeSettings(path: string, settings: Record<string, unknown>): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

export function isInstalled(piSettingsPath: string, extensionDir: string): boolean {
	try {
		return extensionsOf(readSettings(piSettingsPath).settings).includes(extensionDir);
	} catch {
		return false;
	}
}

export function runInstall(piSettingsPath: string, extensionDir: string, log: Logger): number {
	try {
		const { settings, existed } = readSettings(piSettingsPath);
		const exts = extensionsOf(settings);
		if (exts.includes(extensionDir)) {
			log(`Already installed (${extensionDir} is in ${piSettingsPath}).`);
			return 0;
		}
		settings["extensions"] = [...exts, extensionDir];
		writeSettings(piSettingsPath, settings);
		log(`Installed: added ${extensionDir} to ${piSettingsPath}.`);
		log(existed ? "Restart pi to pick it up." : "(created the pi settings file) — restart pi to pick it up.");
		log(
			"Next: `token-tracker login --endpoint=<url> --authority=<oidc-issuer> --client-id=<id> --api-scope=<scope>`.",
		);
		return 0;
	} catch (err) {
		log(err instanceof Error ? err.message : String(err));
		return 1;
	}
}

export function runUninstall(piSettingsPath: string, extensionDir: string, log: Logger): number {
	try {
		const { settings, existed } = readSettings(piSettingsPath);
		if (!existed) {
			log(`Nothing to do — no pi settings file at ${piSettingsPath}.`);
			return 0;
		}
		const exts = extensionsOf(settings);
		const next = exts.filter((e) => e !== extensionDir);
		if (next.length === exts.length) {
			log("Nothing to do — the extension was not registered in pi's settings.");
			return 0;
		}
		settings["extensions"] = next;
		writeSettings(piSettingsPath, settings);
		log(`Uninstalled: removed ${extensionDir} from ${piSettingsPath}.`);
		return 0;
	} catch (err) {
		log(err instanceof Error ? err.message : String(err));
		return 1;
	}
}
