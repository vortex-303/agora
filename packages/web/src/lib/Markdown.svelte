<script lang="ts">
	let { text } = $props<{ text: string }>();

	const URL_REGEX = /(https?:\/\/[^\s<]+[^\s<.,;:!?'")\]])/g;

	function renderMarkdown(src: string): string {
		let html = escapeHtml(src);

		// Code blocks (```)
		html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

		// Inline code
		html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

		// Bold
		html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

		// Italic
		html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

		// Strikethrough
		html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');

		// URLs
		html = html.replace(URL_REGEX, '<a href="$1" target="_blank" rel="noopener noreferrer" class="inline-link" onclick="event.stopPropagation()">$1</a>');

		// Clean up displayed URLs
		html = html.replace(/>https?:\/\/(www\.)?([^<]{0,40})/g, (match, www, rest) => {
			const display = rest.length >= 40 ? rest.slice(0, 37) + '...' : rest;
			return '>' + display;
		});

		return html;
	}

	function escapeHtml(s: string): string {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	let rendered = $derived(renderMarkdown(text));
</script>

<span class="markdown-text">{@html rendered}</span>

<style>
	.markdown-text { white-space: pre-wrap; }
	.markdown-text :global(strong) { font-weight: 600; color: var(--text-primary); }
	.markdown-text :global(em) { font-style: italic; }
	.markdown-text :global(s) { opacity: 0.5; }
	.markdown-text :global(code.inline-code) {
		background: var(--bg-input); padding: 1px 5px; border-radius: 3px;
		font-family: var(--font-mono); font-size: 0.85em;
	}
	.markdown-text :global(pre) {
		background: var(--bg-input); padding: 12px; border-radius: 6px;
		overflow-x: auto; margin: 8px 0;
	}
	.markdown-text :global(pre code) {
		font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-primary);
	}
	.markdown-text :global(.inline-link) {
		color: var(--accent); text-decoration: underline;
		text-decoration-color: rgba(249,115,22,0.3);
	}
	.markdown-text :global(.inline-link:hover) { text-decoration-color: var(--accent); }
</style>
