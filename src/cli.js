const { program } = require('commander');

module.exports = {
    hasArgs,
    registerCommand,
    start
};

program
    .command('start')
    .description('start the application')
    .action(() => {
        throw new Error('app should use $sf.cli.hasArgs() to avoid reaching this error');
    });

function hasArgs() {
    return process.argv.length > 2 && process.argv[2] !== 'start';
}

function registerCommand(commandString, handlerPath) {
    let handler = $sf.h.resolveFn($sf.app.baseDir, handlerPath, 'class');
    let command = program.command(commandString);
    if (handler.configure !== undefined) handler.configure(command);
    command.action((...args) => {
        let handlerInstance = new handler();
        if (typeof handlerInstance.handle !== 'function') throw new Error('handler function does not exist');
        handlerInstance.handle.apply(handlerInstance, args);
    });
}

function start() {
    program.parse(process.argv);
}