<script lang="ts">
	import { onMount } from 'svelte';
	import { createObject, type PostContent, type SignedObject } from '@agora/core';
	import { identityState, feedState, addToFeed, setFeed, appState } from '$lib/stores.svelte.js';
	import { TOPICS } from '$lib/topics.js';
	import Markdown from '$lib/Markdown.svelte';

	let composeText = $state('');
	let activeTopic = $state('general');
	let feedMode = $state<'topic' | 'personal'>('topic');
	let loaded = $state(false);
	let composeImage = $state<string | null>(null);
	let fileInput: HTMLInputElement;
	let newTopicName = $state('');
	let showNewTopic = $state(false);

	onMount(() => {
		// Default to personal feed if user follows any communities
		const mod = appState.moderation;
		if (mod && mod.getFollowedCommunities().length > 0) {
			feedMode = 'personal';
		}

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
		const content: PostContent = { text: composeText.trim(), topic: activeTopic };
		if (composeImage) content.image = composeImage;
		const obj = createObject({
			author: identity.publicKeyBase64, privateKey: identity.privateKey,
			type: 'post', content, seq: state.seq + 1, prev: state.lastId,
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
				if (!file || file.size > 500_000) return;
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

	function createTopic() {
		if (!newTopicName.trim()) return;
		activeTopic = newTopicName.trim().toLowerCase();
		showNewTopic = false;
		newTopicName = '';
	}

	async function vote(id: string, dir: 'upvote' | 'downvote') {
		await appState.voteManager?.vote(id, dir);
	}

	async function deletePost(id: string) {
		await appState.moderation?.deletePost(id);
	}

	// All known topics: hardcoded + any topic seen in posts
	let allTopics = $derived(() => {
		const seen = new Set(TOPICS.map(t => t.id));
		const extra: string[] = [];
		for (const obj of feedState.objects) {
			if (obj.body.type === 'post') {
				const t = (obj.body.content as PostContent).topic;
				if (t && !seen.has(t)) { seen.add(t); extra.push(t); }
			}
		}
		return [...TOPICS, ...extra.map(id => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1), description: '' }))];
	});

	// Personal feed: posts from followed communities
	let personalPosts = $derived(
		feedState.objects.filter((o) => {
			if (o.body.type !== 'post') return false;
			const c = o.body.content as PostContent;
			if (c.reply) return false;
			if (!appState.moderation?.shouldShow(o)) return false;
			const followed = appState.moderation?.getFollowedCommunities() || [];
			return c.topic && followed.includes(c.topic);
		})
	);

	// Topic posts
	let topicPosts = $derived(
		feedState.objects.filter((o) => {
			if (o.body.type !== 'post') return false;
			const c = o.body.content as PostContent;
			if (c.topic !== activeTopic || c.reply) return false;
			if (!appState.moderation?.shouldShow(o)) return false;
			return true;
		})
	);

	let displayPosts = $derived(feedMode === 'personal' ? personalPosts : topicPosts);

	function replyCount(postId: string): number {
		return feedState.objects.filter((o) =>
			o.body.type === 'post' && (o.body.content as PostContent).reply === postId
		).length;
	}

	function isFollowing(topic: string): boolean {
		return appState.moderation?.isFollowingCommunity(topic) || false;
	}

	function toggleFollow(topic: string) {
		const mod = appState.moderation;
		if (!mod) return;
		if (mod.isFollowingCommunity(topic)) mod.unfollowCommunity(topic);
		else mod.followCommunity(topic);
	}

	let isMyPost = (author: string) => author === identityState.identity?.publicKeyBase64;
</script>

{#if identityState.identity}
	<!-- Feed mode tabs -->
	<div class="mode-tabs">
		<button class="mode-tab" class:active={feedMode === 'personal'} onclick={() => { feedMode = 'personal'; }}>
			My Feed
		</button>
		<button class="mode-tab" class:active={feedMode === 'topic'} onclick={() => { feedMode = 'topic'; }}>
			Browse Topics
		</button>
	</div>

	{#if feedMode === 'topic'}
		<div class="topic-tabs">
			{#each allTopics() as topic (topic.id)}
				<button class="topic-tab" class:active={activeTopic === topic.id}
					onclick={() => { activeTopic = topic.id; }}>
					#{topic.label}
				</button>
			{/each}
			<button class="topic-tab new-topic" onclick={() => { showNewTopic = !showNewTopic; }}>+</button>
		</div>

		{#if showNewTopic}
			<div class="new-topic-form card">
				<input class="input" bind:value={newTopicName} placeholder="New topic name..."
					onkeydown={(e) => { if (e.key === 'Enter') createTopic(); }} />
				<button class="btn" onclick={createTopic} disabled={!newTopicName.trim()}>Create</button>
			</div>
		{/if}

		<div class="topic-header">
			<span class="topic-name">#{activeTopic}</span>
			<button class="follow-btn" class:following={isFollowing(activeTopic)}
				onclick={() => toggleFollow(activeTopic)}>
				{isFollowing(activeTopic) ? 'Following' : 'Follow'}
			</button>
		</div>
	{:else}
		{#if (appState.moderation?.getFollowedCommunities().length || 0) === 0}
			<div class="empty-follow">
				<p>You're not following any communities yet.</p>
				<p class="sub">Switch to "Browse Topics" and follow some communities to build your personal feed.</p>
			</div>
		{/if}
	{/if}

	<div class="compose card">
		<textarea class="input" bind:value={composeText}
			placeholder={feedMode === 'topic' ? `Post to #${activeTopic}...` : 'What\'s on your mind?'}
			rows="2" onkeydown={(e) => { if (e.key === 'Enter' && e.metaKey) post(); }}
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
		{#each displayPosts as obj (obj.id)}
			{@const content = obj.body.content as PostContent}
			{@const replies = replyCount(obj.id)}
			{@const votes = appState.voteManager?.getVotes(obj.id) || { up: 0, down: 0, score: 0, myVote: null }}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="post card" onclick={() => window.location.href = `/post/${encodeURIComponent(obj.id)}`}>
				<div class="post-header">
					<a href="/u/{encodeURIComponent(obj.body.author)}" class="author mono"
						onclick={(e) => e.stopPropagation()}>{displayName(obj.body.author)}</a>
					{#if content.topic && feedMode === 'personal'}
						<a href="/c/{content.topic}" class="topic-link" onclick={(e) => e.stopPropagation()}>#{content.topic}</a>
					{/if}
					<span class="time">{formatTime(obj.body.timestamp)}</span>
				</div>
				{#if content.text}
					<div class="post-text"><Markdown text={content.text} /></div>
				{/if}
				{#if content.image}
					<div class="post-image"><img src={content.image} alt="" /></div>
				{/if}
				<div class="post-footer" onclick={(e) => e.stopPropagation()}>
					<div class="vote-group">
						<button class="vote-btn" class:voted={votes.myVote === 'upvote'}
							onclick={() => vote(obj.id, 'upvote')}>▲</button>
						<span class="vote-score" class:positive={votes.score > 0} class:negative={votes.score < 0}>
							{votes.score}
						</span>
						<button class="vote-btn" class:voted={votes.myVote === 'downvote'}
							onclick={() => vote(obj.id, 'downvote')}>▼</button>
					</div>
					{#if replies > 0}
						<span class="reply-count">{replies} {replies === 1 ? 'reply' : 'replies'}</span>
					{/if}
					{#if isMyPost(obj.body.author)}
						<button class="delete-btn" onclick={() => deletePost(obj.id)}>Delete</button>
					{/if}
				</div>
			</div>
		{/each}
		{#if displayPosts.length === 0 && loaded}
			<div class="empty">
				{#if feedMode === 'personal'}
					<p>Your personal feed is empty.</p>
					<p class="sub">Follow some communities to see posts here.</p>
				{:else}
					<p>No posts in #{activeTopic} yet.</p>
					<p class="sub">Be the first to post.</p>
				{/if}
			</div>
		{/if}
	</div>
{:else}
	<div class="loading">Initializing...</div>
{/if}

<style>
	.mode-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
	.mode-tab {
		background: none; border: none; padding: 8px 16px; border-radius: 8px;
		color: var(--text-tertiary); font-size: 0.85rem; font-weight: 600;
		cursor: pointer; transition: all 0.2s;
	}
	.mode-tab:hover { color: var(--text-primary); }
	.mode-tab.active { color: var(--accent); background: rgba(249,115,22,0.08); }

	.topic-tabs {
		display: flex; gap: 4px; margin-bottom: 12px;
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
	.topic-tab.active { background: rgba(249,115,22,0.1); border-color: var(--accent); color: var(--accent); font-weight: 600; }
	.new-topic { color: var(--accent); border-color: var(--accent-border); }

	.new-topic-form { display: flex; gap: 8px; margin-bottom: 12px; padding: 12px; }
	.new-topic-form .input { flex: 1; font-size: 0.85rem; }

	.topic-header {
		display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;
	}
	.topic-name { color: var(--accent); font-size: 1rem; font-weight: 600; }
	.follow-btn {
		background: var(--bg-surface); border: 1px solid rgba(255,255,255,0.06);
		color: var(--text-secondary); padding: 4px 14px; border-radius: 20px;
		font-size: 0.8rem; font-weight: 500; cursor: pointer; transition: all 0.2s;
	}
	.follow-btn:hover { border-color: var(--accent); color: var(--accent); }
	.follow-btn.following { background: rgba(249,115,22,0.1); border-color: var(--accent); color: var(--accent); }

	.compose { margin-bottom: 16px; }
	.compose textarea { resize: vertical; min-height: 50px; background: var(--bg-input); border-color: rgba(255,255,255,0.04); }
	.compose-preview { position: relative; margin-top: 8px; display: inline-block; }
	.compose-preview img { max-height: 100px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); }
	.remove-img {
		position: absolute; top: 4px; right: 4px;
		background: rgba(0,0,0,0.7); color: #fff; border: none;
		width: 20px; height: 20px; border-radius: 50%; cursor: pointer; font-size: 0.7rem;
		display: flex; align-items: center; justify-content: center;
	}
	.compose-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
	.compose-left { display: flex; align-items: center; gap: 8px; }
	.compose-topic { color: var(--text-tertiary); font-size: 0.8rem; }
	.img-btn { background: none; border: none; cursor: pointer; font-size: 1rem; padding: 2px 4px; opacity: 0.5; transition: opacity 0.2s; }
	.img-btn:hover { opacity: 1; }

	.feed { display: flex; flex-direction: column; gap: 8px; }
	.post { padding: 14px 16px; cursor: pointer; transition: all 0.2s; }
	.post:hover { border-color: var(--accent-border); }
	.post-header { display: flex; gap: 10px; align-items: center; font-size: 0.8rem; margin-bottom: 8px; }
	.author { color: var(--accent); font-size: 0.8rem; font-weight: 500; }
	.author:hover { color: var(--accent-hover); }
	.topic-link { color: var(--text-tertiary); font-size: 0.75rem; }
	.topic-link:hover { color: var(--accent); }
	.time { color: var(--text-tertiary); margin-left: auto; font-size: 0.75rem; }
	.post-text { line-height: 1.5; font-size: 0.9rem; }
	.post-image { margin-top: 10px; }
	.post-image img { max-width: 100%; max-height: 400px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); }
	.post-footer { display: flex; align-items: center; gap: 12px; margin-top: 10px; }

	.vote-group { display: flex; align-items: center; gap: 4px; }
	.vote-btn {
		background: none; border: none; color: var(--text-tertiary); cursor: pointer;
		font-size: 0.7rem; padding: 2px 4px; border-radius: 4px; transition: all 0.15s;
	}
	.vote-btn:hover { color: var(--accent); background: rgba(249,115,22,0.08); }
	.vote-btn.voted { color: var(--accent); }
	.vote-score { font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); min-width: 20px; text-align: center; }
	.vote-score.positive { color: var(--accent); }
	.vote-score.negative { color: #f87171; }

	.reply-count { color: var(--text-secondary); font-size: 0.75rem; padding: 2px 8px; background: var(--bg-input); border-radius: 10px; }
	.delete-btn {
		margin-left: auto; background: none; border: none; color: var(--text-tertiary);
		font-size: 0.7rem; cursor: pointer; padding: 2px 6px;
	}
	.delete-btn:hover { color: #f87171; }

	.empty, .empty-follow { text-align: center; margin-top: 48px; color: var(--text-tertiary); }
	.empty p, .empty-follow p { margin: 4px 0; }
	.sub { font-size: 0.85rem; }
	.loading { text-align: center; margin-top: 64px; color: var(--text-tertiary); }
</style>
