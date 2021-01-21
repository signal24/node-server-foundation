const Fastify = require('fastify');
const FastifyFormBody = require('fastify-formbody');
const nsfMultipart = require('./http/multipart');
const fs = require('fs');
const constants = require('./constants');

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

        // no sense in parsing content if we've already determined we've nowhere to go
        this.fastify.addHook('preParsing', async (request, _reply, _payload) => {
            if (request.is404) {
                request.headers['content-type'] = undefined;
                request.headers['content-length'] = undefined;
                request.headers['transfer-encoding'] = undefined;
            }
        });

        this.fastify.decorateRequest(constants.kHiddenContentMeta, null);

        this.fastify.decorateRequest('json', null);
        this.fastify.addHook('preHandler', async (request, _reply) => {
            if (!/^application\/json/.test(request.headers['content-type'])) return;
            request.json = request.body;
        });

        this.fastify.register(FastifyFormBody);
        nsfMultipart.setup(this, this.fastify);

        this.fastify.setErrorHandler($sf.err._handleFastifyError);
    }
};