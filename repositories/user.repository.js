import baseRepository from './base.repository.js';

/**
 * UserRepository
 * Data access layer for user persistence and retrieval.
 */
export class UserRepository {
  /**
   * Find a user by email address (includes password_hash for authentication).
   * @param {string} email
   * @returns {Promise<Object|null>} Full user row or null
   */
  async findByEmail(email) {
    const sql = `
      SELECT 
        id, 
        email, 
        password_hash, 
        role, 
        is_active, 
        daily_token_limit, 
        created_at, 
        updated_at
      FROM users
      WHERE email = ?
      LIMIT 1
    `;
    return await baseRepository.queryOne(sql, [email.toLowerCase().trim()]);
  }

  /**
   * Find a user by primary key (strictly excludes password_hash).
   * @param {number|string} id
   * @returns {Promise<Object|null>} Sanitized user row or null
   */
  async findById(id) {
    const sql = `
      SELECT 
        id, 
        email, 
        role, 
        is_active, 
        daily_token_limit, 
        created_at, 
        updated_at
      FROM users
      WHERE id = ?
      LIMIT 1
    `;
    return await baseRepository.queryOne(sql, [id]);
  }

  /**
   * Insert a new user record.
   * @param {Object} userData
   * @param {string} userData.email
   * @param {string} userData.passwordHash
   * @param {string} [userData.role='user']
   * @returns {Promise<Object>} Created user record (without password_hash)
   */
  async create({ email, passwordHash, role = 'user' }) {
    const sql = `
      INSERT INTO users (email, password_hash, role)
      VALUES (?, ?, ?)
    `;
    const result = await baseRepository.execute(sql, [
      email.toLowerCase().trim(),
      passwordHash,
      role,
    ]);

    return await this.findById(result.insertId);
  }

  /**
   * Update user timestamp / last activity.
   * @param {number|string} id
   * @returns {Promise<boolean>}
   */
  async updateLastLogin(id) {
    const sql = `
      UPDATE users 
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    const result = await baseRepository.execute(sql, [id]);
    return result.affectedRows > 0;
  }
}

export const userRepository = new UserRepository();
export default userRepository;
