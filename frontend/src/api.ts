const BASE = "/api";
const DEFAULT_TIMEOUT_MS = 30_000;

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

	// If the caller provides a signal (e.g. from useAsync), propagate its abort
	// to our internal controller so the timeout still applies alongside it.
	const callerSignal = init?.signal;
	let onCallerAbort: (() => void) | undefined;
	if (callerSignal) {
		if (callerSignal.aborted) {
			clearTimeout(timeout);
			controller.abort();
		} else {
			onCallerAbort = () => controller.abort();
			callerSignal.addEventListener("abort", onCallerAbort);
		}
	}

	try {
		const res = await fetch(`${BASE}${path}`, {
			...init,
			signal: controller.signal,
			headers: { "Content-Type": "application/json", ...init?.headers },
		});
		if (!res.ok) {
			// Container went back to locked state (e.g. after restart) — notify the app
			if (res.status === 423) {
				window.dispatchEvent(new CustomEvent("stork-container-locked"));
			}
			const err = await res.json().catch(() => ({ error: res.statusText }));
			throw new Error((err as { error: string }).error || res.statusText);
		}
		return res.json() as Promise<T>;
	} catch (e) {
		if (e instanceof DOMException && e.name === "AbortError") {
			// Distinguish caller-initiated abort from timeout
			if (callerSignal?.aborted) throw e;
			throw new Error(`Request to ${path} timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`);
		}
		throw e;
	} finally {
		clearTimeout(timeout);
		if (callerSignal && onCallerAbort) {
			callerSignal.removeEventListener("abort", onCallerAbort);
		}
	}
}

// Types
export interface Account {
	id: number;
	name: string;
	email: string;
	ingest_connector_type: IngestConnectorType;
	send_connector_type: SendConnectorType;
	inbound_connector_id: number | null;
	outbound_connector_id: number | null;
	imap_host: string | null;
	smtp_host: string | null;
	default_view?: string;
	sync_delete_from_server: number;
	created_at: string;
}

export interface AccountDetail extends Account {
	inbound_connector_name: string | null;
	outbound_connector_name: string | null;
	imap_port: number | null;
	imap_tls: number | null;
	imap_user: string | null;
	cf_email_webhook_secret: string | null;
	smtp_port: number | null;
	smtp_tls: number | null;
	smtp_user: string | null;
	ses_region: string | null;
	ses_access_key_id: string | null;
	updated_at: string;
}

export interface InboundConnector {
	id: number;
	name: string;
	type: IngestConnectorType;
	imap_host: string | null;
	imap_port: number;
	imap_tls: number;
	imap_user: string | null;
	cf_email_webhook_secret: string | null;
	created_at: string;
	updated_at: string;
}

export interface OutboundConnector {
	id: number;
	name: string;
	type: SendConnectorType;
	smtp_host: string | null;
	smtp_port: number;
	smtp_tls: number;
	smtp_user: string | null;
	ses_region: string | null;
	ses_access_key_id: string | null;
	created_at: string;
	updated_at: string;
}

export interface CreateInboundConnectorRequest {
	name: string;
	type: IngestConnectorType;
	imap_host?: string;
	imap_port?: number;
	imap_tls?: number;
	imap_user?: string;
	imap_pass?: string;
	cf_email_webhook_secret?: string;
}

export interface UpdateInboundConnectorRequest {
	name?: string;
	type?: IngestConnectorType;
	imap_host?: string;
	imap_port?: number;
	imap_tls?: number;
	imap_user?: string;
	imap_pass?: string;
	cf_email_webhook_secret?: string;
}

export interface CreateOutboundConnectorRequest {
	name: string;
	type: SendConnectorType;
	smtp_host?: string;
	smtp_port?: number;
	smtp_tls?: number;
	smtp_user?: string;
	smtp_pass?: string;
	ses_region?: string;
	ses_access_key_id?: string;
	ses_secret_access_key?: string;
}

export interface UpdateOutboundConnectorRequest {
	name?: string;
	type?: SendConnectorType;
	smtp_host?: string;
	smtp_port?: number;
	smtp_tls?: number;
	smtp_user?: string;
	smtp_pass?: string;
	ses_region?: string;
	ses_access_key_id?: string;
	ses_secret_access_key?: string;
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
	/** Present only in unified inbox responses — identifies which account the message belongs to */
	account_id?: number;
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

export interface DraftSummary {
	id: number;
	account_id: number;
	to_addresses: string | null;
	subject: string | null;
	preview: string | null;
	compose_mode: string;
	original_message_id: number | null;
	created_at: string;
	updated_at: string;
}

export interface Draft {
	id: number;
	account_id: number;
	to_addresses: string | null;
	cc_addresses: string | null;
	bcc_addresses: string | null;
	subject: string | null;
	text_body: string | null;
	html_body: string | null;
	in_reply_to: string | null;
	references: string | null;
	original_message_id: number | null;
	compose_mode: string;
	created_at: string;
	updated_at: string;
}

export interface TrustedSender {
	id: number;
	sender_address: string;
	created_at: string;
}

export type ContainerState = "setup" | "locked" | "unlocked";

export type IngestConnectorType = "imap" | "cloudflare-email";
export type SendConnectorType = "smtp" | "ses";

export interface CreateAccountRequest {
	name: string;
	email: string;
	/** Reference an existing inbound connector by ID. If omitted, inline IMAP/CF fields are used. */
	inbound_connector_id?: number;
	/** Reference an existing outbound connector by ID. If omitted, inline SMTP/SES fields are used. */
	outbound_connector_id?: number;
	// Inline connector fields (backward-compat — auto-creates connector rows on the server)
	ingest_connector_type?: IngestConnectorType;
	send_connector_type?: SendConnectorType;
	imap_host?: string;
	imap_port?: number;
	imap_tls?: number;
	imap_user?: string;
	imap_pass?: string;
	smtp_host?: string;
	smtp_port?: number;
	smtp_tls?: number;
	smtp_user?: string;
	smtp_pass?: string;
	cf_email_webhook_secret?: string;
	ses_region?: string;
	ses_access_key_id?: string;
	ses_secret_access_key?: string;
	sync_delete_from_server?: number;
	default_view?: string;
}

export interface UpdateAccountRequest {
	name?: string;
	email?: string;
	/** Re-assign to a different inbound connector */
	inbound_connector_id?: number;
	/** Re-assign to a different outbound connector */
	outbound_connector_id?: number;
	sync_delete_from_server?: number;
	default_view?: string;
}

export interface TestConnectionRequest {
	imap_host: string;
	imap_port?: number;
	imap_tls?: number;
	imap_user: string;
	imap_pass: string;
}

export interface TestSmtpRequest {
	smtp_host: string;
	smtp_port?: number;
	smtp_tls?: number;
	smtp_user: string;
	smtp_pass: string;
}

// API calls
export const api = {
	status: () => fetchJSON<{ state: ContainerState }>("/status"),
	demo: () => fetchJSON<{ demo: boolean }>("/demo"),
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
			fetchJSON<{ recoveryMnemonic: string; pending: boolean }>("/rotate-recovery-key", {
				method: "POST",
				body: JSON.stringify({ password }),
			}),
		confirmRecoveryRotation: (password: string) =>
			fetchJSON<{ ok: boolean }>("/confirm-recovery-rotation", {
				method: "POST",
				body: JSON.stringify({ password }),
			}),
		cancelRecoveryRotation: () =>
			fetchJSON<{ ok: boolean }>("/cancel-recovery-rotation", {
				method: "POST",
				body: JSON.stringify({}),
			}),
		recoveryRotationStatus: () => fetchJSON<{ pending: boolean }>("/recovery-rotation-status"),
	},
	accounts: {
		list: () => fetchJSON<Account[]>("/accounts"),
		get: (id: number) => fetchJSON<AccountDetail>(`/accounts/${id}`),
		create: (data: CreateAccountRequest) =>
			fetchJSON<{ id: number }>("/accounts", {
				method: "POST",
				body: JSON.stringify(data),
			}),
		update: (id: number, data: UpdateAccountRequest) =>
			fetchJSON<{ ok: boolean }>(`/accounts/${id}`, {
				method: "PUT",
				body: JSON.stringify(data),
			}),
		delete: (id: number) => fetchJSON<{ ok: boolean }>(`/accounts/${id}`, { method: "DELETE" }),
		syncStatus: (id: number) => fetchJSON<SyncStatus[]>(`/accounts/${id}/sync-status`),
		testConnection: (data: TestConnectionRequest) =>
			fetchJSON<{ ok: boolean; error?: string; mailboxes?: number }>("/accounts/test-connection", {
				method: "POST",
				body: JSON.stringify(data),
			}),
	},
	connectors: {
		inbound: {
			list: () => fetchJSON<InboundConnector[]>("/connectors/inbound"),
			get: (id: number) => fetchJSON<InboundConnector>(`/connectors/inbound/${id}`),
			create: (data: CreateInboundConnectorRequest) =>
				fetchJSON<{ id: number }>("/connectors/inbound", {
					method: "POST",
					body: JSON.stringify(data),
				}),
			update: (id: number, data: UpdateInboundConnectorRequest) =>
				fetchJSON<{ ok: boolean }>(`/connectors/inbound/${id}`, {
					method: "PUT",
					body: JSON.stringify(data),
				}),
			delete: (id: number) =>
				fetchJSON<{ ok: boolean }>(`/connectors/inbound/${id}`, { method: "DELETE" }),
			test: (id: number) =>
				fetchJSON<{ ok: boolean; error?: string; details?: Record<string, unknown> }>(
					`/connectors/inbound/${id}/test`,
					{ method: "POST", body: JSON.stringify({}) },
				),
		},
		outbound: {
			list: () => fetchJSON<OutboundConnector[]>("/connectors/outbound"),
			get: (id: number) => fetchJSON<OutboundConnector>(`/connectors/outbound/${id}`),
			create: (data: CreateOutboundConnectorRequest) =>
				fetchJSON<{ id: number }>("/connectors/outbound", {
					method: "POST",
					body: JSON.stringify(data),
				}),
			update: (id: number, data: UpdateOutboundConnectorRequest) =>
				fetchJSON<{ ok: boolean }>(`/connectors/outbound/${id}`, {
					method: "PUT",
					body: JSON.stringify(data),
				}),
			delete: (id: number) =>
				fetchJSON<{ ok: boolean }>(`/connectors/outbound/${id}`, { method: "DELETE" }),
			test: (id: number) =>
				fetchJSON<{ ok: boolean; error?: string }>(`/connectors/outbound/${id}/test`, {
					method: "POST",
					body: JSON.stringify({}),
				}),
		},
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
	inbox: {
		unified: {
			list: (opts?: { limit?: number; offset?: number }) => {
				const params = new URLSearchParams();
				if (opts?.limit) params.set("limit", String(opts.limit));
				if (opts?.offset) params.set("offset", String(opts.offset));
				return fetchJSON<MessageSummary[]>(`/inbox/unified?${params}`);
			},
			count: () => fetchJSON<{ total: number; unread: number }>("/inbox/unified/count"),
		},
		allMessages: {
			list: (opts?: { limit?: number; offset?: number }) => {
				const params = new URLSearchParams();
				if (opts?.limit) params.set("limit", String(opts.limit));
				if (opts?.offset) params.set("offset", String(opts.offset));
				return fetchJSON<MessageSummary[]>(`/inbox/all-messages?${params}`);
			},
			count: () => fetchJSON<{ total: number; unread: number }>("/inbox/all-messages/count"),
		},
		unreadMessages: {
			list: (opts?: { limit?: number; offset?: number }) => {
				const params = new URLSearchParams();
				if (opts?.limit) params.set("limit", String(opts.limit));
				if (opts?.offset) params.set("offset", String(opts.offset));
				return fetchJSON<MessageSummary[]>(`/inbox/unread-messages?${params}`);
			},
			count: () => fetchJSON<{ total: number }>("/inbox/unread-messages/count"),
		},
	},
	allMessages: {
		list: (accountId: number, opts?: { limit?: number; offset?: number }) => {
			const params = new URLSearchParams();
			if (opts?.limit) params.set("limit", String(opts.limit));
			if (opts?.offset) params.set("offset", String(opts.offset));
			return fetchJSON<MessageSummary[]>(`/accounts/${accountId}/all-messages?${params}`);
		},
		count: (accountId: number) =>
			fetchJSON<{ total: number; unread: number }>(`/accounts/${accountId}/all-messages/count`),
	},
	unreadMessages: {
		list: (accountId: number, opts?: { limit?: number; offset?: number }) => {
			const params = new URLSearchParams();
			if (opts?.limit) params.set("limit", String(opts.limit));
			if (opts?.offset) params.set("offset", String(opts.offset));
			return fetchJSON<MessageSummary[]>(`/accounts/${accountId}/unread-messages?${params}`);
		},
		count: (accountId: number) =>
			fetchJSON<{ total: number }>(`/accounts/${accountId}/unread-messages/count`),
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
			action: "delete" | "flag" | "move" | "remove_label",
			opts?: { add?: string[]; remove?: string[]; folder_id?: number; label_id?: number },
		) =>
			fetchJSON<{ ok: boolean; count: number }>("/messages/bulk", {
				method: "POST",
				body: JSON.stringify({ ids, action, ...opts }),
			}),
	},
	search: (query: string, opts?: { accountId?: number; limit?: number; offset?: number }) => {
		const params = new URLSearchParams({ q: query });
		if (opts?.accountId) params.set("account_id", String(opts.accountId));
		if (opts?.limit) params.set("limit", String(opts.limit));
		if (opts?.offset) params.set("offset", String(opts.offset));
		return fetchJSON<SearchResult[]>(`/search?${params}`);
	},
	sync: {
		status: () => fetchJSON<GlobalSyncStatus>("/sync/status"),
		trigger: (accountId: number) =>
			fetchJSON<{ ok?: boolean; error?: string }>(`/accounts/${accountId}/sync`, {
				method: "POST",
			}),
	},
	send: (data: {
		account_id: number;
		to: string[];
		cc?: string[];
		bcc?: string[];
		subject: string;
		text_body?: string;
		html_body?: string;
		in_reply_to?: string;
		references?: string[];
		attachments?: { filename: string; content_type: string; content_base64: string }[];
	}) =>
		fetchJSON<{
			ok: boolean;
			message_id: string;
			accepted: string[];
			rejected: string[];
			stored_message_id: number;
		}>("/send", {
			method: "POST",
			body: JSON.stringify(data),
		}),
	testSmtp: (data: TestSmtpRequest) =>
		fetchJSON<{ ok: boolean; error?: string }>("/send/test-smtp", {
			method: "POST",
			body: JSON.stringify(data),
		}),
	drafts: {
		list: (accountId: number) => fetchJSON<DraftSummary[]>(`/drafts?account_id=${accountId}`),
		get: (id: number) => fetchJSON<Draft>(`/drafts/${id}`),
		create: (data: Partial<Draft> & { account_id: number }) =>
			fetchJSON<{ id: number }>("/drafts", {
				method: "POST",
				body: JSON.stringify(data),
			}),
		update: (id: number, data: Partial<Draft>) =>
			fetchJSON<{ ok: boolean }>(`/drafts/${id}`, {
				method: "PUT",
				body: JSON.stringify(data),
			}),
		delete: (id: number) => fetchJSON<{ ok: boolean }>(`/drafts/${id}`, { method: "DELETE" }),
	},
	trustedSenders: {
		list: (accountId: number) =>
			fetchJSON<TrustedSender[]>(`/accounts/${accountId}/trusted-senders`),
		check: (accountId: number, sender: string) =>
			fetchJSON<{ trusted: boolean }>(
				`/accounts/${accountId}/trusted-senders/check?sender=${encodeURIComponent(sender)}`,
			),
		add: (accountId: number, senderAddress: string) =>
			fetchJSON<{ id: number }>(`/accounts/${accountId}/trusted-senders`, {
				method: "POST",
				body: JSON.stringify({ sender_address: senderAddress }),
			}),
		remove: (accountId: number, senderAddress: string) =>
			fetchJSON<{ ok: boolean }>(`/accounts/${accountId}/trusted-senders`, {
				method: "DELETE",
				body: JSON.stringify({ sender_address: senderAddress }),
			}),
	},
};
