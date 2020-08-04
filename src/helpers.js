const crypto = require('crypto');

let mutexCache = [];

module.exports = {
    resolveFn,
    format,
    generateKVHmac,
    mutexExec,
    mutexExecCtx,
    delay,
    promisify,
    randomBytes,
    arrayToObject,
    smartRequire
};

function resolveFn(dir, param, expectedType = 'function') {
    if (typeof param === 'function')
        return param;

    if (typeof param === 'string') {
        const anImport = smartRequire(dir + param);
        if (typeof(anImport) !== 'function') throw new Error(`"${param}" must return a ${expectedType}`);
        return anImport;
    }

    throw new Error(`parameter must be a ${expectedType} or the name of a file that exports a ${expectedType}`);
}

function generateKVHmac(alg, key, data) {
    let segments = [];
    Object.keys(data).sort().forEach(key => {
        segments.push(key + '=' + data[key]);
    });
    data = segments.join('\n') + '\n';
    return crypto.createHmac(alg, key).update(data).digest();
}

function format(src, schema) {
    if (!src) return null;

    if (Array.isArray(src)) {
        return src.map(item => format(item, schema));
    }

    let result = {};
    schema.forEach(key => {
        // TEMP until models w/ casts are build
        if (/^is[A-Z]/.test(key))
            result[key] = !!src[key];
        else
            result[key] = src[key];
    });

    return result;
}

async function mutexExec(key, fn, ...args) {
    return await mutexExecCtx(key, null, fn, ...args);
}

async function mutexExecCtx(key, context, fn, ...args) {
    // TODO: check perf of ! in
    if (typeof mutexCache[key] === 'undefined') {
        mutexCache[key] = new Promise(async (resolve, reject) => {
            try {
                resolve(await fn.apply(context, args));
            }

            catch (err) {
                reject(err);
            }
        });
    }

    return await mutexCache[key];
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomBytes(size) {
    return promisify(crypto.randomBytes, size);
}

function promisify(fn, ...args) {
    return new Promise((resolve, reject) => {
        args.push(function(err, result) {
            if (err) return reject(err);
            resolve(result);
        });
        fn.apply(null, args);
    });
}

function arrayToObject(src, keyProp, valueProp) {
    let result = {};
    src.forEach(el => {
        result[el[keyProp]] = el[valueProp];
    });
    return result;
}

function smartRequire(path) {
    if (global.$requireProxy)
        return global.$requireProxy(require, path);
    else
        return require(path);
}
