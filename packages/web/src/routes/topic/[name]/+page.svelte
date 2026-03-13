<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { createObject, type PostContent, type SignedObject } from '@agora/core';
	import { identityState } from '$lib/stores.svelte.js';
	import type { RelayClient } from '$lib/relay.js';

	let topicName = $derived($page.params.name);
	let objects = $state<SignedObject[]>([]);
	let composeText = $state('');
	let seq = $state(1);
	let lastId: string | undefined = $state(undefined);
	let relay: RelayClient | null = $state(null);

	function addObject(obj: SignedObject) {
		if (objects.some((o) => o.id === obj.id)) return;
		objects = [...objects, obj].sort((a, b) => b.body.timestamp - a.body.timestamp);
	}

	onMount(() => {
		const check = setInterval(() => {
			const r = (window as any).__agora_relay as RelayClient | undefined;
			if (r) {
				relay = r;
				clearInterval(check);
				r.setHandlers({
					onEvent: (subId, obj) => {
						if (subId === `topic:${topicName}`) addObject(obj);
					},
					onEose: () => {},
					onStatus: () => {},
				});
				r.subscribe(`topic:${topicName}`, [{ types: ['post'], topics: [topicName] }]);
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
			content: { text: composeText.trim(), topic: topicName } as PostContent,
			seq: seq,
			prev: lastId,
		});

		addObject(obj);
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

<h2>#{topicName}</h2>

{#if identityState.identity}
	<div class="compose">
		<textarea
			bind:value={composeText}
			placeholder="Post to #{topicName}..."
			rows="3"
			onkeydown={(e) => { if (e.key === 'Enter' && e.metaKey) post(); }}
		></textarea>
		<button onclick={post} disabled={!composeText.trim()}>Post</button>
	</div>

	<div class="feed">
		{#each objects as obj (obj.id)}
			{@const content = obj.body.content as PostContent}
			<article class="post">
				<div class="post-header">
					<span class="author">{obj.body.author.slice(0, 8)}...</span>
					<span class="time">{formatTime(obj.body.timestamp)}</span>
				</div>
				<div class="post-text">{content.text}</div>
			</article>
		{/each}
		{#if objects.length === 0}
			<p class="empty">No posts in #{topicName} yet.</p>
		{/if}
	</div>
{/if}

<style>
	h2 { color: #fff; margin-bottom: 16px; }
	.compose { margin-bottom: 24px; }
	textarea {
		width: 100%; background: #1a1a1a; border: 1px solid #333;
		border-radius: 8px; color: #e0e0e0; padding: 12px;
		font-size: 1em; resize: vertical; box-sizing: border-box; font-family: inherit;
	}
	textarea:focus { outline: none; border-color: #6eb5ff; }
	button {
		background: #6eb5ff; color: #000; border: none; border-radius: 6px;
		padding: 8px 20px; font-size: 0.9em; font-weight: 600; cursor: pointer; margin-top: 8px;
	}
	button:disabled { opacity: 0.4; cursor: default; }
	.post { padding: 12px 0; border-bottom: 1px solid #1a1a1a; }
	.post-header { display: flex; gap: 8px; font-size: 0.85em; margin-bottom: 6px; }
	.author { font-family: monospace; color: #6eb5ff; }
	.time { color: #555; margin-left: auto; }
	.post-text { white-space: pre-wrap; line-height: 1.5; }
	.empty { text-align: center; color: #555; margin-top: 48px; }
</style>
