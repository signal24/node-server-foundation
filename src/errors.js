process.listeners('unhandledRejection').length || process.on('unhandledRejection', err => {
    throw err;
});

class UnauthorizedError extends Error {
    type = 'UnauthorizedError';
    httpStatus = 401;
}

class AccessDeniedError extends Error {
    type = 'AccessDeniedError';
    httpStatus = 403;
}

class NotFoundError extends Error {
    type = 'NotFoundError';
    httpStatus = 404;
}

class CustomMessageError extends Error {
    render() {
        return {
            error: this.message
        };
    }
}

class InvalidRequestError extends CustomMessageError {
    type = 'InvalidRequestError';
    httpStatus = 400;
}

class UserInputError extends CustomMessageError {
    type = 'UserInputError';
    httpStatus = 422;
}

function _handleFastifyError(err, request, reply) {
    if (err.httpStatus) {
        request.log.info(`${err.type}: ${err.message}`);
        reply.code(err.httpStatus);
        reply.send(err.render ? err.render() : err.message);
        return;
    }

    request.log.error(err);
    reply.send(err);
}

module.exports = {
    UnauthorizedError,
    AccessDeniedError,
    NotFoundError,
    InvalidRequestError,
    UserInputError,
    _handleFastifyError
};