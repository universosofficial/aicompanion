import baseRepository from './base.repository.js';

/**
 * SourceRepository
 * Access layer for ingested sources (URLs, PDFs, documents) associated with an AI Mind.
 */
export class SourceRepository {
  /**
   * Register a new source document or URL.
   */
  async createSource({
    characterId,
    sourceType,
    title,
    sourceUri = null,
    status = 'pending',
  }) {
    const sql = `
      INSERT INTO mind_sources (character_id, source_type, title, source_uri, status)
      VALUES (?, ?, ?, ?, ?)
    `;

    const result = await baseRepository.execute(sql, [
      characterId,
      sourceType,
      title,
      sourceUri,
      status,
    ]);

    return await this.findById(result.insertId);
  }

  /**
   * Find source by ID.
   */
  async findById(sourceId) {
    const sql = `
      SELECT id, character_id, source_type, title, source_uri, status, chunk_count, error_message, created_at
      FROM mind_sources
      WHERE id = ?
      LIMIT 1
    `;
    return await baseRepository.queryOne(sql, [sourceId]);
  }

  /**
   * Update source processing status and chunk metrics.
   */
  async updateSourceStatus(sourceId, { status, chunkCount, errorMessage = null }) {
    const fields = ['status = ?'];
    const values = [status];

    if (chunkCount !== undefined) {
      fields.push('chunk_count = ?');
      values.push(chunkCount);
    }

    if (errorMessage !== undefined) {
      fields.push('error_message = ?');
      values.push(errorMessage);
    }

    values.push(sourceId);

    const sql = `
      UPDATE mind_sources
      SET ${fields.join(', ')}
      WHERE id = ?
    `;

    await baseRepository.execute(sql, values);
    return await this.findById(sourceId);
  }

  /**
   * Retrieve all sources registered for a character/mind.
   */
  async getSourcesByCharacterId(characterId) {
    const sql = `
      SELECT id, character_id, source_type, title, source_uri, status, chunk_count, error_message, created_at
      FROM mind_sources
      WHERE character_id = ?
      ORDER BY created_at DESC
    `;
    const [rows] = await baseRepository.query(sql, [characterId]);
    return rows;
  }

  /**
   * Delete a source and its linked knowledge nodes.
   */
  async deleteSource(sourceId, characterId) {
    const sql = `
      DELETE FROM mind_sources
      WHERE id = ? AND character_id = ?
    `;
    const result = await baseRepository.execute(sql, [sourceId, characterId]);
    return result.affectedRows > 0;
  }
}

export const sourceRepository = new SourceRepository();
export default sourceRepository;
