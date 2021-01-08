require('./native-extensions');

const auth = require('./auth');
const fs = require('fs');
const helpers = require('./helpers');
const Http = require('./http');
const errors = require('./errors');
const Router = require('./router');

// TODO CORS

class Application {
    baseDir = null;
    srcDir = null;
    name = null;
    version = null;
    isHttps = false;
    registeredMiddleware = {};
    defaultMiddleware = [];
    requestErrorHandler = null;

    init(baseDir, fastifyOpts) {
        this.baseDir = baseDir.replace(/\/$/, '') + '/';
        this.srcDir = this.baseDir + 'src/';

        const packageMeta = require(this.baseDir + 'package.json');
        this.name = packageMeta.name;
        this.version = packageMeta.version;

        this._loadEnv();

        this._setupFastify(fastifyOpts);

        auth.init();
        this.registerMiddleware('auth', auth.authorizeRequest.bind(auth));
    }

    _loadEnv() {
        try {
            const dotenv = require('dotenv');
            dotenv.config({
                path: this.baseDir + '.env'
            });
        } catch (err) {
            if (err.code === 'MODULE_NOT_FOUND') return;
            throw err;
        }
    }

    // TODO: change to use a class, support singleton props, default true?
    registerMiddleware(name, param) {
        const fn = helpers.resolveFn(this.srcDir, param);
        this.registeredMiddleware[name] = fn;
    }

    registerDefaultMiddleware(name, param) {
        this.registerMiddleware(name, param);
        this.defaultMiddleware.push(name);
    }

    registerRoutes(param) {
        const fn = helpers.resolveFn(this.srcDir, param);
        const router = new Router(this);
        fn(router);
    }

    setRequestErrorHandler(fn) {
        this.requestErrorHandler = fn;
    }

    start(port, ip) {
        return this.fastify.listen(port, ip);
    }
}

Object.assign(Application.prototype, Http);

const app = new Application();
module.exports = app;

let cache = {
    app,
    auth,
    err: errors,
    h: helpers,
    log: createLogger,
    require: requireFromSrcDir,
    isLoaded
};

const builders = {
    cli: () => require('./cli'),
    mysql: () => require('./mysql'),
    sentry: () => require('./sentry'),
    uuid4: () => require('uuid').v4,
    wsServer: () => require('./websocket')
};

function getOrBuildModule(name) {
    if (cache[name]) return cache[name];
    if (builders[name]) return cache[name] = builders[name]();
    return undefined;
}

function isLoaded(name) {
    return cache[name] !== undefined;
}

function createLogger(scope) {
    return app.fastify.log.child({ scope });
}

function requireFromSrcDir(path) {
    return helpers.smartRequire(app.srcDir + path);
}

global.$sf = new Proxy({}, {
    get: (_, prop) => getOrBuildModule(prop)
});