<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { createObject, type PostContent, type SignedObject } from '@agora/core';
	import { identityState, feedState, addToFeed, appState, reactiveState } from '$lib/stores.svelte.js';
	import Markdown from '$lib/Markdown.svelte';

	let loaded = $state(false);
	let pinText = $state('');
	let pinImage = $state<string | null>(null);
	let fileInput: HTMLInputElement;
	let shareFileInput: HTMLInputElement;
	let copied = $state(false);
	let qrVisible = $state(false);

	onMount(() => {
		const check = setInterval(async () => {
			if (!identityState.identity) return;
			loaded = true;
			const fm = appState.feedManager;
			if (fm) {
				clearInterval(check);
				const myKey = identityState.identity.publicKeyBase64;
				// Load from cache first (instant)
				const cached = await fm.loadCachedFeed();
				for (const obj of cached) addToFeed(obj);
				// Wire live objects from P2P gossip
				fm.onObject((obj) => addToFeed(obj));
			}
		}, 50);
		return () => clearInterval(check);
	});

	let _tick = $derived(reactiveState.tick);
	let myKey = $derived(identityState.identity?.publicKeyBase64 || '');
	let profile = $derived(appState.profileManager?.getProfile(myKey));

	// Concierge info from localStorage
	let concierge = $state<{ availability?: string; services?: string; preferredContact?: string; links?: Array<{label:string;url:string}>; faqs?: Array<{q:string;a:string}> }>({});
	$effect(() => {
		try {
			const c = localStorage.getItem('riot_concierge_profile');
			if (c) concierge = JSON.parse(c);
		} catch {}
	});
	let displayName = $derived(profile?.name || myKey.slice(0, 12) + '...');
	let location = $derived(appState.profileManager?.locationString(myKey));
	let myUsername = $derived(profile?.name?.toLowerCase().replace(/\s+/g, '') || '');
	let lobbyUrl = $derived(
		typeof window !== 'undefined'
			? (myUsername ? `${window.location.origin}/${myUsername}` : `${window.location.origin}/p/${encodeURIComponent(myKey)}`)
			: ''
	);

	// Pins: my latest posts (no replies, no inbox messages, not deleted), max 5
	let pins = $derived((_tick,
		feedState.objects
			.filter(o => o.body.author === myKey && o.body.type === 'post' &&
				!(o.body.content as PostContent).reply &&
				!(o.body.content as PostContent).topic?.startsWith('inbox:') &&
				!appState.moderation?.isDeleted(o.id))
			.sort((a, b) => b.body.timestamp - a.body.timestamp)
			.slice(0, 5))
	);

	// Shared files: my posts with images, not deleted
	let sharedFiles = $derived((_tick,
		feedState.objects
			.filter(o => o.body.author === myKey && o.body.type === 'post' &&
				(o.body.content as PostContent).image &&
				!appState.moderation?.isDeleted(o.id))
			.sort((a, b) => b.body.timestamp - a.body.timestamp)
			.slice(0, 10))
	);

	// Inbox messages from visitors
	let inboxMessages = $derived(
		feedState.objects
			.filter(o => o.body.type === 'post' && (o.body.content as PostContent).topic === `inbox:${myKey}` && o.body.author !== myKey)
			.sort((a, b) => b.body.timestamp - a.body.timestamp)
			.slice(0, 20)
	);

	function addPin() {
		const identity = identityState.identity;
		const fm = appState.feedManager;
		if (!identity || !fm || (!pinText.trim() && !pinImage)) return;
		const state = fm.getAuthorState(identity.publicKeyBase64);
		const content: PostContent = { text: pinText.trim() };
		if (pinImage) content.image = pinImage;
		const obj = createObject({
			author: identity.publicKeyBase64, privateKey: identity.privateKey,
			type: 'post', content, seq: state.seq + 1, prev: state.lastId,
		});
		addToFeed(obj);
		fm.publish(obj);
		pinText = '';
		pinImage = null;
	}

	function shareFile(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		if (file.size > 500_000) { alert('File must be under 500KB'); return; }
		const reader = new FileReader();
		reader.onload = () => {
			const identity = identityState.identity;
			const fm = appState.feedManager;
			if (!identity || !fm) return;
			const state = fm.getAuthorState(identity.publicKeyBase64);
			const obj = createObject({
				author: identity.publicKeyBase64, privateKey: identity.privateKey,
				type: 'post',
				content: { text: file.name, image: reader.result as string } as PostContent,
				seq: state.seq + 1, prev: state.lastId,
			});
			addToFeed(obj);
			fm.publish(obj);
		};
		reader.readAsDataURL(file);
	}

	function handlePinPaste(e: ClipboardEvent) {
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const item of items) {
			if (item.type.startsWith('image/')) {
				e.preventDefault();
				const file = item.getAsFile();
				if (!file || file.size > 500_000) return;
				const reader = new FileReader();
				reader.onload = () => { pinImage = reader.result as string; };
				reader.readAsDataURL(file);
				return;
			}
		}
	}

	function copyLink() {
		navigator.clipboard.writeText(lobbyUrl);
		copied = true;
		setTimeout(() => { copied = false; }, 2000);
	}

	function senderName(key: string): string {
		return appState.profileManager?.displayName(key) || key.slice(0, 10) + '...';
	}

	function formatTime(ts: number): string {
		const diff = Date.now() - ts;
		if (diff < 60_000) return 'now';
		if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
		if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
		return new Date(ts).toLocaleDateString();
	}

	async function deletePin(id: string) {
		await appState.moderation?.deletePost(id);
	}
</script>

{#if identityState.identity && loaded}
	<!-- Profile card -->
	<div class="profile-card card">
		<div class="profile-top">
			<div class="avatar">{myKey.slice(0, 2)}</div>
			<div class="profile-info">
				<h1 class="name">{displayName}</h1>
				{#if location}
					<div class="loc">{location}</div>
				{/if}
				<div class="status-row">
					<span class="online-dot"></span>
					<span class="online-text">online</span>
				</div>
			</div>
			<a href="/settings" class="edit-btn">Edit</a>
		</div>
		<div class="link-row">
			<code class="lobby-url mono">{lobbyUrl}</code>
			<button class="btn btn-sm" onclick={copyLink}>{copied ? 'Copied!' : 'Copy Link'}</button>
		</div>
		<p class="link-hint">Share this link. Anyone can view your lobby and message you.</p>
	</div>

	<!-- Concierge info -->
	{#if concierge.availability || concierge.services || concierge.preferredContact || (concierge.links && concierge.links.length > 0)}
		<div class="concierge-info card">
			{#if concierge.availability}
				<div class="ci-row">
					<span class="ci-icon">🕐</span>
					<span class="ci-text">{concierge.availability}</span>
				</div>
			{/if}
			{#if concierge.services}
				<div class="ci-row">
					<span class="ci-icon">💼</span>
					<span class="ci-text">{concierge.services}</span>
				</div>
			{/if}
			{#if concierge.preferredContact}
				<div class="ci-row">
					<span class="ci-icon">📧</span>
					<span class="ci-text">{concierge.preferredContact}</span>
				</div>
			{/if}
			{#if concierge.links && concierge.links.length > 0}
				<div class="ci-links">
					{#each concierge.links as link}
						<a href={link.url} target="_blank" class="ci-link">{link.label} →</a>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Pins -->
	<div class="section">
		<div class="section-header">
			<h3 class="section-label">Pinned <span class="count">{pins.length}/5</span></h3>
		</div>
		{#if pins.length < 5}
			<div class="add-pin card">
				<textarea class="input" bind:value={pinText} placeholder="Pin a message, link, or idea..."
					rows="2" onpaste={handlePinPaste}
					onkeydown={(e) => { if (e.key === 'Enter' && e.metaKey) addPin(); }}
				></textarea>
				{#if pinImage}
					<div class="pin-preview">
						<img src={pinImage} alt="" />
						<button class="remove-img" onclick={() => { pinImage = null; }}>✕</button>
					</div>
				{/if}
				<div class="add-bar">
					<button class="img-btn" onclick={() => fileInput.click()}>🖼</button>
					<input bind:this={fileInput} type="file" accept="image/*" onchange={(e) => {
						const f = (e.target as HTMLInputElement).files?.[0];
						if (f && f.size < 500_000) { const r = new FileReader(); r.onload = () => { pinImage = r.result as string; }; r.readAsDataURL(f); }
					}} hidden />
					<button class="btn btn-sm" onclick={addPin} disabled={!pinText.trim() && !pinImage}>Pin</button>
				</div>
			</div>
		{/if}
		{#each pins as obj (obj.id)}
			{@const content = obj.body.content as PostContent}
			<div class="pin card">
				{#if content.text}
					<div class="pin-text"><Markdown text={content.text} /></div>
				{/if}
				{#if content.image}
					<div class="pin-image"><img src={content.image} alt="" /></div>
				{/if}
				<div class="pin-footer">
					<span class="pin-time">{formatTime(obj.body.timestamp)}</span>
					<button class="delete-btn" onclick={() => deletePin(obj.id)}>Remove</button>
				</div>
			</div>
		{/each}
	</div>

	<!-- Shared files -->
	<div class="section">
		<div class="section-header">
			<h3 class="section-label">Shared Files</h3>
			<button class="btn btn-sm btn-secondary" onclick={() => shareFileInput.click()}>+ Share File</button>
			<input bind:this={shareFileInput} type="file" onchange={shareFile} hidden />
		</div>
		{#if sharedFiles.length > 0}
			<div class="files">
				{#each sharedFiles as obj (obj.id)}
					{@const content = obj.body.content as PostContent}
					<div class="file-item card">
						{#if content.image}
							<img src={content.image} alt="" class="file-thumb" />
						{/if}
						<div class="file-info">
							<span class="file-name">{content.text || 'File'}</span>
							<span class="file-time">{formatTime(obj.body.timestamp)}</span>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<p class="empty-hint">No files shared yet. Files are visible to anyone who visits your lobby.</p>
		{/if}
	</div>

	<!-- Inbox -->
	<div class="section">
		<h3 class="section-label">Lobby Inbox <span class="count">{inboxMessages.length}</span></h3>
		{#if inboxMessages.length > 0}
			<div class="inbox">
				{#each inboxMessages as msg (msg.id)}
					{@const content = msg.body.content as PostContent}
					<a href="/dm/{encodeURIComponent(msg.body.author)}" class="inbox-msg card">
						<div class="msg-top">
							<span class="msg-sender mono">{senderName(msg.body.author)}</span>
							<span class="msg-time">{formatTime(msg.body.timestamp)}</span>
						</div>
						<div class="msg-text">{content.text}</div>
						<span class="msg-reply">Reply →</span>
					</a>
				{/each}
			</div>
		{:else}
			<p class="empty-hint">No messages yet. Share your lobby link and people can message you.</p>
		{/if}
	</div>
{:else if !identityState.identity}
	<div class="loading"></div>
{:else}
	<div class="loading">Loading your lobby...</div>
{/if}

<style>
	.profile-card { padding: 20px; margin-bottom: 20px; }
	.profile-top { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
	.avatar {
		width: 56px; height: 56px; border-radius: 50%; flex-shrink: 0;
		background: var(--bg-raised); display: flex; align-items: center; justify-content: center;
		font-family: var(--font-mono); font-size: 1.1rem; color: var(--accent);
		border: 2px solid var(--accent-border);
	}
	.profile-info { flex: 1; }
	h1.name { font-size: 1.3rem; margin: 0 0 2px; letter-spacing: -0.02em; }
	.loc { color: var(--text-tertiary); font-size: 0.8rem; }
	.status-row { display: flex; align-items: center; gap: 5px; margin-top: 2px; }
	.online-dot { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; animation: pulse-dot 2s infinite; }
	.online-text { color: #4ade80; font-size: 0.75rem; }
	.edit-btn {
		color: var(--text-tertiary); font-size: 0.8rem; text-decoration: none;
		padding: 4px 10px; border: 1px solid rgba(255,255,255,0.06); border-radius: 6px;
		transition: all 0.2s;
	}
	.edit-btn:hover { border-color: var(--accent); color: var(--accent); }
	.link-row { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
	.lobby-url {
		flex: 1; font-size: 0.6rem; color: var(--accent); padding: 6px 8px;
		background: var(--bg-input); border-radius: 4px;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.btn-sm { padding: 5px 12px; font-size: 0.75rem; }
	.btn-secondary { background: var(--bg-raised); color: var(--text-primary); border: 1px solid rgba(255,255,255,0.06); }
	.btn-secondary:hover { border-color: var(--accent); color: var(--accent); box-shadow: none; transform: none; }
	.link-hint { color: var(--text-tertiary); font-size: 0.7rem; }

	.concierge-info { padding: 14px 16px; margin-bottom: 16px; }
	.ci-row { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
	.ci-row:last-child { margin-bottom: 0; }
	.ci-icon { font-size: 0.85rem; flex-shrink: 0; margin-top: 1px; }
	.ci-text { font-size: 0.85rem; color: var(--text-secondary); line-height: 1.4; }
	.ci-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
	.ci-link {
		font-size: 0.8rem; color: var(--accent); padding: 4px 10px;
		background: var(--bg-input); border-radius: 6px; transition: all 0.15s;
	}
	.ci-link:hover { background: rgba(249,115,22,0.1); }

	.section { margin-bottom: 24px; }
	.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
	.section-label {
		color: var(--text-secondary); font-size: 0.75rem; font-weight: 600;
		text-transform: uppercase; letter-spacing: 0.06em; margin: 0;
	}
	.count { color: var(--text-tertiary); font-weight: 400; }

	.add-pin {
		padding: 14px; margin-bottom: 8px;
		background: rgba(249,115,22,0.06);
		border-color: rgba(249,115,22,0.2);
	}
	.add-pin textarea { resize: none; min-height: 44px; background: var(--bg-root); font-size: 0.85rem; border-color: rgba(249,115,22,0.15); }
	.add-pin textarea:focus { border-color: var(--accent); }
	.pin-preview { position: relative; margin-top: 6px; display: inline-block; }
	.pin-preview img { max-height: 80px; border-radius: 6px; }
	.remove-img {
		position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,0.7); color: #fff;
		border: none; width: 18px; height: 18px; border-radius: 50%; cursor: pointer; font-size: 0.6rem;
		display: flex; align-items: center; justify-content: center;
	}
	.add-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; }
	.img-btn { background: none; border: none; cursor: pointer; font-size: 0.9rem; opacity: 0.5; }
	.img-btn:hover { opacity: 1; }

	.pin { padding: 12px 14px; margin-bottom: 6px; }
	.pin-text { line-height: 1.5; font-size: 0.9rem; }
	.pin-image { margin-top: 6px; }
	.pin-image img { max-width: 100%; max-height: 200px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06); }
	.pin-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
	.pin-time { color: var(--text-tertiary); font-size: 0.7rem; }
	.delete-btn { background: none; border: none; color: var(--text-tertiary); font-size: 0.7rem; cursor: pointer; }
	.delete-btn:hover { color: #f87171; }

	.files { display: flex; flex-direction: column; gap: 6px; }
	.file-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; }
	.file-thumb { width: 40px; height: 40px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }
	.file-info { flex: 1; min-width: 0; }
	.file-name { font-size: 0.85rem; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.file-time { font-size: 0.7rem; color: var(--text-tertiary); }

	.inbox { display: flex; flex-direction: column; gap: 6px; }
	.inbox-msg { display: block; padding: 12px 14px; text-decoration: none; color: inherit; transition: all 0.2s; }
	.inbox-msg:hover { border-color: var(--accent-border); }
	.msg-top { display: flex; justify-content: space-between; margin-bottom: 4px; }
	.msg-sender { color: var(--accent); font-size: 0.8rem; font-weight: 500; }
	.msg-time { color: var(--text-tertiary); font-size: 0.7rem; }
	.msg-text { font-size: 0.85rem; color: var(--text-secondary); line-height: 1.4; }
	.msg-reply { color: var(--accent); font-size: 0.75rem; margin-top: 6px; display: block; opacity: 0; transition: opacity 0.2s; }
	.inbox-msg:hover .msg-reply { opacity: 1; }

	.empty-hint { color: var(--text-tertiary); font-size: 0.8rem; padding: 16px 0; }
	.loading { text-align: center; margin-top: 80px; color: var(--text-tertiary); }
</style>
