export class Logger {
	private isDevelopment: boolean;

	constructor() {
		// Check if we're in development mode by looking for specific indicators
		this.isDevelopment = 
			process.env.NODE_ENV === 'development' ||
			// @ts-ignore - Check if Obsidian is in dev mode (if available)
			(typeof window !== 'undefined' && window?.electronAPI?.isDev) ||
			// Fallback: assume development if console methods are not stubbed
			typeof console.log.toString === 'function';
	}

	log(message: string, ...args: any[]) {
		if (this.isDevelopment) {
			console.log(`[Claude Code Bridge] ${message}`, ...args);
		}
	}

	error(message: string, ...args: any[]) {
		// Always log errors, even in production
		console.error(`[Claude Code Bridge] ${message}`, ...args);
	}

	warn(message: string, ...args: any[]) {
		if (this.isDevelopment) {
			console.warn(`[Claude Code Bridge] ${message}`, ...args);
		}
	}

	debug(message: string, ...args: any[]) {
		if (this.isDevelopment) {
			console.debug(`[Claude Code Bridge] ${message}`, ...args);
		}
	}
}

export const logger = new Logger();