// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Post-install smoke test for PDF text extraction.
//
// PDF upload in transact-qda depends on the `pdf-parse` package (and, through
// it, `pdfjs-dist`). On some machines a fresh `npm install` can leave that path
// unusable — e.g. an optional native dependency of pdf-parse was skipped, or
// the install was interrupted. When that happens PDF uploads silently produce
// empty/placeholder documents instead of real text.
//
// This script verifies the *actual* extraction path the app uses: it loads
// pdf-parse, builds a tiny in-memory PDF that contains a known marker, runs the
// same `new PDFParse({ data }).getText()` call the app runs, and checks that the
// marker comes back out.
//
// It is intentionally self-contained (no fixture files, no extra dependencies)
// so it works identically on macOS, Linux and Windows. It prints a clear OK or
// FAIL line and sets the exit code accordingly:
//   0  -> PDF extraction works
//   2  -> pdf-parse could not be loaded (module/native-binding problem)
//   3  -> pdf-parse loaded but returned no usable text
//   4  -> pdf-parse threw while parsing
// Installers should treat a non-zero exit as a *warning*, not a hard failure:
// the rest of the app still works without PDF support.

const MARKER = 'TQDAPDFOK';

// Build a minimal, spec-correct single-page PDF whose content stream draws the
// marker text. Byte offsets in the xref table are computed from the actual
// serialized bytes so we don't rely on pdfjs' error-recovery for broken xrefs.
function buildSamplePdf(marker) {
	const header = '%PDF-1.4\n%\xFF\xFF\xFF\xFF\n';
	const stream = `BT /F1 24 Tf 50 100 Td (${marker}) Tj ET`;
	const objects = [
		`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
		`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
		`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200]` +
			` /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
		`4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
		`5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`
	];

	let pdf = header;
	const offsets = [];
	for (const obj of objects) {
		offsets.push(Buffer.byteLength(pdf, 'latin1'));
		pdf += obj;
	}

	const xrefStart = Buffer.byteLength(pdf, 'latin1');
	const size = objects.length + 1; // include the free object 0
	let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
	for (const off of offsets) {
		xref += String(off).padStart(10, '0') + ' 00000 n \n';
	}
	pdf += xref;
	pdf += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

	return Buffer.from(pdf, 'latin1');
}

async function main() {
	let PDFParse;
	try {
		({ PDFParse } = await import('pdf-parse'));
	} catch (err) {
		console.error('FAIL: could not load pdf-parse:', err?.message || err);
		console.error('  -> PDF upload will not work. Re-run `npm install` and make sure');
		console.error('     optional dependencies are NOT disabled (no --omit=optional / --no-optional).');
		process.exit(2);
	}

	try {
		const data = new Uint8Array(buildSamplePdf(MARKER));
		const parser = new PDFParse({ data });
		const result = await parser.getText();
		const got = (result?.text || '').replace(/\s+/g, '');
		if (got.includes(MARKER)) {
			console.log('OK: pdf-parse is installed and PDF text extraction works.');
			process.exit(0);
		}
		console.error('FAIL: pdf-parse loaded but extracted no usable text.');
		console.error('  extracted:', JSON.stringify(result?.text ?? null));
		process.exit(3);
	} catch (err) {
		console.error('FAIL: pdf-parse threw while parsing a test PDF:', err?.message || err);
		console.error('  -> PDF upload will not work. Re-run `npm install`.');
		process.exit(4);
	}
}

main();
