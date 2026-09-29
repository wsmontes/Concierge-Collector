import { describe, expect, test } from 'vitest';
import { findingsForText } from '../scripts/release/check-secrets.mjs';

describe('local release secret scan', () => {
  test('detects credential-shaped values without echoing the secret', () => {
    const samples = [
      'GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-1234567890abcdefghijklmnop',
      'GOOGLE_PLACES_API_KEY=AIzaSy123456789012345678901234567890123',
      'OPENAI_API_KEY=sk-proj-1234567890abcdefghijklmnop',
      'TOKEN=ghp_123456789012345678901234567890123456',
      'AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF',
      '-----BEGIN PRIVATE KEY-----',
    ].join('\n');

    const findings = findingsForText(samples, 'fixture.env');
    expect(findings.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'Google OAuth client secret',
      'Google API key',
      'OpenAI API key',
      'GitHub classic token',
      'AWS access key id',
      'private key material',
    ]));
    expect(JSON.stringify(findings)).not.toContain('1234567890abcdefghijklmnop');
  });

  test('permits the masked placeholders used in documentation', () => {
    const placeholders = [
      'GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...',
      'OPENAI_API_KEY=sk-proj-...',
      'GOOGLE_PLACES_API_KEY=AIzaSy...',
      'mongodb+srv://<user>:<password>@<cluster>.mongodb.net/',
    ].join('\n');

    expect(findingsForText(placeholders, 'docs/example.md')).toEqual([]);
  });
});
