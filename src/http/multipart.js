module.exports = {
    setup
};

const os = require('os');
const fs = require('fs');
const FastifyMultipart = require('fastify-multipart');

function setup(app, fastify) {
    fastify.register(FastifyMultipart);

    fastify.addHook('onResponse', cleanupFiles);
    fastify.addHook('onError', cleanupFiles);

    fastify.decorateRequest('files', null);
    fastify.decorateRequest('processMultipart', function(opts) {
        return processMultipart(app, this, opts);
    });
}

function processMultipart(app, request, opts) {
    if (!request.isMultipart()) return;

    const allowedFields = typeof opts.allowedFields !== 'undefined' ? (Array.isArray(opts.allowedFields) ? opts.allowedFields : [opts.allowedFields]) : true;
    const allowedTypes = typeof opts.allowedTypes !== 'undefined' ? (Array.isArray(opts.allowedTypes) ? opts.allowedTypes : [opts.allowedTypes]) : true;

    request.files = {};

    return new Promise((resolve, reject) => {
        let openFileCount = 0;
        let isRequestComplete = false;

        request.multipart(
            (field, file, fileName, encoding, mimeType) => {
                if (allowedFields !== true && !doesMatchSet(allowedFields, field))
                    return reject(new $sf.err.InvalidRequestError(`"${field}" is not an allowed file field`));

                if (allowedTypes !== true && !doesMatchSet(allowedTypes, mimeType))
                    return reject(new $sf.err.InvalidRequestError(`"${mimeType}" is not an allowable file type`));

                let isFileComplete = false;
                let fileSize = 0;

                const outPath = os.tmpdir() + '/sfupload_' + process.pid + '_' + request.id + '_' + field.replace(/[^a-z0-9_-]/ig, '');
                const outStream = fs.createWriteStream(outPath, { emitClose: true });
                openFileCount++;

                outStream.on('close', () => {
                    if (!isFileComplete) return fs.unlink(outPath, () => {});

                    request.files[field] = {
                        name: fileName,
                        size: fileSize,
                        mimeType,
                        path: outPath
                    };

                    openFileCount--;
                    openFileCount === 0 && isRequestComplete && resolve();
                });

                file.on('limit', () => {
                    file.removeAllListeners('data');
                    outStream.end();
                    reject(new $sf.err.InvalidRequestError(`"${field}" exceeds the maximum file size`));
                });

                file.on('end', () => {
                    isFileComplete = true;
                    outStream.end();
                });

                file.on('data', chunk => {
                    fileSize += chunk.length;
                    outStream.write(chunk) || file.pause();
                });

                outStream.on('drain', () => {
                    file.resume();
                });
            },
            () => {
                isRequestComplete = true;
                openFileCount || resolve();
            },
            {
                limits: {
                    fileSize: opts.maxSize || app._httpMaxFileSize
                }
            }
        )

        .on('field', (key, value) => {
            if (key === '_payload') {
                request.json = JSON.parse(value);
            } else {
                reject(new $sf.err.InvalidRequestError(`"${key}" is not an expected field"`));
            }
        });
    });
}

function doesMatchSet(set, value) {
    return undefined !== set.find(entry => {
        if (entry instanceof RegExp) return entry.test(value);
        return entry === value;
    });
}

async function cleanupFiles(request, reply) {
    if (request.files === null) return;
    Object.keys(request.files).forEach(key => {
        fs.unlink(request.files[key].path, () => {});
    });
    request.files = null;
}