// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import yauzl from 'yauzl';
import { XMLParser } from 'fast-xml-parser';

function stripHtml(html: string): string {
	return html
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n\n')
		.replace(/<\/div>/gi, '\n')
		.replace(/<\/h[1-6]>/gi, '\n\n')
		.replace(/<\/li>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#039;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function stripOpenDocumentXml(xml: string): string {
	return xml
		.replace(/<text:tab\s*\/>/gi, '\t')
		.replace(/<text:line-break\s*\/>/gi, '\n')
		.replace(/<text:s\s+[^>]*\/>/gi, ' ')
		.replace(/<text:s\s*\/>/gi, ' ')
		.replace(/<\/text:(p|h)>/gi, '\n\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function readZipFiles(
	buffer: Buffer,
	predicate: (filename: string) => boolean
): Promise<Map<string, Buffer>> {
	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
			if (err || !zipfile) return reject(err || new Error('Failed to open archive'));
			const result = new Map<string, Buffer>();
			zipfile.on('end', () => resolve(result));
			zipfile.on('error', reject);
			zipfile.readEntry();
			zipfile.on('entry', (entry) => {
				if (/\/$/.test(entry.fileName) || !predicate(entry.fileName)) {
					zipfile.readEntry();
					return;
				}
				zipfile.openReadStream(entry, (err2, stream) => {
					if (err2 || !stream) {
						zipfile.readEntry();
						return;
					}
					const chunks: Buffer[] = [];
					stream.on('data', (c: Buffer) => chunks.push(c));
					stream.on('end', () => {
						result.set(entry.fileName, Buffer.concat(chunks));
						zipfile.readEntry();
					});
					stream.on('error', reject);
				});
			});
		});
	});
}

async function extractOpenDocumentText(buffer: Buffer): Promise<string> {
	const files = await readZipFiles(buffer, (n) => n === 'content.xml');
	const content = files.get('content.xml');
	if (!content) return '';
	return stripOpenDocumentXml(content.toString('utf-8'));
}

async function extractEpubText(buffer: Buffer): Promise<string> {
	const files = await readZipFiles(buffer, (n) => {
		const lower = n.toLowerCase();
		return (
			n === 'META-INF/container.xml' ||
			lower.endsWith('.opf') ||
			lower.endsWith('.xhtml') ||
			lower.endsWith('.html') ||
			lower.endsWith('.htm')
		);
	});

	const containerBuf = files.get('META-INF/container.xml');
	const opfPathMatch = containerBuf?.toString('utf-8').match(/full-path="([^"]+)"/);
	const opfPath = opfPathMatch?.[1];
	const opfBuf = opfPath ? files.get(opfPath) : undefined;

	if (opfPath && opfBuf) {
		try {
			const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
			const opfDoc = parser.parse(opfBuf.toString('utf-8'));
			const pkg = opfDoc.package ?? {};
			const items = pkg.manifest?.item;
			const refs = pkg.spine?.itemref;
			const itemArr = items ? (Array.isArray(items) ? items : [items]) : [];
			const refArr = refs ? (Array.isArray(refs) ? refs : [refs]) : [];
			const idToHref = new Map<string, string>();
			for (const it of itemArr) {
				const id = it['@_id'];
				const href = it['@_href'];
				if (id && href) idToHref.set(id, href);
			}
			const opfDir = opfPath.includes('/')
				? opfPath.substring(0, opfPath.lastIndexOf('/') + 1)
				: '';
			const parts: string[] = [];
			for (const ref of refArr) {
				const idref = ref['@_idref'];
				const href = idref ? idToHref.get(idref) : undefined;
				if (!href) continue;
				const fullPath = opfDir + href;
				const fileBuf = files.get(fullPath);
				if (!fileBuf) continue;
				const text = stripHtml(fileBuf.toString('utf-8'));
				if (text) parts.push(text);
			}
			if (parts.length) {
				return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
			}
		} catch {
			// fall through to alphabetical fallback
		}
	}

	const htmlFiles = Array.from(files.entries())
		.filter(([n]) => /\.(xhtml|html|htm)$/i.test(n))
		.sort(([a], [b]) => a.localeCompare(b));
	const parts = htmlFiles
		.map(([, buf]) => stripHtml(buf.toString('utf-8')))
		.filter(Boolean);
	return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function extractMarkdownText(buffer: Buffer): Promise<string> {
	const raw = buffer.toString('utf-8');
	try {
		const { marked } = await import('marked');
		const html = await marked.parse(raw, { async: true });
		return stripHtml(html);
	} catch {
		return raw;
	}
}

export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
	if (mimeType === 'text/plain') {
		return buffer.toString('utf-8');
	}

	if (mimeType === 'text/markdown') {
		return extractMarkdownText(buffer);
	}

	if (mimeType === 'text/html') {
		return stripHtml(buffer.toString('utf-8'));
	}

	if (mimeType === 'application/pdf') {
		try {
			const pdfParse = (await import('pdf-parse')) as any;
			const parseFn = pdfParse.default || pdfParse;
			const data = await parseFn(buffer);
			return data.text;
		} catch {
			return '[PDF text extraction failed]';
		}
	}

	if (
		mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
		mimeType === 'application/msword'
	) {
		try {
			const mammoth = await import('mammoth');
			const result = await mammoth.extractRawText({ buffer });
			return result.value;
		} catch {
			return '[DOCX text extraction failed]';
		}
	}

	if (
		mimeType === 'application/vnd.oasis.opendocument.text' ||
		mimeType === 'application/vnd.sun.xml.writer'
	) {
		try {
			return await extractOpenDocumentText(buffer);
		} catch {
			return '[OpenDocument text extraction failed]';
		}
	}

	if (mimeType === 'application/epub+zip') {
		try {
			return await extractEpubText(buffer);
		} catch {
			return '[EPUB text extraction failed]';
		}
	}

	return '';
}

export function detectMimeType(filename: string): string {
	const ext = filename.toLowerCase().split('.').pop();
	const map: Record<string, string> = {
		pdf: 'application/pdf',
		txt: 'text/plain',
		md: 'text/markdown',
		html: 'text/html',
		htm: 'text/html',
		docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		doc: 'application/msword',
		odt: 'application/vnd.oasis.opendocument.text',
		sxw: 'application/vnd.sun.xml.writer',
		epub: 'application/epub+zip',
		png: 'image/png',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		gif: 'image/gif',
		webp: 'image/webp',
		svg: 'image/svg+xml'
	};
	return map[ext || ''] || 'application/octet-stream';
}
