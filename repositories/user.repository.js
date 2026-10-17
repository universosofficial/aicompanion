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
        vasos_balance,
        has_unlimited_vasos,
        display_name,
        avatar_url,
        bio,
        phone,
        location,
        is_verified,
        email_verified_at,
        two_factor_enabled,
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
        vasos_balance,
        has_unlimited_vasos,
        display_name,
        avatar_url,
        bio,
        phone,
        location,
        is_verified,
        email_verified_at,
        two_factor_enabled,
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
   * @param {boolean} [userData.isVerified=false]
   * @returns {Promise<Object>} Created user record (without password_hash)
   */
  async create({ email, passwordHash, role = 'user', isVerified = false }) {
    const sql = `
      INSERT INTO users (email, password_hash, role, is_verified, email_verified_at)
      VALUES (?, ?, ?, ?, ?)
    `;
    const result = await baseRepository.execute(sql, [
      email.toLowerCase().trim(),
      passwordHash,
      role,
      isVerified ? 1 : 0,
      isVerified ? new Date() : null,
    ]);

    return await this.findById(result.insertId);
  }

  /**
   * Mark user's email as verified.
   * @param {string} email
   * @returns {Promise<boolean>}
   */
  async markEmailVerified(email) {
    const sql = `
      UPDATE users 
      SET is_verified = TRUE, email_verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE email = ?
    `;
    const result = await baseRepository.execute(sql, [email.toLowerCase().trim()]);
    return result.affectedRows > 0;
  }

  /**
   * Update password hash for an account.
   * @param {string} email
   * @param {string} passwordHash
   * @returns {Promise<boolean>}
   */
  async updatePassword(email, passwordHash) {
    const sql = `
      UPDATE users 
      SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE email = ?
    `;
    const result = await baseRepository.execute(sql, [passwordHash, email.toLowerCase().trim()]);
    return result.affectedRows > 0;
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

  /**
   * Update profile fields (display_name, avatar_url, bio, phone, location).
   * @param {number|string} userId
   * @param {Object} data
   * @returns {Promise<Object>} Updated sanitized user
   */
  async updateProfile(userId, data = {}) {
    const fields = [];
    const params = [];

    if (data.display_name !== undefined) {
      fields.push('display_name = ?');
      params.push(data.display_name ? String(data.display_name).trim() : null);
    }
    if (data.avatar_url !== undefined) {
      fields.push('avatar_url = ?');
      params.push(data.avatar_url ? String(data.avatar_url).trim() : null);
    }
    if (data.bio !== undefined) {
      fields.push('bio = ?');
      params.push(data.bio ? String(data.bio).trim() : null);
    }
    if (data.phone !== undefined) {
      fields.push('phone = ?');
      params.push(data.phone ? String(data.phone).trim() : null);
    }
    if (data.location !== undefined) {
      fields.push('location = ?');
      params.push(data.location ? String(data.location).trim() : null);
    }

    if (fields.length > 0) {
      fields.push('updated_at = CURRENT_TIMESTAMP');
      params.push(userId);
      const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
      await baseRepository.execute(sql, params);
    }

    return await this.findById(userId);
  }

  /**
   * Update password hash by user ID.
   * @param {number|string} userId
   * @param {string} passwordHash
   * @returns {Promise<boolean>}
   */
  async updatePasswordById(userId, passwordHash) {
    const sql = `
      UPDATE users 
      SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    const result = await baseRepository.execute(sql, [passwordHash, userId]);
    return result.affectedRows > 0;
  }
}

export const userRepository = new UserRepository();
export default userRepository;
