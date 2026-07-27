import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Hostname-Trennung gegen Browser-Kollisionen auf localhost:
//
// Browser scopen Cookies und (faktisch) auch den Passwort-Manager nach Host-
// name, nicht nach Port. Auf demselben „localhost" mit verschiedenen Ports
// teilen sich SARAH, transact-qda etc. denselben Cookie-Topf — und der Auto-
// fill schlägt gespeicherte Credentials der jeweils anderen App vor. Daher
// rufen wir transact-qda über einen separaten Hostname auf:
//
//   http://tqda.localhost:5174
//
// `*.localhost` löst per RFC 6761 in allen modernen Browsern auf 127.0.0.1
// auf — kein /etc/hosts-Eintrag nötig.
//
// `server.host: '127.0.0.1'` bindet das Listening explizit auf Loopback (nicht
// auf alle Interfaces). `allowedHosts` erlaubt zusätzlich den Production-
// Hostname (transact.ucdcae.org) und das `.localhost`-Pattern für jedes
// `*.localhost`-Alias, das jemand verwenden will.
export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 5174,
		host: '127.0.0.1',
		allowedHosts: ['transact.ucdcae.org', '.localhost']
	}
});
