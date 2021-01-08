const Sentry = require('@sentry/node');
const os = require('os');

module.exports = {
    init,
    setExtra,
    setExtras,
    reportError
};

let extras = {};

function init(dsn) {
    Sentry.init({
        dsn,
        environment: process.env.NODE_ENV || 'development',
        release: $sf.app.name + '@' + $sf.app.version
    });

    $sf.app.setRequestErrorHandler((err, request) => {
        reportRequestError(request, err);
    });

    $sf.app.registerDefaultMiddleware('errorLogHandler', (request, reply, next) => {
        const originalFn = request.log.error;
        request.log.error = function() {
            reportRequestError(request, arguments[0]);
            return originalFn.apply(this, arguments);
        };

        return next();
    });
}

function setExtra(key, value) {
    extras[key] = value;
}

function setExtras(obj) {
    extras = { ...extras, obj };
}

function reportError(err) {
    return reportRequestError(null, err);
}

function reportRequestError(request, err) {
    Sentry.withScope(scope => {
        scope.setExtras(extras);

        if (request && request.headers['x-request-id'] !== undefined) {
            scope.setTag('request-id', request.headers['x-request-id']);
        }

        scope.addEventProcessor(event => {
            event.contexts = {
                ...event.contexts,
                runtime: {
                    name: 'node',
                    version: process.version
                }
            };

            event.server_name = os.hostname();

            if (request) {
                const isHttps = $sf.app.isHttps || request.headers['x-forwarded-proto'] === 'https';
                const proto = isHttps ? 'https' : 'http';

                event.request = {
                    ...event.request,
                    url: proto + '://' + request.hostname + request.url,
                    method: request.method,
                    query_string: request.query,
                    headers: request.headers,
                    data: request.json || undefined
                };

                event.user = {
                    id: request.auth?.id,
                    ip_address: request.ip
                };
            }

            return event;
        });

        Sentry.captureException(err);
    });
}