import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, normalizeTeamDomain } from '../src/config.js';

describe('loadConfig', () => {
  it('fails closed outside development when Access settings are missing', () => {
    expect(() => loadConfig({ NOTION_TOKEN: 't' })).toThrow(ConfigError);
    expect(() => loadConfig({ NOTION_TOKEN: 't', NODE_ENV: 'production', CF_ACCESS_AUD: 'a' })).toThrow(
      /CF_ACCESS_TEAM_DOMAIN/,
    );
  });

  it('allows a missing Access config only in development', () => {
    const cfg = loadConfig({ NOTION_TOKEN: 't', NODE_ENV: 'development' });
    expect(cfg.access).toBeNull();
    expect(cfg.host).toBe('127.0.0.1');
  });

  it('requires the Notion token', () => {
    expect(() => loadConfig({ NODE_ENV: 'development' })).toThrow(/NOTION_TOKEN/);
  });

  it('builds the Access config in production', () => {
    const cfg = loadConfig({ NOTION_TOKEN: 't', CF_ACCESS_TEAM_DOMAIN: 'myteam', CF_ACCESS_AUD: 'aud' });
    expect(cfg.access).toEqual({ teamDomain: 'myteam.cloudflareaccess.com', audience: 'aud' });
    expect(cfg.host).toBe('0.0.0.0');
  });
});

describe('normalizeTeamDomain', () => {
  it('accepts short names, hosts and URLs', () => {
    expect(normalizeTeamDomain('myteam')).toBe('myteam.cloudflareaccess.com');
    expect(normalizeTeamDomain('myteam.cloudflareaccess.com')).toBe('myteam.cloudflareaccess.com');
    expect(normalizeTeamDomain('https://myteam.cloudflareaccess.com/')).toBe('myteam.cloudflareaccess.com');
  });
});
