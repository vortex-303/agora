<script lang="ts">
	import { onMount } from 'svelte';
	import { createObject, type PostContent } from '@agora/core';
	import { identityState, feedState, addToFeed, setFeed, appState } from '$lib/stores.svelte.js';
	import { TOPICS } from '$lib/topics.js';
	import Markdown from '$lib/Markdown.svelte';

	let composeText = $state('');
	let composeCommunity = $state('general');
	let feedMode = $state<'main' | 'personal'>('main');
	let loaded = $state(false);
	let composeImage = $state<string | null>(null);
	let fileInput: HTMLInputElement;
	let showCommunityPicker = $state(false);

	onMount(() => {
		const check = setInterval(async () => {
			const fm = appState.feedManager;
			const mod = appState.moderation;
			if (fm) {
				clearInterval(check);
				if (mod && mod.getFollowedCommunities().length > 0) feedMode = 'personal';
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
		const content: PostContent = { text: composeText.trim(), topic: composeCommunity };
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

	// All known communities: seeded + user-created (from posts)
	let allCommunities = $derived(() => {
		const seen = new Set(TOPICS.map(t => t.id));
		const extra: string[] = [];
		for (const obj of feedState.objects) {
			if (obj.body.type === 'post') {
				const t = (obj.body.content as PostContent).topic;
				if (t && !seen.has(t)) { seen.add(t); extra.push(t); }
			}
		}
		return [
			...TOPICS.map(t => t.id),
			...extra,
		];
	});

	let followedCommunities = $derived(appState.moderation?.getFollowedCommunities() || []);

	// Personal feed: posts from followed communities, sorted by time
	let personalPosts = $derived(
		feedState.objects
			.filter((o) => {
				if (o.body.type !== 'post') return false;
				const c = o.body.content as PostContent;
				if (c.reply) return false;
				if (!appState.moderation?.shouldShow(o)) return false;
				return c.topic ? followedCommunities.includes(c.topic) : false;
			})
			.sort((a, b) => b.body.timestamp - a.body.timestamp)
	);

	// Main feed: ranked by engagement + recency algo
	function rankScore(obj: typeof feedState.objects[0]): number {
		const votes = appState.voteManager?.getVotes(obj.id) || { score: 0 };
		const replies = replyCount(obj.id);
		const ageHours = (Date.now() - obj.body.timestamp) / 3_600_000;
		const voteSignal = Math.max(votes.score, 0) + 1; // floor at 1
		const replyBoost = 1 + replies * 0.3;
		const timePenalty = Math.pow((ageHours / 6) + 1, 1.5);
		return (voteSignal * replyBoost) / timePenalty;
	}

	let mainFeedPosts = $derived(
		feedState.objects
			.filter((o) => {
				if (o.body.type !== 'post') return false;
				const c = o.body.content as PostContent;
				if (c.reply) return false;
				if (!appState.moderation?.shouldShow(o)) return false;
				return true;
			})
			.sort((a, b) => rankScore(b) - rankScore(a))
	);

	let displayPosts = $derived(feedMode === 'personal' ? personalPosts : mainFeedPosts);

	function replyCount(postId: string): number {
		return feedState.objects.filter((o) =>
			o.body.type === 'post' && (o.body.content as PostContent).reply === postId
		).length;
	}

	async function vote(id: string, dir: 'upvote' | 'downvote') {
		await appState.voteManager?.vote(id, dir);
	}

	async function deletePost(id: string) {
		await appState.moderation?.deletePost(id);
	}

	function selectCommunity(name: string) {
		composeCommunity = name;
		showCommunityPicker = false;
	}

	let isMyPost = (author: string) => author === identityState.identity?.publicKeyBase64;
</script>

{#if identityState.identity}
	<div class="mode-tabs">
		<button class="mode-tab" class:active={feedMode === 'main'} onclick={() => { feedMode = 'main'; }}>
			Main Feed
		</button>
		<button class="mode-tab" class:active={feedMode === 'personal'} onclick={() => { feedMode = 'personal'; }}>
			My Feed
			{#if followedCommunities.length > 0}
				<span class="follow-count">{followedCommunities.length}</span>
			{/if}
		</button>
	</div>

	{#if feedMode === 'personal' && followedCommunities.length === 0}
		<div class="empty-state card">
			<p>Your feed is empty.</p>
			<p class="sub">Follow some <a href="/communities">communities</a> and their posts will appear here.</p>
		</div>
	{/if}

	<div class="compose card">
		<textarea class="input" bind:value={composeText}
			placeholder="What's on your mind?" rows="2"
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
				<div class="community-picker-wrap">
					<button class="community-pick-btn" onclick={() => { showCommunityPicker = !showCommunityPicker; }}>
						<span class="pick-label">#{composeCommunity}</span>
						<span class="pick-caret">▾</span>
					</button>
					{#if showCommunityPicker}
						<div class="community-dropdown">
							{#each allCommunities() as name (name)}
								<button class="community-opt" class:active={composeCommunity === name}
									onclick={() => selectCommunity(name)}>
									#{name}
								</button>
							{/each}
							<a href="/communities" class="community-opt browse-link">Browse all →</a>
						</div>
					{/if}
				</div>
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
					{#if content.topic}
						<a href="/c/{content.topic}" class="community-tag" onclick={(e) => e.stopPropagation()}>#{content.topic}</a>
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
				{#if feedMode === 'main'}
					<p>The agora is quiet.</p>
					<p class="sub">Post something to break the silence.</p>
				{:else}
					<p>No posts from your communities yet.</p>
					<p class="sub">Follow more <a href="/communities">communities</a> or switch to Main Feed.</p>
				{/if}
			</div>
		{/if}
	</div>
{:else}
	<div class="loading">Initializing...</div>
{/if}

<style>
	.mode-tabs { display: flex; gap: 4px; margin-bottom: 16px; }
	.mode-tab {
		display: flex; align-items: center; gap: 6px;
		background: none; border: none; padding: 8px 16px; border-radius: 8px;
		color: var(--text-tertiary); font-size: 0.85rem; font-weight: 600;
		cursor: pointer; transition: all 0.2s;
	}
	.mode-tab:hover { color: var(--text-primary); }
	.mode-tab.active { color: var(--accent); background: rgba(249,115,22,0.08); }
	.follow-count {
		background: var(--accent); color: #000; font-size: 0.6rem; font-weight: 700;
		min-width: 16px; height: 16px; border-radius: 8px;
		display: flex; align-items: center; justify-content: center; padding: 0 4px;
	}

	.empty-state { padding: 32px; text-align: center; margin-bottom: 16px; }
	.empty-state p { margin: 4px 0; color: var(--text-secondary); }
	.empty-state .sub { font-size: 0.85rem; color: var(--text-tertiary); }

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
	.img-btn { background: none; border: none; cursor: pointer; font-size: 1rem; padding: 2px 4px; opacity: 0.5; transition: opacity 0.2s; }
	.img-btn:hover { opacity: 1; }

	/* Community picker dropdown */
	.community-picker-wrap { position: relative; }
	.community-pick-btn {
		display: flex; align-items: center; gap: 4px;
		background: var(--bg-input); border: 1px solid rgba(255,255,255,0.06);
		border-radius: 6px; padding: 5px 10px; cursor: pointer;
		color: var(--accent); font-size: 0.8rem; font-weight: 500; transition: all 0.2s;
	}
	.community-pick-btn:hover { border-color: var(--accent-border); }
	.pick-caret { font-size: 0.6rem; color: var(--text-tertiary); }
	.community-dropdown {
		position: absolute; bottom: calc(100% + 6px); left: 0;
		background: var(--bg-raised); border: 1px solid rgba(255,255,255,0.08);
		border-radius: 10px; padding: 4px; z-index: 50; min-width: 160px;
		max-height: 240px; overflow-y: auto;
		box-shadow: 0 8px 32px rgba(0,0,0,0.4);
		animation: dropdown-in 0.15s cubic-bezier(0.16, 1, 0.3, 1);
	}
	@keyframes dropdown-in {
		from { opacity: 0; transform: translateY(4px) scale(0.95); }
		to { opacity: 1; transform: translateY(0) scale(1); }
	}
	.community-opt {
		display: block; width: 100%; padding: 8px 12px; border: none; border-radius: 6px;
		background: none; color: var(--text-secondary); font-size: 0.8rem;
		cursor: pointer; text-align: left; transition: all 0.1s; text-decoration: none;
	}
	.community-opt:hover { background: rgba(255,255,255,0.04); color: var(--text-primary); }
	.community-opt.active { color: var(--accent); }
	.browse-link { color: var(--text-tertiary); font-size: 0.75rem; border-top: 1px solid rgba(255,255,255,0.04); margin-top: 4px; }

	.feed { display: flex; flex-direction: column; gap: 8px; }
	.post { padding: 14px 16px; cursor: pointer; transition: all 0.2s; }
	.post:hover { border-color: var(--accent-border); }
	.post-header { display: flex; gap: 10px; align-items: center; font-size: 0.8rem; margin-bottom: 8px; }
	.author { color: var(--accent); font-size: 0.8rem; font-weight: 500; }
	.author:hover { color: var(--accent-hover); }
	.community-tag { color: var(--text-tertiary); font-size: 0.75rem; }
	.community-tag:hover { color: var(--accent); }
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

	.empty { text-align: center; margin-top: 48px; color: var(--text-tertiary); }
	.empty p { margin: 4px 0; }
	.sub { font-size: 0.85rem; }
	.loading { text-align: center; margin-top: 64px; color: var(--text-tertiary); }
</style>
