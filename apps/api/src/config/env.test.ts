import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './env';

describe('loadConfig', () => {
  it('starts with no configuration at all', () => {
    const config = loadConfig({});
    expect(config.PORT).toBe(3001);
    expect(config.OLLAMA_API_KEY).toBeUndefined();
  });

  it('reads the AeroDataBox key from the environment', () => {
    expect(loadConfig({ AERODATABOX_API_KEY: 'k' }).AERODATABOX_API_KEY).toBe('k');
    expect(loadConfig({ AERODATABOX_API_KEY: '' }).AERODATABOX_API_KEY).toBeUndefined();
  });

  it('treats empty strings as unset', () => {
    const config = loadConfig({ OLLAMA_API_KEY: '', LLM_MODEL: '' });
    expect(config.OLLAMA_API_KEY).toBeUndefined();
    expect(config.LLM_MODEL).toBeUndefined();
  });

  it('reports all problems at once', () => {
    expect(() => loadConfig({ PORT: 'abc', AGENT_MAX_STEPS: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: 'abc', AGENT_MAX_STEPS: '0' })).toThrow(/PORT[\s\S]*AGENT_MAX_STEPS/);
  });
});
