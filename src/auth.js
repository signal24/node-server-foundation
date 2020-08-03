const os = require('os');
const jwt = require('fast-jwt');
// const uuid = require('uuid');

class Auth {
    init() {
        if (!process.env.JWT_SECRET) return;

        const secret = Buffer.from(process.env.JWT_SECRET, 'base64');
        this.jwtIssuer = process.env.JWT_ISSUER;
        this.jwtSigner = jwt.createSigner({ key: secret });
        this.jwtVerifier = jwt.createVerifier({ key: secret, cache: true, allowedIss: this.jwtIssuer });

        this.jwtIdPrefix = os.hostname() + '/' + (process.env.APP_NAME || 's24nsf') + '/' + process.pid;
        this.jwtExpirationMins = 15;

        this.jwtCookieName = process.env.JWT_COOKIE_NAME || 'jwt';
        this.jwtCookieRe = new RegExp('(^|;)[ ]*' + this.jwtCookieName + '=([^;]+)');
    }

    async authorizeRequest(request, reply, next) {
        if (!this.jwtVerifier) throw new Error('JWT_SECRET was not provided at application startup.');

        if (request.headers.authorization) {
            if (request.headers.authorization.substr(0, 7) === 'Bearer ') {
                if (await this._authorizeJwt(request, reply, request.headers.authorization.substr(7))) {
                    return await next();
                }
            }
        }

        if (request.headers.cookie) {
            const matches = request.headers.cookie.match(this.jwtCookieRe);
            if (matches) {
                if (await this._authorizeJwt(request, reply, matches[2])) {
                    return await next();
                }
            }
        }
        
        throw new $sf.err.UnauthorizedError;
    }

    async _authorizeJwt(request, reply, token) {
        try {
            const payloadJson = await this.jwtVerifier(token);
            const payload = JSON.parse(payloadJson);

            request.auth = {
                id: payload.st === 'n' ? Number(payload.sub) : payload.sub,
                jwt: payload
            };

            return true;
        }
        
        catch (err) {
            if (err instanceof jwt.TokenError) return false;
            throw err;
        }
    }

    async generateJwt(opts, request) {
        if (typeof opts !== 'object') {
            opts = { subject: opts };
        }

        // const tokenIdBuf = Buffer.allocUnsafe(16);
        // uuid.v5(this.jwtIdPrefix, uuid.v5.URL, tokenIdBuf);

        const subjectType = typeof opts.subject;

        const payload = {
            // jti: tokenIdBuf.toString('base64').replace(/=+$/, ''),
            iat: Math.floor(Date.now() / 1000),
            iss: this.jwtIssuer,
            sub: String(opts.subject),
            st: subjectType.substr(0, 1),
            exp: this._getExpirationTs(opts)
        };
        
        const jwt = await this.jwtSigner(JSON.stringify(payload));

        if (request) {
            request.auth = {
                id: opts.subject,
                jwt: payload  
            };
        }

        return jwt;
    }

    async generateJwtCookie(opts, request, reply) {
        const jwtPayload = await this.generateJwt(opts, request);
        reply.header('Set-Cookie', `${this.jwtCookieName}=${jwtPayload}; Path=/; HttpOnly`);
    }

    async renewJwtCookie(opts, request, reply) {
        if (typeof reply === 'undefined') {
            reply = request;
            request = opts;
            opts = {};
        }

        if (!opts || !request || !reply) throw new Error('missing parameters');
        if (!request.auth) throw new Error('expected auth object is not present on request');

        request.auth.jwt.exp = this._getExpirationTs(opts);
        
        const jwtPayload = await this.jwtSigner(JSON.stringify(request.auth.jwt));
        reply.header('Set-Cookie', `${this.jwtCookieName}=${jwtPayload}; Path=/; HttpOnly`);
    }

    clearJwtCookie(request, reply) {
        reply.header('Set-Cookie', `${this.jwtCookieName}=invalid; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly`);
    }

    setExpirationMinutes(mins) {
        this.jwtExpirationMins = mins;
    }

    _getExpirationTs(opts) {
        const expiresMs =
            opts.expiresAt ||
            (Date.now() + (opts.expiryMins || this.jwtExpirationMins) * 60 * 1000);
        return Math.floor(expiresMs / 1000);
    }
}

module.exports = new Auth();