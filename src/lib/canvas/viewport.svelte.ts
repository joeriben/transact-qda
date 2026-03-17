export function createViewport(opts?: { minZoom?: number; maxZoom?: number }) {
	let x = $state(0);
	let y = $state(0);
	let zoom = $state(1);

	const MIN_ZOOM = opts?.minZoom ?? 0.1;
	const MAX_ZOOM = opts?.maxZoom ?? 5;

	function pan(dx: number, dy: number) {
		x += dx / zoom;
		y += dy / zoom;
	}

	function zoomAt(factor: number, cx: number, cy: number) {
		const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
		const scale = newZoom / zoom;
		x = cx - (cx - x) * scale;
		y = cy - (cy - y) * scale;
		zoom = newZoom;
	}

	function screenToCanvas(sx: number, sy: number): { x: number; y: number } {
		return {
			x: (sx / zoom) - x,
			y: (sy / zoom) - y
		};
	}

	function canvasToScreen(cx: number, cy: number): { x: number; y: number } {
		return {
			x: (cx + x) * zoom,
			y: (cy + y) * zoom
		};
	}

	function reset() {
		x = 0;
		y = 0;
		zoom = 1;
	}

	// Fit a canvas bounding box into the container with padding
	function fitBounds(
		bounds: { minX: number; minY: number; maxX: number; maxY: number },
		containerW: number, containerH: number,
		padding = 60
	) {
		const bw = bounds.maxX - bounds.minX;
		const bh = bounds.maxY - bounds.minY;
		if (bw <= 0 || bh <= 0 || containerW <= 0 || containerH <= 0) return;
		const scaleX = (containerW - padding * 2) / bw;
		const scaleY = (containerH - padding * 2) / bh;
		zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(scaleX, scaleY)));
		x = (padding / zoom) - bounds.minX;
		y = (padding / zoom) - bounds.minY;
	}

	return {
		get x() { return x; },
		get y() { return y; },
		get zoom() { return zoom; },
		set x(v: number) { x = v; },
		set y(v: number) { y = v; },
		set zoom(v: number) { zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v)); },
		pan,
		zoomAt,
		screenToCanvas,
		canvasToScreen,
		reset,
		fitBounds
	};
}
