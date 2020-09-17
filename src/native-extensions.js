Object.defineProperty(Array.prototype, 'diff', {
    enumerable: false,
    value: function(...args) {
        return this.filter(val => {
            for (let i = 0; i < args.length; i++) {
                if (args[i].includes(val)) {
                    return false;
                }
            }
            
            return true;
        });
    }
});

Object.defineProperty(Array.prototype, 'intersect', {
    enumerable: false,
    value: function(...args) {
        return this.filter(val => {
            for (let i = 0; i < args.length; i++) {
                if (args[i].includes(val)) {
                    return true;
                }
            }
            
            return false;
        });
    }
});

Object.defineProperty(Array.prototype, 'unique', {
    enumerable: false,
    value: function() {
        return [...new Set(this)]
    }
});

Object.defineProperty(Array.prototype, 'remove', {
    enumerable: false,
    value: function(element) {
        const index = this.indexOf(element);
        if (index >= 0) this.splice(index, 1);
    }
});

Object.defineProperty(Array.prototype, 'pluck', {
    enumerable: false,
    value: function(prop, keyProp) {
        if (typeof keyProp === 'undefined')
            return this.map(elem => elem[prop]);

        let result = {};
        this.forEach(elem => {
            result[elem[keyProp]] = elem[prop];
        });
        return result;
    }
});

Object.defineProperty(Array.prototype, 'keyBy', {
    enumerable: false,
    value: function(keyProp) {
        let result = {};
        this.forEach(elem => {
            result[elem[keyProp]] = elem;
        });
        return result;
    }
});

String.prototype.ucfirst = function() {
    return this.substr(0, 1).toUpperCase() + this.substr(1);
}

String.prototype.ucwords = function() {
    return this.replace(/^[a-z]| [a-z]/gi, function(value) {
        return value.toUpperCase();
    });
}
