<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { feedState, appState, identityState } from '$lib/stores.svelte.js';
	import type { PostContent, SignedObject } from '@agora/core';

	let pubkey = $derived($page.params.pubkey);
	let loaded = $state(false);

	onMount(() => {
		const check = setInterval(() => {
			if (appState.profileManager && appState.feedManager) {
				clearInterval(check);
				loaded = true;
			}
		}, 50);
		return () => clearInterval(check);
	});

	let profile = $derived(appState.profileManager?.getProfile(pubkey));
	let displayName = $derived(profile?.name || pubkey.slice(0, 12) + '...');
	let location = $derived(appState.profileManager?.locationString(pubkey));
	let isMe = $derived(identityState.identity?.publicKeyBase64 === pubkey);

	let userPosts = $derived(
		feedState.objects
			.filter((o) => o.body.type === 'post' && o.body.author === pubkey && !(o.body.content as PostContent).reply)
			.sort((a, b) => b.body.timestamp - a.body.timestamp)
	);

	function formatTime(ts: number): string {
		const diff = Date.now() - ts;
		if (diff < 60_000) return 'now';
		if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
		if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
		return new Date(ts).toLocaleDateString();
	}

	function replyCount(postId: string): number {
		return feedState.objects.filter((o) =>
			o.body.type === 'post' && (o.body.content as PostContent).reply === postId
		).length;
	}

	let copied = $state(false);
	let linkCopied = $state(false);

	function copyAddress() {
		navigator.clipboard.writeText(pubkey);
		copied = true;
		setTimeout(() => { copied = false; }, 2000);
	}

	function copyInviteLink() {
		const base = window.location.origin.replace('app.', '');
		const link = `${window.location.origin}/join/${encodeURIComponent(pubkey)}`;
		navigator.clipboard.writeText(link);
		linkCopied = true;
		setTimeout(() => { linkCopied = false; }, 2000);
	}
</script>

{#if loaded}
	<div class="profile-header card">
		<div class="avatar">{pubkey.slice(0, 2)}</div>
		<div class="profile-info">
			<h2 class="name">{displayName}</h2>
			{#if location}
				<div class="location">{location}</div>
			{/if}
			{#if profile?.online}
				<span class="badge badge-online">online</span>
			{/if}
		</div>
		<div class="profile-actions">
			{#if isMe}
				<a href="/settings" class="btn btn-secondary">Edit Profile</a>
			{:else}
				<a href="/dm/{encodeURIComponent(pubkey)}" class="btn">Message</a>
			{/if}
		</div>
	</div>

	<div class="address-row card">
		<code class="mono address-text">{pubkey}</code>
		<button class="btn btn-secondary btn-sm" onclick={copyAddress}>{copied ? 'Copied' : 'Copy'}</button>
		<button class="btn btn-secondary btn-sm" onclick={copyInviteLink}>{linkCopied ? 'Link Copied' : 'Share Link'}</button>
	</div>

	<h3 class="section-title">{userPosts.length} {userPosts.length === 1 ? 'Post' : 'Posts'}</h3>

	<div class="feed">
		{#each userPosts as obj (obj.id)}
			{@const content = obj.body.content as PostContent}
			{@const replies = replyCount(obj.id)}
			<a href="/post/{encodeURIComponent(obj.id)}" class="post card">
				<div class="post-header">
					{#if content.topic}
						<span class="topic">#{content.topic}</span>
					{/if}
					<span class="time">{formatTime(obj.body.timestamp)}</span>
				</div>
				{#if content.text}
					<div class="post-text">{content.text}</div>
				{/if}
				{#if content.image}
					<div class="post-image"><img src={content.image} alt="" /></div>
				{/if}
				{#if replies > 0}
					<div class="post-footer">
						<span class="reply-count">{replies} {replies === 1 ? 'reply' : 'replies'}</span>
					</div>
				{/if}
			</a>
		{/each}
		{#if userPosts.length === 0}
			<div class="empty"><p>No posts yet.</p></div>
		{/if}
	</div>
{:else}
	<div class="loading">Loading...</div>
{/if}

<style>
	.profile-header {
		display: flex; align-items: center; gap: 16px; padding: 20px;
		margin-bottom: 12px;
	}
	.avatar {
		width: 56px; height: 56px; border-radius: 50%; flex-shrink: 0;
		background: var(--bg-raised); display: flex; align-items: center; justify-content: center;
		font-family: var(--font-mono); font-size: 1rem; color: var(--accent);
		border: 2px solid var(--accent-border);
	}
	.profile-info { flex: 1; }
	.name { font-size: 1.2rem; margin: 0 0 4px; }
	.location { color: var(--text-tertiary); font-size: 0.8rem; margin-bottom: 4px; }
	.profile-actions { flex-shrink: 0; }
	.address-row {
		display: flex; gap: 8px; align-items: center;
		padding: 10px 16px; margin-bottom: 24px;
	}
	.address-text {
		flex: 1; font-size: 0.6rem; color: var(--accent);
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.btn-sm { padding: 4px 12px; font-size: 0.75rem; }
	.section-title {
		color: var(--text-secondary); font-size: 0.8rem; font-weight: 600;
		text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 12px;
	}
	.feed { display: flex; flex-direction: column; gap: 8px; }
	.post {
		display: block; padding: 14px 16px; text-decoration: none;
		color: inherit; transition: all 0.2s; cursor: pointer;
	}
	.post:hover { border-color: var(--accent-border); }
	.post-header { display: flex; gap: 10px; align-items: center; font-size: 0.8rem; margin-bottom: 8px; }
	.topic { color: var(--accent); font-size: 0.75rem; }
	.time { color: var(--text-tertiary); margin-left: auto; font-size: 0.75rem; }
	.post-text { white-space: pre-wrap; line-height: 1.5; font-size: 0.9rem; }
	.post-image { margin-top: 10px; }
	.post-image img { max-width: 100%; max-height: 300px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); }
	.post-footer { margin-top: 10px; }
	.reply-count { color: var(--text-secondary); font-size: 0.75rem; padding: 2px 8px; background: var(--bg-input); border-radius: 10px; }
	.empty { text-align: center; margin-top: 48px; color: var(--text-tertiary); }
	.loading { text-align: center; margin-top: 64px; color: var(--text-tertiary); }
</style>
