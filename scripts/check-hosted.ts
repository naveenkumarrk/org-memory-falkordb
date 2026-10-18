import fs from 'node:fs';
import { connect } from '../worker/graph.ts';
if (fs.existsSync('.env.hosted')) process.loadEnvFile('.env.hosted');
const url = process.env.FALKORDB_URL;
if (!url) throw new Error('Set FALKORDB_URL in gitignored .env.hosted; do not paste credentials into chat.');
let db: Awaited<ReturnType<typeof connect>> | undefined;
try {
  db = await connect(url);
  const result = await db.selectGraph('orgmem_connection_check').query('RETURN 1 AS connected');
  if (result.data?.[0]?.connected !== 1) throw new Error('Unexpected database response');
  console.log('FalkorDB connection successful. Credentials were not printed.');
} catch {
  console.error('FalkorDB connection failed. Check the endpoint, credentials, TLS setting, and network access in .env.hosted. Connection details were not printed.');
  process.exitCode = 1;
} finally { await db?.close(); }
