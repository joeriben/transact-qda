import pg from 'pg';
import { hash } from 'argon2';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://tqda:tqda_dev@localhost:5432/transact_qda';

async function seed() {
	const client = new pg.Client({ connectionString: DATABASE_URL });
	await client.connect();

	// Check if admin user exists
	const existing = await client.query("SELECT id FROM users WHERE username = 'admin'");
	if (existing.rows.length > 0) {
		console.log('  Admin user already exists, skipping seed.');
		await client.end();
		return;
	}

	// Create admin user (password: "adminadmin")
	const passwordHash = await hash('adminadmin', { type: 2 }); // argon2id
	const userResult = await client.query(
		`INSERT INTO users (username, email, password_hash, display_name, role)
		 VALUES ('admin', 'admin@localhost', $1, 'Administrator', 'admin')
		 RETURNING id`,
		[passwordHash]
	);
	const userId = userResult.rows[0].id;
	console.log(`  Created admin user: ${userId}`);

	// Create a sample project
	const projResult = await client.query(
		`INSERT INTO projects (name, description, created_by)
		 VALUES ('Sample Project', 'A sample project for testing transact-qda', $1)
		 RETURNING id`,
		[userId]
	);
	const projectId = projResult.rows[0].id;

	await client.query(
		`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')`,
		[projectId, userId]
	);
	console.log(`  Created sample project: ${projectId}`);

	await client.end();
	console.log('Seed complete.');
}

seed().catch((e) => {
	console.error('Seed failed:', e);
	process.exit(1);
});
