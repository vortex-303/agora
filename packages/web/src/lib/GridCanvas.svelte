<script lang="ts">
	import { onMount } from 'svelte';

	let canvas: HTMLCanvasElement;

	onMount(() => {
		const ctx = canvas.getContext('2d')!;
		const GRID = 40;
		const ACCENT = [249, 115, 22];
		let mouseX = -200, mouseY = -200;
		let ambientNodes: Array<{ x: number; y: number; phase: number; speed: number; size: number }> = [];
		let mouseNodes: Array<{ x: number; y: number; phase: number; speed: number; size: number; life: number; maxLife: number }> = [];
		let gTime = 0;

		function snapToGrid(v: number) { return Math.round(v / GRID) * GRID; }

		function resize() {
			canvas.width = window.innerWidth;
			canvas.height = window.innerHeight;
			initAmbient();
		}

		function initAmbient() {
			ambientNodes = [];
			const cols = Math.floor(canvas.width / GRID);
			const rows = Math.floor(canvas.height / GRID);
			for (let y = 0; y <= rows; y++) {
				for (let x = 0; x <= cols; x++) {
					if (Math.random() < 0.06) {
						ambientNodes.push({
							x: x * GRID, y: y * GRID,
							phase: Math.random() * Math.PI * 2,
							speed: 0.2 + Math.random() * 0.5,
							size: 1 + Math.random()
						});
					}
				}
			}
		}

		function spawnMouseNodes(mx: number, my: number) {
			const cx = snapToGrid(mx), cy = snapToGrid(my);
			const range = 4;
			for (let dy = -range; dy <= range; dy++) {
				for (let dx = -range; dx <= range; dx++) {
					const gx = cx + dx * GRID, gy = cy + dy * GRID;
					const dist = Math.sqrt((gx - mx) ** 2 + (gy - my) ** 2);
					if (dist > range * GRID) continue;
					const prob = 0.12 * (1 - dist / (range * GRID));
					if (Math.random() < prob) {
						mouseNodes.push({
							x: gx, y: gy,
							phase: Math.random() * Math.PI * 2,
							speed: 0.4 + Math.random() * 0.8,
							size: 1.5 + Math.random() * 1.5,
							life: 0, maxLife: 180 + Math.random() * 250
						});
					}
				}
			}
			if (mouseNodes.length > 60) mouseNodes.splice(0, mouseNodes.length - 60);
		}

		function animate() {
			const w = canvas.width, h = canvas.height;
			ctx.clearRect(0, 0, w, h);
			gTime += 0.016;

			// Ambient nodes
			for (const nd of ambientNodes) {
				const pulse = (Math.sin(gTime * nd.speed + nd.phase) + 1) / 2;
				const alpha = 0.06 + pulse * 0.15;
				ctx.beginPath();
				ctx.arc(nd.x, nd.y, nd.size + pulse * 2, 0, Math.PI * 2);
				ctx.fillStyle = `rgba(${ACCENT[0]},${ACCENT[1]},${ACCENT[2]},${alpha * 0.45})`;
				ctx.fill();
			}

			// Mouse-spawned nodes
			for (let i = mouseNodes.length - 1; i >= 0; i--) {
				const nd = mouseNodes[i];
				nd.life++;
				if (nd.life > nd.maxLife) { mouseNodes.splice(i, 1); continue; }
				const fadeIn = Math.min(nd.life / 20, 1);
				const fadeOut = nd.life > nd.maxLife - 60 ? (nd.maxLife - nd.life) / 60 : 1;
				const pulse = (Math.sin(gTime * nd.speed + nd.phase) + 1) / 2;
				const alpha = (0.1 + pulse * 0.25) * fadeIn * fadeOut;
				ctx.beginPath();
				ctx.arc(nd.x, nd.y, nd.size + pulse * 2, 0, Math.PI * 2);
				ctx.fillStyle = `rgba(${ACCENT[0]},${ACCENT[1]},${ACCENT[2]},${alpha})`;
				ctx.fill();
			}

			requestAnimationFrame(animate);
		}

		function onMouseMove(e: MouseEvent) {
			mouseX = e.clientX;
			mouseY = e.clientY;
			spawnMouseNodes(mouseX, mouseY);
		}

		resize();
		window.addEventListener('resize', resize);
		document.addEventListener('mousemove', onMouseMove);
		animate();

		return () => {
			window.removeEventListener('resize', resize);
			document.removeEventListener('mousemove', onMouseMove);
		};
	});
</script>

<canvas bind:this={canvas} class="grid-canvas"></canvas>

<style>
	.grid-canvas {
		position: fixed;
		inset: 0;
		pointer-events: none;
		z-index: 0;
	}
</style>
