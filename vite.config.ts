import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Zusätzliche Hostnamen für den Dev-Server über TQDA_ALLOWED_HOSTS (kommagetrennt).
const extraHosts = (process.env.TQDA_ALLOWED_HOSTS ?? '')
	.split(',')
	.map((h) => h.trim())
	.filter(Boolean);

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 5174,
		allowedHosts: ['.localhost', ...extraHosts]
	}
});
