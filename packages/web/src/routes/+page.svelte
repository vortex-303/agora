<script lang="ts">
	import { onMount } from 'svelte';
	import { createObject, type PostContent, type SignedObject } from '@agora/core';
	import { identityState, feedState, addToFeed, setFeed, appState } from '$lib/stores.svelte.js';
	import { TOPICS } from '$lib/topics.js';

	let composeText = $state('');
	let activeTopic = $state('general');
	let loaded = $state(false);
	let composeImage = $state<string | null>(null);
	let fileInput: HTMLInputElement;

	onMount(() => {
		const check = setInterval(async () => {
			const fm = appState.feedManager;
			if (fm) {
				clearInterval(check);
				const cached = await fm.loadCachedFeed();
				if (cached.length > 0) setFeed(cached);
				fm.onObject((obj) => { if (obj.body.type === 'post') addToFeed(obj); });
				await fm.subscribe('feed', [{ types: ['post'] }]);
				loaded = true;
			}
		}, 50);
		return () => clearInterval(check);
	});

	function post() {
		const identity = identityState.identity;
		const fm = appState.feedManager;
		if (!identity || !fm || (!composeText.trim() && !composeImage)) return;
		const state = fm.getAuthorState(identity.publicKeyBase64);
		const content: PostContent = {
			text: composeText.trim(),
			topic: activeTopic,
		};
		if (composeImage) content.image = composeImage;
		const obj = createObject({
			author: identity.publicKeyBase64,
			privateKey: identity.privateKey,
			type: 'post',
			content,
			seq: state.seq + 1,
			prev: state.lastId,
		});
		addToFeed(obj);
		fm.publish(obj);
		composeText = '';
		composeImage = null;
	}

	function handleFile(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file || !file.type.startsWith('image/')) return;
		if (file.size > 500_000) { alert('Image must be under 500KB'); return; }
		const reader = new FileReader();
		reader.onload = () => { composeImage = reader.result as string; };
		reader.readAsDataURL(file);
	}

	function handlePaste(e: ClipboardEvent) {
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const item of items) {
			if (item.type.startsWith('image/')) {
				e.preventDefault();
				const file = item.getAsFile();
				if (!file) return;
				if (file.size > 500_000) { alert('Image must be under 500KB'); return; }
				const reader = new FileReader();
				reader.onload = () => { composeImage = reader.result as string; };
				reader.readAsDataURL(file);
				return;
			}
		}
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

	let topicPosts = $derived(
		feedState.objects.filter((o) => {
			if (o.body.type !== 'post') return false;
			const c = o.body.content as PostContent;
			return c.topic === activeTopic && !c.reply;
		})
	);

	function replyCount(postId: string): number {
		return feedState.objects.filter((o) =>
			o.body.type === 'post' && (o.body.content as PostContent).reply === postId
		).length;
	}
</script>

{#if identityState.identity}
	<div class="topic-tabs">
		{#each TOPICS as topic (topic.id)}
			<button class="topic-tab" class:active={activeTopic === topic.id}
				onclick={() => { activeTopic = topic.id; }}>
				#{topic.label}
			</button>
		{/each}
	</div>

	<div class="compose card">
		<textarea class="input" bind:value={composeText}
			placeholder="Post to #{activeTopic}..." rows="2"
			onkeydown={(e) => { if (e.key === 'Enter' && e.metaKey) post(); }}
			onpaste={handlePaste}
		></textarea>
		{#if composeImage}
			<div class="compose-preview">
				<img src={composeImage} alt="preview" />
				<button class="remove-img" onclick={() => { composeImage = null; }}>✕</button>
			</div>
		{/if}
		<div class="compose-bar">
			<div class="compose-left">
				<span class="compose-topic">#{activeTopic}</span>
				<button class="img-btn" onclick={() => fileInput.click()} title="Add image">🖼</button>
				<input bind:this={fileInput} type="file" accept="image/*" onchange={handleFile} hidden />
			</div>
			<button class="btn" onclick={post} disabled={!composeText.trim() && !composeImage}>Post</button>
		</div>
	</div>

	<div class="feed">
		{#each topicPosts as obj (obj.id)}
			{@const content = obj.body.content as PostContent}
			{@const replies = replyCount(obj.id)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="post card" onclick={() => window.location.href = `/post/${encodeURIComponent(obj.id)}`}>
				<div class="post-header">
					<a href="/u/{encodeURIComponent(obj.body.author)}" class="author mono"
						onclick={(e) => e.stopPropagation()}>{displayName(obj.body.author)}</a>
					<span class="time">{formatTime(obj.body.timestamp)}</span>
				</div>
				{#if content.text}
					<div class="post-text">{content.text}</div>
				{/if}
				{#if content.image}
					<div class="post-image">
						<img src={content.image} alt="" />
					</div>
				{/if}
				{#if replies > 0}
					<div class="post-footer">
						<span class="reply-count">{replies} {replies === 1 ? 'reply' : 'replies'}</span>
					</div>
				{/if}
			</div>
		{/each}
		{#if topicPosts.length === 0 && loaded}
			<div class="empty">
				<p>No posts in #{activeTopic} yet.</p>
				<p class="sub">Be the first to post.</p>
			</div>
		{/if}
	</div>
{:else}
	<div class="loading">Initializing...</div>
{/if}

<style>
	.topic-tabs {
		display: flex; gap: 4px; margin-bottom: 16px;
		overflow-x: auto; padding-bottom: 4px;
		-webkit-overflow-scrolling: touch;
	}
	.topic-tabs::-webkit-scrollbar { display: none; }
	.topic-tab {
		background: var(--bg-surface); border: 1px solid rgba(255,255,255,0.04);
		border-radius: 20px; padding: 6px 14px; color: var(--text-secondary);
		font-size: 0.8rem; font-weight: 500; cursor: pointer;
		white-space: nowrap; transition: all 0.2s; flex-shrink: 0;
	}
	.topic-tab:hover { border-color: var(--accent-border); color: var(--text-primary); }
	.topic-tab.active {
		background: rgba(249,115,22,0.1); border-color: var(--accent);
		color: var(--accent); font-weight: 600;
	}
	.compose { margin-bottom: 20px; }
	.compose textarea {
		resize: vertical; min-height: 60px;
		background: var(--bg-input); border-color: rgba(255,255,255,0.04);
	}
	.compose-preview {
		position: relative; margin-top: 8px; display: inline-block;
	}
	.compose-preview img {
		max-height: 120px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);
	}
	.remove-img {
		position: absolute; top: 4px; right: 4px;
		background: rgba(0,0,0,0.7); color: #fff; border: none;
		width: 20px; height: 20px; border-radius: 50%; cursor: pointer;
		font-size: 0.7rem; display: flex; align-items: center; justify-content: center;
	}
	.compose-bar {
		display: flex; justify-content: space-between; align-items: center; margin-top: 8px;
	}
	.compose-left { display: flex; align-items: center; gap: 8px; }
	.compose-topic { color: var(--text-tertiary); font-size: 0.8rem; }
	.img-btn {
		background: none; border: none; cursor: pointer; font-size: 1rem;
		padding: 2px 4px; opacity: 0.5; transition: opacity 0.2s;
	}
	.img-btn:hover { opacity: 1; }
	.feed { display: flex; flex-direction: column; gap: 8px; }
	.post {
		display: block; padding: 14px 16px; text-decoration: none; color: inherit;
		transition: all 0.2s; cursor: pointer;
	}
	.post:hover { border-color: var(--accent-border); }
	.post-header {
		display: flex; gap: 10px; align-items: center;
		font-size: 0.8rem; margin-bottom: 8px;
	}
	.author { color: var(--accent); font-size: 0.8rem; font-weight: 500; }
	.time { color: var(--text-tertiary); margin-left: auto; font-size: 0.75rem; }
	.post-text { white-space: pre-wrap; line-height: 1.5; font-size: 0.9rem; }
	.post-image { margin-top: 10px; }
	.post-image img {
		max-width: 100%; max-height: 400px; border-radius: 8px;
		border: 1px solid rgba(255,255,255,0.06);
	}
	.post-footer { margin-top: 10px; }
	.reply-count {
		color: var(--text-secondary); font-size: 0.75rem;
		padding: 2px 8px; background: var(--bg-input); border-radius: 10px;
	}
	.empty { text-align: center; margin-top: 64px; color: var(--text-tertiary); }
	.empty p { margin: 4px 0; }
	.empty .sub { font-size: 0.85rem; }
	.loading { text-align: center; margin-top: 64px; color: var(--text-tertiary); }

	/* Mobile responsive */
	@media (max-width: 640px) {
		.topic-tabs { gap: 3px; }
		.topic-tab { padding: 5px 10px; font-size: 0.75rem; }
	}
</style>
