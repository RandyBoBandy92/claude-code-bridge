import * as net from "net";
import { Duplex } from "stream";

// WebSocket connection type - uses Node.js socket directly
export type WebSocketConnection = net.Socket | Duplex;

// MCP message types
export interface MCPMessage {
	jsonrpc: string;
	method?: string;
	id?: string | number;
	params?: unknown;
	result?: unknown;
	error?: {
		code: number;
		message: string;
		data?: unknown;
	};
}

// HTTP upgrade request interface
export interface UpgradeRequest {
	headers: Record<string, string | string[] | undefined>;
	url?: string;
	method?: string;
}

// At-mention message interface
export interface AtMentionMessage extends MCPMessage {
	method: "at_mentioned";
	params: {
		filePath: string;
		lineStart?: number;
		lineEnd?: number;
	};
}

// Selection changed message interface
export interface SelectionChangedMessage extends MCPMessage {
	method: "selection_changed";
	params: {
		text: string;
		filePath: string;
		fileUrl: string;
		selection: {
			start: number;
			end: number;
			isEmpty: boolean;
		};
	};
}