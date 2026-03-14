<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { createObject, type PostContent, type SignedObject } from '@agora/core';
	import { identityState, appState } from '$lib/stores.svelte.js';

	let topicName = $derived($page.params.name);
	let objects = $state<SignedObject[]>([]);
	let composeText = $state('');
	let loaded = $state(false);

	function addObject(obj: SignedObject) {
		if (objects.some((o) => o.id === obj.id)) return;
		objects = [...objects, obj].sort((a, b) => b.body.timestamp - a.body.timestamp);
	}

	onMount(() => {
		const check = setInterval(async () => {
			const fm = appState.feedManager;
			if (fm) {
				clearInterval(check);
				const cached = await fm.loadCachedTopic(topicName);
				for (const obj of cached) addObject(obj);
				fm.onObject((obj) => {
					if (obj.body.type === 'post' && (obj.body.content as PostContent).topic === topicName) addObject(obj);
				});
				await fm.subscribe(`topic:${topicName}`, [{ types: ['post'], topics: [topicName] }]);
				loaded = true;
			}
		}, 50);
		return () => clearInterval(check);
	});

	function post() {
		const identity = identityState.identity;
		const fm = appState.feedManager;
		if (!identity || !fm || !composeText.trim()) return;
		const state = fm.getAuthorState(identity.publicKeyBase64);
		const obj = createObject({
			author: identity.publicKeyBase64, privateKey: identity.privateKey,
			type: 'post', content: { text: composeText.trim(), topic: topicName } as PostContent,
			seq: state.seq + 1, prev: state.lastId,
		});
		addObject(obj);
		fm.publish(obj);
		composeText = '';
	}

	function displayName(key: string): string {
		return appState.profileManager?.displayName(key) || key.slice(0, 8) + '...';
	}

	function formatTime(ts: number): string {
		const diff = Date.now() - ts;
		if (diff < 60_000) return 'now';
		if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
		if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
		return new Date(ts).toLocaleDateString();
	}
</script>

<h2><span class="hash">#</span>{topicName}</h2>

{#if identityState.identity}
	<div class="compose card">
		<textarea class="input" bind:value={composeText} placeholder="Post to #{topicName}..." rows="3"
			onkeydown={(e) => { if (e.key === 'Enter' && e.metaKey) post(); }}
		></textarea>
		<button class="btn" onclick={post} disabled={!composeText.trim()} style="margin-top: 8px">Post</button>
	</div>

	<div class="feed">
		{#each objects as obj (obj.id)}
			{@const content = obj.body.content as PostContent}
			<article class="post card">
				<div class="post-header">
					<a href="/dm/{encodeURIComponent(obj.body.author)}" class="author mono">{displayName(obj.body.author)}</a>
					<span class="time">{formatTime(obj.body.timestamp)}</span>
				</div>
				<div class="post-text">{content.text}</div>
			</article>
		{/each}
		{#if objects.length === 0 && loaded}
			<div class="empty"><p>No posts in #{topicName} yet.</p></div>
		{/if}
	</div>
{/if}

<style>
	h2 { color: var(--text-primary); font-size: 1.3rem; margin-bottom: 20px; }
	.hash { color: var(--accent); }
	.compose { margin-bottom: 20px; }
	.compose textarea { resize: vertical; min-height: 80px; background: var(--bg-input); }
	.feed { display: flex; flex-direction: column; gap: 8px; }
	.post { padding: 14px 16px; }
	.post-header { display: flex; gap: 10px; align-items: center; font-size: 0.8rem; margin-bottom: 8px; }
	.author { color: var(--accent); font-size: 0.8rem; font-weight: 500; }
	.time { color: var(--text-tertiary); margin-left: auto; font-size: 0.75rem; }
	.post-text { white-space: pre-wrap; line-height: 1.5; font-size: 0.9rem; }
	.empty { text-align: center; margin-top: 64px; color: var(--text-tertiary); }
</style>
