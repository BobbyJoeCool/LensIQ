import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AccessConfig {
  /** Cloudflare Access team domain, e.g. `myteam.cloudflareaccess.com`. */
  teamDomain: string;
  /** Application Audience (AUD) tag from the Access application. */
  audience: string;
}

export interface Config {
  isDevelopment: boolean;
  host: string;
  port: number;
  /** Folder that holds the SQLite file. */
  dataDir: string;
  notionToken: string;
  /** Null only in development, where the Access check is bypassed. */
  access: AccessConfig | null;
  /** Folder with the built React app, served in production. */
  webDist: string;
}

export class ConfigError extends Error {}

const here = path.dirname(fileURLToPath(import.meta.url));
// api/src or api/dist -> repo root
const repoRoot = path.resolve(here, '..', '..');

/** Accepts `myteam`, `myteam.cloudflareaccess.com`, or a full https URL. */
export function normalizeTeamDomain(value: string): string {
  const host = value.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return host.includes('.') ? host : `${host}.cloudflareaccess.com`;
}

/**
 * Reads settings from the environment. Fails closed: unless NODE_ENV is exactly
 * `development`, the Cloudflare Access settings are required.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const isDevelopment = env.NODE_ENV === 'development';
  const missing: string[] = [];

  const notionToken = env.NOTION_TOKEN?.trim() ?? '';
  if (!notionToken) missing.push('NOTION_TOKEN');

  let access: AccessConfig | null = null;
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.CF_ACCESS_AUD?.trim();
  if (teamDomain && audience) {
    access = { teamDomain: normalizeTeamDomain(teamDomain), audience };
  } else if (!isDevelopment) {
    if (!teamDomain) missing.push('CF_ACCESS_TEAM_DOMAIN');
    if (!audience) missing.push('CF_ACCESS_AUD');
  }

  if (missing.length > 0) {
    throw new ConfigError(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ConfigError(`PORT must be a valid port number, got "${env.PORT}"`);
  }

  return {
    isDevelopment,
    host: env.HOST ?? (isDevelopment ? '127.0.0.1' : '0.0.0.0'),
    port,
    dataDir: path.resolve(env.DATA_DIR ?? path.join(repoRoot, 'data')),
    notionToken,
    access,
    webDist: path.resolve(env.WEB_DIST ?? path.join(repoRoot, 'web', 'dist')),
  };
}
