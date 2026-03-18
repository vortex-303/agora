<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { appState, identityState, feedState, addToFeed } from '$lib/stores.svelte.js';
	import { createObject, type PostContent } from '@agora/core';
	import Markdown from '$lib/Markdown.svelte';

	let username = $derived($page.params.username);
	let loaded = $state(false);
	let ownerKey = $state<string | null>(null);
	let messageText = $state('');
	let messageSent = $state(false);
	let copied = $state(false);

	// Resolve username to public key
	onMount(() => {
		const check = setInterval(async () => {
			const pm = appState.profileManager;
			const fm = appState.feedManager;
			if (pm && fm) {
				// Search all profiles for this username
				const all = pm.getAllProfiles();
				const found = all.find(p => p.name?.toLowerCase() === username.toLowerCase());

				// Also check if the param is itself a public key
				if (!found && username.length > 20) {
					ownerKey = username;
				} else if (found) {
					ownerKey = found.publicKey;
				}

				if (ownerKey) {
					clearInterval(check);
					await fm.subscribe(`lobby:${ownerKey}`, [{ authors: [ownerKey] }]);
					fm.onObject((obj) => addToFeed(obj));
					loaded = true;
				}
			}
		}, 100);

		// Timeout — if username not found after 5s, show not found
		setTimeout(() => {
			if (!ownerKey) {
				clearInterval(check);
				loaded = true;
			}
		}, 5000);

		return () => clearInterval(check);
	});

	let profile = $derived(ownerKey ? appState.profileManager?.getProfile(ownerKey) : null);
	let displayName = $derived(profile?.name || username);
	let location = $derived(ownerKey ? appState.profileManager?.locationString(ownerKey) : null);
	let isOnline = $derived(profile?.online || false);
	let isMe = $derived(identityState.identity?.publicKeyBase64 === ownerKey);

	let pins = $derived(
		ownerKey ? feedState.objects
			.filter(o => o.body.author === ownerKey && o.body.type === 'post' &&
				!(o.body.content as PostContent).reply &&
				!(o.body.content as PostContent).topic?.startsWith('inbox:'))
			.sort((a, b) => b.body.timestamp - a.body.timestamp)
			.slice(0, 5) : []
	);

	let sharedFiles = $derived(
		ownerKey ? feedState.objects
			.filter(o => o.body.author === ownerKey && o.body.type === 'post' && (o.body.content as PostContent).image)
			.sort((a, b) => b.body.timestamp - a.body.timestamp)
			.slice(0, 10) : []
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
		if (!fm || !identity || !ownerKey || !messageText.trim()) return;
		const state = fm.getAuthorState(identity.publicKeyBase64);
		const obj = createObject({
			author: identity.publicKeyBase64, privateKey: identity.privateKey,
			type: 'post',
			content: { text: messageText.trim(), topic: `inbox:${ownerKey}` } as PostContent,
			seq: state.seq + 1, prev: state.lastId,
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

{#if loaded && ownerKey}
	<div class="lobby">
		<div class="profile-card card">
			<div class="profile-top">
				<div class="avatar">{(profile?.name || ownerKey).slice(0, 2).toUpperCase()}</div>
				<div class="profile-info">
					<h1 class="name">{displayName}</h1>
					{#if location}
						<div class="loc">{location}</div>
					{/if}
					<div class="status-row">
						{#if isOnline}
							<span class="online-dot"></span>
							<span class="status-text online">online</span>
						{:else}
							<span class="status-text">offline</span>
						{/if}
					</div>
				</div>
			</div>
			<div class="link-bar">
				<code class="mono link-url">riotp2p.com/{username}</code>
				<button class="share-btn" onclick={copyLink}>{copied ? 'Copied!' : 'Share'}</button>
			</div>
		</div>

		{#if pins.length > 0}
			<div class="section">
				<h3 class="label">Pinned</h3>
				{#each pins as obj (obj.id)}
					{@const content = obj.body.content as PostContent}
					<div class="pin card">
						{#if content.text}<div class="pin-text"><Markdown text={content.text} /></div>{/if}
						{#if content.image}<div class="pin-img"><img src={content.image} alt="" /></div>{/if}
						<div class="pin-time">{formatTime(obj.body.timestamp)}</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if sharedFiles.length > 0}
			<div class="section">
				<h3 class="label">Files</h3>
				{#each sharedFiles as obj (obj.id)}
					{@const content = obj.body.content as PostContent}
					<div class="file card">
						{#if content.image}<img src={content.image} alt="" class="file-thumb" />{/if}
						<span class="file-name">{content.text || 'File'}</span>
					</div>
				{/each}
			</div>
		{/if}

		{#if !isMe}
			<div class="section">
				<h3 class="label">Send a message</h3>
				<div class="msg-box card">
					{#if identityState.identity}
						<textarea class="input" bind:value={messageText}
							placeholder="Message {displayName}..."
							rows="3"
							onkeydown={(e) => { if (e.key === 'Enter' && e.metaKey) sendMessage(); }}
						></textarea>
						<div class="msg-bar">
							<span class="encrypt-note">🔒 E2E encrypted</span>
							{#if messageSent}
								<span class="sent">Sent!</span>
							{:else}
								<button class="btn" onclick={sendMessage} disabled={!messageText.trim()}>Send</button>
							{/if}
						</div>
					{:else}
						<div class="anon-box">
							<p>Create an identity to send messages.</p>
							<a href="/setup" class="btn">Get Started — 10 seconds</a>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<div class="footer">
			<p>Powered by <a href="https://riotp2p.com">Riot</a> — encrypted, decentralized, yours.</p>
		</div>
	</div>
{:else if loaded}
	<div class="not-found">
		<h2>@{username}</h2>
		<p>This person hasn't joined Riot yet.</p>
		<p class="sub">Maybe they will. Share the link anyway.</p>
		<a href="/setup" class="btn">Create Your Own →</a>
	</div>
{:else}
	<div class="loading">Finding @{username}...</div>
{/if}

<style>
	.lobby { max-width: 520px; margin: 0 auto; }
	.profile-card { padding: 24px; margin-bottom: 20px; }
	.profile-top { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
	.avatar {
		width: 60px; height: 60px; border-radius: 50%; flex-shrink: 0;
		background: var(--bg-raised); display: flex; align-items: center; justify-content: center;
		font-family: var(--font-mono); font-size: 1.1rem; color: var(--accent);
		border: 2px solid var(--accent-border); font-weight: 700;
	}
	.profile-info { flex: 1; }
	h1.name { font-size: 1.4rem; margin: 0; letter-spacing: -0.02em; }
	.loc { color: var(--text-tertiary); font-size: 0.8rem; margin-top: 2px; }
	.status-row { display: flex; align-items: center; gap: 5px; margin-top: 3px; }
	.online-dot { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; animation: pulse-dot 2s infinite; }
	.status-text { font-size: 0.75rem; color: var(--text-tertiary); }
	.status-text.online { color: #4ade80; }
	.link-bar { display: flex; gap: 8px; align-items: center; }
	.link-url { flex: 1; font-size: 0.75rem; color: var(--accent); padding: 6px 10px; background: var(--bg-input); border-radius: 6px; }
	.share-btn {
		background: var(--bg-raised); border: 1px solid rgba(255,255,255,0.06); color: var(--text-secondary);
		padding: 6px 14px; border-radius: 6px; font-size: 0.8rem; cursor: pointer; transition: all 0.2s;
	}
	.share-btn:hover { border-color: var(--accent); color: var(--accent); }

	.section { margin-bottom: 20px; }
	.label { color: var(--text-tertiary); font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 8px; }
	.pin { padding: 12px 14px; margin-bottom: 6px; }
	.pin-text { line-height: 1.5; font-size: 0.9rem; }
	.pin-img { margin-top: 6px; }
	.pin-img img { max-width: 100%; max-height: 250px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06); }
	.pin-time { color: var(--text-tertiary); font-size: 0.65rem; margin-top: 6px; }

	.file { display: flex; align-items: center; gap: 10px; padding: 10px 12px; margin-bottom: 4px; }
	.file-thumb { width: 36px; height: 36px; border-radius: 6px; object-fit: cover; }
	.file-name { font-size: 0.85rem; }

	.msg-box { padding: 16px; }
	.msg-box textarea { resize: vertical; min-height: 60px; background: var(--bg-input); }
	.msg-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
	.encrypt-note { font-size: 0.7rem; color: var(--text-tertiary); }
	.sent { color: #4ade80; font-size: 0.85rem; font-weight: 500; }
	.anon-box { text-align: center; padding: 20px; }
	.anon-box p { color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 12px; }

	.footer { text-align: center; margin-top: 32px; padding: 16px 0; font-size: 0.75rem; color: var(--text-tertiary); }
	.not-found { text-align: center; margin-top: 80px; }
	.not-found h2 { color: var(--accent); font-size: 1.5rem; margin-bottom: 8px; }
	.not-found p { color: var(--text-secondary); margin-bottom: 4px; }
	.not-found .sub { color: var(--text-tertiary); font-size: 0.85rem; margin-bottom: 20px; }
	.loading { text-align: center; margin-top: 80px; color: var(--text-tertiary); }
</style>
