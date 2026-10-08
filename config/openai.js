import OpenAI from 'openai';
import env from './env.js';

let openaiClient = null;

if (env.OPENAI_API_KEY) {
  openaiClient = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
  });
} else {
  console.warn(
    '[OPENAI CONFIG] OPENAI_API_KEY is not set in environment. ' +
    'Simulated AI responses will be provided until an API key is configured.'
  );
  // Create client with dummy key to allow class initialization
  openaiClient = new OpenAI({
    apiKey: 'dummy-key-offline',
  });
}

export const openai = openaiClient;
export default openai;
