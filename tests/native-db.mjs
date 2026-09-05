import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createServer } from 'node:net';
import { initializeDatabase } from './db-harness.mjs';

export async function nativeDatabase() {
  const directory=await mkdtemp(join(tmpdir(),'killer-pg-tests-'));
  const port=await new Promise((resolve,reject)=>{
    const server=createServer(); server.on('error',reject);
    server.listen(0,'127.0.0.1',()=>{ const port=server.address().port; server.close(()=>resolve(port)); });
  });
  const pg=new EmbeddedPostgres({databaseDir:directory,port,user:'postgres',password:'local-test-only',persistent:true,
    postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
  let connection;
  async function close() {
    await connection?.end();
    await pg.stop();
    // Only remove the newly created test directory within the intended temp root.
    const rel=relative(tmpdir(),directory);
    if (!rel.startsWith('killer-pg-tests-') || rel.includes('..')) throw Error('Unsafe test directory');
    await rm(directory,{recursive:true,force:true});
  }
  try {
    await pg.initialise(); await pg.start();
    connection=pg.getPgClient(); await connection.connect();
    const db={query:(...args)=>connection.query(...args),exec:(sql)=>connection.query(sql)};
    await initializeDatabase(db,true);
    return {db,close,newClient:async()=>{const client=pg.getPgClient();await client.connect();return client;}};
  } catch(error) { await close().catch(()=>{}); throw error; }
}
