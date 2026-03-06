export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
	if (mimeType === 'text/plain') {
		return buffer.toString('utf-8');
	}

	if (mimeType === 'application/pdf') {
		try {
			const pdfParse = await import('pdf-parse');
			const data = await pdfParse.default(buffer);
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
