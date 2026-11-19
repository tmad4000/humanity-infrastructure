// Read-only private-scope check and exact signed readback for the HI signup poller.
// Reuses 075's existing, reviewed bridge modules unchanged; never publishes, never prints keys or bodies.
// Usage: node signup_notifier_buzz.mjs scope <channel>
//        node signup_notifier_buzz.mjs readback <channel> <event_id> <body_sha256>
import { createHash } from 'node:crypto';
import { checkProjectScope } from '/home/dev/code/paseo-buzz-bridge-20261114/listener/private_channel_scope.mjs';
import { authenticatedQuery } from '/home/dev/code/paseo-buzz-bridge-20261114/listener/status_card_read.mjs';

const CHANNEL = '5f035fae-8731-41ac-9837-dd109d2ed1d8';
const SENDER = '38ba46f41d56ff5c71cfbfb856d00b209e6216a218260d2a30c4f1b712bdd1cb';
const HEX64 = /^[a-f0-9]{64}$/;

export function verifyReadback(rows, channel, eventId, bodySha) {
  if (!Array.isArray(rows) || rows.length !== 1) return false;
  const e = rows[0];
  const h = Array.isArray(e.tags) ? e.tags.filter(t => Array.isArray(t) && t[0] === 'h').map(t => t[1]) : [];
  return e.id === eventId && e.kind === 9 && e.pubkey === SENDER
    && h.length === 1 && h[0] === channel && typeof e.content === 'string'
    && createHash('sha256').update(e.content, 'utf8').digest('hex') === bodySha;
}

export async function main(argv, query = authenticatedQuery()) {
  const [cmd, channel, eventId, bodySha] = argv;
  if (channel !== CHANNEL) return { ok: false };
  if (cmd === 'scope' && argv.length === 2) {
    const scope = await checkProjectScope(channel, query);
    return { ok: true, metadataId: scope.metadataId, membershipId: scope.membershipId };
  }
  if (cmd === 'readback' && argv.length === 4 && HEX64.test(eventId) && HEX64.test(bodySha)) {
    const rows = await query([{ ids: [eventId], limit: 2, consistency: 'strong' }]);
    return { ok: verifyReadback(rows, channel, eventId, bodySha), eventId };
  }
  return { ok: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(r => {
    process.stdout.write(JSON.stringify(r) + '\n');
    process.exitCode = r.ok ? 0 : 1;
  }, () => { process.stdout.write('{"ok":false}\n'); process.exitCode = 1; });
}
