import conversationRepository from '../repositories/conversation.repository.js';
import messageRepository from '../repositories/message.repository.js';
import characterRepository from '../repositories/character.repository.js';
import aiOrchestrator from './ai/ai.orchestrator.js';

export class ChatService {
  /**
   * Get existing conversation or start a new one for a companion
   */
  async getOrCreateConversation(userId, characterId) {
    const character = await characterRepository.findById(characterId);
    if (!character) {
      const err = new Error('Character not found.');
      err.statusCode = 404;
      err.code = 'CHARACTER_NOT_FOUND';
      throw err;
    }

    if (character.user_id !== userId && !character.is_system && !character.is_public) {
      const err = new Error('Access denied to this character.');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    let conversation = await conversationRepository.findByUserAndCharacter(userId, characterId);
    let isNew = false;

    if (!conversation) {
      conversation = await conversationRepository.create({
        userId,
        characterId,
        title: `Chat with ${character.name}`,
      });
      isNew = true;

      // Seed with initial character greeting
      if (character.greeting) {
        await messageRepository.create({
          conversationId: conversation.id,
          senderType: 'assistant',
          content: character.greeting,
          tokenCount: Math.ceil(character.greeting.length / 4),
        });
      }
    }

    // Fetch initial messages for conversation
    const messages = await messageRepository.findRecentByConversationId(conversation.id, 50);

    return {
      conversation,
      character,
      messages,
      isNew,
    };
  }

  /**
   * Retrieve message history for a conversation
   */
  async getMessages(conversationId, userId, limit = 50) {
    const conversation = await conversationRepository.findById(conversationId, userId);
    if (!conversation) {
      const err = new Error('Conversation not found or unauthorized.');
      err.statusCode = 404;
      err.code = 'CONVERSATION_NOT_FOUND';
      throw err;
    }

    const messages = await messageRepository.findRecentByConversationId(conversationId, limit);
    return messages;
  }

  /**
   * Send a user message and run AI completion turn
   */
  async sendMessage({ userId, characterId, conversationId, content }) {
    if (!content || typeof content !== 'string' || !content.trim()) {
      const err = new Error('Message content is required.');
      err.statusCode = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    return await aiOrchestrator.processChatTurn({
      userId,
      characterId,
      conversationId,
      content: content.trim(),
    });
  }

  /**
   * Edit a message content in a conversation
   */
  async editMessage({ userId, messageId, content }) {
    if (!content || typeof content !== 'string' || !content.trim()) {
      const err = new Error('Updated message content is required.');
      err.statusCode = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const message = await messageRepository.findById(messageId);
    if (!message) {
      const err = new Error('Message not found.');
      err.statusCode = 404;
      err.code = 'MESSAGE_NOT_FOUND';
      throw err;
    }

    // Verify user owns the conversation
    const conversation = await conversationRepository.findById(message.conversation_id, userId);
    if (!conversation) {
      const err = new Error('Unauthorized to edit this message.');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    // Only allow editing user messages
    if (message.sender_type !== 'user') {
      const err = new Error('Only user messages can be edited.');
      err.statusCode = 400;
      err.code = 'CANNOT_EDIT_ASSISTANT_MESSAGE';
      throw err;
    }

    const tokenCount = Math.ceil(content.trim().length / 4);
    const updated = await messageRepository.updateContent(messageId, content.trim(), tokenCount);
    return updated;
  }

  /**
   * Delete a message from a conversation
   */
  async deleteMessage({ userId, messageId }) {
    const message = await messageRepository.findById(messageId);
    if (!message) {
      const err = new Error('Message not found.');
      err.statusCode = 404;
      err.code = 'MESSAGE_NOT_FOUND';
      throw err;
    }

    // Verify user owns the conversation
    const conversation = await conversationRepository.findById(message.conversation_id, userId);
    if (!conversation) {
      const err = new Error('Unauthorized to delete this message.');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    await messageRepository.deleteById(messageId);
    return {
      id: messageId,
      conversationId: message.conversation_id,
      deleted: true,
    };
  }
}

export const chatService = new ChatService();
export default chatService;
