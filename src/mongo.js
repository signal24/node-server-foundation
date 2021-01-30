const mongodb = require('mongodb');

class Mongo {
    constructor() {
        const host = process.env.NSF_MONGO_HOST || '127.0.0.1';
        const port = process.env.NSF_MONGO_PORT || 27017;

        let authObj = {};

        if (process.env.NSF_MONGO_USER) {
            authObj.auth = {
                user: process.env.NSF_MONGO_USER,
                password: process.env.NSF_MONGO_PASSWORD
            };

            if (process.env.NSF_MONGO_AUTH_DB) {
                authObj.authSource = process.env.NSF_MONGO_AUTH_DB;
            }
        }

        const uri = `mongodb://${host}:${port}`;
        this.client = new mongodb.MongoClient(uri, {
            useUnifiedTopology: true,
            ...authObj
        });
    }

    async init() {
        if (!process.env.NSF_MONGO_DATABASE) throw new Error('NSF_MONGO_DATABASE not configured');

        await this.client.connect();
        this.db = this.client.db(process.env.NSF_MONGO_DATABASE);
    }

    // these are just convenience functions to skip the '.db' from having to be called over and over

    collection(...args) {
        return this.db.collection(...args);
    }

    c(...args) {
        return this.db.collection(...args);
    }
}

module.exports = new Mongo();