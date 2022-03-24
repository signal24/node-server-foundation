const modelFns = {
    $plain(proxy, target, handler, ...keys) {
        if (!keys.length) return { ...target.$data };
        return $sf.h.extract(target.$data, keys);
    },

    $getKey(proxy, target, handler) {
        return { id: target.$data.id };
    },

    $getOriginal(proxy, target, handler, key) {
        return key ? target.$original[key] : target.$original;
    },

    $isDirty(proxy, target, handler, key) {
        if (key === undefined) {
            return Object.keys(target.$original).length > 0;
        } else {
            return target.$original[key] !== target.$data[key];
        }
    },

    $getDirty(proxy, target, handler) {
        const result = {};
        for (const key in target.$original)
            result[key] = target.$data[key];
        return result;
    },

    $diff(proxy, target, handler) {
        const result = {};
        for (const key in target.$original)
            result[key] = { o: target.$original[key], n: target.$data[key] };
        return result;
    },

    async $save(proxy, target, handler, txn) {
        const context = txn || $sf.mysql;
        const updates = this.$getDirty(proxy, target);
        if (!Object.keys(updates).length) return false;
        runHook(target.$table, proxy, 'beforeSave');
        await context.update(target.$table, updates, this.$getKey(proxy, target));
        runHook(target.$table, proxy, 'onSave');
        target.$original = {};
        return true;
    }
};

class ModelProxyHandler {
    has(target, key) {
        return target.$data !== undefined;
    }

    get(target, key, receiver) {
        if (key === '$') return target.$tempData;
        if (modelFns[key] !== undefined) return modelFns[key].bind(modelFns, receiver, target, this);
        if (target[key] !== undefined) return target[key];
        return target.$data[key];
    }

    set(target, key, value) {
        if (target.$data[key] !== value) {
            if (target.$original[key] === value) {
                target.$data[key] = value;
                delete target.$original[key];
            } else {
                target.$original[key] = target.$data[key];
                target.$data[key] = value;
            }
        }

        return true;
    }

    deleteProperty(target, key) {
        if (target.$data[key] !== undefined) {
            target.$original[key] = target.$data[key];
        }

        delete target.$data[key];
        return true;
    }

    ownKeys(target, key) {
        return Reflect.ownKeys(target.$data);
    }

    getOwnPropertyDescriptor(target, key) {
        if (!Object.keys(target.$data).includes(key)) return undefined;

        return {
            configurable: true,
            enumerable: true,
            writable: true,
            value: target.$data[key]
        };
    }
}

const schemaCache = {};
const globalHooks = [];
const tableHooks = {};

const proxyHandler = new ModelProxyHandler();

const TYPE_BOOL = 1;
const TYPE_JSON = 2;
const TYPE_FLOAT = 3;
const TYPE_POINT = 4;
const TYPE_DATE = 5;
const BOOL_PREFIX_RE = new RegExp('^' + ['is', 'was', 'has', 'had', 'does', 'did', 'should', 'can'].join('|'));

async function populateSchemaCache() {
    const tablesResult = await $sf.mysql.query('show tables');
    const tables = tablesResult.map(row => Object.values(row)[0]).filter(name => name.substr(0, 1) !== '_');
    for (const table of tables) {
        const schema = {};
        const createStatement = (await $sf.mysql.queryOne('show create table `' + table + '`'))['Create Table'];
        const fieldMatches = createStatement.matchAll(/^\s*`([^`]+)` ([^ ]+) .*?$/mg);
        for (const matches of fieldMatches) {
            matches[2] = matches[2].toLowerCase();
            if (matches[2] === 'tinyint(1)') {
                schema[matches[1]] = TYPE_BOOL;
            } else if (matches[2] === 'tinyint') {
                if (BOOL_PREFIX_RE.test(matches[1])) {
                    schema[matches[1]] = TYPE_BOOL;
                }
            } else if (matches[2] === 'json') {
                schema[matches[1]] = TYPE_JSON;
            } else if (/^decimal(.+)$/.test(matches[2])) {
                schema[matches[1]] = TYPE_FLOAT;
            } else if (matches[2] === 'point') {
                schema[matches[1]] = TYPE_POINT;
            } else if (matches[2] === 'date') {
                schema[matches[1]] = TYPE_DATE;
            }
        }

        if (Object.keys(schema).length) {
            schemaCache[table.toLowerCase()] = schema;
        }
    }
}

function addHook(table, hook) {
    if (typeof table === 'object') {
        hook = table;
        table = null;
    }

    if (table === null) {
        globalHooks.push(hook);
    }

    else {
        if (tableHooks[table] === undefined)
            tableHooks[table] = [];
        tableHooks[table].push(hook);
    }
}

function buildModel(table, data) {
    const decodedData = decodeValues(table, data);

    const dataTarget = {
        $table: table,
        $data: decodedData,
        $tempData: {},
        $original: {}
    };

    return new Proxy(dataTarget, proxyHandler);
}

function decodeValues(table, data) {
    table = table.toLowerCase();
    if (schemaCache[table] === undefined) return data;

    const decodedData = { ...data };
    for (const key in schemaCache[table]) {
        if (decodedData[key] !== undefined) {
            if (schemaCache[table][key] === TYPE_BOOL) {
                decodedData[key] = decodedData[key] > 0;
            } else if (schemaCache[table][key] === TYPE_JSON) {
                // JSON is decoded automatically by the mysql library (but is not automatically encoded... go figure)
            } else if (schemaCache[table][key] === TYPE_FLOAT) {
                decodedData[key] = decodedData[key] === null ? null : parseFloat(decodedData[key]);
            } else if (schemaCache[table][key] === TYPE_POINT) {
                // points are automatically decoded to objects w/ x and y props by the mysql library (but also is not automatically encoded... lol)
            } else if (schemaCache[table][key] === TYPE_DATE) {
                if (decodedData[key] instanceof Date) {
                    decodedData[key] = decodedData[key].toISOString().substr(0, 10);
                }
            }
        }
    }

    return decodedData;
}

function encodeValues(table, data) {
    table = table.toLowerCase();
    if (schemaCache[table] === undefined) return data;

    const encodedData = { ...data };
    for (const key in schemaCache[table]) {
        if (encodedData[key] !== undefined) {
            if (schemaCache[table][key] === TYPE_BOOL) {
                encodedData[key] = encodedData[key] ? 1 : 0;
            } else if (schemaCache[table][key] === TYPE_JSON) {
                encodedData[key] = JSON.stringify(encodedData[key]);
            } else if (schemaCache[table][key] === TYPE_FLOAT) {
                // no changes to make here
            } else if (schemaCache[table][key] === TYPE_POINT) {
                if (encodedData[key] !== null) {
                    if (typeof encodedData[key] !== 'object') throw new Error(`point column "${key}" must be an object`);
                    if (encodedData[key].x === undefined || encodedData[key].y === undefined) throw new Error(`point column "${key}" must be an object with x and y properties`);
                    const sqlValue = `POINT(${encodedData[key].x}, ${encodedData[key].y})`;
                    encodedData[key] = {
                        ...encodedData[key],
                        toSqlString: () => sqlValue
                    };
                }
            }
        }
    }

    return encodedData;
}

// TODO: wrap in pregenerated chain rather than if'ing on every save
async function runHook(table, model, action) {
    for (const i = 0; i < globalHooks.length; i++) {
        if (globalHooks[i][action] !== undefined) {
            await globalHooks[i][action](model);
        }
    }

    if (tableHooks[table] !== undefined) {
        for (const i = 0; i < tableHooks[table].length; i++) {
            if (tableHooks[table][i][action] !== undefined) {
                await tableHooks[table][i][action](model);
            }
        }
    }
}

module.exports = {
    populateSchemaCache,
    addHook,
    buildModel,
    decodeValues,
    encodeValues
};
