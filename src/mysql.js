const mysql = require('mysql2/promise');
const Migrator = require('./mysql/migrator');
const Model = require('./mysql/model');

class MySQL {
    constructor() {
        this.pool = mysql.createPool({
            host: process.env.NSF_MYSQL_HOST || '127.0.0.1',
            port: process.env.NSF_MYSQL_PORT || 3306,
            user: process.env.NSF_MYSQL_USER,
            password: process.env.NSF_MYSQL_PASSWORD,
            database: process.env.NSF_MYSQL_DATABASE,
            timezone: 'Z'
        });
    }

    async init() {
        // simply verify that we can connect to the DB
        const conn = await this.pool.getConnection();
        await conn.release();

        await Model.populateSchemaCache();
    }

    async migrate(dir) {
        const migrator = new Migrator();
        await migrator.run(dir);
    }

    async addHook(table, hook) {
        Model.addHook(table, hook);
    }

    async exec(sql, bindings) {
        return await this.pool.query(sql, bindings)
    }

    async startTransaction() {
        const cxn = await this.pool.getConnection();
        await cxn.query('START TRANSACTION');
        return new Transaction(cxn);
    }

    async runInTransaction(fn) {
        const txn = await this.startTransaction();

        try {
            await fn(txn);
            await txn.commit();
        }

        catch (err) {
            await txn.rollBack();
            throw err;
        }
    }
}

class Transaction {
    constructor(conn) {
        this.conn = conn;
    }

    async exec(sql, bindings) {
        try {
            return await this.conn.query(sql, bindings);
        } catch (err) {
            err.query = sql;
            err.bindings = bindings;
            throw err;
        }
    }

    async commit() {
        await this.query('COMMIT');
        await this.conn.release();
        this.conn = null;
    }

    async rollBack() {
        await this.query('ROLLBACK');
        await this.conn.release();
        this.conn = null;
    }
}

const Injections = {
    async query(sql, bindings) {
        const [ rows ] = await this.exec(sql, bindings);
        return rows;
    },

    async queryOne(sql, bindings) {
        const results = await this.query(sql, bindings);
        return results.length > 0 ? results[0] : null;
    },

    async fetchWithQuery(table, query, bindings) {
        const results = await this.query(query, bindings);
        return results.map(row => Model.buildModel(table, { ...row }));
    },

    async fetchOneWithQuery(table, query, bindings) {
        const results = await this.fetchWithQuery(table, query, bindings);
        return result.length > 0 ? results[0] : null;
    },

    async fetch(table, where, opts = {}) {
        const [ whereFragment, whereBindings ] = buildWhereFragment(where);
        const cols = opts.cols === undefined ? '*' : '`' + opts.cols.join('`,`') + '`';
        let query = 'SELECT ' + cols + ' FROM `' + table + '`' + whereFragment;
        if (opts.order !== undefined) query += ' ORDER BY ' + (typeof opts.order === 'object' ? '`' + opts.order.col + '` ' + opts.order.dir : '`' + opts.order + '` ASC');
        return this.fetchWithQuery(table, query, whereBindings);
    },

    async fetchOne(table, where, opts) {
        const results = await this.fetch(table, where, opts);
        return results.length > 0 ? results[0] : null;
    },

    async createModel(table, row) {
        return Model.buildModel(table, { ...row });
    },

    async checkExists(table, where) {
        const [ whereFragment, whereBindings ] = buildWhereFragment(where);
        const result = await this.queryOne('SELECT 1 FROM `' + table + '`' + whereFragment, whereBindings);
        return result !== null;
    },

    async getCount(table, where, col) {
        const [ whereFragment, whereBindings ] = buildWhereFragment(where);
        const result = await this.queryOne('SELECT COUNT(' + (col || '*') + ') AS count FROM `' + table + '`' + whereFragment, whereBindings);
        return result.count;
    },

    async insert(table, obj) {
        return await this._insert(table, obj, 'INSERT');
    },

    async insertIgnore(table, obj) {
        return await this._insert(table, obj, 'INSERT IGNORE');
    },

    async replace(table, obj) {
        return await this._insert(table, obj, 'REPLACE');
    },

    async _insert(table, obj, cmd) {
        const encodedObj = Model.encodeValues(table, obj);
        const [ results ] = await this.exec(cmd + ' INTO `' + table + '` SET ?', encodedObj);
        obj.id = obj.id || results.insertId;
        return Model.buildModel(table, obj);
    },

    async update(table, obj, where) {
        const encodedObj = Model.encodeValues(table, obj);

        let updates = [];
        let bindings = [];

        Object.keys(encodedObj).forEach(key => {
            updates.push('`' + key + '`=?');
            bindings.push(encodedObj[key]);
        });

        const [ whereFragment, whereBindings ] = buildWhereFragment(where);
        const query = 'UPDATE `' + table + '` SET ' + updates.join(',') + whereFragment;

        bindings.push.apply(bindings, whereBindings);

        const [ results ] = await this.exec(query, bindings);
        return results.affectedRows;
    },

    async delete(table, where) {
        const [ whereFragment, whereBindings ] = buildWhereFragment(where);
        const query = 'DELETE FROM `' + table + '`' + whereFragment;
        const [ results ] = await this.exec(query, whereBindings);
        return results.affectedRows;
    }
}

Object.assign(MySQL.prototype, Injections);
Object.assign(Transaction.prototype, Injections);

function buildWhereFragment(where) {
    if (!where) return [ '', [] ];

    const whereKeys = Object.keys(where);
    if (!whereKeys.length) return [ '', [] ];

    let wheres = [];
    let bindings = [];

    whereKeys.forEach(key => {
        if (where[key] === null) {
            wheres.push('`' + key + '` IS NULL');
        } else if (Array.isArray(where[key])) {
            wheres.push('`' + key + '` IN (' + where[key].map(() => '?').join(',') + ')');
            bindings.push(...where[key]);
        } else {
            wheres.push('`' + key + '`=?');
            bindings.push(where[key]);
        }
    });

    return [ ' WHERE ' + wheres.join(' AND '), bindings ];
}

module.exports = new MySQL();