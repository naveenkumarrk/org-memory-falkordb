import { demoSnapshot } from '../fixtures/memory.ts';
import { api } from './client.ts';

const migrated = process.argv.includes('--migrated');
const snapshot = demoSnapshot(migrated);
const current = await api(`/v1/graph?repository=${encodeURIComponent(snapshot.repository)}`);
snapshot.expected_version = current.version;
console.log(JSON.stringify(await api('/v1/ingest', snapshot), null, 2));
