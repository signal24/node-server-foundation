const modelFns = {
    // $clone(proxy, target, handler) {
    //     const clonedTarget = 
    // }
    
    $getKey(proxy, target, handler) {
        return { id: target.$data.id };
    },

    $getOriginal(proxy, target, handler, key) {
        return target.$original[key];
    },

    $isDirty(proxy, target, handler, key) {
        if (key === undefined) {
            return Object.keys(target.$original).length > 0;
        } else {
            return target.$original[key] !== target.$data[key];
        }
    },

    $getDirty(proxy, target, handler) {
        let result = {};
        for (let key in target.$original)
            result[key] = target.$data[key];
        return result;
    },

    async $save(proxy, target, handler, txn) {
        const context = txn || $sf.mysql;
        const updates = this.$getDirty(proxy, target);
        if (!Object.keys(updates).length) return;
        runHook(target.$table, proxy, 'beforeSave');
        await context.update(target.$table, updates, this.$getKey(proxy, target));
        runHook(target.$table, proxy, 'onSave');
        target.$original = {};
    }
};

class ModelProxyHandler {
    has(target, key) {
        return target.$data !== undefined;
    }

    get(target, key, receiver) {
        if (modelFns[key] !== undefined) return modelFns[key].bind(modelFns, receiver, target, this);
        if (target[key] !== undefined) return target[key];
        return target.$data[key];
    }

    set(target, key, value) {
        if (key === '$ctx') {
            target.$ctx = value;
        } else if (target.$data[key] !== value) {
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

let schemaCache = {};
let globalHooks = [];
let tableHooks = {};

const proxyHandler = new ModelProxyHandler();

const TYPE_BOOL = 1;
const TYPE_FLOAT = 3;

// function clone(obj) {
    
// }

async function populateSchemaCache() {
    const tablesResult = await $sf.mysql.query('show tables');
    const tables = tablesResult.map(row => Object.values(row)[0]).filter(name => name.substr(0, 1) !== '_');
    for (let table of tables) {
        let schema = {};
        const createStatement = (await $sf.mysql.queryOne('show create table `' + table + '`'))['Create Table'];
        const fieldMatches = createStatement.matchAll(/^\s*`([^`]+)` ([^ ]+) .*?$/mg);
        for (let matches of fieldMatches) {
            matches[2] = matches[2].toLowerCase();
            if (matches[2] === 'tinyint(1)') {
                schema[matches[1]] = TYPE_BOOL;
            } else if (matches[2] === 'json') {
                // TODO: future support
            } else if (/^decimal(.+)$/.test(matches[2])) {
                schema[matches[1]] = TYPE_FLOAT;
            }
        }
        
        if (Object.keys(schema).length) {
            schemaCache[table] = schema;
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
    if (schemaCache[table] !== undefined) {
        for (let key in schemaCache[table]) {
            if (data[key] !== undefined) {
                if (schemaCache[table][key] === TYPE_BOOL) {
                    data[key] = !!data[key];
                } else if (schemaCache[table][key] === TYPE_FLOAT) {
                    data[key] = data[key] === null ? null : parseFloat(data[key]);
                }
            }
        }
    }

    let dataTarget = {
        $table: table,
        $ctx: {},
        $data: data,
        $original: {}
    };

    return new Proxy(dataTarget, proxyHandler);
}

// TODO: wrap in pregenerated chain rather than if'ing on every save
async function runHook(table, model, action) {
    for (let i = 0; i < globalHooks.length; i++) {
        if (globalHooks[i][action] !== undefined) {
            await globalHooks[i][action](model);
        }
    }

    if (tableHooks[table] !== undefined) {
        for (let i = 0; i < tableHooks[table].length; i++) {
            if (tableHooks[table][i][action] !== undefined) {
                await tableHooks[table][i][action](model);
            }
        }
    }
}

module.exports = {
    populateSchemaCache,
    addHook,
    buildModel
};
