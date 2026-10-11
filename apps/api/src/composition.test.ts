import { describe, expect, it, vi } from 'vitest';
import { code } from './analytics/__tests__/support';
import { AnalysisUnavailableError } from './application/errors';
import { AgentError } from './agent/errors';
import { composeApplication } from './composition';

describe('composeApplication', () => {
  it('makes no network calls when composing, so startup never spends provider quota', () => {
    const fetch = vi.fn();
    composeApplication({ AERODATABOX_API_KEY: 'key' }, fetch);
    composeApplication({ AERODATABOX_API_KEY: undefined }, fetch);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports AeroDataBox as configured only when a key is present', () => {
    expect(composeApplication({ AERODATABOX_API_KEY: 'key' }, vi.fn()).providers).toEqual({ bts: 'configured', faa: 'configured', aerodatabox: 'configured' });
    expect(composeApplication({ AERODATABOX_API_KEY: undefined }, vi.fn()).providers.aerodatabox).toBe('not-configured');
  });

  it('without a key, route and delay analyses fail clearly before any request is made', async () => {
    const fetch = vi.fn();
    const { analytics } = composeApplication({ AERODATABOX_API_KEY: undefined }, fetch);
    await expect(analytics.longHaulShare(code('ANC'))).rejects.toBeInstanceOf(AnalysisUnavailableError);
    await expect(analytics.delaySummary(code('LAX'), { from: '2026-10-06T08:00', to: '2026-10-06T20:00' })).rejects.toBeInstanceOf(AnalysisUnavailableError);
    expect(fetch).not.toHaveBeenCalled();
  });

  describe('chat model', () => {
    const base = { AERODATABOX_API_KEY: undefined };

    it('is reported configured only when both the Ollama key and a model name are set, and composing calls nothing', () => {
      const fetch = vi.fn();
      expect(composeApplication({ ...base, OLLAMA_API_KEY: 'k', LLM_MODEL: 'some-model' }, fetch).llm).toBe('configured');
      expect(composeApplication({ ...base, OLLAMA_API_KEY: 'k' }, fetch).llm).toBe('not-configured');
      expect(composeApplication({ ...base, LLM_MODEL: 'some-model' }, fetch).llm).toBe('not-configured');
      expect(composeApplication(base, fetch).llm).toBe('not-configured');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('without a model, chat fails with a clear not-configured error and makes no request', async () => {
      const fetch = vi.fn();
      const { agent } = composeApplication(base, fetch);
      await expect(agent.respond([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(AgentError);
      await expect(agent.respond([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ kind: 'not-configured' });
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
