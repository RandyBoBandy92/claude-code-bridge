import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { Platform } from "obsidian";
import { logger } from "./logger";

export class LockFileManager {
	private lockFile = "";
	private authToken = "";

	createLockFile(port: number, workspacePath: string): string {
		const claudeDir = path.join(os.homedir(), ".claude", "ide");

		// Ensure directory exists
		if (!fs.existsSync(claudeDir)) {
			fs.mkdirSync(claudeDir, { recursive: true });
		}

		this.lockFile = path.join(claudeDir, `${port}.lock`);

		// Generate auth token
		this.authToken =
			crypto.randomBytes(16).toString("hex") +
			"-" +
			crypto.randomBytes(2).toString("hex") +
			"-" +
			crypto.randomBytes(2).toString("hex") +
			"-" +
			crypto.randomBytes(2).toString("hex") +
			"-" +
			crypto.randomBytes(6).toString("hex");

		const lockData = {
			pid: process.pid,
			workspaceFolders: [workspacePath || process.cwd()],
			ideName: "Obsidian",
			transport: "ws",
			runningInWindows: Platform.isWin,
			authToken: this.authToken,
			port: port,
		};

		// Write lock file with restrictive permissions (owner read/write only)
		fs.writeFileSync(this.lockFile, JSON.stringify(lockData, null, 2), { mode: 0o600 });
		logger.log(`Lock file created: ${this.lockFile}`);
		
		return this.authToken;
	}

	removeLockFile() {
		if (this.lockFile && fs.existsSync(this.lockFile)) {
			try {
				fs.unlinkSync(this.lockFile);
				logger.log("Lock file removed");
			} catch (error) {
				logger.error("Failed to remove lock file:", error);
			}
		}
	}

	getAuthToken(): string {
		return this.authToken;
	}

	getLockFilePath(): string {
		return this.lockFile;
	}
}