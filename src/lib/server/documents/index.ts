// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
	if (mimeType === 'text/plain') {
		return buffer.toString('utf-8');
	}

	if (mimeType === 'text/html') {
		const html = buffer.toString('utf-8');
		// Strip HTML tags, decode entities, normalize whitespace
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
			.replace(/&nbsp;/g, ' ')
			.replace(/\n{3,}/g, '\n\n')
			.trim();
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
		png: 'image/png',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		gif: 'image/gif',
		webp: 'image/webp',
		svg: 'image/svg+xml'
	};
	return map[ext || ''] || 'application/octet-stream';
}
