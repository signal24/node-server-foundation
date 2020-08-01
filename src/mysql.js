const mysql = require('mysql2/promise');
const Migrator = require('./mysql/migrator');

class MySQL {
    constructor() {
        this.pool = mysql.createPool({
            host: process.env.MYSQL_HOST,
            port: process.env.MYSQL_PORT,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE,
            timezone: 'Z'
        });
    }

    async init() {
        // simply verify that we can connect to the DB
        const conn = await this.pool.getConnection();
        await conn.release();
    }

    async migrate(dir) {
        const migrator = new Migrator();
        await migrator.run(dir);
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
        return await this.conn.query(sql, bindings)
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

    async fetch(table, where) {
        const [ whereFragment, whereBindings ] = buildWhereFragment(where);
        return this.query('SELECT * FROM `' + table + '`' + whereFragment, whereBindings);
    },

    async fetchOne(table, where) {
        const result = await this.fetch(table, where);
        return result.length > 0 ? result[0] : null;
    },

    async checkExists(table, where) {
        const [ whereFragment, whereBindings ] = buildWhereFragment(where);
        const result = await this.queryOne('SELECT 1 FROM `' + table + '`' + whereFragment, whereBindings);
        return result !== null;
    },

    async insert(table, obj) {
        const [ results ] = await this.exec('INSERT INTO `' + table + '` SET ?', obj);
        return results.insertId;
    },

    async update(table, obj, where) {
        let updates = [];
        let bindings = [];
        
        Object.keys(obj).forEach(key => {
            updates.push('`' + key + '`=?');
            bindings.push(obj[key]);
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

const instance = module.exports = new MySQL();

// module.exports = new Proxy(instance, {
//     get(_, prop) {
//         return instance[prop] || instance.pool[prop];
//     }
// })

function buildWhereFragment(where) {
    if (!where) return [ '', [] ];

    const whereKeys = Object.keys(where);
    if (!whereKeys.length) return [ '', [] ];

    let wheres = [];
    let bindings = [];

    whereKeys.forEach(key => {
        if (where[key] === null) {
            wheres.push('`' + key + '` IS NULL');
        } else {
            wheres.push('`' + key + '`=?');
            bindings.push(where[key]);
        }
    });

    return [ ' WHERE ' + wheres.join(' AND '), bindings ];
}