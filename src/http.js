const Fastify = require('fastify');
const FastifyFormBody = require('fastify-formbody');
const FastifyMultipart = require('fastify-multipart');
const fs = require('fs');
const os = require('os');

module.exports = {
    _httpMaxFileSize: 1*1024*1024,

    _loadHttpsConfig(targetOpts) {
        let sslCert = null, sslKey = null;

        if (process.env.NSF_HTTPS_CERT_FILE !== undefined)
            sslCert = fs.readFileSync($sf.h.resolvePath(process.env.NSF_HTTPS_CERT_FILE), 'utf8');
        else if (process.env.NSF_HTTPS_CERT !== undefined)
            sslCert = process.env.NSF_HTTPS_CERT;

        if (process.env.NSF_HTTPS_KEY_FILE !== undefined)
            sslKey = fs.readFileSync($sf.h.resolvePath(process.env.NSF_HTTPS_KEY_FILE), 'utf8');
        else if (process.env.NSF_HTTPS_KEY !== undefined)
            sslKey = process.env.NSF_HTTPS_KEY;

        if (sslCert) {
            targetOpts.https = {
                cert: sslCert,
                key: sslKey
            };

            this.isHttps = true;
        }
    },

    _loadProxyConfig(targetOpts) {
        targetOpts.trustProxy = (function() {
            const proxySetting = process.env.NSF_TRUST_PROXY;
            if (!proxySetting) return false;
            if (proxySetting.toLowerCase() === 'false') return false;
            if (proxySetting.toLowerCase() === 'true') return true;
            if (/^[0-9]+$/.test(proxySetting)) return parseInt(proxySetting);
            if (!/^[0-9.,/]+$/.test(proxySetting)) throw new Error('invalid value for NSF_TRUST_PROXY');
            if (proxySetting.includes(',')) return proxySetting.split(',');
            return proxySetting;
        })();
    },

    _setupFastify(fastifyOpts = {}) {
        this._loadHttpsConfig(fastifyOpts);
        this._loadProxyConfig(fastifyOpts);

        this.fastify = Fastify({
            logger: {
                prettyPrint: process.env.NODE_ENV !== 'production'
            },
            ...fastifyOpts
        });

        const app = this;

        this.fastify.register(FastifyFormBody);

        this.fastify.register(FastifyMultipart);
        this.fastify.decorateRequest('processMultipart', function(opts) {
            return app._httpProcessMultipart(this, opts);
        });

        this.fastify.decorateRequest('files', null);
        const cleanupFilesFn = async (request, reply) => {
            if (typeof request.files === 'undefined') return;
            if (request.files === null) return;
            Object.keys(request.files).forEach(key => {
                fs.unlink(request.files[key].path, () => {});
            });
            request.files = undefined;
        };
        this.fastify.addHook('onResponse', cleanupFilesFn);
        this.fastify.addHook('onError', cleanupFilesFn);

        this.fastify.decorateRequest('json', null);
        this.fastify.addHook('preHandler', (request, _, done) => {
            if (request.body && request.body.constructor === Object)
                request.json = request.body; // TODO: change to 'input'
            else
                request.json = {};
            done();
        });

        this.fastify.setErrorHandler($sf.err._handleFastifyError);
    },

    _httpProcessMultipart(request, opts) {
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
                        fileSize: opts.maxSize || this._httpMaxFileSize
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
};

function doesMatchSet(set, value) {
    return undefined !== set.find(entry => {
        if (entry instanceof RegExp) return entry.test(value);
        return entry === value;
    });
}