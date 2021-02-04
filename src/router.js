const constants = require('./constants');
const helpers = require('./helpers');
const fastifyStatic = require('fastify-static');
const pathLib = require('path');

// TODO: add ctx w/ req & reply?
// TODO: is a chepaer to use a single function and arrays to run middleware?

class Router {
    constructor(app, opts) {
        this.app = app;
        this.opts = opts || {};

        if (typeof opts == 'undefined') {
            this.isBare = true;
            this.opts.middleware = app.defaultMiddleware || [];
            this.opts.prefix = '/';
            this.opts.dir = this.app.srcDir;
            this.opts.routeOpts = {};
        }
    }

    register(fn) {
        fn(this);
        return this;
    }

    prefix(prefix, shouldCopy) {
        if (shouldCopy !== false) return copyRouter(this).prefix(prefix, false);
        this.opts.prefix += trimSlashes(prefix) + '/';
        return this;
    }

    dir(dir, shouldCopy) {
        if (shouldCopy !== false) return copyRouter(this).dir(dir, false);
        this.opts.dir += trimSlashes(dir) + '/';
        return this;
    }

    middleware(name, shouldCopy) {
        if (shouldCopy !== false) return copyRouter(this).middleware(name, false);
        if (!this.app.registeredMiddleware[name])
            throw new Error(`middleware "${name}" is not registered`);
        this.opts.middleware.unshift(name);
        return this;
    }

    rawBody(shouldCopy) {
        if (shouldCopy !== false) return copyRouter(this).rawBody(false);
        this.opts.routeOpts.rawBody = true;
        return this;
    }

    head(path, target, routeOpts) { return this.route('GET', path, target, routeOpts); }
    get(path, target, routeOpts) { return this.route('GET', path, target, routeOpts); }
    post(path, target, routeOpts) { return this.route('POST', path, target, routeOpts); }
    put(path, target, routeOpts) { return this.route('PUT', path, target, routeOpts); }
    patch(path, target, routeOpts) { return this.route('PUT', path, target, routeOpts); }
    delete(path, target, routeOpts) { return this.route('DELETE', path, target, routeOpts); }

    resource(path, target, routeOpts) {
        const targetClass = helpers.resolveFn(this.opts.dir, target, 'class');
        const classInstance = new targetClass();
        const fnNames = getClassFunctions(classInstance);
        fnNames.includes('index') && this._route('GET', path, targetClass, 'index', routeOpts);
        fnNames.includes('show') && this._route('GET', path + '/:id', targetClass, 'show', routeOpts);
        fnNames.includes('store') && this._route('POST', path, targetClass, 'store', routeOpts);
        fnNames.includes('update') && this._route('PUT', path + '/:id', targetClass, 'update', routeOpts);
        fnNames.includes('destroy') && this._route('DELETE', path + '/:id', targetClass, 'destroy', routeOpts);
        return this;
    }

    route(method, path, targetClass, fnName, routeOpts) {
        if (typeof targetClass === 'string') {
            if (targetClass.includes('@')) {
                routeOpts = fnName;
                [targetClass, fnName] = targetClass.split('@');
            }

            targetClass = helpers.resolveFn(this.opts.dir, targetClass, 'class');
        }

        else if (typeof targetClass === 'function') {
            const fnPropNames = Object.getOwnPropertyNames(targetClass);
            if (!fnPropNames.includes('prototype') || fnPropNames.includes('arguments')) {
                fnName = targetClass;
                targetClass = null;
            }

            else {
                if (typeof fnName === 'undefined') {
                    fnName = 'handle';
                }
            }
        }

        else {
            throw new Error(`target for route ${method} ${this.opts.prefix}${path} must be a function, class object, or string class name`);
        }

        if (targetClass !== null) {
            const classInstance = new targetClass();
            if (typeof classInstance[fnName] !== 'function')
                throw new Error(`class for route ${method} ${this.opts.prefix}${path} does not include "${fnName}" function`);
        }

        return this._route(method, path, targetClass, fnName, routeOpts);
    }

    _route(method, path, targetClass, fnName, routeOpts = {}) {
        const handler = makeRouteHandler(this, targetClass, fnName);

        const opts = { ...this.opts.routeOpts, ...routeOpts };

        if (opts.rawBody !== undefined) {
            if (opts.rawBody) {
                opts.preParsing = mergeHooks(opts.preParsing, hideBodyFromContentTypeParser);
                opts.preValidation = mergeHooks(opts.preValidation, unhideBodyFromContentTypeParser);
            } else {
                delete opts.rawBody;
            }
        }

        this.app.fastify.route({
            ...opts,
            method,
            url: this.opts.prefix + path,
            handler
        });

        return this;
    }

    ws(path, targetClass, routeOpts = {}) {
        if (typeof targetClass === 'string') {
            targetClass = helpers.resolveFn(this.opts.dir, targetClass, 'class');
        }

        const classInstance = new targetClass();
        if (typeof classInstance.handle !== 'function')
            throw new Error(`class for WebSocket route ${this.opts.prefix}${path} does not include "handle" function`);

        // this line appears to do nothing, but it will cause the WebSocket server to be loaded if it hasn't already been
        // this allows us to throw an error at route registration time instead of runtime if ws isn't installed
        $sf.get('wsServer');

        this.app.fastify.route({
            ...routeOpts,
            method: 'GET',
            url: this.opts.prefix + path,
            handler: makeWebSocketHandler(this, targetClass)
        });

        return this;
    }

    static(localPath, urlPath) {
        if (!this.isBare) throw new Error('static routes can only be registered to the root router');

        if (urlPath) {
            urlPath = '/' + urlPath.replace(/^\/|\/$/g, '') + '/';
        } else {
            urlPath = '/';
        }

        this.app.fastify.register(fastifyStatic, {
            root: pathLib.normalize(this.app.srcDir + '/' + localPath),
            prefix: urlPath,
            decorateReply: urlPath === '/'
        });

        return this;
    }
}

module.exports = Router;

function trimSlashes(str) {
    if (str.substr(0, 1) == '/')
        str = str.substr(1);
    if (str.substr(-1) == '/')
        str = str.substr(0, str.length - 1);
    return str;
}

function copyRouter(src) {
    let copiedOpts = Object.assign({}, src.opts);
    copiedOpts.middleware = Object.assign([], copiedOpts.middleware);
    copiedOpts.routeOpts = Object.assign({}, copiedOpts.roueOpts);
    const dst = new Router(src.app, copiedOpts);
    return dst;
}

function getClassFunctions(obj) {
    let properties = new Set();
    let currentObj = obj;
    do {
        Object.getOwnPropertyNames(currentObj).forEach(item => properties.add(item));
    } while ((currentObj = Object.getPrototypeOf(currentObj)))
    return [...properties.keys()].filter(item => typeof obj[item] === 'function');
}

function makeRouteHandler(router, targetClass, fnName) {
    let handler;

    if (typeof fnName === 'function') {
        handler = fnName;
    } else {
        handler = async (request, reply) => {
            const classInstance = new targetClass();
            return await classInstance[fnName](request, reply);
        };
    }

    const wrappedHandler = wrapHandlerWithMiddleware(router, handler);
    return handleThenValidateReply.bind(this, wrappedHandler);
}

async function handleThenValidateReply(handler, request, reply) {
    const result = await handler(request, reply);

    if (!reply.sent) {
        if (typeof result === 'undefined') {
            throw new $sf.err.UnproductiveHandlerError();
        }

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

function mergeHooks(existingHooks, newHook) {
    if (existingHooks === undefined) return newHook;
    if (Array.isArray(existingHooks)) return [...existingHooks, newHook];
    return [ existingHooks, newHook ];
}

const CONTENT_TYPE_PARSER_KEYS = ['content-type', 'content-length', 'transfer-encoding'];
async function hideBodyFromContentTypeParser(request, _reply, _payload) {
    const hiddenData = {};
    CONTENT_TYPE_PARSER_KEYS.forEach(key => {
        if (typeof request.headers[key] === 'undefined') return;
        hiddenData[key] = request.headers[key];
        request.headers[key] = undefined;
    });
    request[constants.kHiddenContentMeta] = hiddenData;
}

async function unhideBodyFromContentTypeParser(request, reply) {
    const hiddenData = request[constants.kHiddenContentMeta];
    request[constants.kHiddenContentMeta] = null;

    Object.keys(hiddenData).forEach(key => {
        request.headers[key] = hiddenData[key];
    });
}