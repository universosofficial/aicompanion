import pool from '../config/database.js';

/**
 * BaseRepository
 * Generic database access layer providing parameterized query helpers
 * and atomic transaction execution.
 */
export class BaseRepository {
  /**
   * Execute a parameterized query (typically SELECT)
   * @param {string} sql - Parameterized SQL string with '?' placeholders
   * @param {Array} [params=[]] - Query parameters
   * @param {import('mysql2/promise').Connection} [connection=null] - Optional dedicated connection
   * @returns {Promise<[Array, Array]>} [rows, fields]
   */
  async query(sql, params = [], connection = null) {
    const executor = connection || pool;
    const [rows, fields] = await executor.execute(sql, params);
    return [rows, fields];
  }

  /**
   * Execute a query and return the first matched row or null
   * @param {string} sql - Parameterized SQL string
   * @param {Array} [params=[]] - Query parameters
   * @param {import('mysql2/promise').Connection} [connection=null] - Optional dedicated connection
   * @returns {Promise<Object|null>} First row or null
   */
  async queryOne(sql, params = [], connection = null) {
    const [rows] = await this.query(sql, params, connection);
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  }

  /**
   * Execute an INSERT, UPDATE, or DELETE parameterized statement
   * @param {string} sql - Parameterized SQL statement
   * @param {Array} [params=[]] - Statement parameters
   * @param {import('mysql2/promise').Connection} [connection=null] - Optional dedicated connection
   * @returns {Promise<Object>} ResultSetHeader (insertId, affectedRows, changedRows, etc.)
   */
  async execute(sql, params = [], connection = null) {
    const executor = connection || pool;
    const [result] = await executor.execute(sql, params);
    return result;
  }

  /**
   * Executes a callback within a managed database transaction.
   * Begins transaction, commits on success, rolls back on error,
   * and guarantees connection release back to the pool.
   * 
   * @template T
   * @param {(connection: import('mysql2/promise').Connection) => Promise<T>} callback
   * @returns {Promise<T>}
   */
  async withTransaction(callback) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('[DATABASE] Rollback failed:', rollbackError.message);
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}

export const baseRepository = new BaseRepository();
export default baseRepository;
