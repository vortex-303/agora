<script lang="ts">
	let { text } = $props<{ text: string }>();

	const URL_REGEX = /(https?:\/\/[^\s<]+[^\s<.,;:!?'")\]])/g;

	interface TextPart {
		type: 'text' | 'link';
		value: string;
	}

	let parts = $derived((): TextPart[] => {
		const result: TextPart[] = [];
		let lastIndex = 0;
		let match;
		const regex = new RegExp(URL_REGEX);
		while ((match = regex.exec(text)) !== null) {
			if (match.index > lastIndex) {
				result.push({ type: 'text', value: text.slice(lastIndex, match.index) });
			}
			result.push({ type: 'link', value: match[1] });
			lastIndex = regex.lastIndex;
		}
		if (lastIndex < text.length) {
			result.push({ type: 'text', value: text.slice(lastIndex) });
		}
		return result;
	});

	function displayUrl(url: string): string {
		try {
			const u = new URL(url);
			return u.hostname + (u.pathname.length > 1 ? u.pathname.slice(0, 30) : '') + (u.pathname.length > 30 ? '...' : '');
		} catch { return url.slice(0, 40); }
	}
</script>

<span class="link-text">
	{#each parts() as part}
		{#if part.type === 'link'}
			<a href={part.value} target="_blank" rel="noopener noreferrer" class="inline-link"
				onclick={(e) => e.stopPropagation()}>{displayUrl(part.value)}</a>
		{:else}
			{part.value}
		{/if}
	{/each}
</span>

<style>
	.link-text { white-space: pre-wrap; }
	.inline-link {
		color: var(--accent); text-decoration: underline;
		text-decoration-color: rgba(249,115,22,0.3);
		transition: text-decoration-color 0.2s;
	}
	.inline-link:hover { text-decoration-color: var(--accent); }
</style>
