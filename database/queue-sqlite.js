const async  = require('async');
const sqlite = require('sqlite3');
const uuid   = require('node-uuid');

function SqliteStore(opts) {
    opts = opts || {};
    const self = this;
    self._path = opts.path || ':memory:';
    self._tableName = opts.tableName || 'task';
    self.setImmediate = opts.setImmediate || setImmediate;
}

SqliteStore.prototype.connect = function (cb) {
    const self = this;
    self._db = new sqlite.Database(self._path, function (err) {
        if (err) return cb(err);
        self._db.exec(`
      CREATE TABLE IF NOT EXISTS ${self._tableName} (id TEXT UNIQUE, lock TEXT, task TEXT, priority NUMERIC, added INTEGER PRIMARY KEY AUTOINCREMENT);
      CREATE INDEX IF NOT EXISTS priorityIndex ON ${self._tableName} (lock, priority desc, added);
      PRAGMA synchronous=OFF;
      PRAGMA journal_mode=MEMORY;
      PRAGMA temp_store=MEMORY;
      `, function (err) {
            if (err) return cb(err);
            self._db.get(`SELECT COUNT (*) FROM ${self._tableName} WHERE lock = ""`, function (err, results) {
                if (err) return cb(err);
                return cb(null, results['COUNT (*)']);
            });
        });
    });

    self._putCargo = new async.cargo(function (tasks, cb) {
        tasks = tasks.filter((task) => task !== 'dummy');
        if (!tasks.length) return cb();
        self._db.run('BEGIN', function () {
            tasks.forEach(function (task) {
                // TODO: Optimize (take out self._tableName evaluation)
                self._db.run(`INSERT OR REPLACE INTO ${self._tableName} (id, task, priority, lock) VALUES (?, ?, ?, ?)`, [task.taskId, task.serializedTask, task.priority, '']);
            })
            self._db.run('COMMIT', cb);
        });
    }, 3000);
};

SqliteStore.prototype._afterWritten = function (cb) {
    this._putCargo.push('dummy', function () {
        cb();
    });
}

SqliteStore.prototype.getTask = function (taskId, cb) {
    const self = this;
    self._afterWritten(function () {
        self._db.all(`SELECT * FROM ${self._tableName} WHERE id = ? AND lock = ?`, [taskId, ''], function (err, rows) {
            if (err) return cb(err);
            if (!rows.length) return cb();
            const row = rows[0];
            let savedTask;
            try {
                savedTask = JSON.parse(row.task);
            } catch (e) {
                return cb('failed_to_deserialize_task');
            }
            cb(null, savedTask);
        });
    });
};

SqliteStore.prototype.deleteTask = function (taskId, cb) {
    const self = this;
    self._afterWritten(function () {
        self._db.run(`DELETE FROM ${self._tableName} WHERE id = ?`, [taskId], cb);
    });
};


// TODO: Put a cargo in front of this.
SqliteStore.prototype.putTask = function (taskId, task, priority, cb) {
    const self = this;
    let serializedTask;
    try {
        serializedTask = JSON.stringify(task);
    } catch (e) {
        return cb('failed_to_serialize_task');
    }
    self._putCargo.push({
        taskId,
        serializedTask,
        priority
    });
    self.setImmediate(cb);
};


SqliteStore.prototype.getLock = function (lockId, cb) {
    const self = this;
    self._afterWritten(function () {
        self._db.all(`SELECT id, task FROM ${self._tableName} WHERE lock = ?`, [lockId || ''], function (err, rows) {
            if (err) return cb(err);
            const tasks = {};
            rows.forEach(function (row) {
                tasks[row.id] = JSON.parse(row.task);
            });
            cb(null, tasks);
        });
    });
};


SqliteStore.prototype.getRunningTasks = function (cb) {
    const self = this;
    self._db.all(`SELECT * FROM ${self._tableName} WHERE NOT lock = ?`, [''], function (err, rows) {
        if (err) return cb(err);
        const tasks = {};
        rows.forEach(function (row) {
            if (!row.lock) return;
            tasks[row.lock] = tasks[row.lock] || [];
            tasks[row.lock][row.id] = JSON.parse(row.task);
        });
        cb(null, tasks);
    });
};

SqliteStore.prototype.releaseLock = function (lockId, cb) {
    const self = this;
    self._db.run(`DELETE FROM ${self._tableName} WHERE lock = ?`, [lockId], cb);
};


SqliteStore.prototype.close = function (cb) {
    const self = this;
    if (self._db) return self._db.close(cb);
    cb();
};


SqliteStore.prototype.takeFirstN = function (num, cb) {
    const self = this;
    const lockId = uuid.v4();

    self._afterWritten(function () {
        self._db.run(`UPDATE ${self._tableName} SET lock = ? WHERE id IN (SELECT id FROM ${self._tableName} WHERE lock = ? ORDER BY priority DESC, added ASC LIMIT ${num})`, [lockId, ''], function (err, result) {
            if (err) return cb(err);
            cb(null, this.changes ? lockId : '');
        });
    });
};

SqliteStore.prototype.takeLastN = function (num, cb) {
    const self = this;
    const lockId = uuid.v4();
    self._afterWritten(function () {
        self._db.run(`UPDATE ${self._tableName} SET lock = ? WHERE id IN (SELECT id FROM ${self._tableName} WHERE lock = ? ORDER BY priority DESC, added DESC LIMIT ${num})`, [lockId, ''], function (err, result) {
            if (err) return cb(err);
            cb(null, this.changes ? lockId : '');
        });
    });
};

SqliteStore.prototype.close = function (cb) {
    if (this.adapter) return this.adapter.close(cb);
    cb();
};

module.exports = SqliteStore;
