/**
 * Resolve workspace metadata (cwd, git repo, git branch, CI flag) once
 * at session start.
 */

import { execFileSync } from "node:child_process";
import type { Workspace } from "../shared/types.js";

export function resolveWorkspace(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): Workspace {
	return {
		cwd,
		repo: gitRepo(cwd),
		branch: gitBranch(cwd),
		isCi: detectCi(env),
	};
}

function gitRepo(cwd: string): string | undefined {
	const url = gitOutput(cwd, ["config", "--get", "remote.origin.url"]);
	if (url === undefined) return undefined;
	return normalizeRepoUrl(url);
}

function gitBranch(cwd: string): string | undefined {
	return gitOutput(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

function gitOutput(cwd: string, args: readonly string[]): string | undefined {
	try {
		const out = execFileSync("git", ["-C", cwd, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return out.length > 0 ? out : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Normalize a git remote URL to `host/owner/repo` form.
 * Examples:
 *   git@github.com:vilosource/pi-extensions.git → github.com/vilosource/pi-extensions
 *   https://github.com/vilosource/pi-extensions.git → github.com/vilosource/pi-extensions
 *   ssh://git@gitlab.com:2222/owner/proj.git → gitlab.com/owner/proj
 */
export function normalizeRepoUrl(url: string): string {
	let s = url.trim();

	// Strip ssh:// or https:// or git:// prefix
	s = s.replace(/^(ssh|https?|git):\/\//, "");

	// Strip user@ prefix
	s = s.replace(/^[^@/]+@/, "");

	// Strip trailing .git
	s = s.replace(/\.git$/, "");

	// ssh form uses : as separator between host and path
	s = s.replace(/^([^:/]+):(?!\d)/, "$1/");

	// ssh-with-port form: host:port/path → host/path
	s = s.replace(/^([^:/]+):\d+\//, "$1/");

	return s;
}

function detectCi(env: NodeJS.ProcessEnv): boolean {
	return Boolean(
		env["CI"] === "true" ||
			env["GITHUB_ACTIONS"] ||
			env["GITLAB_CI"] ||
			env["CIRCLECI"] ||
			env["JENKINS_URL"] ||
			env["TRAVIS"],
	);
}
