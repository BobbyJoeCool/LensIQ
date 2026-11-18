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

  it('trims surrounding whitespace from the token', () => {
    expect(loadConfig({ NODE_ENV: 'development', NOTION_TOKEN: '  ntn_abc\n' }).notionToken).toBe('ntn_abc');
  });

  it('refuses a token with terminal paste codes or inner spaces', () => {
    const dev = { NODE_ENV: 'development' };
    expect(() => loadConfig({ ...dev, NOTION_TOKEN: '\x1b[200~ntn_abc\x1b[201~' })).toThrow(/control characters/);
    expect(() => loadConfig({ ...dev, NOTION_TOKEN: 'ntn_abc\rdef' })).toThrow(/control characters/);
    expect(() => loadConfig({ ...dev, NOTION_TOKEN: 'ntn abc' })).toThrow(/spaces/);
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
