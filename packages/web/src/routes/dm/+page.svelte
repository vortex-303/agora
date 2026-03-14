<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { page } from '$app/stores';
	import { appState, identityState } from '$lib/stores.svelte.js';
	import type { DecryptedDM } from '$lib/dm.js';

	let conversations = $state<Array<{ partner: string; lastMessage: DecryptedDM }>>([]);
	let activePartner = $state<string | null>(null);
	let messages = $state<DecryptedDM[]>([]);
	let composeText = $state('');
	let canEncrypt = $state(false);
	let newAddress = $state('');
	let messagesEl: HTMLDivElement;

	onMount(() => {
		const check = setInterval(() => {
			const dm = appState.dmManager;
			const pm = appState.profileManager;
			if (dm && pm) {
				clearInterval(check);
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
				});

				// Auto-open from redirect
				const pending = sessionStorage.getItem('agora_dm_open');
				if (pending) {
					sessionStorage.removeItem('agora_dm_open');
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

	function selectConversation(partner: string) {
		activePartner = partner;
		const dm = appState.dmManager;
		const pm = appState.profileManager;
		if (dm) messages = dm.getConversation(partner);
		canEncrypt = !!pm?.getX25519Key(partner);
		tick().then(scrollBottom);
	}

	function startNew() {
		if (newAddress.trim()) {
			selectConversation(newAddress.trim());
			newAddress = '';
		}
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

	function locationOf(key: string): string | undefined {
		return appState.profileManager?.locationString(key);
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
</script>

<div class="dm-layout" class:chat-open={!!activePartner}>
	<!-- Sidebar -->
	<div class="sidebar">
		<div class="sidebar-header">
			<h2>Messages</h2>
		</div>

		<div class="conv-list">
			{#each conversations as conv (conv.partner)}
				<button
					class="conv-item" class:active={activePartner === conv.partner}
					onclick={() => selectConversation(conv.partner)}
				>
					<div class="conv-avatar">{conv.partner.slice(0, 2)}</div>
					<div class="conv-info">
						<div class="conv-top">
							<span class="conv-name mono">{displayName(conv.partner)}</span>
							<span class="conv-time">{formatRelative(conv.lastMessage.timestamp)}</span>
						</div>
						<div class="conv-preview">{conv.lastMessage.outgoing ? 'You: ' : ''}{conv.lastMessage.text.slice(0, 40)}</div>
					</div>
				</button>
			{/each}
		</div>

		<div class="sidebar-footer">
			<input class="input mono" bind:value={newAddress} placeholder="Paste address to chat"
				onkeydown={(e) => { if (e.key === 'Enter') startNew(); }}
			/>
		</div>
	</div>

	<!-- Chat area -->
	<div class="chat-area">
		{#if activePartner}
			<div class="chat-header">
				<button class="back-btn" onclick={() => { activePartner = null; }}>←</button>
				<div class="chat-avatar">{activePartner.slice(0, 2)}</div>
				<div class="chat-header-info">
					<span class="chat-name mono">{displayName(activePartner)}</span>
					{#if locationOf(activePartner)}
						<span class="chat-location">{locationOf(activePartner)}</span>
					{/if}
				</div>
			</div>

			<div class="chat-messages" bind:this={messagesEl}>
				{#each messages as msg (msg.id)}
					<div class="msg" class:outgoing={msg.outgoing}>
						<div class="bubble" class:bubble-out={msg.outgoing}>
							<span class="msg-text">{msg.text}</span>
							<span class="msg-time">{formatTime(msg.timestamp)}</span>
						</div>
					</div>
				{/each}
				{#if messages.length === 0}
					<div class="chat-empty">
						{#if canEncrypt}
							<p>Send an encrypted message.</p>
						{:else}
							<p>Waiting for encryption key...</p>
							<p class="sub">This person needs to come online once to exchange keys.</p>
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
					<span class="lock-icon">E2E pending</span> — waiting for recipient's key
				</div>
			{/if}
		{:else}
			<div class="no-chat">
				<div class="no-chat-icon">💬</div>
				<p>Select a conversation</p>
				<p class="sub">Or find someone on the <a href="/network">Network</a> page</p>
			</div>
		{/if}
	</div>
</div>

<style>
	.dm-layout {
		display: flex; height: calc(100vh - 80px);
		border: 1px solid rgba(255,255,255,0.04); border-radius: 12px;
		overflow: hidden; background: var(--bg-surface);
	}

	/* Sidebar */
	.sidebar {
		width: 280px; min-width: 280px;
		flex-shrink: 0;
		display: flex; flex-direction: column;
		border-right: 1px solid rgba(255,255,255,0.04);
		background: var(--bg-root);
	}
	.sidebar-header {
		padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.04);
	}
	.sidebar-header h2 { margin: 0; font-size: 1rem; color: var(--text-primary); }
	.conv-list { flex: 1; overflow-y: auto; }
	.conv-item {
		display: flex; align-items: center; gap: 10px;
		width: 100%; padding: 12px 16px; border: none; background: none;
		color: inherit; cursor: pointer; text-align: left;
		transition: background 0.15s;
	}
	.conv-item:hover { background: var(--bg-surface); }
	.conv-item.active { background: var(--bg-raised); border-left: 2px solid var(--accent); }
	.conv-avatar {
		width: 36px; height: 36px; border-radius: 50%;
		background: var(--bg-raised); display: flex; align-items: center; justify-content: center;
		font-family: var(--font-mono); font-size: 0.7rem; color: var(--accent);
		border: 1px solid var(--accent-border); flex-shrink: 0;
	}
	.conv-info { min-width: 0; flex: 1; }
	.conv-top { display: flex; justify-content: space-between; align-items: center; }
	.conv-name { font-size: 0.8rem; color: var(--text-primary); font-weight: 500; }
	.conv-time { font-size: 0.65rem; color: var(--text-tertiary); }
	.conv-preview {
		font-size: 0.75rem; color: var(--text-secondary);
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px;
	}
	.sidebar-footer {
		padding: 12px; border-top: 1px solid rgba(255,255,255,0.04);
	}
	.sidebar-footer .input { font-size: 0.75rem; padding: 8px 10px; }

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
	.chat-avatar {
		width: 32px; height: 32px; border-radius: 50%;
		background: var(--bg-raised); display: flex; align-items: center; justify-content: center;
		font-family: var(--font-mono); font-size: 0.65rem; color: var(--accent);
		border: 1px solid var(--accent-border);
	}
	.chat-header-info { display: flex; flex-direction: column; gap: 1px; }
	.chat-name { font-size: 0.85rem; color: var(--accent); }
	.chat-location { font-size: 0.7rem; color: var(--text-tertiary); }
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
	.msg-time { font-size: 0.6rem; color: var(--text-tertiary); flex-shrink: 0; white-space: nowrap; }
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
	.no-chat-icon { font-size: 2rem; margin-bottom: 12px; opacity: 0.5; }
	.no-chat p { margin: 2px 0; }
	.no-chat .sub { font-size: 0.85rem; }
	.chat-empty {
		flex: 1; display: flex; flex-direction: column;
		align-items: center; justify-content: center;
		color: var(--text-tertiary);
	}
	.chat-empty .sub { font-size: 0.8rem; }
	.back-btn {
		display: none; background: none; border: none; color: var(--text-secondary);
		font-size: 1.1rem; cursor: pointer; padding: 4px 8px;
	}
	.back-btn:hover { color: var(--accent); }

	/* Mobile: show sidebar OR chat */
	@media (max-width: 640px) {
		.dm-layout { height: calc(100vh - 70px); border-radius: 0; border: none; }
		.sidebar { width: 100%; min-width: 100%; }
		.chat-area { width: 100%; min-width: 100%; }
		.back-btn { display: block; }
		.chat-open .sidebar { display: none; }
		.dm-layout:not(.chat-open) .chat-area { display: none; }
	}
</style>
