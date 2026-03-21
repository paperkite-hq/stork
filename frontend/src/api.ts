const BASE = "/api";
const DEFAULT_TIMEOUT_MS = 30_000;

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
	try {
		const res = await fetch(`${BASE}${path}`, {
			...init,
			signal: init?.signal ?? controller.signal,
			headers: { "Content-Type": "application/json", ...init?.headers },
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: res.statusText }));
			throw new Error((err as { error: string }).error || res.statusText);
		}
		return res.json() as Promise<T>;
	} catch (e) {
		if (e instanceof DOMException && e.name === "AbortError") {
			throw new Error(`Request to ${path} timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`);
		}
		throw e;
	} finally {
		clearTimeout(timeout);
	}
}

// Types
export interface Account {
	id: number;
	name: string;
	email: string;
	imap_host: string;
	smtp_host: string | null;
	created_at: string;
}

export interface AccountDetail extends Account {
	imap_port: number;
	imap_tls: number;
	imap_user: string;
	smtp_port: number | null;
	smtp_tls: number | null;
	smtp_user: string | null;
	sync_delete_from_server: number;
	updated_at: string;
}

export interface SyncStatus {
	id: number;
	name: string;
	path: string;
	message_count: number;
	unread_count: number;
	last_synced_at: string | null;
	last_uid: number | null;
}

export interface Folder {
	id: number;
	path: string;
	name: string;
	special_use: string | null;
	message_count: number;
	unread_count: number;
	last_synced_at: string | null;
}

export interface MessageSummary {
	id: number;
	uid: number;
	message_id: string | null;
	subject: string | null;
	from_address: string;
	from_name: string | null;
	to_addresses: string | null;
	date: string;
	flags: string | null;
	size: number;
	has_attachments: number;
	preview: string | null;
}

export interface Message extends MessageSummary {
	in_reply_to: string | null;
	references: string | null;
	cc_addresses: string | null;
	bcc_addresses: string | null;
	text_body: string | null;
	html_body: string | null;
	folder_path: string;
	folder_name: string;
}

export interface Attachment {
	id: number;
	filename: string | null;
	content_type: string | null;
	size: number | null;
	content_id: string | null;
}

export interface Label {
	id: number;
	name: string;
	color: string | null;
	source: "imap" | "user";
	created_at: string;
	message_count: number;
	unread_count: number;
}

export interface LabelSummary {
	id: number;
	name: string;
	color: string | null;
	source: "imap" | "user";
}

export interface SearchResult {
	id: number;
	subject: string | null;
	from_address: string;
	from_name: string | null;
	date: string;
	snippet: string;
}

export interface SyncProgressStatus {
	currentFolder: string | null;
	foldersCompleted: number;
	totalFolders: number;
	messagesNew: number;
	startedAt: number;
}

export interface GlobalSyncStatus {
	[accountId: string]: {
		running: boolean;
		lastSync: number | null;
		lastError: string | null;
		consecutiveErrors: number;
		progress: SyncProgressStatus | null;
	};
}

export type ContainerState = "setup" | "locked" | "unlocked";

// API calls
export const api = {
	status: () => fetchJSON<{ state: ContainerState }>("/status"),
	encryption: {
		setup: (password: string) =>
			fetchJSON<{ recoveryMnemonic: string }>("/setup", {
				method: "POST",
				body: JSON.stringify({ password }),
			}),
		unlock: (opts: { password: string } | { recoveryMnemonic: string; newPassword: string }) =>
			fetchJSON<{ ok: boolean }>("/unlock", {
				method: "POST",
				body: JSON.stringify(opts),
			}),
		changePassword: (currentPassword: string, newPassword: string) =>
			fetchJSON<{ ok: boolean }>("/change-password", {
				method: "POST",
				body: JSON.stringify({ currentPassword, newPassword }),
			}),
		rotateRecoveryKey: (password: string) =>
			fetchJSON<{ recoveryMnemonic: string }>("/rotate-recovery-key", {
				method: "POST",
				body: JSON.stringify({ password }),
			}),
	},
	accounts: {
		list: () => fetchJSON<Account[]>("/accounts"),
		get: (id: number) => fetchJSON<AccountDetail>(`/accounts/${id}`),
		create: (data: Partial<Account> & Record<string, unknown>) =>
			fetchJSON<{ id: number }>("/accounts", {
				method: "POST",
				body: JSON.stringify(data),
			}),
		update: (id: number, data: Record<string, unknown>) =>
			fetchJSON<{ ok: boolean }>(`/accounts/${id}`, {
				method: "PUT",
				body: JSON.stringify(data),
			}),
		delete: (id: number) => fetchJSON<{ ok: boolean }>(`/accounts/${id}`, { method: "DELETE" }),
		syncStatus: (id: number) => fetchJSON<SyncStatus[]>(`/accounts/${id}/sync-status`),
	},
	folders: {
		list: (accountId: number) => fetchJSON<Folder[]>(`/accounts/${accountId}/folders`),
	},
	labels: {
		list: (accountId: number) => fetchJSON<Label[]>(`/accounts/${accountId}/labels`),
		create: (accountId: number, data: { name: string; color?: string }) =>
			fetchJSON<{ id: number }>(`/accounts/${accountId}/labels`, {
				method: "POST",
				body: JSON.stringify(data),
			}),
		update: (labelId: number, data: { name?: string; color?: string }) =>
			fetchJSON<{ ok: boolean }>(`/labels/${labelId}`, {
				method: "PUT",
				body: JSON.stringify(data),
			}),
		delete: (labelId: number) =>
			fetchJSON<{ ok: boolean }>(`/labels/${labelId}`, { method: "DELETE" }),
		messages: (labelId: number, opts?: { limit?: number; offset?: number }) => {
			const params = new URLSearchParams();
			if (opts?.limit) params.set("limit", String(opts.limit));
			if (opts?.offset) params.set("offset", String(opts.offset));
			return fetchJSON<MessageSummary[]>(`/labels/${labelId}/messages?${params}`);
		},
	},
	messages: {
		list: (accountId: number, folderId: number, opts?: { limit?: number; offset?: number }) => {
			const params = new URLSearchParams();
			if (opts?.limit) params.set("limit", String(opts.limit));
			if (opts?.offset) params.set("offset", String(opts.offset));
			return fetchJSON<MessageSummary[]>(
				`/accounts/${accountId}/folders/${folderId}/messages?${params}`,
			);
		},
		get: (messageId: number) => fetchJSON<Message>(`/messages/${messageId}`),
		getThread: (messageId: number) => fetchJSON<Message[]>(`/messages/${messageId}/thread`),
		updateFlags: (messageId: number, opts: { add?: string[]; remove?: string[] }) =>
			fetchJSON<{ ok: boolean; flags: string }>(`/messages/${messageId}/flags`, {
				method: "PATCH",
				body: JSON.stringify(opts),
			}),
		delete: (messageId: number) =>
			fetchJSON<{ ok: boolean }>(`/messages/${messageId}`, { method: "DELETE" }),
		move: (messageId: number, folderId: number) =>
			fetchJSON<{ ok: boolean }>(`/messages/${messageId}/move`, {
				method: "POST",
				body: JSON.stringify({ folder_id: folderId }),
			}),
		attachments: (messageId: number) =>
			fetchJSON<Attachment[]>(`/messages/${messageId}/attachments`),
		labels: (messageId: number) => fetchJSON<LabelSummary[]>(`/messages/${messageId}/labels`),
		addLabels: (messageId: number, labelIds: number[]) =>
			fetchJSON<{ ok: boolean }>(`/messages/${messageId}/labels`, {
				method: "POST",
				body: JSON.stringify({ label_ids: labelIds }),
			}),
		removeLabel: (messageId: number, labelId: number) =>
			fetchJSON<{ ok: boolean }>(`/messages/${messageId}/labels/${labelId}`, {
				method: "DELETE",
			}),
		bulk: (
			ids: number[],
			action: "delete" | "flag" | "move",
			opts?: { add?: string[]; remove?: string[]; folder_id?: number },
		) =>
			fetchJSON<{ ok: boolean; count: number }>("/messages/bulk", {
				method: "POST",
				body: JSON.stringify({ ids, action, ...opts }),
			}),
	},
	search: (query: string, opts?: { accountId?: number; limit?: number }) => {
		const params = new URLSearchParams({ q: query });
		if (opts?.accountId) params.set("account_id", String(opts.accountId));
		if (opts?.limit) params.set("limit", String(opts.limit));
		return fetchJSON<SearchResult[]>(`/search?${params}`);
	},
	sync: {
		status: () => fetchJSON<GlobalSyncStatus>("/sync/status"),
		trigger: (accountId: number) =>
			fetchJSON<Record<string, unknown>>(`/accounts/${accountId}/sync`, { method: "POST" }),
	},
};
