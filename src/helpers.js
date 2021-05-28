const nodePath = require('path');
const crypto = require('crypto');

let mutexCache = {};

module.exports = {
    resolvePath,
    resolveFn,
    smartRequire,
    arrayToObject,
    extract,
    format,
    mutexExec,
    mutexExecCtx,
    delay,
    promisify,
    randomBytes,
    initCrypto,
    encrypt,
    decrypt,
    generateKVHmac
};

////////////////////////////////////

function resolvePath(path) {
    if (nodePath.isAbsolute(path))
        return path;
    else
        return nodePath.normalize($sf.app.srcDir + path);
}

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

////////////////////////////////////

function smartRequire(path) {
    if (global.$requireProxy)
        return global.$requireProxy(require, path);
    else
        return require(path);
}

////////////////////////////////////

function arrayToObject(src, keyProp, valueProp) {
    let result = {};
    src.forEach(el => {
        result[el[keyProp]] = el[valueProp];
    });
    return result;
}

function extract(obj, keys) {
    let ret = {};
    keys.forEach(key => {
        ret[key] = obj[key];
    });
    return ret;
}

////////////////////////////////////

function format(src, schema) {
    if (!src) return null;

    if (Array.isArray(src)) {
        return src.map(item => format(item, schema));
    }

    let result = {};
    schema.forEach(key => {
        let inKey, outKey;

        if (key.includes(':')) {
            inKey = key.substr(0, key.indexOf(':'));
            outKey = key.substr(inKey.length + 1);
        } else {
            inKey = key;
            outKey = key;
        }

        result[outKey] = src[inKey];
    });

    return result;
}

////////////////////////////////////

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

            delete mutexCache[key];
        });
    }

    return await mutexCache[key];
}

////////////////////////////////////

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

////////////////////////////////////

function promisify(fn, ...args) {
    return new Promise((resolve, reject) => {
        args.push(function(err, result) {
            if (err) return reject(err);
            resolve(result);
        });
        fn.apply(null, args);
    });
}

////////////////////////////////////

function randomBytes(size) {
    return promisify(crypto.randomBytes, size);
}

////////////////////////////////////

let cryptoKey;

async function initCrypto() {
    if (!process.env.NSF_ENCRYPT_KEY) return;
    cryptoKey = Buffer.from(process.env.NSF_ENCRYPT_KEY, 'hex');
}

function encrypt(data) {
    if (cryptoKey === undefined) throw new Error('NSF_ENCRYPT_KEY is not set');
    return new Promise(async (resolve, reject) => {
        const isDataBuffer = data instanceof Buffer;
        const iv = await randomBytes(16);
        let result = [ iv ];
        const cipher = crypto.createCipheriv('aes-256-ctr', cryptoKey, iv);
        cipher.on('error', err => reject(err));
        cipher.on('data', eData => result.push(eData));
        cipher.on('end', () => {
            result = Buffer.concat(result);
            resolve(isDataBuffer ? result : result.toString('base64'));
        });
        cipher.write(data, isDataBuffer ? undefined : 'utf8');
        cipher.end();
    });
}

function decrypt(data) {
    if (cryptoKey === undefined) throw new Error('NSF_ENCRYPT_KEY is not set');
    return new Promise(async (resolve, reject) => {
        const isDataBuffer = data instanceof Buffer;
        if (!isDataBuffer) data = Buffer.from(data, 'base64');
        const iv = data.slice(0, 16);
        let result = [];
        const decipher = crypto.createDecipheriv('aes-256-ctr', cryptoKey, iv);
        decipher.on('error', err => reject(err));
        decipher.on('data', eData => result.push(eData));
        decipher.on('end', () => {
            result = Buffer.concat(result);
            resolve(isDataBuffer ? result : result.toString('utf8'));
        });
        decipher.write(data.slice(16));
        decipher.end();
    });
}

////////////////////////////////////

function generateKVHmac(alg, key, data) {
    let segments = [];
    Object.keys(data).sort().forEach(key => {
        segments.push(key + '=' + data[key]);
    });
    data = segments.join('\n') + '\n';
    return crypto.createHmac(alg, key).update(data).digest();
}