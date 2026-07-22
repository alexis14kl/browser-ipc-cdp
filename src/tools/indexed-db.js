/**
 * Tools de acceso a IndexedDB via CDP IndexedDB domain.
 */

function createIndexedDbTools({ caller }) {
  async function getOrigin() {
    const res = await caller.call('Runtime.evaluate', {
      expression:    'window.location.origin',
      returnByValue: true,
    });
    return res.result?.value;
  }

  const listIndexedDb = {
    name: 'list_indexed_db',
    description: 'List all IndexedDB databases and their object stores for the current page origin.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      const securityOrigin = await getOrigin();
      await caller.call('IndexedDB.enable', {});

      const { databaseNames } = await caller.call('IndexedDB.requestDatabaseNames', { securityOrigin });
      if (!databaseNames || databaseNames.length === 0) {
        return [{ type: 'text', text: 'No IndexedDB databases found for this origin' }];
      }

      const schemas = await Promise.all(databaseNames.map(async name => {
        try {
          const { databaseWithObjectStores } = await caller.call('IndexedDB.requestDatabase', {
            securityOrigin,
            databaseName: name,
          });
          return {
            name,
            version: databaseWithObjectStores?.version,
            objectStores: (databaseWithObjectStores?.objectStores || []).map(s => ({
              name: s.name,
              keyPath: s.keyPath,
              autoIncrement: s.autoIncrement,
              indexes: (s.indexes || []).map(i => ({ name: i.name, keyPath: i.keyPath, unique: i.unique })),
            })),
          };
        } catch {
          return { name, error: 'could not read schema' };
        }
      }));

      return [{ type: 'text', text: JSON.stringify(schemas, null, 2) }];
    },
  };

  const getIndexedDbData = {
    name: 'get_indexed_db_data',
    description: 'Read records from an IndexedDB object store.',
    inputSchema: {
      type: 'object',
      required: ['databaseName', 'objectStoreName'],
      properties: {
        databaseName:    { type: 'string', description: 'Name of the IndexedDB database.' },
        objectStoreName: { type: 'string', description: 'Name of the object store to read from.' },
        indexName:       { type: 'string', description: 'Optional index name to query by.' },
        skipCount:       { type: 'number', description: 'Number of records to skip. Default: 0.' },
        pageSize:        { type: 'number', description: 'Max records to return. Default: 50.' },
      },
    },
    async handler(args) {
      const securityOrigin = await getOrigin();
      await caller.call('IndexedDB.enable', {});

      const { objectStoreDataEntries, hasMore } = await caller.call('IndexedDB.requestData', {
        securityOrigin,
        databaseName:    args.databaseName,
        objectStoreName: args.objectStoreName,
        indexName:       args.indexName || '',
        skipCount:       args.skipCount  || 0,
        pageSize:        args.pageSize   || 50,
        keyRange:        null,
      });

      const records = (objectStoreDataEntries || []).map(entry => ({
        key:            entry.key?.value,
        primaryKey:     entry.primaryKey?.value,
        value:          entry.value?.value,
      }));

      return [{ type: 'text', text: JSON.stringify({ records, hasMore }, null, 2) }];
    },
  };

  return [listIndexedDb, getIndexedDbData];
}

module.exports = { createIndexedDbTools };
