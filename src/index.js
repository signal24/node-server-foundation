require('./native-extensions');

const auth = require('./auth');
const helpers = require('./helpers');
const Http = require('./http');
const errors = require('./errors');
const Router = require('./router');

// TODO CORS

class Application {
    baseDir = null;
    registeredMiddleware = [];

    init(baseDir, envFilePath, fastifyOpts = {}) {
        this.baseDir = baseDir.replace(/\/$/, '') + '/';
        this._loadEnv(envFilePath);

        this._loadHttpsConfig(fastifyOpts);
        this._setupFastify(fastifyOpts);

        auth.init();
        this.registerMiddleware('auth', auth.authorizeRequest.bind(auth));
    }

    _loadEnv(envFilePath) {
        if (envFilePath) {
            envFilePath = helpers.resolvePath(envFilePath);
        }

        try {
            const dotenv = require('dotenv');
            dotenv.config({
                path: envFilePath || this.baseDir + '.env'
            });
        } catch (err) {
            if (err.code === 'MODULE_NOT_FOUND') return;
            throw err;
        }
    }

    // TODO: change to use a class, support singleton props, default true?
    registerMiddleware(name, param) {
        const fn = helpers.resolveFn(this.baseDir, param);
        this.registeredMiddleware[name] = fn;
    }

    registerRoutes(param) {
        const fn = helpers.resolveFn(this.baseDir, param);
        const router = new Router(this);
        fn(router);
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
    require: requireFromBase
};

const builders = {
    cli: () => require('./cli'),
    mysql: () => require('./mysql'),
    uuid4: () => require('uuid').v4,
    wsServer: () => require('./websocket')
};

function getOrBuildModule(name) {
    if (cache[name]) return cache[name];
    if (builders[name]) return cache[name] = builders[name]();
    return undefined;
}

function createLogger(scope) {
    return app.fastify.log.child({ scope });
}

function requireFromBase(path) {
    return helpers.smartRequire(app.baseDir + path);
}

global.$sf = new Proxy({}, {
    get: (_, prop) => getOrBuildModule(prop)
});