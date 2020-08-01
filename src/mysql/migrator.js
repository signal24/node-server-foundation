const fs = require('fs');
const { exec } = require('child_process');
const log = function() { console.log.apply(console, arguments); } // TODO: do better logging

class Migrator {
    async run(dir) {
        dir = dir || 'migrations';
        dir = $sf.app.baseDir + dir;

        if (!fs.existsSync(dir))
            throw new Error('migrations directory does not exist');
        
        let migrations = fs.readdirSync(dir);
        migrations.sort();

        await this.checkMigrationsTable();
        const executedMigrationRows = await $sf.mysql.query('select name from _migrations order by name');
        const executedMigrations = executedMigrationRows.pluck('name');
        
        const unexecutedMigrations = migrations.diff(executedMigrations);
        for (let migration of unexecutedMigrations) {
            log('running migration:', migration);

            if (/\.sql$/i.test(migration)) {
                await this.runSqlMigration(dir + '/' + migration);
            }

            else if (/\.js$/i.test(migration)) {
                await this.runFileMigration(dir + '/' + migration);
            }

            else {
                throw new Error('unsupported file type for migration: ' + migration);
            }

            log('completed migration:', migration);

            await $sf.mysql.query('insert into _migrations (name) values (?)', [ migration ]);
        }
    }

    async checkMigrationsTable() {
        const tableCheckResult = await $sf.mysql.query(`show tables like '_migrations'`);
        if (tableCheckResult.length > 0) return;

        await $sf.mysql.query("CREATE TABLE `_migrations` ( \
            `name` varchar(255) NOT NULL DEFAULT '', \
            PRIMARY KEY (`name`) \
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8");
    }

    async runSqlMigration(file) {
        const statementsBlob = fs.readFileSync(file, 'utf8');
        const statements = this.extractStatements(statementsBlob);

        for (let statement of statements) {
            try {
                await $sf.mysql.query(statement);
            } catch (err) {
                log('failed to execute statement:', statement);
                throw err;
            }
        }
    }

    async runFileMigration(file) {
        let migrationFn;

        try {
            migrationFn = require(file);
        } catch (err) {
            log('failed to load migration');
            throw err;
        }

        if (typeof migrationFn !== 'function') {
            throw new Error('migration does not export a function');
        }

        try {
            await migrationFn();
        } catch(err) {
            log('migration function failed to execute');
            throw err;
        }
    }

    extractStatements(statementsBlob) {
        let statements = [];

        const quoteChars = ["'", '"', '`'];
        let statementStartIdx = 0;
        let activeQuote = null;
        for (let i = 0; i < statementsBlob.length; i++) {
            const char = statementsBlob.charAt(i);

            if (quoteChars.includes(char)) {
                if (activeQuote === null) {
                    activeQuote = char;
                } else if (char === activeQuote) {
                    if (statementsBlob.charAt(i - 1) !== '\\') {
                        activeQuote = null;
                    }
                }

                continue;
            }

            if (activeQuote !== null)
                continue;
            
            if (char === ';') {
                const statement = statementsBlob.substring(statementStartIdx, i).trim();
                statement.length && statements.push(statement);
                statementStartIdx = i + 1;
            }
        }

        const lastStatement = statementsBlob.substring(statementStartIdx).trim();
        lastStatement.length && statements.push(lastStatement);

        return statements;
    }
}

module.exports = Migrator;