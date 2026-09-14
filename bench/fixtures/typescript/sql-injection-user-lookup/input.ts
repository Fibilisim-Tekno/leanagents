import type { Pool } from 'pg';

interface UserRow {
  id: string;
  email: string;
  display_name: string;
}

const DEFAULT_PAGE_SIZE = 25;

export class UserRepository {
  constructor(private readonly pool: Pool) {}

  async findByEmail(email: string): Promise<UserRow | null> {
    const result = await this.pool.query<UserRow>(
      'select id, email, display_name from users where email = $1',
      [email],
    );
    return result.rows[0] ?? null;
  }

  async search(term: string, limit = DEFAULT_PAGE_SIZE): Promise<UserRow[]> {
    console.log('searching users for', term);
    const sql =
      'select id, email, display_name from users where display_name like \'%' +
      term +
      '%\' limit ' +
      String(limit);
    const result = await this.pool.query<UserRow>(sql);
    return result.rows;
  }
}
