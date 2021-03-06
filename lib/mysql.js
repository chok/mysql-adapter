/**
 * Module dependencies
 */
var mysql = require('mysql');
var jdb = require('jugglingdb');
var uuid = require('uuid');
var EnumFactory = require('./enumFactory').EnumFactory;

exports.initialize = function initializeSchema(schema, callback) {
    if (!mysql) return;

    var s = schema.settings;

    if (s.collation) {
        s.charset = s.collation.substr(0, s.collation.indexOf('_')); // Charset should be first 'chunk' of collation.
    } else {
        s.collation = 'utf8mb4_general_ci';
        s.charset = 'utf8mb4';
    }

    s.supportBigNumbers = (s.supportBigNumbers || false);
    s.timezone = (s.timezone || 'local');

    schema.client = getConnection(s);

    // MySQL specific column types
    schema.constructor.registerType(function Point() {});
    // Factory for Enums. Note that currently Enums can not be registered
    schema.EnumFactory = EnumFactory;

    schema.adapter = new MySQL(schema.client);
    schema.adapter.schema = schema;

    initializeConnection(schema.client, schema, callback);
}

function initializeConnection(connection, schema, callback) {
    var s = schema.settings;
    var pool = s.pool;
    var silentOnError = typeof s.silentOnError === 'undefined'?false:s.silentOnError;
    var retryOnError = typeof s.retryOnError === 'undefined'?true:s.retryOnError;
    var createDatabaseOnError = typeof s.createDatabaseOnError === 'undefined'?true:s.createDatabaseOnError;

    // Attach listeners first
    connection.on('error', function(err) {
        schema.log('connection error', err);
        schema.connected = false;
    });

    var cb = callback;

    if(pool) {
        callback = function(err, connection) {
            if (pool && connection) {
                connection.release();
            }

            cb && cb(err);
        };

        getQueryConnection(connection, schema, initDatabase);
    }
    else {
        callback = function(err, connection) {
            cb && cb(err);
        };

        connection.connect(function(err) {
            if(err) {
                schema.emit('init error', err);
                if (!silentOnError) {
                    console.log('connection.connect err', err);
                }
                if (retryOnError) {
                    setTimeout(schema.adapter.connect.bind(schema.adapter, callback), 6000);
                }
                return;
            }
            getQueryConnection(connection, schema, initDatabase);
        });
    }
    function initDatabase(err, connection) {
        if (err) {
            if (!silentOnError) {
                throw err;
            } else {
                return callback(err, connection);
            }
        }
        if (typeof s.database !== 'undefined') {
            connection.query('USE `' + s.database + '`', function (err) {
                if (err) {
                    schema.emit('init error', err);
                    if (createDatabaseOnError && err.message.match(/(^|: )unknown database/i)) {
                        var dbName = s.database;
                        var charset = s.charset;
                        var collation = s.collation;
                        var q = 'CREATE DATABASE ' + dbName + ' CHARACTER SET ' + charset + ' COLLATE ' + collation;
                        connection.query(q, function (err) {
                            if (!err) {
                                connection.query('USE ' + s.database, function(err) {
                                    if (err && !silentOnError) {
                                        throw err;
                                    }

                                    callback(err, connection);
                                });
                            } else if (!silentOnError) {
                                throw err;
                            } else {
                                callback(err, connection);
                            }
                        });
                    } else if (!silentOnError) {
                        throw err;
                    } else {
                        callback(err, connection);
                    }
                } else {
                    callback(err, connection);
                }
            });
        } else {
            callback(err, connection);
        }
    }
};

function getQueryConnection(connection, schema, callback) {
    if(schema.settings.pool) {
        connection.getConnection(callback);
    } else {
        callback(null, connection);
    }
}
/**
 * Returns a connection or a connection pool based on the settings object
 *
 * @param settings {Object}     adapter settings
 * @return connection {Object}  mysql connection object or connection pool
 */
function getConnection(settings) {
    var connection;

    var options = [
        'host',                 // The hostname of the database you are connecting to. (Default: localhost)
        'port',                 // The port number to connect to. (Default: 3306)
        'localAddress',         // The source IP address to use for TCP connection. (Optional)
        'socketPath',           // The path to a unix domain socket to connect to. When used host and port are ignored.
        'user',                 // The MySQL user to authenticate as.
        'password',             // The password of that MySQL user.
        'database',             // Name of the database to use for this connection (Optional).
        'charset',              // The charset for the connection. This is called "collation" in the SQL-level of MySQL (like utf8_general_ci). If a SQL-level charset is specified (like utf8mb4) then the default collation for that charset is used. (Default: 'UTF8_GENERAL_CI')
        'timezone',             // The timezone used to store local dates. (Default: 'local')
        'connectTimeout',       // The milliseconds before a timeout occurs during the initial connection to the MySQL server. (Default: 10 seconds)
        'stringifyObjects',     // Stringify objects instead of converting to values. See issue #501. (Default: 'false')
        'insecureAuth',         // Allow connecting to MySQL instances that ask for the old (insecure) authentication method. (Default: false)
        'typeCast',             // Determines if column values should be converted to native JavaScript types. (Default: true)
        'queryFormat',          // A custom query format function. See Custom format.
        'supportBigNumbers',    // When dealing with big numbers (BIGINT and DECIMAL columns) in the database, you should enable this option (Default: false).
        'bigNumberStrings',     // Enabling both supportBigNumbers and bigNumberStrings forces big numbers (BIGINT and DECIMAL columns) to be always returned as JavaScript String objects (Default: false). Enabling supportBigNumbers but leaving bigNumberStrings disabled will return big numbers as String objects only when they cannot be accurately represented with JavaScript Number objects (which happens when they exceed the [-2^53, +2^53] range), otherwise they will be returned as Number objects. This option is ignored if supportBigNumbers is disabled.
        'dateStrings',          // Force date types (TIMESTAMP, DATETIME, DATE) to be returned as strings rather then inflated into JavaScript Date objects. (Default: false)
        'debug',                // Prints protocol details to stdout. (Default: false)
        'trace',                // Generates stack traces on Error to include call site of library entrance ("long stack traces"). Slight performance penalty for most calls. (Default: true)
        'multipleStatements',   // Allow multiple mysql statements per query. Be careful with this, it exposes you to SQL injection attacks. (Default: false)
        'flags',                // List of connection flags to use other than the default ones. It is also possible to blacklist default ones. For more information, check Connection Flags.
        'ssl',                  // object with ssl parameters or a string containing name of ssl profile. See SSL options.
    ];

    var poolOptions = [
        'acquireTimeout',       // The milliseconds before a timeout occurs during the connection acquisition. This is slightly different from connectTimeout, because acquiring a pool connection does not always involve making a connection. (Default: 10 seconds)
        'waitForConnections',   // Determines the pool's action when no connections are available and the limit has been reached. If true, the pool will queue the connection request and call it when one becomes available. If false, the pool will immediately call back with an error. (Default: true)
        'connectionLimit',      // The maximum number of connections to create at once. (Default: 10)
        'queueLimit'            // The maximum number of connection requests the pool will queue before returning an error from getConnection. If set to 0, there is no limit to the number of queued connection requests. (Default: 0)
    ].concat(options);

    var aliases = {
        'user': ['username']
    };

    function getSetting(settings, name, aliases) {
        var currentAliases = aliases[name];
        if (typeof settings[name] !== 'undefined') {
            return settings[name]
        } else if (typeof currentAliases !== 'undefined') {
            for (var key in currentAliases) {
                var setting = getSetting(settings, currentAliases[key], []);
                if (setting !== null) {
                    return setting;
                }
            }
        }

        return null;
    }

    function filterSettings(settings, options) {
        filteredSettings = {}
        for (var key in options) {
            var option = options[key];
            var setting = getSetting(settings, option, aliases);

            if (setting !== null) {
                filteredSettings[option] = setting;
            }
        }

        return filteredSettings;
    }

    if (settings.pool) {
        var poolSettings = filterSettings(settings, poolOptions);

        return mysql.createPool(poolSettings);
    }

    var connectionSettings = filterSettings(settings, options);

    return mysql.createConnection(connectionSettings);
}

/**
 * MySQL adapter
 */

function MySQL(client) {
    this.name = 'mysql';
    this._models = {};
    this.client = client;
}

require('util').inherits(MySQL, jdb.BaseSQL);

MySQL.prototype.connect = function (callback) {
    this.client = getConnection(this.schema.settings);
    initializeConnection(this.client, this.schema, callback);
};

// bulk sql queies and track the sequence count
MySQL.prototype.bulkquery = function (sql,j, callback) {
    this.query(sql,function(err,info){
        callback(j,{err:err,info:info} );
    });
};

MySQL.prototype.query = function (sql, callback, quiet) {
    if (!this.schema.connected) {
        return this.schema.on('connected', function () {
            this.query(sql, callback, quiet);
        }.bind(this));
    }

    var pool = this.schema.settings.pool;
    var time = Date.now();
    var log = this.log;
    if (typeof callback !== 'function') throw new Error('callback should be a function');

    function checkData(err, connection, data) {
        if (err && err.message.match(/(^|: )unknown database/i)) {
            var dbName = err.message.match(/(^|: )unknown database '(.*?)'/i)[1];
            connection.query('CREATE DATABASE ' + dbName, function (error) {
                if(pool) {
                    connection.release();
                }

                if (!error) {
                    connection.query(sql, callback);
                } else {
                    callback(err);
                }
            });
            return;
        }
        if (log && !quiet) {
            log(sql, time);
        }
        if(!err && pool) {
            connection.release();
        }
        callback(err, data);
    }

    function process(err, connection) {
        if (err) {
            return checkData(err, connection);
        }

        connection.query(sql, function(err, data) {
            checkData(err, connection, data);
        });
    }

    getQueryConnection(this.client, this.schema, process);
};

/**
 * Must invoke callback(err, id)
 */
MySQL.prototype.create = function (model, data, callback) {
    var uuidType = this.get(model, 'uuid');

    if (!data.id && (uuidType === 'v1' || uuidType === 'v4')) {
        data.id = uuid[uuidType]();
    }

    var fields = this.toFields(model, data);
    var sql = 'INSERT INTO ' + this.tableEscaped(model);
    if (fields) {
        sql += ' SET ' + fields;
    } else {
        sql += ' VALUES ()';
    }
    this.query(sql, function (err, info) {
        callback(err, info && info.insertId || data.id);
    });
};

MySQL.prototype.updateOrCreate = function (model, data, callback) {
    var mysql = this;
    var fieldsNames = [];
    var fieldValues = [];
    var combined = [];
    var props = this._models[model].properties;
    Object.keys(data).forEach(function (key) {
        if (props[key] || key === 'id') {
            var k = '`' + key + '`';
            var v;
            if (key !== 'id') {
                v = mysql.toDatabase(props[key], data[key], key, model);
            } else {
                v = '"' + data[key] + '"';
            }
            fieldsNames.push(k);
            fieldValues.push(v);
            if (key !== 'id') combined.push(k + ' = ' + v);
        }
    });

    var sql = 'INSERT INTO ' + this.tableEscaped(model);
    sql += ' (' + fieldsNames.join(', ') + ')';
    sql += ' VALUES (' + fieldValues.join(', ') + ')';
    sql += ' ON DUPLICATE KEY UPDATE ' + combined.join(', ');

    this.query(sql, function (err, info) {
        if (!err && info && info.insertId) {
            data.id = info.insertId;
        }
        callback(err, data);
    });
};

MySQL.prototype.toFields = function (model, data) {
    var fields = [];
    var props = this._models[model].properties;
    Object.keys(data).forEach(function (key) {
        if (props[key]) {
            var value = this.toDatabase(props[key], data[key], key, model);
            if ('undefined' === typeof value) return;
            fields.push('`' + key.replace(/\./g, '`.`') + '` = ' + value);
        }
    }.bind(this));
    return fields.join(',');
};

function dateToMysql(val) {
    return val.getUTCFullYear() + '-' +
        fillZeros(val.getUTCMonth() + 1) + '-' +
        fillZeros(val.getUTCDate()) + ' ' +
        fillZeros(val.getUTCHours()) + ':' +
        fillZeros(val.getUTCMinutes()) + ':' +
        fillZeros(val.getUTCSeconds()) + '.' +
        fillZeros(val.getUTCMilliseconds(), 3);

    function fillZeros(v, nbDigits) {
        nbDigits = typeof nbDigits == 'undefined' ? 2 : nbDigits;

        v = parseInt(v);
        if (isNaN(v)) {
            v = 0;
        }
        negative = v < 0;
        result = v = Math.abs(v);

        for (var i = nbDigits - 1; i > 0; i--) {
            if (!(v < Math.pow(10, i))) {
                break;
            }

            result = '0' + result;
        }

        if (negative) {
            result = '-' + result;
        }

        return result;
    }
}

MySQL.prototype.toDatabase = function (prop, val, key, model) {
    if (key === 'id' && this.get(model, 'uuid') in {v1: 1, v4: 1}) {
        return this.client.escape(String(val));
    }
    if (val === null) return 'NULL';
    if (typeof val === 'undefined') return 'NULL';
    if (prop && prop.type.name === 'JSON') {
        return this.client.escape(JSON.stringify(val));
    }
    if (prop && prop.type instanceof Array) {
        return this.client.escape(JSON.stringify(val));
    }
    if (val.constructor.name === 'Array') {
        return val.map(function (v) {
            return this.toDatabase(prop, v, key, model);
        }.bind(this));
    } else if (val.constructor.name === 'Object') {
        var operator = Object.keys(val)[0]
        val = val[operator];
        if (operator === 'between') {
            return this.toDatabase(prop, val[0], key, model) +
                ' AND ' +
                this.toDatabase(prop, val[1], key, model);
        } else if (operator == 'inq' || operator == 'nin') {
            if (!(val.propertyIsEnumerable('length')) && typeof val === 'object' && typeof val.length === 'number') { //if value is array
                for (var i = 0; i < val.length; i++) {
                    val[i] = this.client.escape(val[i]);
                }
                return val.join(',');
            } else {
                return val;
            }
        } else if (!operator) {
            return 'NULL';
        }
    }
    if (!prop) return val;
    if (prop.type.name === 'Number') return Number(val);
    if (prop.type.name === 'Date') {
        if (!val) return 'NULL';
        if (!val.toUTCString) {
            val = new Date(val);
        }
        return '"' + dateToMysql(val) + '"';
    }
    if (prop.type.name == "Boolean") return val ? 1: 0;
    if (typeof prop.type === 'function') return this.client.escape(prop.type(val));
    return this.client.escape(val.toString());
};

MySQL.prototype.fromDatabase = function (model, data) {
    if (!data) return null;
    var props = this._models[model].properties;
    Object.keys(data).forEach(function (key) {
        var val = data[key];
        if (typeof val === 'undefined' || val === null) {
            return;
        }
        if (props[key]) {
            switch (props[key].type.name) {
            case 'Date':
                val = new Date(val.toString().replace(/GMT.*$/, 'GMT'));
                break;
            case 'Boolean':
                val = Boolean(val);
                break;
            case 'JSON':
                try {
                    val = JSON.parse(val);
                } catch(e) {
                    val = null;
                }
                break;
            }
        }
        data[key] = val;
    });
    return data;
};

MySQL.prototype.escapeName = function (name) {
    return '`' + name.replace(/\./g, '`.`') + '`';
};

MySQL.prototype.escapeCol = function (col) {
    return '`' + col + '`';
}

MySQL.prototype.all = function all(model, filter, callback) {

    var self = this;
    var sql = 'SELECT ';
    if (filter && filter.attributes) {
        var attributes = filter.attributes;

        if (attributes && !Array.isArray(attributes)) {
            attributes = [attributes];
        }

        sql += attributes.map(function (field) {
            return self.escapeCol(field);
        }).join(', ');
    } else {
        sql += '*';
    }
    sql += ' FROM ' + this.tableEscaped(model);


    if (filter) {

        if (filter.where) {
            if (Object.getOwnPropertyNames(filter.where).length==0) {
                 throw new Error('Where field is empty');
            };
            sql += ' WHERE ' + this._buildWhere(model, filter.where);
        }

        if (filter.group) {
            sql += ' ' + buildGroupBy(filter.group);
        }

        if (filter.order) {
            sql += ' ' + buildOrderBy(filter.order);
        }

        if (filter.limit) {
            sql += ' ' + buildLimit(filter.limit, filter.skip || 0);
        }

    }

    this.query(sql, function (err, data) {
        var objs;
        if (err) {
            return callback(err, []);
        }
        if (filter && filter.attributes) {
            objs = data;
        } else {
            objs = data.map(function (obj) {
                return self.fromDatabase(model, obj);
            });
        }

        if (filter && filter.include) {
            this._models[model].model.include(objs, filter.include, callback);
        } else {
            callback(null, objs);
        }
    }.bind(this));

    return sql;

    function buildGroupBy(group) {
        if (typeof group === 'string') group = [group];
        return 'GROUP BY ' + group.map(function (o) {
            var t = o.split(/\s+/);
            if (t.length === 1) return '`' + o + '`';
            return '`' + t[0] + '` ' + t[1];
        }).join(', ');
    }

    function buildOrderBy(order) {
        if (typeof order === 'string') order = [order];
        return 'ORDER BY ' + order.map(function (o) {
            var t = o.split(/\s+/);
            if (t.length === 1) return '`' + o + '`';
            return '`' + t[0] + '` ' + t[1];
        }).join(', ');
    }

    function buildLimit(limit, offset) {
        return 'LIMIT ' + (offset ? (offset + ', ' + limit): limit);
    }

};

MySQL.prototype._buildWhere = function (model, conds) {
    if(!conds){
        return "";
    }
    var self = this;
    var cs = [];
    var props = this._models[model].properties;
    Object.keys(conds).forEach(function (key) {
        var keyEscaped = '`' + key.replace(/\./g, '`.`') + '`';
        var val = self.toDatabase(props[key], conds[key], key, model);
        if (conds[key] === null || conds[key] === undefined) {
            cs.push(keyEscaped + ' IS NULL');
        } else if (key.toLowerCase() === 'or' && conds[key] && conds[key].constructor.name === 'Array') {
            var queries = [];
            conds[key].forEach(function (cond) {
                queries.push(self._buildWhere(model, cond));
            });
            cs.push('(' + queries.join(' OR ') + ')');
        } else if (conds[key] && conds[key].constructor.name === 'Array') {
            cs.push(keyEscaped + ' IN (' + val.join(', ') + ')');

        } else if (conds[key] && conds[key].constructor.name === 'Object') {
            var condType = Object.keys(conds[key])[0];
            var sqlCond = keyEscaped;
            if ((condType == 'inq' || condType == 'nin') && val.length == 0) {
                cs.push(condType == 'inq' ? 0: 1);
                return true;
            }
            switch (condType) {
            case 'gt':
                sqlCond += ' > ';
                break;
            case 'gte':
                sqlCond += ' >= ';
                break;
            case 'lt':
                sqlCond += ' < ';
                break;
            case 'lte':
                sqlCond += ' <= ';
                break;
            case 'between':
                sqlCond += ' BETWEEN ';
                break;
            case 'inq':
                sqlCond += ' IN ';
                break;
            case 'nin':
                sqlCond += ' NOT IN ';
                break;
            case 'neq':
                sqlCond += ' != ';
                break;
            case 'like':
                sqlCond += ' LIKE ';
                val = self.client.escape(conds[key].like);
                break;
            }
            sqlCond += (condType == 'inq' || condType == 'nin') ? '(' + val + ')': val;
            cs.push(sqlCond);
        } else {
            cs.push(keyEscaped + ' = ' + val);
        }
    });
    if (cs.length === 0) {
        return '';
    }
    return cs.join(' AND ');
}

MySQL.prototype.count = function count(model, callback, where) {
    var self = this;
    var query = 'SELECT count(*) as cnt FROM ' +
        this.tableEscaped(model);
    if(where){
        query += ' where ' + this._buildWhere(model, where);
    }
    this.queryOne(query, function (err, res) {
        if (err) return callback(err);
        callback(err, res && res.cnt);
    });
};

MySQL.prototype.autoupdate = function (cb) {
    var self = this;
    var wait = 0;
    Object.keys(this._models).forEach(function (model) {
        wait += 1;
        self.query('SHOW FIELDS FROM ' + self.tableEscaped(model), function (err, fields) {
            if (err) {
                if(err.code != 'ER_NO_SUCH_TABLE') return done(err);
                return self.createTable(model, done);
            }
            self.query('SHOW INDEXES FROM ' + self.tableEscaped(model), function (err, indexes) {
                if (!err && fields.length) {
                    self.alterTable(model, fields, indexes, done);
                } else {
                    self.createTable(model, done);
                }
            }, true);
        }, true);
    });

    var hadError;
    function done(err) {
        if (err) {
            hadError = err;
            console.log(err);
        }
        if (--wait === 0 && cb) {
            cb(hadError);
        }
    }
};

MySQL.prototype.isActual = function (cb) {
    var ok = false;
    var self = this;
    var wait = 0;
    Object.keys(this._models).forEach(function (model) {
        wait += 1;
        self.query('SHOW FIELDS FROM ' + self.tableEscaped(model), function (err, fields) {
            if(err) {
                return done(err);
            }
            self.query('SHOW INDEXES FROM ' + self.tableEscaped(model), function (err, indexes) {
                if(err) {
                    return done(err);
                }
                self.alterTable(model, fields, indexes, done, true);
            }, true);
        }, true);
    });

    var hadError;
    function done(err, needAlter) {
        if (err) {
            hadError = err;
            console.log(err);
        }
        ok = ok || needAlter;
        if (--wait === 0 && cb) {
            cb(hadError, !ok);
        }
    }
};

MySQL.prototype.alterTable = function (model, actualFields, actualIndexes, done, checkOnly) {
    var self = this;
    var m = this._models[model];
    var propNames = Object.keys(m.properties).filter(function (name) {
        return !!m.properties[name];
    });
    var indexNames = m.settings.indexes ? Object.keys(m.settings.indexes).filter(function (name) {
        return !!m.settings.indexes[name];
    }): [];
    var sql = [];
    var ai = {};

    if (actualIndexes) {
        actualIndexes.forEach(function (i) {
            var name = i.Key_name;
            if (!ai[name]) {
                ai[name] = {
                    info : i,
                    columns : []
                };
            }
            ai[name].columns[i.Seq_in_index - 1] = i.Column_name;
        });
    }
    var aiNames = Object.keys(ai);

    // update primary key (id)
    var foundId;
    if (actualFields) {
        actualFields.forEach(function (f) {
            if (f.Field === 'id') {
                foundId = f;
            }
        });
    }
    if (foundId) {
        var uuidVersion = this.get(model, 'uuid');
        if (uuidVersion === 'v4' || uuidVersion === 'v1') {
            if (foundId.Type.toUpperCase() !== 'CHAR(36)') {
                sql.push('CHANGE COLUMN `id` `id` CHAR(36) NOT NULL');
            }
        } else {
            if (m.properties.id && m.properties.id.type === String) {
                if (foundId.Type.toUpperCase() !== 'VARCHAR(100)') {
                    sql.push('CHANGE COLUMN `id` `id` VARCHAR(100) NOT NULL');
                }
            } else {
                if (foundId.Type.toUpperCase() !== 'INT(11)') {
                    sql.push('CHANGE COLUMN `id` `id` INT(11) NOT NULL AUTO_INCREMENT');
                }
            }
        }
    }

    // change/add new fields
    propNames
        .filter(function(propName) { return propName !== 'id'; })
        .forEach(function (propName) {
            var found;
            if (actualFields) {
                actualFields.forEach(function (f) {
                    if (f.Field === propName) {
                        found = f;
                    }
                });
            }

            if (found) {
                actualize(propName, found);
            } else {
                sql.push('ADD COLUMN `' + propName + '` ' + self.propertySettingsSQL(model, propName));
            }
        });

    // drop columns
    if (actualFields) {
        actualFields.forEach(function (f) {
            var notFound = !~propNames.indexOf(f.Field);
            if (f.Field === 'id') return;
            if (notFound || !m.properties[f.Field]) {
                sql.push('DROP COLUMN `' + f.Field + '`');
            }
        });
    }

    // remove indexes
    aiNames.forEach(function (indexName) {
        if (indexName === 'id' || indexName === 'PRIMARY') return;
        if (indexNames.indexOf(indexName) === -1 && !m.properties[indexName] || m.properties[indexName] && (!m.properties[indexName].index || m.properties[indexName].type instanceof Array || m.properties[indexName].type.name === 'JSON')) {
            sql.push('DROP INDEX `' + indexName + '`');
        } else {
            // first: check single (only type and kind)
            if (m.properties[indexName] && !m.properties[indexName].index) {
                // TODO
                return;
            }
            // second: check multiple indexes
            var orderMatched = true;
            if (indexNames.indexOf(indexName) !== -1) {
                if (m.settings.indexes[indexName].keys) {
                    m.settings.indexes[indexName].columns = m.settings.indexes[indexName].keys.join(',');
                }
                m.settings.indexes[indexName].columns.split(/,\s*/).forEach(function (columnName, i) {
                    if (ai[indexName].columns[i] !== columnName) orderMatched = false;
                });
            }
            if (!orderMatched) {
                sql.push('DROP INDEX `' + indexName + '`');
                delete ai[indexName];
            }
        }
    });

    // add single-column indexes
    propNames.forEach(function (propName) {
        var prop = m.properties[propName];
        var i = prop.index;
        if (!i || prop.type && (prop.type instanceof Array ||  prop.type.name === 'JSON')) {
            return;
        }
        var found = ai[propName] && ai[propName].info;
        if (!found) {
            var type = '';
            var kind = '';
            if (i.type) {
                type = 'USING ' + i.type;
            }
            if (i.kind) {
                // kind = i.kind;
            }
            if (kind && type) {
                sql.push('ADD ' + kind + ' INDEX `' + propName + '` (`' + propName + '`) ' + type);
            } else {
                sql.push('ADD ' + kind + ' INDEX `' + propName + '` ' + type + ' (`' + propName + '`) ');
            }
        }
    });

    // add multi-column indexes
    indexNames.forEach(function (indexName) {
        var i = m.settings.indexes[indexName];
        var found = ai[indexName] && ai[indexName].info;
        if (!found) {
            var type = '';
            var kind = '';
            if (i.type) {
                type = 'USING ' + i.type;
            }
            if (i.kind) {
                kind = i.kind;
            }
            if (i.keys && i.keys.length) {
                i.columns = '`' + i.keys.join('`, `') + '`';
            }
            if (kind && type) {
                sql.push('ADD ' + kind + ' INDEX `' + indexName + '` (' + i.columns + ') ' + type);
            } else {
                sql.push('ADD ' + kind + ' INDEX ' + type + ' `' + indexName + '` (' + i.columns + ')');
            }
        }
    });

    if (sql.length) {
        var query = 'ALTER TABLE ' + self.tableEscaped(model) + ' ' + sql.join(',\n');
        if (checkOnly) {
            done(null, true, {
                statements : sql, query : query
            });
        } else {
            this.query(query, done);
        }
    } else {
        done();
    }

    function actualize(propName, oldSettings) {
        var newSettings = m.properties[propName];
        if (newSettings && changed(newSettings, oldSettings)) {
            sql.push('CHANGE COLUMN `' + propName + '` `' + propName + '` ' + self.propertySettingsSQL(model, propName));
        }
    }

    function changed(newSettings, oldSettings) {
        if (oldSettings.Null === 'YES') { // Used to allow null and does not now.
            if (newSettings.allowNull === false) return true;
            if (newSettings.null === false) return true;
        }
        if (oldSettings.Null === 'NO') { // Did not allow null and now does.
            if (newSettings.allowNull === true) return true;
            if (newSettings.null === true) return true;
            if (newSettings.null === undefined && newSettings.allowNull === undefined) return true;
        }

        if (oldSettings.Type.toUpperCase() !== datatype(newSettings).toUpperCase()) return true;
        return false;
    }
};

MySQL.prototype.propertiesSQL = function (model) {
    var self = this;
    var sql;

    var tableOptions = [];
    var uuidVersion = this.get(model, 'uuid');
    if (uuidVersion === 'v4' || uuidVersion === 'v1') {
        sql = ['`id` CHAR(36) NOT NULL PRIMARY KEY'];
    } else {
        sql = ['`id` INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY'];
    }
    Object.keys(this._models[model].properties).forEach(function (prop) {
        if (prop === 'id') return;
        sql.push('`' + prop + '` ' + self.propertySettingsSQL(model, prop));
    });
    // Declared in model index property indexes.
    Object.keys(this._models[model].properties).forEach(function (prop) {
        var p = self._models[model].properties[prop];
        var i = p.index;
        if (i && !(p.type instanceof Array)) {
            sql.push(self.singleIndexSettingsSQL(model, prop));
        }
    });
    // Settings might not have an indexes property.
    var dxs = this._models[model].settings.indexes;
    if (dxs) {
        Object.keys(this._models[model].settings.indexes).forEach(function (prop) {
            sql.push(self.indexSettingsSQL(model, prop));
        });
    }

    var engine = this._models[model].settings.engine;
    if (engine) {
        tableOptions.push('ENGINE '+engine);
    }

    return ' (\n  ' + sql.join(',\n  ') + '\n) '+tableOptions.join(',\n ');
};

MySQL.prototype.singleIndexSettingsSQL = function (model, prop) {
    // Recycled from alterTable single indexes above, more or less.
    var i = this._models[model].properties[prop].index;
    var type = '';
    var kind = '';
    if (i.type) {
        type = 'USING ' + i.type;
    }
    if (i.kind) {
        kind = i.kind;
    }
    if (kind && type) {
        return (kind + ' INDEX `' + prop + '` (`' + prop + '`) ' + type);
    } else {
        return (kind + ' INDEX `' + prop + '` ' + type + ' (`' + prop + '`) ');
    }
};

MySQL.prototype.indexSettingsSQL = function (model, prop) {
    // Recycled from alterTable multi-column indexes above, more or less.
    var i = this._models[model].settings.indexes[prop];
    var p = this._models[model].properties[prop];
    var type = '';
    var kind = '';
    if (i.type) {
        type = 'USING ' + i.type;
    }
    if (i.kind) {
        kind = i.kind;
    }
    if (i.keys && i.keys.length) {
        i.columns = '`' + i.keys.join('`, `') + '`';
    }
    if (kind && type) {
        return (kind + ' INDEX `' + prop + '` (' + i.columns + ') ' + type);
    } else {
        return (kind + ' INDEX ' + type + ' `' + prop + '` (' + i.columns + ')');
    }
};

MySQL.prototype.propertySettingsSQL = function (model, prop) {
    var p = this._models[model].properties[prop];
    var line = datatype(p) + ' ' +
        (p.allowNull === false || p['null'] === false ? 'NOT NULL': 'NULL');
    return line;
};

function datatype(p) {
    var dt = '';
    if (p.type instanceof Array) {
        return 'Text';
    }
    switch (p.type.name) {
        default :
    case 'String':
        dt = columnType(p, 'VARCHAR');
        dt = stringOptionsByType(p, dt);
        break;
    case 'JSON':
    case 'Text':
        dt = columnType(p, 'LONGTEXT');
        dt = stringOptionsByType(p, dt);
        break;
    case 'Number':
        dt = columnType(p, 'INT');
        dt = numericOptionsByType(p, dt);
        break;
    case 'Date':
        dt = columnType(p, 'DATETIME');
        dt = stringOptionsByType(p, dt);
        break;
    case 'Boolean':
        dt = 'TINYINT(1)';
        break;
    case 'Point':
        dt = 'POINT';
        break;
    case 'Enum':
        dt = 'ENUM(' + p.type._string + ')';
        dt = stringOptions(p, dt); // Enum columns can have charset/collation.
        break;
    }
    return dt;
}

function columnType(p, defaultType) {
    var dt = defaultType;
    if (p.dataType) {
        dt = String(p.dataType);
    }
    return dt;
}

function stringOptionsByType(p, dt) {
    switch (dt.toLowerCase()) {
        default :
    case 'varchar':
    case 'char':
        dt += '(' + (p.limit || p.length || 255) + ')';
        break;
    case 'datetime':
    case 'timestamp':

        if (p.length) {
            dt += '(' + p.length + ')';
        }
        break;

    case 'text':
    case 'tinytext':
    case 'mediumtext':
    case 'longtext':

        break;
    }
    dt = stringOptions(p, dt);
    return dt;
}

function stringOptions(p, dt) {
    if (p.charset) {
        dt += " CHARACTER SET " + p.charset;
    }
    if (p.collation) {
        dt += " COLLATE " + p.collation;
    }
    return dt;
}

function numericOptionsByType(p, dt) {
    switch (dt.toLowerCase()) {
        default :
    case 'tinyint':
    case 'smallint':
    case 'mediumint':
    case 'int':
    case 'integer':
    case 'bigint':
        dt = integerOptions(p, dt);
        break;

    case 'decimal':
    case 'numeric':
        dt = fixedPointOptions(p, dt);
        break;

    case 'float':
    case 'double':
        dt = floatingPointOptions(p, dt);
        break;
    }
    dt = unsigned(p, dt);
    return dt;
}

function floatingPointOptions(p, dt) {
    var precision = 16;
    var scale = 8;
    if (p.precision) {
        precision = Number(p.precision);
    }
    if (p.scale) {
        scale = Number(p.scale);
    }
    if (p.precision && p.scale) {
        dt += '(' + precision + ',' + scale + ')';
    } else if (p.precision) {
        dt += '(' + precision + ')';
    }
    return dt;
}

/*  @TODO: Change fixed point to use an arbitrary precision arithmetic library.     */
/*  Currently fixed point will lose precision because it's turned to non-fixed in   */
/*  JS. Also, defaulting column to (9,2) and not allowing non-specified 'DECIMAL'   */
/*  declaration which would default to DECIMAL(10,0). Instead defaulting to (9,2).  */

function fixedPointOptions(p, dt) {
    var precision = 9;
    var scale = 2;
    if (p.precision) {
        precision = Number(p.precision);
    }
    if (p.scale) {
        scale = Number(p.scale);
    }
    dt += '(' + precision + ',' + scale + ')';
    return dt;
}

function integerOptions(p, dt) {
    var tmp = 0;
    if (p.display || p.limit) {
        tmp = Number(p.display || p.limit);
    }
    if (tmp > 0) {
        dt += '(' + tmp + ')';
    } else if (p.unsigned) {
        switch (dt.toLowerCase()) {
            default :
        case 'int':
            dt += '(10)';
            break;
        case 'mediumint':
            dt += '(8)';
            break;
        case 'smallint':
            dt += '(5)';
            break;
        case 'tinyint':
            dt += '(3)';
            break;
        case 'bigint':
            dt += '(20)';
            break;
        }
    } else {
        switch (dt.toLowerCase()) {
            default :
        case 'int':
            dt += '(11)';
            break;
        case 'mediumint':
            dt += '(9)';
            break;
        case 'smallint':
            dt += '(6)';
            break;
        case 'tinyint':
            dt += '(4)';
            break;
        case 'bigint':
            dt += '(20)';
            break;
        }
    }
    return dt;
}

function unsigned(p, dt) {
    if (p.unsigned) {
        dt += ' UNSIGNED';
    }
    return dt;
}


function buildWhrSet(model) {
    this.buildWhrSet = function (buildtype, conds, self, props,querytype) {

        var cs = [];
        Object.keys(conds).forEach(function (key) {
            var keyEscaped = '`' + key.replace(/\./g, '`.`') + '`';
            var val = self.toDatabase(props[key], conds[key], key, model);
            if (conds[key] === null || conds[key] === undefined) {
                if (querytype!="update") {
                    cs.push(keyEscaped + ' IS NULL');
                }else{
                    cs.push(keyEscaped + ' = NULL');
                }
            } else if (conds[key] && conds[key].constructor.name === 'Object') {
                var condType = Object.keys(conds[key])[0];
                var sqlCond = keyEscaped;
                if ((condType == 'inq' || condType == 'nin') && val.length === 0) {
                    cs.push(condType == 'inq' ? 0: 1);
                    return true;
                }
                switch (condType) {
                case 'gt':
                    sqlCond += ' > ';
                    break;
                case 'gte':
                    sqlCond += ' >= ';
                    break;
                case 'lt':
                    sqlCond += ' < ';
                    break;
                case 'lte':
                    sqlCond += ' <= ';
                    break;
                case 'between':
                    sqlCond += ' BETWEEN ';
                    break;
                case 'inq':
                    sqlCond += ' IN ';
                    break;
                case 'nin':
                    sqlCond += ' NOT IN ';
                    break;
                case 'neq':
                    sqlCond += ' != ';
                    break;
                }
                sqlCond += (condType == 'inq' || condType == 'nin') ? '(' + val + ')': val;
                cs.push(sqlCond);
            } else {
                cs.push(keyEscaped + ' = ' + val);
            }
        });


        if (buildtype == 'Where') {
            return cs.length ? ' WHERE ' + cs.join(' AND '): '';
        } else {
            return cs.length ? ' SET ' + cs.join(' , '): '';
        }
    };
}

MySQL.prototype.update = function all(model, filter, callback) {

    var queryresulterr=[];
    var queryresultinfo=[];
    var querynum=0;
    var iferr=false;
    var sql="";
    var props = this._models[model].properties;

    var buidquery = new buildWhrSet(model);

    if (!Array.isArray(filter))
        filter = [filter];

    for (var i = 0; i<filter.length ; i++) {
        if (!filter[i].where || !filter[i].update) {
            queryresulterr[i]='Where or Update fields are missing';
            queryresultinfo[i]=null;
            querynum++;
            iferr=true;
            if (filter.length==querynum) {
                if (iferr) {
                    callback(queryresulterr,queryresultinfo);
                }else{
                    callback(null,queryresultinfo);
                }
            }
        }else{
            sql = 'UPDATE ' + this.tableEscaped(model) + buidquery.buildWhrSet('SET', filter[i].update, this, props,"update") + buidquery.buildWhrSet('Where', filter[i].where, this, props)+";";

            this.bulkquery(sql, i,function (k, res) {

                if (res.err!=null) {
                    iferr=true;
                }

                queryresulterr[k]=res.err;
                queryresultinfo[k]=res.info;
                querynum++;

                if (filter.length==querynum) {

                    if (iferr) {
                        callback(queryresulterr,queryresultinfo);
                    }else{
                        callback(null,queryresultinfo);
                    }
                }
            });

        }

    }

};

MySQL.prototype.get = function(model, key) {
    return this._models[model].settings[key];
};
