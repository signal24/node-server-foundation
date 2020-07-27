Array.prototype.diff = function(...args) {
    return this.filter(val => {
        for (let i = 0; i < args.length; i++) {
            if (args[i].includes(val)) {
                return false;
            }
        }
        
        return true;
    });
}

Array.prototype.remove = function(element) {
    const index = this.indexOf(element);
    if (index >= 0) this.splice(index, 1);
}

Array.prototype.pluck = function(prop, keyProp) {
    if (typeof keyProp === 'undefined')
        return this.map(elem => elem[prop]);

    let result = {};
    this.forEach(elem => {
        result[elem[keyProp]] = elem[prop];
    });
    return result;
}