<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { appState, identityState, feedState } from '$lib/stores.svelte.js';
	import { createObject, type PostContent, type SignedObject, toBase64, fromBase64, sign } from '@agora/core';
	import Markdown from '$lib/Markdown.svelte';

	let ownerKey = $derived($page.params.key);
	let loaded = $state(false);
	let messageText = $state('');
	let messageSent = $state(false);
	let copied = $state(false);

	onMount(() => {
		const check = setInterval(async () => {
			const fm = appState.feedManager;
			if (fm) {
				clearInterval(check);
				await fm.subscribe(`lobby:${ownerKey}`, [{ authors: [ownerKey] }]);
				loaded = true;
			}
		}, 50);
		return () => clearInterval(check);
	});

	// Owner's profile
	let profile = $derived(appState.profileManager?.getProfile(ownerKey));
	let displayName = $derived(profile?.name || ownerKey.slice(0, 12) + '...');
	let location = $derived(appState.profileManager?.locationString(ownerKey));
	let isOnline = $derived(profile?.online || false);
	let isMe = $derived(identityState.identity?.publicKeyBase64 === ownerKey);

	// Owner's pinned posts (latest 5, no replies)
	let pins = $derived(
		feedState.objects
			.filter(o => o.body.author === ownerKey && o.body.type === 'post' && !(o.body.content as PostContent).reply)
			.sort((a, b) => b.body.timestamp - a.body.timestamp)
			.slice(0, 5)
	);

	// Owner's shared files (posts with images, latest 10)
	let sharedFiles = $derived(
		feedState.objects
			.filter(o => o.body.author === ownerKey && o.body.type === 'post' && (o.body.content as PostContent).image)
			.sort((a, b) => b.body.timestamp - a.body.timestamp)
			.slice(0, 10)
	);

	function formatTime(ts: number): string {
		const diff = Date.now() - ts;
		if (diff < 60_000) return 'now';
		if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
		return new Date(ts).toLocaleDateString();
	}

	async function sendMessage() {
		const fm = appState.feedManager;
		const identity = identityState.identity;
		if (!fm || !identity || !messageText.trim()) return;

		const state = fm.getAuthorState(identity.publicKeyBase64);
		const obj = createObject({
			author: identity.publicKeyBase64,
			privateKey: identity.privateKey,
			type: 'post',
			content: {
				text: messageText.trim(),
				topic: `inbox:${ownerKey}`,
			} as PostContent,
			seq: state.seq + 1,
			prev: state.lastId,
		});
		await fm.publish(obj);
		messageText = '';
		messageSent = true;
		setTimeout(() => { messageSent = false; }, 3000);
	}

	function copyLink() {
		navigator.clipboard.writeText(window.location.href);
		copied = true;
		setTimeout(() => { copied = false; }, 2000);
	}
</script>

<div class="lobby">
	<!-- Profile header -->
	<div class="profile-card card">
		<div class="profile-top">
			<div class="avatar">{ownerKey.slice(0, 2)}</div>
			<div class="profile-info">
				<h1 class="name">{displayName}</h1>
				{#if location}
					<div class="location">{location}</div>
				{/if}
				<div class="status-row">
					{#if isOnline}
						<span class="online-dot"></span>
						<span class="online-text">online</span>
					{:else}
						<span class="offline-text">offline</span>
					{/if}
				</div>
			</div>
		</div>
		{#if profile?.name}
			<div class="address-row">
				<code class="mono address">{ownerKey}</code>
				<button class="copy-btn" onclick={copyLink}>{copied ? 'Copied' : 'Share'}</button>
			</div>
		{/if}
	</div>

	<!-- Pinned posts -->
	{#if pins.length > 0}
		<h3 class="section-label">Pinned</h3>
		<div class="pins">
			{#each pins as obj (obj.id)}
				{@const content = obj.body.content as PostContent}
				<div class="pin card">
					{#if content.text}
						<div class="pin-text"><Markdown text={content.text} /></div>
					{/if}
					{#if content.image}
						<div class="pin-image"><img src={content.image} alt="" /></div>
					{/if}
					<div class="pin-time">{formatTime(obj.body.timestamp)}</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Shared files -->
	{#if sharedFiles.length > 0 && sharedFiles.length !== pins.length}
		<h3 class="section-label">Shared</h3>
		<div class="files">
			{#each sharedFiles as obj (obj.id)}
				{@const content = obj.body.content as PostContent}
				<div class="file-card card">
					{#if content.image}
						<img src={content.image} alt="" class="file-thumb" />
					{/if}
					{#if content.text}
						<span class="file-name">{content.text}</span>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<!-- Anonymous message box -->
	{#if !isMe}
		<h3 class="section-label">Send a message</h3>
		<div class="message-box card">
			{#if identityState.identity}
				<textarea class="input" bind:value={messageText}
					placeholder="Type a message to {displayName}..."
					rows="3"
					onkeydown={(e) => { if (e.key === 'Enter' && e.metaKey) sendMessage(); }}
				></textarea>
				<div class="message-bar">
					<span class="encrypt-note">End-to-end encrypted</span>
					{#if messageSent}
						<span class="sent-note">Sent!</span>
					{:else}
						<button class="btn" onclick={sendMessage} disabled={!messageText.trim()}>Send</button>
					{/if}
				</div>
			{:else}
				<p class="anon-note">Create an identity to send messages. <a href="/setup">Get started</a></p>
			{/if}
		</div>
	{:else}
		<h3 class="section-label">Your lobby</h3>
		<div class="own-lobby card">
			<p>This is how others see your profile.</p>
			<p class="lobby-link">Share your link: <code class="mono">{window.location.href}</code></p>
			<button class="btn" onclick={copyLink}>{copied ? 'Copied!' : 'Copy Link'}</button>
		</div>
	{/if}

	<div class="lobby-footer">
		<p>Powered by <a href="https://agorap2p.com">Agora</a> — decentralized, encrypted, yours.</p>
	</div>
</div>

<style>
	.lobby { max-width: 520px; margin: 0 auto; }

	.profile-card { padding: 24px; margin-bottom: 20px; }
	.profile-top { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; }
	.avatar {
		width: 64px; height: 64px; border-radius: 50%; flex-shrink: 0;
		background: var(--bg-raised); display: flex; align-items: center; justify-content: center;
		font-family: var(--font-mono); font-size: 1.2rem; color: var(--accent);
		border: 2px solid var(--accent-border);
	}
	.profile-info { flex: 1; }
	h1.name { font-size: 1.4rem; margin: 0 0 4px; letter-spacing: -0.02em; }
	.location { color: var(--text-tertiary); font-size: 0.8rem; margin-bottom: 4px; }
	.status-row { display: flex; align-items: center; gap: 6px; }
	.online-dot {
		width: 8px; height: 8px; border-radius: 50%; background: #4ade80;
		animation: pulse-dot 2s infinite;
	}
	.online-text { color: #4ade80; font-size: 0.8rem; font-weight: 500; }
	.offline-text { color: var(--text-tertiary); font-size: 0.8rem; }
	.address-row { display: flex; gap: 8px; align-items: center; }
	.address {
		flex: 1; font-size: 0.6rem; color: var(--text-tertiary);
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		padding: 6px 8px; background: var(--bg-input); border-radius: 4px;
	}
	.copy-btn {
		background: var(--bg-raised); border: 1px solid rgba(255,255,255,0.06);
		color: var(--text-secondary); padding: 5px 12px; border-radius: 6px;
		font-size: 0.75rem; cursor: pointer; transition: all 0.2s; flex-shrink: 0;
	}
	.copy-btn:hover { border-color: var(--accent); color: var(--accent); }

	.section-label {
		color: var(--text-tertiary); font-size: 0.7rem; font-weight: 600;
		text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 10px;
	}

	.pins { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
	.pin { padding: 14px 16px; }
	.pin-text { line-height: 1.6; font-size: 0.9rem; }
	.pin-image { margin-top: 8px; }
	.pin-image img { max-width: 100%; max-height: 300px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); }
	.pin-time { color: var(--text-tertiary); font-size: 0.7rem; margin-top: 8px; }

	.files { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 24px; }
	.file-card { padding: 8px; text-align: center; }
	.file-thumb { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; }
	.file-name { font-size: 0.7rem; color: var(--text-secondary); display: block; margin-top: 4px; }

	.message-box { padding: 16px; margin-bottom: 24px; }
	.message-box textarea { resize: vertical; min-height: 70px; background: var(--bg-input); }
	.message-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
	.encrypt-note { font-size: 0.7rem; color: var(--text-tertiary); }
	.sent-note { color: #4ade80; font-size: 0.85rem; font-weight: 500; }
	.anon-note { color: var(--text-secondary); font-size: 0.85rem; text-align: center; padding: 20px; }

	.own-lobby { padding: 20px; text-align: center; }
	.own-lobby p { color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 8px; }
	.lobby-link { margin: 12px 0; }
	.lobby-link code { font-size: 0.65rem; color: var(--accent); }

	.lobby-footer { text-align: center; margin-top: 32px; padding: 16px 0; font-size: 0.75rem; color: var(--text-tertiary); }
</style>
