const helpers = require('./helpers');
const fastifyStatic = require('fastify-static');
const path = require('path');

// TODO: add ctx w/ req & reply?
// TODO: is a chepaer to use a single function and arrays to run middleware?

class Router {
    constructor(app, opts) {
        this.app = app;
        this.opts = opts || {};
        
        if (typeof opts == 'undefined') {
            this.isBare = true;
            this.opts.middleware = [];
            this.opts.prefix = '/';
            this.opts.dir = this.app.baseDir;
        }
    }

    register(param) {
        const fn = helpers.resolveFn(this.opts.dir, param);
        const chainedRouter = copyRouter(this);
        fn(chainedRouter);
        return this;
    }

    prefix(prefix) {
        if (this.isBare) return copyRouter(this).prefix(prefix);
        this.opts.prefix += trimSlashes(prefix) + '/';
        return this;
    }

    dir(dir) {
        if (this.isBare) return copyRouter(this).dir(prefix);
        this.opts.dir += trimSlashes(dir) + '/';
        return this;
    }

    middleware(name) {
        if (this.isBare) return copyRouter(this).middleware(name);
        if (!this.app.registeredMiddleware[name])
            throw new Error(`middleware "${name}" is not registered`);
        this.opts.middleware.unshift(name);
        return this;
    }

    get(path, target) { return this.route('GET', path, target); }
    post(path, target) { return this.route('POST', path, target); }
    put(path, target) { return this.route('PUT', path, target); }
    delete(path, target) { return this.route('DELETE', path, target); }

    resource(path, target, fastifyOpts) {
        const targetClass = helpers.resolveFn(this.opts.dir, target, 'class');
        const classInstance = new targetClass();
        const fnNames = getClassFunctions(classInstance);
        fnNames.includes('index') && this._route('GET', path, targetClass, 'index', fastifyOpts);
        fnNames.includes('show') && this._route('GET', path + '/:id', targetClass, 'show', fastifyOpts);
        fnNames.includes('store') && this._route('POST', path, targetClass, 'store', fastifyOpts);
        fnNames.includes('update') && this._route('PUT', path + '/:id', targetClass, 'update', fastifyOpts);
        fnNames.includes('destroy') && this._route('DELETE', path + '/:id', targetClass, 'destroy', fastifyOpts);
    }

    route(method, path, targetClass, fnName, fastifyOpts) {
        if (typeof targetClass === 'string') {
            if (targetClass.includes('@')) {
                fastifyOpts = fnName;
                [targetClass, fnName] = targetClass.split('@');
            }

            targetClass = helpers.resolveFn(this.opts.dir, targetClass, 'class');
        }

        if (typeof fnName === 'undefined') {
            fnName = 'handle';
        }

        const classInstance = new targetClass();
        if (typeof classInstance[fnName] !== 'function')
            throw new Error(`class for route ${method} ${this.opts.prefix}${path} does not include "${fnName}" function`);

        return this._route(method, path, targetClass, fnName, fastifyOpts);
    }

    _route(method, path, targetClass, fnName, fastifyOpts = {}) {
        const handler = makeRouteHandler(this, targetClass, fnName);

        this.app.fastify.route({
            ...fastifyOpts,
            method,
            url: this.opts.prefix + path,
            handler
        });

        return this;
    }

    ws(path, targetClass, fastifyOpts = {}) {
        if (typeof targetClass === 'string') {
            targetClass = helpers.resolveFn(this.opts.dir, targetClass, 'class');
        }

        const classInstance = new targetClass();
        if (typeof classInstance.handle !== 'function')
            throw new Error(`class for WebSocket route ${this.opts.prefix}${path} does not include "handle" function`);

        // this line appears to do nothing, but it will cause the WebSocket server to be loaded if it hasn't already been
        // this allows us to throw an error at route registration time instead of runtime if ws isn't installed
        $sf.wsServer;

        this.app.fastify.route({
            ...fastifyOpts,
            method: 'GET',
            url: this.opts.prefix + path,
            handler: makeWebSocketHandler(this, targetClass)
        });
    }

    static(localPath, urlPath) {
        if (!this.isBare) throw new Error('static routes can only be registered to the root router');

        if (urlPath) {
            urlPath = '/' + urlPath.replace(/^\/|\/$/g, '') + '/';
        } else {
            urlPath = '/';
        }

        this.app.fastify.register(fastifyStatic, {
            root: path.normalize(this.app.baseDir + '/' + localPath),
            prefix: urlPath,
            decorateReply: urlPath === '/'
        });
    }
}

module.exports = Router;

function trimSlashes(str) {
    if (str.substr(0, 1) == '/')
        str = str.substr(1);
    if (str.substr(-1) == '/')
        str = str.substr(0, str.length - 1);
    return str;
};

function copyRouter(src) {
    let copiedOpts = Object.assign({}, src.opts);
    copiedOpts.middleware = Object.assign([], copiedOpts.middleware);
    const dst = new Router(src.app, copiedOpts);
    return dst;
}

function getClassFunctions(obj) {
    let properties = new Set();
    let currentObj = obj;
    do {
        Object.getOwnPropertyNames(currentObj).map(item => properties.add(item));
    } while ((currentObj = Object.getPrototypeOf(currentObj)))
    return [...properties.keys()].filter(item => typeof obj[item] === 'function');
}

function makeRouteHandler(router, targetClass, fnName) {
    const handler = async (request, reply) => {
        const classInstance = new targetClass();
        return await classInstance[fnName](request, reply);
    };

    const wrappedHandler = wrapHandlerWithMiddleware(router, handler);
    return handleThenValidateReply.bind(this, wrappedHandler);
}

async function handleThenValidateReply(handler, request, reply) {
    const result = await handler(request, reply);

    if (!reply.sent) {
        if (typeof result == 'undefined')
            reply.status(501).send('HTTP handler did not return or send data');
        else    
            reply.send(result);
    }
}

function makeWebSocketHandler(router, targetClass) {
    const handler = async (request, reply) => {
        const classInstance = new targetClass();
        
        if (typeof classInstance.authorize === 'function') {
            await classInstance.authorize(request, reply);
            if (reply.sent) return;
        }

        reply.sent = true;
        
        request.raw.removeAllListeners();
        $sf.wsServer.handleUpgrade(request, request.raw.socket, Buffer.alloc(0), async ws => {
            try {
                await classInstance.handle(ws, request);
            } catch (err) {
                ws.terminate();
                request.log.error(err);
                return;
            }

            if (ws.listeners('error').length === 0) {
                ws.on('error', err => {
                    request.log.error(err);
                });
            }
        });
    };

    return wrapHandlerWithMiddleware(router, handler);
}

function wrapHandlerWithMiddleware(router, handler) {
    let result = handler;
    router.opts.middleware.forEach(middlewareName => {
        const nextHandler = result;
        const middlewareFn = router.app.registeredMiddleware[middlewareName];
        result = (request, reply) => {
            return middlewareFn(request, reply, async () => {
                return await nextHandler(request, reply);
            });
        };
    });
    return result;
}