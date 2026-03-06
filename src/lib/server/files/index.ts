import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const UPLOAD_DIR = join(process.cwd(), 'uploads');

export async function saveFile(buffer: Buffer, originalName: string, projectId: string): Promise<string> {
	const ext = originalName.split('.').pop() || 'bin';
	const filename = `${randomUUID()}.${ext}`;
	const dir = join(UPLOAD_DIR, projectId);
	await mkdir(dir, { recursive: true });
	const filePath = join(dir, filename);
	await writeFile(filePath, buffer);
	return filePath;
}

export function getUploadDir(): string {
	return UPLOAD_DIR;
}
