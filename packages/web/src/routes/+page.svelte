<script lang="ts">
	import { onMount } from 'svelte';
	import { createObject, type SignedObject, type PostContent } from '@agora/core';
	import { identityState, feedState, addToFeed, connectionState } from '$lib/stores.svelte.js';
	import type { RelayClient } from '$lib/relay.js';

	let composeText = $state('');
	let composeTopic = $state('general');
	let seq = $state(1);
	let lastId: string | undefined = $state(undefined);
	let relay: RelayClient | null = $state(null);

	onMount(() => {
		const check = setInterval(() => {
			const r = (window as any).__agora_relay as RelayClient | undefined;
			if (r) {
				relay = r;
				clearInterval(check);
				r.setHandlers({
					onEvent: (_subId, obj) => addToFeed(obj),
					onEose: () => {},
					onStatus: (status) => { connectionState.status = status; },
				});
				r.subscribe('feed', [{ types: ['post'] }]);
			}
		}, 100);
		return () => clearInterval(check);
	});

	function post() {
		const identity = identityState.identity;
		if (!identity || !composeText.trim()) return;

		const obj = createObject({
			author: identity.publicKeyBase64,
			privateKey: identity.privateKey,
			type: 'post',
			content: { text: composeText.trim(), topic: composeTopic || undefined } as PostContent,
			seq: seq,
			prev: lastId,
		});

		addToFeed(obj);
		relay?.publish(obj);

		lastId = obj.id;
		seq++;
		composeText = '';
	}

	function formatTime(ts: number): string {
		const diff = Date.now() - ts;
		if (diff < 60_000) return 'just now';
		if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
		return new Date(ts).toLocaleDateString();
	}
</script>

{#if identityState.identity}
	<div class="compose">
		<textarea
			bind:value={composeText}
			placeholder="What's on your mind?"
			rows="3"
			onkeydown={(e) => { if (e.key === 'Enter' && e.metaKey) post(); }}
		></textarea>
		<div class="compose-bar">
			<label>
				Topic: <input bind:value={composeTopic} placeholder="general" class="topic-input" />
			</label>
			<button onclick={post} disabled={!composeText.trim()}>Post</button>
		</div>
	</div>

	<div class="feed">
		{#each feedState.objects as obj (obj.id)}
			{@const content = obj.body.content as PostContent}
			<article class="post">
				<div class="post-header">
					<span class="author">{obj.body.author.slice(0, 8)}...</span>
					{#if content.topic}
						<a href="/topic/{content.topic}" class="topic">#{content.topic}</a>
					{/if}
					<span class="time">{formatTime(obj.body.timestamp)}</span>
				</div>
				<div class="post-text">{content.text}</div>
			</article>
		{/each}
		{#if feedState.objects.length === 0}
			<p class="empty">No posts yet. Be the first!</p>
		{/if}
	</div>
{:else}
	<p>Loading...</p>
{/if}

<style>
	.compose {
		margin-bottom: 24px;
	}
	textarea {
		width: 100%;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 8px;
		color: #e0e0e0;
		padding: 12px;
		font-size: 1em;
		resize: vertical;
		box-sizing: border-box;
		font-family: inherit;
	}
	textarea:focus {
		outline: none;
		border-color: #6eb5ff;
	}
	.compose-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 8px;
	}
	.topic-input {
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 4px;
		color: #e0e0e0;
		padding: 4px 8px;
		font-size: 0.85em;
		width: 120px;
	}
	button {
		background: #6eb5ff;
		color: #000;
		border: none;
		border-radius: 6px;
		padding: 8px 20px;
		font-size: 0.9em;
		font-weight: 600;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	button:hover:not(:disabled) {
		background: #8ec8ff;
	}
	.feed {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.post {
		padding: 12px 0;
		border-bottom: 1px solid #1a1a1a;
	}
	.post-header {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 0.85em;
		margin-bottom: 6px;
	}
	.author {
		font-family: monospace;
		color: #6eb5ff;
	}
	.topic {
		color: #888;
		font-size: 0.9em;
	}
	.time {
		color: #555;
		margin-left: auto;
	}
	.post-text {
		white-space: pre-wrap;
		line-height: 1.5;
	}
	.empty {
		text-align: center;
		color: #555;
		margin-top: 48px;
	}
	label {
		color: #888;
		font-size: 0.85em;
	}
</style>
