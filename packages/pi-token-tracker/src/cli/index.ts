#!/usr/bin/env node
/**
 * `token-tracker` CLI entry point.
 *
 *   token-tracker install [--pi-settings=<path>]
 *   token-tracker login [--endpoint=<url> --authority=<oidc-issuer> --client-id=<id> --api-scope=<scope>]
 *   token-tracker status
 *   token-tracker logout
 *   token-tracker uninstall [--pi-settings=<path>]
 *   token-tracker --help | --version
 *
 * `install` registers this package's pi-extension directory in pi's
 * `settings.json`. `login` records the connection config in
 * ~/.config/token-tracker/config.json (first run) and writes the device-flow
 * tokens to ~/.config/token-tracker/auth.json (mode 0600).
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flagString, type ParsedArgs, parseArgs } from "./args.js";
import { isInstalled, runInstall, runUninstall } from "./install.js";
import { runLogin } from "./login.js";
import { runLogout } from "./logout.js";
import { runStatus } from "./status.js";

const VERSION = "0.0.0";

const HELP = `token-tracker — install the telemetry extension into pi, sign in, and manage the credential.

Usage:
  token-tracker install [--pi-settings=<path>]    Register this extension in pi's settings.json
  token-tracker login [options]                   Device-flow sign-in (records config on first run)
  token-tracker status                            Show config + sign-in state
  token-tracker logout                            Remove the stored credential
  token-tracker uninstall [--pi-settings=<path>]  Unregister the extension from pi's settings.json
  token-tracker --help                            Show this help
  token-tracker --version                         Show the version

login options (required on first run; thereafter optional; TOKEN_TRACKER_* env vars also work):
  --endpoint=<url>          token-tracker backend base URL (OTLP goes to <url>/v1/traces)
  --authority=<oidc-issuer> OIDC issuer URL (its discovery doc is fetched)
  --client-id=<id>          public-client app registration client id
  --api-scope=<scope>       delegated scope granting the backend audience (e.g. api://<appId>/access_as_user)

Typical end-user setup:
  npm i -g @vilosource/pi-token-tracker
  token-tracker install
  token-tracker login --endpoint=... --authority=... --client-id=... --api-scope=...
`;

/** This package's pi-extension directory: dist/extension, next to dist/cli. */
function extensionDir(): string {
	return resolve(dirname(fileURLToPath(import.meta.url)), "..", "extension");
}

function piSettingsPath(args: ParsedArgs, env: NodeJS.ProcessEnv): string {
	return (
		flagString(args, "pi-settings") ??
		env["TOKEN_TRACKER_PI_SETTINGS"] ??
		join(env["HOME"] ?? "", ".pi", "agent", "settings.json")
	);
}

async function dispatch(args: ParsedArgs, env: NodeJS.ProcessEnv, log: (line: string) => void): Promise<number> {
	switch (args.command) {
		case "install":
			return runInstall(piSettingsPath(args, env), extensionDir(), log);
		case "uninstall":
			return runUninstall(piSettingsPath(args, env), extensionDir(), log);
		case "login": {
			const code = await runLogin(args, env, log);
			if (code === 0 && !isInstalled(piSettingsPath(args, env), extensionDir())) {
				log("");
				log("Tip: run `token-tracker install` so pi actually loads the telemetry extension.");
			}
			return code;
		}
		case "status":
			return runStatus(env, log);
		case "logout":
			return runLogout(env, log);
		default:
			log(`unknown command: ${args.command}\n`);
			log(HELP);
			return 2;
	}
}

async function main(): Promise<number> {
	const args = parseArgs(process.argv.slice(2));
	const log = (line: string): void => {
		// eslint-disable-next-line no-console
		console.log(line);
	};

	if (args.flags.has("help") || args.command === "help" || args.command === undefined) {
		log(HELP);
		return args.command === undefined && !args.flags.has("help") ? 1 : 0;
	}
	if (args.flags.has("version")) {
		log(VERSION);
		return 0;
	}
	return dispatch(args, process.env, log);
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((err: unknown) => {
		// eslint-disable-next-line no-console
		console.error(`token-tracker: ${err instanceof Error ? err.message : String(err)}`);
		process.exitCode = 1;
	});
