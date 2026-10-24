'use strict';

// Community edition: TL;DRs and voice with your own API keys, straight from
// this computer to the provider. No Notchman server, no account, no limits
// beyond your provider's.
//
//  - Summaries: Groq (free key at console.groq.com), or any OpenAI-compatible
//    API via LLM_BASE_URL / LLM_API_KEY / LLM_MODEL (OpenAI, OpenRouter, a
//    local Ollama at http://localhost:11434/v1, ...).
//  - Voice: ElevenLabs with ELEVENLABS_API_KEY; without it, the free Kokoro
//    voice that runs on this computer.

const GROQ = 'https://api.groq.com/openai/v1';
// Groq retired llama-3.3-70b-versatile; this is the model the Notchman server uses.
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const MAX_INPUT_CHARACTERS = 20_000;
/** TL;DRs of texts up to this long (about 1,300 words); Notchman Pro takes long ones. */
const MAX_TLDR_CHARACTERS = 8_000;

class ApiError extends Error {
  constructor(message, status = 0, reason) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
  }
}

const INSTRUCTIONS = [
  'You turn text into a short TL;DR that will be read aloud, like a smart friend who just read it for the listener.',
  'Read all of it first. Open with the context and the bottom line in one or two plain sentences (what this is and what it comes down to), then explain what matters in the easiest order to follow, with why it matters, and end with where it leaves the listener: what they need to do or decide next, or the one thing to remember. For a report on work that was done (from an AI agent or a teammate): is it done, what changed, what is still open, and each decision waiting for the listener with the recommendation. Translate jargon, file names and commands into what they mean.',
  'Keep every material detail exactly: numbers, dates, names, prices, conditions, and who needs to do what, but at most two numbers in a sentence.',
  'Sound like a person talking: warm, plain words, contractions, short sentences of varied length.',
  'Never say "the text", "the author", "it discusses" or "it mentions", never "Additionally", "Furthermore" or "In conclusion": just say the thing itself.',
  'No lists, no markdown, no emojis. Use the language of the text. Reply with only the TL;DR.',
].join(' ');

function wordLimit(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(40, Math.min(120, Math.round(words / 3)));
}

/**
 * @param {{ keys: { get(name: string): string, has(name: string): boolean }, fetch?: typeof fetch }} options
 */
function createClient({ keys, fetch: fetchImpl = fetch }) {
  function llm() {
    const custom = keys.get('LLM_BASE_URL');
    const key = custom ? keys.get('LLM_API_KEY') : keys.get('GROQ_API_KEY');
    return {
      base: (custom || GROQ).replace(/\/+$/, ''),
      key,
      model: keys.get('LLM_MODEL') || (custom ? '' : DEFAULT_MODEL),
      name: custom ? 'your AI provider' : 'Groq',
      local: /^https?:\/\/(localhost|127\.0\.0\.1)/.test(custom),
    };
  }

  async function complete(text) {
    const provider = llm();
    if (!provider.key && !provider.local) {
      throw new ApiError('Notchman isn\'t set up yet. In its folder, run: npm run setup', 401);
    }
    if (!provider.model) throw new ApiError('Notchman\'s AI service isn\'t fully set up. In its folder, run: npm run setup', 400);
    let response;
    try {
      response = await fetchImpl(`${provider.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(provider.key ? { Authorization: `Bearer ${provider.key}` } : {}) },
        body: JSON.stringify({
          model: provider.model,
          temperature: 0.3,
          // gpt-oss thinks before it answers, and the thinking counts toward max_tokens.
          ...(provider.model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low', max_tokens: 2000 } : { max_tokens: 700 }),
          messages: [
            { role: 'system', content: INSTRUCTIONS },
            { role: 'user', content: `Make a TL;DR of this in ${wordLimit(text)} words at most.\n\nTEXT:\n${text.slice(0, MAX_INPUT_CHARACTERS)}` },
          ],
        }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      throw new ApiError(`Couldn't reach ${provider.name}. Check your connection.`, 0);
    }
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(`${provider.name} turned down Notchman's setup. In its folder, run: npm run setup`, response.status);
    }
    if (response.status === 429) {
      throw new ApiError(`${provider.name}'s rate limit is reached for now. Try again in a minute.`, 429);
    }
    if (!response.ok) {
      throw new ApiError(data?.error?.message ? `${provider.name}: ${data.error.message}` : `${provider.name} returned ${response.status}.`, response.status);
    }
    const summary = data?.choices?.[0]?.message?.content?.trim();
    if (!summary) throw new ApiError(`${provider.name} returned an empty answer. Try again.`, 502);
    return summary;
  }

  return {
    community: true,

    /** True once a summary can be made (a key, or a local model). */
    ready: () => {
      const provider = llm();
      return Boolean(provider.key || provider.local);
    },

    /** True when the ElevenLabs voice can be used (otherwise the free computer voice reads). */
    hasCloudVoice: () => keys.has('ELEVENLABS_API_KEY'),

    async usage() {
      return { plan: 'community', voiceUsed: 0, voiceLimit: 0 };
    },

    async checkout() {
      throw new ApiError('Notchman Pro is at notchman.app.', 400);
    },

    /** @returns {Promise<string>} the spoken summary */
    async tldr(text) {
      if (text.length > MAX_TLDR_CHARACTERS) {
        throw new ApiError("That's over 8,000 characters, the limit in Notchman Community. "
          + 'Notchman Pro makes TL;DRs of long texts too, like reports and research papers.', 413, 'too_long');
      }
      return complete(text);
    },

    /** @returns {Promise<Buffer>} MP3 audio of one piece (ElevenLabs). */
    async speak({ text, previousText, nextText, voiceId }) {
      const key = keys.get('ELEVENLABS_API_KEY');
      if (!key) throw new ApiError('Natural voices aren\'t set up. In Notchman\'s folder, run: npm run setup', 401);
      let response;
      try {
        response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
          body: JSON.stringify({
            text,
            model_id: 'eleven_flash_v2_5',
            ...(previousText ? { previous_text: previousText } : {}),
            ...(nextText ? { next_text: nextText } : {}),
          }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new ApiError("Couldn't reach ElevenLabs. Check your connection.", 0);
      }
      if (!response.ok) {
        const reason = response.status === 401 ? "ElevenLabs turned down Notchman's setup. In its folder, run: npm run setup" : `ElevenLabs returned ${response.status}.`;
        throw new ApiError(reason, response.status);
      }
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

module.exports = { createClient, ApiError, wordLimit };
