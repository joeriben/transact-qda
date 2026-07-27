import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Hostname-Trennung gegen Browser-Kollisionen auf localhost:
//
// Browser scopen Cookies und (faktisch) auch den Passwort-Manager nach Host-
// name, nicht nach Port. Auf demselben „localhost" mit verschiedenen Ports
// teilen sich alle lokal laufenden Anwendungen denselben Cookie-Topf — und der
// Autofill schlägt gespeicherte Credentials der jeweils anderen App vor. Daher
// rufen wir transact-qda über einen separaten Hostname auf:
//
//   http://tqda.localhost:5174
//
// `*.localhost` löst per RFC 6761 in allen modernen Browsern auf 127.0.0.1
// auf — kein /etc/hosts-Eintrag nötig.
//
// `server.host: '127.0.0.1'` bindet das Listening explizit auf Loopback (nicht
// auf alle Interfaces). `allowedHosts` erlaubt das `.localhost`-Pattern für
// jedes `*.localhost`-Alias. Wer den Dev-Server hinter einem eigenen Hostnamen
// betreibt, ergänzt ihn über TQDA_ALLOWED_HOSTS (kommagetrennt).
const extraHosts = (process.env.TQDA_ALLOWED_HOSTS ?? '')
	.split(',')
	.map((h) => h.trim())
	.filter(Boolean);

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 5174,
		host: '127.0.0.1',
		allowedHosts: ['.localhost', ...extraHosts]
	}
});
