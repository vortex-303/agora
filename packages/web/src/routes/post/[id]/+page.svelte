<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { createObject, type PostContent, type SignedObject } from '@agora/core';
	import { identityState, feedState, addToFeed, appState } from '$lib/stores.svelte.js';
	import Markdown from '$lib/Markdown.svelte';

	let postId = $derived($page.params.id);
	let replyText = $state('');

	function displayName(key: string): string {
		return appState.profileManager?.displayName(key) || key.slice(0, 8) + '...';
	}

	function formatTime(ts: number): string {
		const d = new Date(ts);
		const diff = Date.now() - ts;
		if (diff < 60_000) return 'just now';
		if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
		return d.toLocaleString();
	}

	let parentPost = $derived(feedState.objects.find((o) => o.id === postId));
	let parentContent = $derived(parentPost ? parentPost.body.content as PostContent : null);

	let replies = $derived(
		feedState.objects
			.filter((o) => o.body.type === 'post' && (o.body.content as PostContent).reply === postId)
			.sort((a, b) => a.body.timestamp - b.body.timestamp)
	);

	function reply() {
		const identity = identityState.identity;
		const fm = appState.feedManager;
		if (!identity || !fm || !replyText.trim() || !parentContent) return;

		const state = fm.getAuthorState(identity.publicKeyBase64);
		const obj = createObject({
			author: identity.publicKeyBase64,
			privateKey: identity.privateKey,
			type: 'post',
			content: {
				text: replyText.trim(),
				topic: parentContent.topic,
				reply: postId,
			} as PostContent,
			seq: state.seq + 1,
			prev: state.lastId,
		});
		addToFeed(obj);
		fm.publish(obj);
		replyText = '';
	}
</script>

{#if parentPost && parentContent}
	<div class="breadcrumb">
		<a href="/">Feed</a>
		{#if parentContent.topic}
			<span class="sep">/</span>
			<span class="crumb-topic">#{parentContent.topic}</span>
		{/if}
	</div>

	<article class="parent card">
		<div class="post-header">
			<a href="/u/{encodeURIComponent(parentPost.body.author)}" class="author mono">{displayName(parentPost.body.author)}</a>
			<span class="time">{formatTime(parentPost.body.timestamp)}</span>
		</div>
		<div class="post-text"><Markdown text={parentContent.text} /></div>
		{#if parentContent.image}
			<div class="post-image"><img src={parentContent.image} alt="" /></div>
		{/if}
	</article>

	<div class="replies-section">
		<h3 class="section-title">{replies.length} {replies.length === 1 ? 'Reply' : 'Replies'}</h3>

		<div class="reply-compose card">
			<textarea
				class="input"
				bind:value={replyText}
				placeholder="Write a reply..."
				rows="2"
				onkeydown={(e) => { if (e.key === 'Enter' && e.metaKey) reply(); }}
			></textarea>
			<div class="compose-bar">
				<span></span>
				<button class="btn" onclick={reply} disabled={!replyText.trim()}>Reply</button>
			</div>
		</div>

		<div class="replies">
			{#each replies as r (r.id)}
				{@const rc = r.body.content as PostContent}
				<div class="reply card">
					<div class="reply-header">
						<a href="/u/{encodeURIComponent(r.body.author)}" class="author mono">{displayName(r.body.author)}</a>
						<span class="time">{formatTime(r.body.timestamp)}</span>
					</div>
					<div class="reply-text"><Markdown text={rc.text} /></div>
				</div>
			{/each}
		</div>
	</div>
{:else}
	<div class="not-found">
		<p>Post not found.</p>
		<a href="/">Back to feed</a>
	</div>
{/if}

<style>
	.breadcrumb {
		display: flex; align-items: center; gap: 6px;
		font-size: 0.8rem; margin-bottom: 16px; color: var(--text-secondary);
	}
	.breadcrumb a { color: var(--text-secondary); }
	.breadcrumb a:hover { color: var(--accent); }
	.sep { color: var(--text-tertiary); }
	.crumb-topic { color: var(--accent); }
	.parent { padding: 18px 20px; margin-bottom: 24px; }
	.post-header {
		display: flex; gap: 10px; align-items: center;
		font-size: 0.8rem; margin-bottom: 10px;
	}
	.author { color: var(--accent); font-weight: 500; }
	.time { color: var(--text-tertiary); margin-left: auto; font-size: 0.75rem; }
	.post-text { white-space: pre-wrap; line-height: 1.6; font-size: 1rem; }
	.post-image { margin-top: 10px; }
	.post-image img { max-width: 100%; max-height: 500px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); }
	.section-title {
		color: var(--text-secondary); font-size: 0.8rem; font-weight: 600;
		text-transform: uppercase; letter-spacing: 0.05em;
		margin: 0 0 12px;
	}
	.reply-compose { margin-bottom: 16px; padding: 14px; }
	.reply-compose textarea {
		resize: vertical; min-height: 50px;
		background: var(--bg-input); border-color: rgba(255,255,255,0.04);
	}
	.compose-bar {
		display: flex; justify-content: space-between; align-items: center; margin-top: 8px;
	}
	.replies { display: flex; flex-direction: column; gap: 6px; }
	.reply { padding: 12px 16px; }
	.reply-header {
		display: flex; gap: 10px; align-items: center;
		font-size: 0.8rem; margin-bottom: 6px;
	}
	.reply-text { white-space: pre-wrap; line-height: 1.5; font-size: 0.9rem; }
	.not-found { text-align: center; margin-top: 64px; color: var(--text-tertiary); }
</style>
