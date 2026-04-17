<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { page } from '$app/stores';
	import { appState, identityState, reactiveState } from '$lib/stores.svelte.js';
	import type { DecryptedDM } from '$lib/dm.js';

	let conversations = $state<Array<{ partner: string; lastMessage: DecryptedDM }>>([]);
	let contacts = $state<string[]>([]);
	let activePartner = $state<string | null>(null);
	let messages = $state<DecryptedDM[]>([]);
	let composeText = $state('');
	let canEncrypt = $state(false);
	let messagesEl: HTMLDivElement;

	// Add contact modal
	let showAddModal = $state(false);
	let addAddress = $state('');
	let addError = $state('');

	onMount(() => {
		const check = setInterval(() => {
			const dm = appState.dmManager;
			const pm = appState.profileManager;
			const fm = appState.feedManager;
			const ac = appState.accountSync;
			if (dm && pm && fm && ac) {
				clearInterval(check);

				contacts = ac.getContacts();

				// Join all contacts' user swarms to detect online + get profiles
				for (const c of contacts) {
					fm.joinUserSwarm(c);
				}

				refreshConversations();

				dm.onChange(() => {
					refreshConversations();
					if (activePartner) {
						messages = dm.getConversation(activePartner);
						tick().then(scrollBottom);
					}
				});

				pm.onChange(() => {
					if (activePartner) canEncrypt = !!pm.getX25519Key(activePartner);
					contacts = [...contacts];
				});

				ac.onChange(() => {
					contacts = ac.getContacts();
					for (const c of contacts) fm.joinUserSwarm(c);
				});

				// Auto-open from redirect
				const pending = sessionStorage.getItem('agora_dm_open');
				if (pending) {
					sessionStorage.removeItem('agora_dm_open');
					addContact(pending);
					selectConversation(pending);
				}
			}
		}, 50);
		return () => clearInterval(check);
	});

	function refreshConversations() {
		const dm = appState.dmManager;
		if (dm) conversations = dm.getConversationList();
	}

	function addContact(address: string) {
		const key = address.trim();
		if (!key || key.length < 10) return;
		if (key === identityState.identity?.publicKeyBase64) return;
		if (contacts.includes(key)) return;

		appState.accountSync?.addContact(key);
		contacts = [...contacts, key];
		appState.feedManager?.joinUserSwarm(key);
	}

	function removeContact(key: string) {
		appState.accountSync?.removeContact(key);
		contacts = contacts.filter(c => c !== key);
		appState.feedManager?.leaveUserSwarm(key);
	}

	function handleAddSubmit() {
		addError = '';
		const key = addAddress.trim();
		if (!key) { addError = 'Paste an address'; return; }
		if (key.length < 10) { addError = 'Address too short'; return; }
		if (key === identityState.identity?.publicKeyBase64) { addError = "That's your own address"; return; }
		if (contacts.includes(key)) { addError = 'Already in contacts'; return; }

		addContact(key);
		addAddress = '';
		showAddModal = false;
		selectConversation(key);
	}

	function selectConversation(partner: string) {
		activePartner = null;
		tick().then(() => {
			activePartner = partner;
			markRead(partner);
			const dm = appState.dmManager;
			const pm = appState.profileManager;
			if (dm) {
				dm.openConversation(partner);
				messages = dm.getConversation(partner);
			}
			canEncrypt = !!pm?.getX25519Key(partner);
			tick().then(scrollBottom);
		});
	}

	function closeChat() {
		appState.dmManager?.closeConversation();
		activePartner = null;
	}

	function scrollBottom() {
		if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
	}

	async function send() {
		const dm = appState.dmManager;
		const pm = appState.profileManager;
		if (!dm || !pm || !activePartner || !composeText.trim()) return;

		const x25519Key = pm.getX25519Key(activePartner);
		if (!x25519Key) return;

		await dm.sendDM(activePartner, x25519Key, composeText.trim());
		composeText = '';
		await tick();
		scrollBottom();
	}

	function displayName(key: string): string {
		return appState.profileManager?.displayName(key) || key.slice(0, 10) + '...';
	}

	function contactStatus(key: string): 'ready' | 'connecting' | 'offline' {
		const pm = appState.profileManager;
		const fm = appState.feedManager;
		if (!pm || !fm) return 'offline';
		const hasKey = !!pm.getX25519Key(key);
		const isConnected = fm.swarmManager.isPubkeyConnected(key);
		if (hasKey && isConnected) return 'ready';
		if (hasKey) return 'ready'; // have key from cache, can encrypt even if offline
		if (isConnected) return 'connecting'; // connected but waiting for key
		const profile = pm.getProfile(key);
		if (profile?.lastSeen && Date.now() - profile.lastSeen < 300_000) return 'connecting';
		return 'offline';
	}

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function formatRelative(ts: number): string {
		const diff = Date.now() - ts;
		if (diff < 60_000) return 'now';
		if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
		if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
		return new Date(ts).toLocaleDateString();
	}

	// Track read state per conversation
	const READ_KEY = 'riot_dm_read';
	let readTimestamps = $state<Record<string, number>>({});

	function loadReadState(): Record<string, number> {
		try { const s = localStorage.getItem(READ_KEY); if (s) return JSON.parse(s); } catch {}
		return {};
	}

	function markRead(partner: string): void {
		readTimestamps[partner] = Date.now();
		try { localStorage.setItem(READ_KEY, JSON.stringify(readTimestamps)); } catch {}
	}

	function isUnread(partner: string, lastMsg: DecryptedDM | undefined, readState: Record<string, number>): boolean {
		if (!lastMsg || lastMsg.outgoing) return false;
		const readAt = readState[partner] || 0;
		return lastMsg.timestamp > readAt;
	}

	// Merged list: sorted by most recent message, unread items first
	let mergedList = $derived((() => {
		const currentRead = loadReadState();
		const seen = new Set<string>();
		const items: Array<{ key: string; name: string; status: 'ready' | 'connecting' | 'offline'; lastMsg?: DecryptedDM; isContact: boolean; unread: boolean }> = [];

		// Collect all contacts + conversations
		for (const c of contacts) {
			seen.add(c);
			const conv = conversations.find(cv => cv.partner === c);
			items.push({
				key: c,
				name: displayName(c),
				status: contactStatus(c),
				lastMsg: conv?.lastMessage,
				isContact: true,
				unread: isUnread(c, conv?.lastMessage, currentRead),
			});
		}

		for (const conv of conversations) {
			if (!seen.has(conv.partner)) {
				seen.add(conv.partner);
				items.push({
					key: conv.partner,
					name: displayName(conv.partner),
					status: contactStatus(conv.partner),
					lastMsg: conv.lastMessage,
					isContact: false,
					unread: isUnread(conv.partner, conv.lastMessage, currentRead),
				});
			}
		}

		// Sort: unread first, then by most recent message, contacts without messages last
		items.sort((a, b) => {
			if (a.unread !== b.unread) return a.unread ? -1 : 1;
			const ta = a.lastMsg?.timestamp || 0;
			const tb = b.lastMsg?.timestamp || 0;
			return tb - ta;
		});

		return items;
	})());
</script>

<!-- Add Contact Modal -->
{#if showAddModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={() => { showAddModal = false; addError = ''; }}>
		<div class="modal card" onclick={(e) => e.stopPropagation()}>
			<h3>Add Contact</h3>
			<p class="modal-desc">Paste their public address to start a conversation.</p>
			<textarea
				class="input mono"
				bind:value={addAddress}
				placeholder="Paste address here..."
				rows="3"
				onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddSubmit(); } }}
			></textarea>
			{#if addError}
				<p class="modal-error">{addError}</p>
			{/if}
			<div class="modal-actions">
				<button class="btn btn-secondary" onclick={() => { showAddModal = false; addError = ''; }}>Cancel</button>
				<button class="btn" onclick={handleAddSubmit}>Add & Chat</button>
			</div>
		</div>
	</div>
{/if}

<div class="dm-layout" class:chat-open={!!activePartner}>
	<!-- Sidebar -->
	<div class="sidebar">
		<div class="sidebar-header">
			<h2>Messages</h2>
			<button class="add-btn" onclick={() => { showAddModal = true; addAddress = ''; addError = ''; }}>+</button>
		</div>

		<div class="conv-list">
			{#each mergedList as item (item.key)}
				<button
					class="conv-item" class:active={activePartner === item.key}
					onclick={() => selectConversation(item.key)}
				>
					<div class="conv-avatar-wrap">
						<div class="conv-avatar">{item.key.slice(0, 2)}</div>
						<span class="status-dot"
							class:dot-ready={item.status === 'ready'}
							class:dot-connecting={item.status === 'connecting'}
							class:dot-offline={item.status === 'offline'}
						></span>
					</div>
					<div class="conv-info">
						<div class="conv-top">
							<span class="conv-name">{item.name}</span>
							{#if item.lastMsg}
								<span class="conv-time">{formatRelative(item.lastMsg.timestamp)}</span>
							{:else}
								<span class="conv-status-label"
									class:label-ready={item.status === 'ready'}
									class:label-connecting={item.status === 'connecting'}
								>
									{item.status === 'ready' ? 'ready' : item.status === 'connecting' ? 'connecting...' : 'offline'}
								</span>
							{/if}
						</div>
						{#if item.lastMsg}
							<div class="conv-preview" class:unread-preview={item.unread}>{item.lastMsg.outgoing ? 'You: ' : ''}{item.lastMsg.text.slice(0, 40)}</div>
						{:else}
							<div class="conv-preview">No messages yet</div>
						{/if}
						{#if item.unread}
							<span class="unread-dot"></span>
						{/if}
					</div>
				</button>
			{/each}

			{#if mergedList.length === 0}
				<div class="empty-contacts">
					<p>No contacts yet</p>
					<button class="btn btn-sm" onclick={() => { showAddModal = true; addAddress = ''; }}>+ Add Contact</button>
				</div>
			{/if}
		</div>
	</div>

	<!-- Chat area -->
	<div class="chat-area">
		{#if activePartner}
			<div class="chat-header">
				<button class="back-btn" onclick={closeChat}>&#x2190;</button>
				<div class="conv-avatar-wrap">
					<div class="chat-avatar">{activePartner.slice(0, 2)}</div>
					<span class="status-dot"
						class:dot-ready={contactStatus(activePartner) === 'ready'}
						class:dot-connecting={contactStatus(activePartner) === 'connecting'}
						class:dot-offline={contactStatus(activePartner) === 'offline'}
					></span>
				</div>
				<div class="chat-header-info">
					<span class="chat-name">{displayName(activePartner)}</span>
					<span class="chat-status"
						class:label-ready={contactStatus(activePartner) === 'ready'}
						class:label-connecting={contactStatus(activePartner) === 'connecting'}
					>
						{contactStatus(activePartner) === 'ready' ? 'E2E ready' : contactStatus(activePartner) === 'connecting' ? 'exchanging keys...' : 'offline'}
					</span>
				</div>
			</div>

			<div class="chat-messages" bind:this={messagesEl}>
				{#each messages as msg (msg.id)}
					<div class="msg" class:outgoing={msg.outgoing}>
						<div class="bubble" class:bubble-out={msg.outgoing}>
							<span class="msg-text">{msg.text}</span>
							<span class="msg-meta">
								<span class="msg-time">{formatTime(msg.timestamp)}</span>
								{#if msg.outgoing && msg.status}
									<span class="msg-status" class:status-queued={msg.status === 'queued'} class:status-sent={msg.status === 'sent'} class:status-read={msg.status === 'read'}>
										{msg.status === 'queued' ? '&#x23F3;' : msg.status === 'read' ? '&#x2713;&#x2713;' : '&#x2713;'}
									</span>
								{/if}
							</span>
						</div>
					</div>
				{/each}
				{#if messages.length === 0}
					<div class="chat-empty">
						{#if canEncrypt}
							<p>Send an encrypted message.</p>
						{:else if contactStatus(activePartner) === 'connecting'}
							<div class="key-spinner"></div>
							<p>Exchanging encryption keys...</p>
							<p class="sub">Both sides need to be online. This usually takes a few seconds.</p>
						{:else}
							<p>Waiting for peer to come online...</p>
							<p class="sub">They need to open the app so you can exchange keys.</p>
						{/if}
					</div>
				{/if}
			</div>

			{#if canEncrypt}
				<div class="chat-compose">
					<input
						class="input"
						bind:value={composeText}
						placeholder="Type a message..."
						onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
					/>
					<button class="btn" onclick={send} disabled={!composeText.trim()}>Send</button>
				</div>
			{:else}
				<div class="encrypt-bar">
					{#if contactStatus(activePartner) === 'connecting'}
						<span class="lock-icon">Exchanging keys</span> — almost ready...
					{:else}
						<span class="lock-icon">E2E pending</span> — peer needs to be online
					{/if}
				</div>
			{/if}
		{:else}
			<div class="no-chat">
				<p>Select a conversation or add a contact</p>
				<p class="sub">Tap <strong>+</strong> to add someone by their address</p>
			</div>
		{/if}
	</div>
</div>

<style>
	.dm-layout {
		display: flex; height: 100%;
		overflow: hidden; background: var(--bg-surface);
	}

	/* Modal */
	.modal-overlay {
		position: fixed; inset: 0; background: rgba(0,0,0,0.6);
		display: flex; align-items: center; justify-content: center; z-index: 200;
	}
	.modal {
		width: 420px; max-width: 90vw; padding: 24px;
		background: var(--bg-raised); border: 1px solid rgba(255,255,255,0.08);
	}
	.modal h3 { margin: 0 0 6px; font-size: 1.1rem; color: var(--text-primary); }
	.modal-desc { color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 14px; }
	.modal textarea { font-size: 0.75rem; resize: none; }
	.modal-error { color: #f87171; font-size: 0.8rem; margin-top: 6px; }
	.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
	.btn-secondary { background: var(--bg-input); color: var(--text-secondary); border: 1px solid rgba(255,255,255,0.06); }
	.btn-secondary:hover { border-color: var(--accent); color: var(--accent); box-shadow: none; transform: none; }
	.btn-sm { padding: 6px 14px; font-size: 0.75rem; }

	/* Sidebar */
	.sidebar {
		width: 320px; min-width: 320px;
		flex-shrink: 0;
		display: flex; flex-direction: column;
		border-right: 1px solid rgba(255,255,255,0.04);
		background: var(--bg-root);
	}
	.sidebar-header {
		display: flex; justify-content: space-between; align-items: center;
		padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.04);
	}
	.sidebar-header h2 { margin: 0; font-size: 1rem; color: var(--text-primary); }
	.add-btn {
		width: 30px; height: 30px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);
		background: none; color: var(--accent); font-size: 1.2rem; cursor: pointer;
		display: flex; align-items: center; justify-content: center; transition: all 0.2s;
	}
	.add-btn:hover { background: rgba(249,115,22,0.1); border-color: var(--accent); }
	.conv-list { flex: 1; overflow-y: auto; }
	.conv-item {
		display: flex; align-items: center; gap: 10px;
		width: 100%; padding: 12px 16px; border: none; background: none;
		color: inherit; cursor: pointer; text-align: left;
		transition: background 0.15s;
	}
	.conv-item:hover { background: var(--bg-surface); }
	.conv-item.active { background: var(--bg-raised); border-left: 2px solid var(--accent); }

	.conv-avatar-wrap { position: relative; flex-shrink: 0; }
	.conv-avatar, .chat-avatar {
		width: 36px; height: 36px; border-radius: 50%;
		background: var(--bg-raised); display: flex; align-items: center; justify-content: center;
		font-family: var(--font-mono); font-size: 0.7rem; color: var(--accent);
		border: 1px solid var(--accent-border);
	}
	.chat-avatar { width: 32px; height: 32px; font-size: 0.65rem; }
	.status-dot {
		position: absolute; bottom: -1px; right: -1px;
		width: 10px; height: 10px; border-radius: 50%;
		border: 2px solid var(--bg-root);
	}
	.dot-ready { background: #4ade80; }
	.dot-connecting { background: #facc15; animation: pulse-dot 1.5s infinite; }
	.dot-offline { background: var(--text-tertiary); }

	.conv-info { min-width: 0; flex: 1; }
	.conv-top { display: flex; justify-content: space-between; align-items: center; }
	.conv-name { font-size: 0.8rem; color: var(--text-primary); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.conv-time { font-size: 0.65rem; color: var(--text-tertiary); flex-shrink: 0; }
	.conv-status-label { font-size: 0.6rem; flex-shrink: 0; color: var(--text-tertiary); }
	.label-ready { color: #4ade80; }
	.label-connecting { color: #facc15; }
	.conv-preview {
		font-size: 0.75rem; color: var(--text-secondary);
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px;
	}
	.conv-preview.unread-preview { color: var(--text-primary); font-weight: 600; }
	.unread-dot {
		width: 8px; height: 8px; border-radius: 50%; background: var(--accent);
		flex-shrink: 0; margin-left: auto;
	}

	.empty-contacts {
		display: flex; flex-direction: column; align-items: center; justify-content: center;
		padding: 40px 20px; gap: 12px; color: var(--text-tertiary); font-size: 0.85rem;
	}

	/* Chat area */
	.chat-area {
		flex: 1; display: flex; flex-direction: column;
		min-width: 0;
	}
	.chat-header {
		display: flex; align-items: center; gap: 10px;
		padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.04);
		background: var(--bg-root);
	}
	.chat-header-info { display: flex; flex-direction: column; gap: 1px; }
	.chat-name { font-size: 0.85rem; color: var(--text-primary); font-weight: 500; }
	.chat-status { font-size: 0.7rem; color: var(--text-tertiary); }
	.chat-status.label-ready { color: #4ade80; }
	.chat-status.label-connecting { color: #facc15; }
	.chat-messages {
		flex: 1; overflow-y: auto; padding: 16px 20px;
		display: flex; flex-direction: column; gap: 6px;
	}
	.msg { display: flex; }
	.msg.outgoing { justify-content: flex-end; }
	.bubble {
		max-width: 70%; padding: 10px 14px; border-radius: 16px;
		background: var(--bg-raised); border: 1px solid rgba(255,255,255,0.04);
		display: flex; align-items: baseline; gap: 10px;
	}
	.bubble-out {
		background: rgba(249, 115, 22, 0.1);
		border-color: var(--accent-border);
	}
	.msg-text { line-height: 1.4; font-size: 0.9rem; word-break: break-word; }
	.msg-meta { display: flex; align-items: center; gap: 3px; flex-shrink: 0; }
	.msg-time { font-size: 0.6rem; color: var(--text-tertiary); white-space: nowrap; }
	.msg-status { font-size: 0.65rem; }
	.status-queued { color: var(--text-tertiary); }
	.status-sent { color: var(--text-tertiary); }
	.status-read { color: #4ade80; }
	.chat-compose {
		display: flex; gap: 8px; padding: 12px 20px;
		border-top: 1px solid rgba(255,255,255,0.04);
		background: var(--bg-root);
	}
	.chat-compose .input { flex: 1; }
	.encrypt-bar {
		padding: 12px 20px; text-align: center;
		color: var(--text-tertiary); font-size: 0.8rem;
		border-top: 1px solid rgba(255,255,255,0.04);
		background: var(--bg-root);
	}
	.lock-icon { color: var(--accent); }
	.no-chat {
		flex: 1; display: flex; flex-direction: column;
		align-items: center; justify-content: center;
		color: var(--text-tertiary);
	}
	.no-chat p { margin: 2px 0; font-size: 0.9rem; }
	.no-chat .sub { font-size: 0.85rem; }
	.chat-empty {
		flex: 1; display: flex; flex-direction: column;
		align-items: center; justify-content: center;
		color: var(--text-tertiary); gap: 4px;
	}
	.chat-empty .sub { font-size: 0.8rem; }
	.key-spinner {
		width: 24px; height: 24px; border: 2px solid rgba(255,255,255,0.1);
		border-top-color: var(--accent); border-radius: 50%;
		animation: spin 1s linear infinite; margin-bottom: 8px;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	.back-btn {
		display: none; background: none; border: none; color: var(--text-secondary);
		font-size: 1.1rem; cursor: pointer; padding: 4px 8px;
	}
	.back-btn:hover { color: var(--accent); }

	/* Mobile: show sidebar OR chat */
	@media (max-width: 768px) {
		.dm-layout { height: calc(100vh - 56px - env(safe-area-inset-bottom, 0)); }
		.sidebar { width: 100%; min-width: 100%; }
		.chat-area { width: 100%; min-width: 100%; }
		.back-btn { display: block; }
		.chat-open .sidebar { display: none; }
		.dm-layout:not(.chat-open) .chat-area { display: none; }
		.chat-compose { padding-bottom: calc(12px + env(safe-area-inset-bottom, 0)); }
	}
</style>
