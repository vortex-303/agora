<script lang="ts">
	import { onMount } from 'svelte';
	import { feedState, appState, identityState } from '$lib/stores.svelte.js';
	import type { PostContent } from '@agora/core';
	import Markdown from '$lib/Markdown.svelte';

	let loaded = $state(false);

	onMount(() => {
		const check = setInterval(async () => {
			const fm = appState.feedManager;
			const id = identityState.identity;
			if (fm && id) {
				clearInterval(check);
				await fm.subscribe('my-inbox', [{ topics: [`inbox:${id.publicKeyBase64}`] }]);
				loaded = true;
			}
		}, 50);
		return () => clearInterval(check);
	});

	let myKey = $derived(identityState.identity?.publicKeyBase64 || '');

	let messages = $derived(
		feedState.objects
			.filter(o => {
				if (o.body.type !== 'post') return false;
				const c = o.body.content as PostContent;
				return c.topic === `inbox:${myKey}` && o.body.author !== myKey;
			})
			.sort((a, b) => b.body.timestamp - a.body.timestamp)
			.slice(0, 100)
	);

	function displayName(key: string): string {
		return appState.profileManager?.displayName(key) || key.slice(0, 10) + '...';
	}

	function formatTime(ts: number): string {
		const diff = Date.now() - ts;
		if (diff < 60_000) return 'now';
		if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
		return new Date(ts).toLocaleDateString();
	}
</script>

<h2>Inbox</h2>
<p class="desc">Messages sent to your lobby by visitors.</p>

{#if messages.length > 0}
	<div class="messages">
		{#each messages as msg (msg.id)}
			{@const content = msg.body.content as PostContent}
			<div class="msg card">
				<div class="msg-header">
					<a href="/u/{encodeURIComponent(msg.body.author)}" class="msg-author mono">
						{displayName(msg.body.author)}
					</a>
					<span class="msg-time">{formatTime(msg.body.timestamp)}</span>
				</div>
				<div class="msg-text"><Markdown text={content.text} /></div>
			</div>
		{/each}
	</div>
{:else if loaded}
	<div class="empty">
		<p>No messages yet.</p>
		<p class="sub">Share your lobby link and people can message you anonymously.</p>
		{#if identityState.identity}
			<code class="lobby-url">{window.location.origin}/p/{encodeURIComponent(identityState.identity.publicKeyBase64)}</code>
		{/if}
	</div>
{:else}
	<p class="loading">Loading...</p>
{/if}

<style>
	h2 { color: var(--text-primary); margin: 0 0 4px; font-size: 1.3rem; }
	.desc { color: var(--text-tertiary); font-size: 0.85rem; margin-bottom: 20px; }
	.messages { display: flex; flex-direction: column; gap: 8px; }
	.msg { padding: 14px 16px; }
	.msg-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
	.msg-author { color: var(--accent); font-size: 0.8rem; font-weight: 500; }
	.msg-time { color: var(--text-tertiary); font-size: 0.7rem; }
	.msg-text { line-height: 1.5; font-size: 0.9rem; }
	.empty { text-align: center; margin-top: 64px; color: var(--text-tertiary); }
	.empty .sub { font-size: 0.85rem; margin-bottom: 16px; }
	.lobby-url {
		display: block; font-size: 0.7rem; color: var(--accent);
		padding: 8px; background: var(--bg-input); border-radius: 6px;
		word-break: break-all; max-width: 400px; margin: 0 auto;
	}
	.loading { text-align: center; margin-top: 64px; color: var(--text-tertiary); }
</style>
